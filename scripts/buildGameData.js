/**
 * 게임 기준 DB 생성 — Community Dragon 한 곳에서 패치별로 만든다.
 *
 * 예전에는 기준 데이터가 출처마다 갈라져 있었다 (tftData.json = Data Dragon 전 세트 이름표,
 * championTraits.json = 메타 덱에서 역추출, traitBreakpoints.json · itemRecipes.json = Community Dragon,
 * lib/constants 의 수기 코스트표·기물표). 같은 사실이 여러 벌이라 서로 어긋났다 (예: 나르 2코 vs 5코).
 * 이 스크립트가 그 전부를 대체한다. Riot 경기 데이터의 id(DA_18_Azir, DA_RedBuff, DA_18_Defender)는
 * Community Dragon apiName 과 같은 표기라 정확히 일치로 찾는다.
 *
 * 산출물
 *  - lib/gameData.json            현재 세트 상세: 기물(코스트·시너지·스탯·스킬) · 시너지(단계·단계별 효과) · 아이템(조합법·효과)
 *  - lib/gameData.lite.json       클라이언트 공용 요약 (기물 슬러그·칸 수, 시너지 단계표) — lib/gameFacts
 *  - lib/gameNames.json           전 세트 이름·아이콘 (이전 세트 판 표시 · 다른 세트 시너지명 환각 검사용)
 *  - data/gameData/<버전>.json     패치별 보관본 (lib/gameData.json 과 같은 내용)
 * 입력
 *  - lib/gameData.overrides.json  사람이 확인해 붙이는 사실 (칸 수 · 역할 · 옛 키 별칭). 재생성해도 유지된다
 *
 * 사용법
 *  node scripts/buildGameData.js                  # 최신 패치 (content-metadata 의 버전)
 *  node scripts/buildGameData.js --version=16.20  # 특정 패치
 *  node scripts/buildGameData.js --set=18         # 세트 지정 (기본 18)
 *  node scripts/buildGameData.js --check          # 생성 후 아이콘 URL 이 모두 열리는지 확인
 *  node scripts/buildGameData.js --lite-only      # 네트워크 없이 lib/gameData.json 에서 lite 만 다시 만든다
 */
require('./_ts')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { entitySlug } = require('../lib/entitySlug')

const ROOT = path.join(__dirname, '..')
const CDRAGON = 'https://raw.communitydragon.org'
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
const SET = Number(arg('set') || 18)
const CHECK = process.argv.includes('--check')
const LITE_ONLY = process.argv.includes('--lite-only')

async function fetchJson(url, cacheName) {
  const cache = cacheName && path.join(os.tmpdir(), 'tft-cdragon', cacheName)
  if (cache && fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf-8'))
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  const text = await res.text()
  if (cache) {
    fs.mkdirSync(path.dirname(cache), { recursive: true })
    fs.writeFileSync(cache, text)
  }
  return JSON.parse(text)
}

/** 'assets/.../foo.tex' → 버전 고정 PNG URL */
const iconUrl = (version, asset) =>
  asset ? `${CDRAGON}/${version}/game/${asset.toLowerCase().replace(/\.(tex|dds)$/, '.png')}` : ''

/* ───────── 설명문 템플릿 ───────── */

/** '@Var@' · '@Var*100@' 를 값으로 바꾼다. 값을 모르면 '?' (변수명이 해시로만 남은 경우가 있다) */
function fillTemplate(text, lookup) {
  return text.replace(/@([A-Za-z0-9_{}.]+?)(?:\*(\d+))?@/g, (_, name, mul) => {
    const v = lookup(name)
    if (v == null) return '?'
    const show = (n) => String(Math.round(n * (mul ? Number(mul) : 1) * 100) / 100)
    return Array.isArray(v) ? (v.every((x) => x === v[0]) ? show(v[0]) : v.map(show).join('/')) : show(v)
  })
}

/** 게임 내 서식 태그 제거 */
const stripTags = (text) =>
  String(text || '')
    .replace(/\r/g, '')
    .replace(/\\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/%i:[A-Za-z]+%/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const ci = (obj) => {
  const m = new Map(Object.entries(obj || {}).map(([k, v]) => [k.toLowerCase(), v]))
  return (name) => m.get(name.toLowerCase())
}

/** 스킬 설명: 변수는 성급별(1·2·3성) 값이 배열로 있다 → "a/b/c" */
function abilityText(ability) {
  const vars = Object.fromEntries((ability?.variables || []).map((v) => [v.name, (v.value || []).slice(1, 4)]))
  return stripTags(fillTemplate(ability?.desc || '', ci(vars)))
}

/** 시너지 설명: 머리말 + 단계별 줄. <row> 순서가 effects 순서와 같다 */
function traitText(trait) {
  const desc = String(trait.desc || '')
  const rowAt = desc.indexOf('<row>')
  const head = stripTags(fillTemplate(rowAt >= 0 ? desc.slice(0, rowAt) : desc, ci(trait.effects?.[0]?.variables)))
  const rows = [...desc.matchAll(/<row>([\s\S]*?)<\/row>/g)].map((m) => m[1])
  const levels = (trait.effects || []).map((e, i) => {
    const lookup = ci({ MinUnits: e.minUnits, MaxUnits: e.maxUnits, ...e.variables })
    return {
      min: e.minUnits,
      max: e.maxUnits >= 25000 ? null : e.maxUnits,
      style: e.style,
      text: rows[i] != null ? stripTags(fillTemplate(rows[i], lookup)) : '',
    }
  })
  return { head, levels }
}

/* ───────── 아이템 분류 ───────── */

/** 기물에 장착되는 아이템 종류. 장착 아이템이 아니면 null. parts = 세트 아이템 조합법에 재료로 나오는 apiName */
function itemKind(item, parts) {
  const id = item.apiName
  // 보상 상자(조합 아이템 모루·무작위 조합 아이템)는 장착 아이템이 아니다
  if (/^TFT_Assist_/i.test(id)) return null
  if (/Component/i.test(id) || parts.has(id)) return 'component'
  if (/Emblem/i.test(id)) return 'emblem'
  if (/Radiant/i.test(id)) return 'radiant'
  if (/Artifact|Ornn/i.test(id)) return 'artifact'
  if ((item.composition || []).length === 2) return 'completed'
  if (/Potion/i.test(id)) return 'consumable'
  return null
}

/** DA_ 아이템은 설명이 비어 있다 → 같은 아이콘을 쓰는 일반 아이템(TFT_Item_*)의 설명·수치를 빌린다 */
function descTwinIndex(items) {
  const byIcon = new Map()
  for (const it of items) {
    if (!it.desc || it.isAugment || !it.icon) continue
    const key = it.icon.toLowerCase()
    const prev = byIcon.get(key)
    if (!prev || (/^TFT_Item_/.test(it.apiName) && !/^TFT_Item_/.test(prev.apiName))) byIcon.set(key, it)
  }
  return (item) => (item.desc ? item : byIcon.get((item.icon || '').toLowerCase()))
}

/* ───────── 본체 ───────── */

async function main() {
  const meta = await fetchJson(`${CDRAGON}/latest/content-metadata.json`)
  const latest = String(meta.version || '').split('.').slice(0, 2).join('.')
  const version = arg('version') || latest
  console.log(`Community Dragon ${version} (최신 ${meta.version}) · 세트 ${SET}`)

  const [ko, en] = await Promise.all([
    fetchJson(`${CDRAGON}/${version}/cdragon/tft/ko_kr.json`, `${version}-ko_kr.json`),
    fetchJson(`${CDRAGON}/${version}/cdragon/tft/en_us.json`, `${version}-en_us.json`),
  ])
  // 원본 이름 끝에 공백이 붙은 항목이 있다 ('그레이브즈 ')
  for (const d of [ko, en]) {
    for (const s of d.setData) for (const x of [...s.champions, ...s.traits]) x.name = (x.name || '').trim()
    for (const x of d.items) x.name = (x.name || '').trim()
  }
  const pick = (d) => d.setData.find((s) => s.mutator === `TFTSet${SET}`)
  const setKo = pick(ko)
  const setEn = pick(en)
  if (!setKo || !setEn) throw new Error(`세트 ${SET} (TFTSet${SET}) 데이터가 없습니다`)

  const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'gameData.overrides.json'), 'utf-8'))
  const enName = (list) => new Map(list.map((x) => [x.apiName, (x.name || '').trim()]))
  const enChamp = enName(setEn.champions)
  const enTrait = enName(setEn.traits)
  const enItem = enName(en.items)

  /* 시너지 */
  const traits = {}
  const traitApiByName = new Map()
  for (const t of setKo.traits) {
    const { head, levels } = traitText(t)
    const ov = overrides.traits?.[t.apiName] || {}
    traits[t.apiName] = {
      apiName: t.apiName,
      slug: entitySlug('trait', t.apiName),
      name: t.name,
      nameEn: enTrait.get(t.apiName) || '',
      // 같은 인원 단계가 두 번 나오는 시너지가 있다 (경쟁자 1,1,2) → 중복 제거. 일월식은 인원이 비어 있다(null) → 단계 없음
      breakpoints: [...new Set(levels.map((l) => l.min).filter((n) => typeof n === 'number'))].sort((a, b) => a - b),
      desc: head,
      levels,
      icon: iconUrl(version, t.icon),
      ...(ov.aliases ? { aliases: ov.aliases } : {}),
    }
    traitApiByName.set(t.name, t.apiName)
  }

  /* 기물 (시너지가 있는 1~5코스트만 — 크립·훈련용 허수아비·무기고 열쇠 등은 뺀다) */
  const champions = {}
  for (const c of setKo.champions) {
    if (!(c.traits || []).length || !(c.cost >= 1 && c.cost <= 5)) continue
    const traitIds = c.traits.map((n) => {
      const id = traitApiByName.get(n)
      if (!id) throw new Error(`${c.apiName} 의 시너지 '${n}' 가 시너지 목록에 없습니다`)
      return id
    })
    const s = c.stats || {}
    const ov = overrides.champions?.[c.apiName] || {}
    champions[c.apiName] = {
      apiName: c.apiName,
      slug: entitySlug('champion', c.apiName),
      name: c.name,
      nameEn: enChamp.get(c.apiName) || '',
      cost: c.cost,
      traits: traitIds,
      role: ov.role ?? c.role ?? null,
      slots: ov.slots ?? 1,
      stats: {
        hp: s.hp,
        armor: s.armor,
        magicResist: s.magicResist,
        damage: s.damage,
        attackSpeed: s.attackSpeed != null ? Math.round(s.attackSpeed * 100) / 100 : null,
        range: s.range,
        mana: s.mana,
        initialMana: s.initialMana,
      },
      ability: { name: c.ability?.name || '', desc: abilityText(c.ability) },
      icon: iconUrl(version, c.tileIcon || c.squareIcon),
    }
  }
  // 형태 변형 ('럭스 (검은 가시)' — 형태마다 시너지가 하나 더 붙는다). 경기 데이터의 기물 id 는 본체(DA_Lux18_Base) 그대로다
  const byName = new Map(Object.values(champions).map((c) => [c.name, c.apiName]))
  for (const c of Object.values(champions)) {
    const base = byName.get(c.name.match(/^(.+?)\s*\(.+\)$/)?.[1] ?? '')
    if (base && base !== c.apiName) c.variantOf = base
  }
  for (const id of Object.keys(overrides.champions || {})) {
    if (!champions[id]) throw new Error(`gameData.overrides.json 의 기물 ${id} 가 세트 ${SET} 에 없습니다`)
  }
  for (const id of Object.keys(overrides.traits || {})) {
    if (!traits[id]) throw new Error(`gameData.overrides.json 의 시너지 ${id} 가 세트 ${SET} 에 없습니다`)
  }

  /* 아이템 (세트 아이템 목록 기준, 증강 제외) */
  const allItems = new Map(ko.items.map((i) => [i.apiName, i]))
  const twin = descTwinIndex(ko.items)
  const parts = new Set(setKo.items.flatMap((id) => allItems.get(id)?.composition || []))
  const items = {}
  for (const apiName of setKo.items) {
    const it = allItems.get(apiName)
    if (!it || it.isAugment || !it.name) continue
    // 기물에 장착되지 않는 것(증강형 아이템·상점 효과 등)은 뺀다
    const kind = itemKind(it, parts)
    if (!kind) continue
    const src = twin(it)
    items[apiName] = {
      apiName,
      slug: entitySlug('item', apiName),
      name: it.name,
      nameEn: enItem.get(apiName) || '',
      kind,
      recipe: it.composition || [],
      tags: (it.tags || []).filter((t) => !t.startsWith('{')),
      desc: src ? stripTags(fillTemplate(src.desc, ci(src.effects))) : '',
      unique: Boolean(it.unique),
      icon: iconUrl(version, it.icon),
    }
  }
  for (const it of Object.values(items)) {
    for (const part of it.recipe) {
      if (!items[part]) throw new Error(`${it.apiName} 재료 ${part} 가 세트 아이템 목록에 없습니다`)
    }
  }

  const generatedAt = new Date().toISOString()
  const gameData = {
    _comment:
      '게임 기준 DB (Community Dragon 공식 추출 데이터). scripts/buildGameData.js 로 생성 — 손으로 고치지 말고 lib/gameData.overrides.json 에 적는다.',
    source: `${CDRAGON}/${version}/cdragon/tft/ko_kr.json`,
    set: SET,
    gameVersion: version,
    contentVersion: version === latest ? meta.version : version,
    generatedAt,
    counts: {
      champions: Object.keys(champions).length,
      traits: Object.keys(traits).length,
      items: Object.keys(items).length,
    },
    champions,
    traits,
    items,
  }

  /* 전 세트 이름표 — 같은 apiName 은 최신 세트가 이긴다 */
  const names = { champions: {}, traits: {}, items: {} }
  const sets = [...ko.setData].sort((a, b) => a.number - b.number)
  for (const s of sets) {
    for (const c of s.champions) if (c.name) names.champions[c.apiName] = { name: c.name, cost: c.cost, set: s.number, icon: iconUrl(version, c.tileIcon || c.squareIcon) }
    for (const t of s.traits) if (t.name) names.traits[t.apiName] = { name: t.name, set: s.number, icon: iconUrl(version, t.icon) }
  }
  for (const it of ko.items) if (!it.isAugment && it.name) names.items[it.apiName] = { name: it.name, icon: iconUrl(version, it.icon) }
  const gameNames = {
    _comment: '전 세트 기물·시너지·아이템 이름표 (Community Dragon). scripts/buildGameData.js 로 생성.',
    gameVersion: version,
    generatedAt,
    ...names,
  }

  const write = (rel, obj) => {
    const out = path.join(ROOT, rel)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, JSON.stringify(obj, null, 1) + '\n', 'utf-8')
    console.log(`✅ ${rel} (${Math.round(fs.statSync(out).size / 1024)}KB)`)
  }
  write('lib/gameData.json', gameData)
  write('lib/gameData.lite.json', liteOf(gameData))
  write('lib/gameNames.json', gameNames)
  write(`data/gameData/${version}.json`, gameData)
  console.log(`기물 ${gameData.counts.champions} · 시너지 ${gameData.counts.traits} · 아이템 ${gameData.counts.items}`)

  if (CHECK) await checkIcons(gameData)
}

/** 클라이언트 번들용 요약 — 설명·스탯·아이콘·아이템을 뺀다 (lib/gameFacts) */
function liteOf(gameData) {
  return {
    _comment: 'lib/gameData.json 의 클라이언트용 요약. scripts/buildGameData.js 로 생성.',
    // set: 전적의 이전 시즌 판을 분석에서 빼는 기준 (lib/queue)
    set: gameData.set,
    gameVersion: gameData.gameVersion,
    // traits: 시너지 한글명 — 시너지 인원 계산(lib/traitAnchors)이 클라이언트 장면(lib/keyMoments)에서도 돌도록
    champions: Object.values(gameData.champions).map(({ apiName, slug, name, nameEn, cost, slots, traits }) => ({
      apiName,
      slug,
      name,
      nameEn,
      cost,
      slots,
      traits: traits.map((id) => gameData.traits[id]?.name ?? id),
    })),
    traits: Object.values(gameData.traits).map(({ apiName, slug, name, nameEn, breakpoints, aliases }) => ({
      apiName,
      slug,
      name,
      nameEn,
      breakpoints,
      ...(aliases ? { aliases } : {}),
    })),
  }
}

/** 현재 세트 아이콘이 모두 열리는지 (HEAD) */
async function checkIcons(gameData) {
  const urls = [
    ...Object.values(gameData.champions).map((x) => x.icon),
    ...Object.values(gameData.traits).map((x) => x.icon),
    ...Object.values(gameData.items).map((x) => x.icon),
  ].filter(Boolean)
  const bad = []
  for (let i = 0; i < urls.length; i += 16) {
    await Promise.all(
      urls.slice(i, i + 16).map(async (u) => {
        const res = await fetch(u, { method: 'HEAD' }).catch(() => null)
        if (!res?.ok) bad.push(`${res?.status ?? 'ERR'} ${u}`)
      })
    )
  }
  console.log(`아이콘 확인: ${urls.length - bad.length}/${urls.length} 열림`)
  if (bad.length) {
    console.log(bad.slice(0, 30).join('\n'))
    process.exitCode = 1
  }
}

if (LITE_ONLY) {
  const out = path.join(ROOT, 'lib/gameData.lite.json')
  fs.writeFileSync(out, JSON.stringify(liteOf(JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/gameData.json'), 'utf-8'))), null, 1) + '\n', 'utf-8')
  console.log(`✅ lib/gameData.lite.json (${Math.round(fs.statSync(out).size / 1024)}KB)`)
} else main().catch((err) => {
  console.error('❌', err.message)
  process.exit(1)
})

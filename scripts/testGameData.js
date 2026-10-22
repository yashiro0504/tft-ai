/**
 * 게임 기준 DB(lib/gameData.json) 검증 — 실제 경기 데이터와 대조한다.
 *
 *  1. 구조: 기물 코스트 1~5 · 기물의 시너지가 모두 존재 · 조합법 재료가 모두 존재 · overrides 반영
 *  2. 골든셋(data/evalMatches.json, 저장소에 있음): 기물 id 가 모두 찾아지고 DB 코스트 = Riot rarity 코스트,
 *     아이템 한글명이 모두 찾아진다
 *  3. 래더 보드(data/ladderBoards.json, 로컬 수집본 — 있으면): 기물·시너지·아이템 id 가 정확히(apiName) 일치하고,
 *     Riot 이 판정한 시너지 단계 수(max)·달성 단계(tier)가 DB 단계표와 같다
 *  4. 조회 별칭: 통계 키·덱 데이터 옛 키·한글명으로도 찾는다
 *
 * 사용법: node scripts/testGameData.js   (npm run test:gamedata)
 */
require('./_ts')
const fs = require('fs')
const path = require('path')
const { GAME_CHAMPIONS, GAME_TRAITS, GAME_ITEMS, GAME_DATA_INFO, ITEM_RECIPES, BASIC_COMPONENT_NAMES, findChampion, findTrait, findItem } = require(
  '../lib/gameData'
)

const ROOT = path.join(__dirname, '..')
const failures = []
const check = (label, ok, detail = '') => {
  if (!ok) failures.push(detail ? `${label} — ${detail}` : label)
}
const eq = (label, actual, expected) => check(label, JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`)

/* 1. 구조 */
check('기물 수', GAME_CHAMPIONS.length >= 60, String(GAME_CHAMPIONS.length))
check('시너지 수', GAME_TRAITS.length >= 25, String(GAME_TRAITS.length))
for (const c of GAME_CHAMPIONS) {
  check('기물 코스트 1~5', c.cost >= 1 && c.cost <= 5, `${c.apiName}=${c.cost}`)
  check('기물 시너지 존재', c.traits.length > 0 && c.traits.every((t) => findTrait(t)?.apiName === t), c.apiName)
  check('기물 아이콘', /^https:\/\//.test(c.icon), c.apiName)
}
for (const t of GAME_TRAITS) {
  check('단계 오름차순', t.breakpoints.every((b, i) => i === 0 || b > t.breakpoints[i - 1]), `${t.name} ${t.breakpoints}`)
}
for (const i of GAME_ITEMS.filter((x) => x.recipe.length)) {
  check('조합법 재료 존재', i.recipe.every((r) => findItem(r)?.apiName === r), i.apiName)
}
eq('일반 조합 재료 8종', BASIC_COMPONENT_NAMES.length, 8)
check('조합법 30개 이상', Object.keys(ITEM_RECIPES).length >= 30, String(Object.keys(ITEM_RECIPES).length))

/* 2. 골든셋 — 기물 코스트는 Riot rarity 와 같아야 한다 */
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'evalMatches.json'), 'utf-8'))
const goldenUnits = new Map()
const goldenItems = new Set()
for (const c of golden.cases || []) {
  for (const m of c.matches || []) {
    for (const p of [m, ...(m.lobbyParticipants || [])]) {
      for (const u of p.units || []) {
        if (u.id) goldenUnits.set(u.id, u.rarity)
        for (const it of u.items || []) goldenItems.add(it)
      }
    }
  }
}
for (const [id, rarity] of goldenUnits) {
  const c = findChampion(id)
  check('골든셋 기물 찾기', Boolean(c), id)
  if (c && rarity != null) check('골든셋 코스트 = Riot rarity', c.cost === rarity, `${id} DB ${c.cost} / Riot ${rarity}`)
}
for (const name of goldenItems) check('골든셋 아이템 찾기', Boolean(findItem(name)), name)

/* 3. 래더 보드 — Riot 판정과 단계표 교차 검증 (로컬 수집본이 있을 때만) */
const ladderPath = path.join(ROOT, 'data', 'ladderBoards.json')
let ladderNote = '래더 보드 없음 (건너뜀)'
if (fs.existsSync(ladderPath)) {
  const ladder = JSON.parse(fs.readFileSync(ladderPath, 'utf-8'))
  const miss = new Set()
  const tierBad = new Map()
  let traits = 0
  for (const m of ladder.matches || []) {
    for (const b of m.boards || []) {
      for (const u of b.units || []) {
        if (findChampion(u.id)?.apiName !== u.id) miss.add(u.id)
        for (const it of u.items || []) if (findItem(it)?.apiName !== it) miss.add(it)
      }
      for (const t of b.traits || []) {
        traits++
        const tr = findTrait(t.id)
        if (tr?.apiName !== t.id) {
          miss.add(t.id)
          continue
        }
        if (!tr.breakpoints.length) continue
        // Riot max = 단계 수 (levels). 경쟁자(1·1·2명)처럼 같은 인원에 단계가 둘이면 뒤 단계는 조건부(카직스 진화)라
        // 인원만으로 정해지지 않는다 → 그 시너지는 달성 단계가 인원 기준 최대를 넘지 않는지만 본다
        const mins = tr.levels.map((l) => l.min)
        const conditional = new Set(mins).size !== mins.length
        const reached = tr.levels.filter((l) => typeof l.min === 'number' && t.units >= l.min).length
        if (tr.levels.length !== t.max || (conditional ? t.tier > reached : reached !== t.tier)) {
          const key = `${tr.name}: DB 단계 ${tr.levels.length}·달성 ${reached} / Riot ${t.max}·${t.tier} (인원 ${t.units})`
          tierBad.set(key, (tierBad.get(key) || 0) + 1)
        }
      }
    }
  }
  check('래더 id 정확히 일치', miss.size === 0, [...miss].slice(0, 10).join(', '))
  check('래더 시너지 단계 = Riot 판정', tierBad.size === 0, [...tierBad].slice(0, 5).map(([k, n]) => `${k} ×${n}`).join(' | '))
  ladderNote = `래더 시너지 ${traits}건 대조`
}

/* 4. 조회 별칭 · 알려진 사실 */
eq('장로 드래곤 칸', findChampion('DA_18_ElderDragon')?.slots, 2)
eq('나르 코스트 (통계 키)', findChampion('Gnar')?.cost, 5)
eq('코그모 (통계 키)', findChampion('KogMaw18_AD')?.name, '코그모')
eq('심술두꺼비 (슬러그)', findChampion('gromp18ap')?.name, '심술두꺼비')
eq('베이가 시너지', findChampion('베이가')?.traits.map((t) => findTrait(t).name), ['검은 가시', '날렵이', '주문술사'])
eq('옛 키 Eldritch', findTrait('Eldritch')?.name, '검은 가시')
eq('영문명 Ravager', findTrait('Ravager')?.name, '약탈자')
eq('나무정령 단계', findTrait('나무정령')?.breakpoints, [3, 5, 7, 9, 11])
eq('일월식 단계 없음', findTrait('DA_18_Eclipse')?.breakpoints, [])
eq('대천사의 지팡이 조합법', ITEM_RECIPES['대천사의 지팡이'], ['쓸데없이 큰 지팡이', '여신의 눈물'])
eq('붉은 덩굴정령 (DA_RedBuff)', findItem('DA_RedBuff')?.name, '붉은 덩굴정령')

/* 5. 클라이언트 요약본(lib/gameFacts)이 본 DB 와 같은 빌드 · 클라이언트 번들에 본 DB 가 들어가지 않음 */
const lite = require('../lib/gameData.lite.json')
const { traitBreakpointsOf, championSlots, CURRENT_CHAMPION_SLUGS } = require('../lib/gameFacts')
eq('lite 버전 = 본 DB 버전', lite.gameVersion, GAME_DATA_INFO.gameVersion)
for (const t of GAME_TRAITS) eq(`lite 단계표 ${t.name}`, traitBreakpointsOf(t.apiName), t.breakpoints)
for (const c of GAME_CHAMPIONS) {
  check('lite 기물 슬러그', CURRENT_CHAMPION_SLUGS.has(c.slug), c.apiName)
  eq(`lite 칸 수 ${c.name}`, championSlots(c.apiName), c.slots)
}

/** 'use client' 파일에서 import 를 따라가 lib/gameData · lib/gameNames 에 닿는 경로 */
function clientPathsToFullData() {
  const resolve = (from, spec) => {
    const base = spec.startsWith('@/') ? path.join(ROOT, spec.slice(2)) : spec.startsWith('.') ? path.join(path.dirname(from), spec) : null
    if (!base) return null
    for (const ext of ['', '.ts', '.tsx', '/index.ts']) {
      if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext
    }
    return null
  }
  const listTs = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = path.join(dir, d.name)
      if (d.isDirectory()) return d.name === 'node_modules' ? [] : listTs(p)
      return /\.tsx?$/.test(d.name) ? [p] : []
    })
  const clients = [...listTs(path.join(ROOT, 'app')), ...listTs(path.join(ROOT, 'lib'))].filter((f) =>
    /^['"]use client['"]/m.test(fs.readFileSync(f, 'utf-8'))
  )
  const seen = new Set()
  const hits = []
  const walk = (f, chain) => {
    if (seen.has(f)) return
    seen.add(f)
    for (const m of fs.readFileSync(f, 'utf-8').matchAll(/^import\s+(?!type\b)[^'"]*['"]([^'"]+)['"]/gm)) {
      const r = resolve(f, m[1])
      if (!r) continue
      if (/[\\/]lib[\\/](gameData|gameNames)\.(ts|json)$/.test(r)) hits.push([...chain, f, r].map((x) => path.relative(ROOT, x)).join(' → '))
      else if (/\.tsx?$/.test(r)) walk(r, [...chain, f])
    }
  }
  for (const c of clients) walk(c, [])
  return hits
}
const clientHits = clientPathsToFullData()
check('클라이언트 번들에 본 DB 없음 (lib/gameFacts 를 쓸 것)', clientHits.length === 0, clientHits.slice(0, 3).join(' | '))

const summary = `게임 기준 DB ${GAME_DATA_INFO.gameVersion} · 기물 ${GAME_CHAMPIONS.length} · 시너지 ${GAME_TRAITS.length} · 아이템 ${GAME_ITEMS.length} · 골든셋 기물 ${goldenUnits.size} · ${ladderNote}`
if (failures.length) {
  console.error(`❌ 게임 기준 DB 검증 실패 ${failures.length}건\n` + failures.slice(0, 40).map((f) => `  - ${f}`).join('\n'))
  console.error(summary)
  process.exit(1)
}
console.log(`✅ ${summary}`)

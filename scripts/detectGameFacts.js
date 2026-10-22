/**
 * 게임 사실 자동 탐지 — 쌓인 랭크 보드에서 "코드가 모르는 게임 규칙" 의 흔적을 찾는다.
 *
 * 실행: npm run facts:detect                (출처 자동: DB → data/ladderBoards.json → 골든셋)
 *       npm run facts:detect -- --source=db --out=tmp/facts.md --strict
 *
 * 2026-10-22 장로 드래곤(보드 2칸)을 찾은 방식을 일반화했다. 탐지기 4개:
 *  1. 칸 수 이상 — '기물 수 = 레벨 − 1' 보드에 몰려 나오는 기물 → 2칸 기물 후보 (lib/boardSlots 와 대조)
 *  2. 시너지 이중 계산 — 시너지 인원이 (그 시너지를 가진 기물 수 + 상징) 보다 많은 보드에 몰려 나오는 기물
 *  3. 성급·아이템 불가 — 자주 나오는데 2성이 한 번도 없거나 아이템을 한 번도 안 든 기물 (장면 규칙 오진단 위험)
 *  4. 사전 누락 — 코스트 표·이름·시너지 사전·단계표에 없는 키 (코스트 3 대체 → '1성 저코스트' 규칙 오작동)
 *
 * --strict: lib 에 반영 안 된 새 후보(1·2번)나 사전 누락이 있으면 종료 코드 1.
 * 후보는 "확인할 것" 목록이다 — 자동으로 코드를 고치지 않는다. 사람이 확인하고 lib 에 반영한다.
 */
const { arg, loadLobbies, writeReport, annotate } = require('./_boards')
const { entitySlug } = require('../lib/entitySlug')
const { unitSlots } = require('../lib/boardSlots')
const { getChampionCost } = require('../lib/constants')
const { GAME_TRAITS, championTraitNames, findChampion } = require('../lib/gameData')

/** 후보 기준: 기물이 나온 보드 수 하한 · 해당 비율 하한 · 기준선 대비 배수 하한 */
const MIN_BOARDS = 10
const MIN_RATE = 0.5
const MIN_LIFT = 3
/** 3번 탐지기: 이만큼 나와야 "한 번도 없음" 을 사실로 본다 */
const MIN_SEEN_NEVER = 30
/**
 * 이미 아는 시너지 인원 초과 (기물|시너지 → 이유). Riot 인원 값이 맞으므로 코드에서 고칠 것 없음.
 *  - 장로 드래곤: 협곡야수 2명 (lib/boardSlots 주석)
 *  - 카직스: 경쟁자 고유 능력 — 처치 관여로 진화해 처형자·속사포·약탈자·주문술사 중 하나를 영구히 얻는다 (Community Dragon 세트18 설명)
 *  - 럭스: 화신 — 형태(DA_18_Lux_Coven 등 9종)마다 시너지가 하나 더 붙는데, 매치 데이터 기물 id 는 DA_Lux18_Base 그대로다
 */
const KNOWN_TRAIT_EXCESS = new Map([
  ['elderdragon|협곡야수', '2명 계산'],
  ...['처형자', '속사포', '약탈자', '주문술사'].map((t) => [`khazix|${t}`, '진화로 시너지 획득']),
  ...['검은 가시', '개화', '악의 여단', '나무정령', '요정', '지옥불', '달빛', '원시', '햇빛'].map((t) => [`lux|${t}`, '형태로 시너지 획득']),
])

const slugOf = (u) => entitySlug('champion', u.id || '') || u.id
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d
const pct = (x) => `${round(x * 100, 0)}%`
const isAsciiKey = (s) => /^[\x20-\x7e]+$/.test(String(s || ''))

/** 시너지 한글명 → 단계표 (게임 기준 DB, 단계가 있는 시너지만) */
const TRAIT_BY_NAME = new Map(GAME_TRAITS.filter((t) => t.breakpoints.length).map((t) => [t.name, t]))
/** 현재 세트 시너지 공식 한글명. 이 이름인데 단계표에 없으면 단계 없는 특수 시너지(예: 일월식)다 */
const SET_TRAIT_NAMES = new Set(GAME_TRAITS.map((t) => t.name))

/** 기물의 시너지 한글명 Set (게임 기준 DB에 없으면 undefined) */
const champTraitsOf = (u) => {
  const c = findChampion(u.id)
  return c ? new Set(championTraitNames(c)) : undefined
}

/**
 * 조건(cond)이 참인 보드 비율을, 기물 U 가 있는 보드 vs 없는 보드로 비교한다.
 * 반환: 기물별 { name, n, rate, base, lift } (lift 내림차순)
 */
function unitLift(boards, cond) {
  const total = boards.length
  const hits = boards.filter(cond).length
  const per = new Map()
  for (const b of boards) {
    const hit = cond(b)
    for (const slug of new Set(b.units.map(slugOf))) {
      const u = b.units.find((x) => slugOf(x) === slug)
      if (!per.has(slug)) per.set(slug, { slug, name: u.name, n: 0, hit: 0, sample: u })
      const p = per.get(slug)
      p.n++
      if (hit) p.hit++
    }
  }
  return [...per.values()]
    .map((p) => {
      const otherN = total - p.n
      const base = otherN ? (hits - p.hit) / otherN : 0
      const rate = p.hit / p.n
      return { ...p, rate, base, lift: base > 0 ? rate / base : rate > 0 ? Infinity : 0 }
    })
    .sort((a, b) => b.lift - a.lift || b.n - a.n)
}

const isCandidate = (r) => r.n >= MIN_BOARDS && r.rate >= MIN_RATE && r.lift >= MIN_LIFT

/* ───────── 1. 칸 수 ───────── */

function detectSlots(boards) {
  // 후반 보드만 (레벨 7+): 초반 탈락 보드는 원래 빈칸이 많다
  const late = boards.filter((b) => (b.level || 0) >= 7)
  const short = (b) => b.units.length === b.level - 1
  const over = (b) => b.units.length > b.level
  const known = unitLift(late, short).filter((r) => unitSlots(r.sample) > 1)
  // 새 후보는 이미 아는 2칸 기물(과 앞서 찾은 후보)을 2칸으로 센 뒤에도 1칸 남는 보드에서 찾는다.
  // 그러지 않으면 장로 드래곤과 같은 덱에 늘 같이 나오는 마오카이·드레이븐이 후보로 뜬다.
  const extra = new Set()
  const slots = (b) => b.units.reduce((s, u) => s + (extra.has(slugOf(u)) ? 2 : unitSlots(u)), 0)
  const residualShort = (b) => slots(b) === b.level - 1
  const fresh = []
  for (;;) {
    const top = unitLift(late, residualShort).find((r) => unitSlots(r.sample) === 1 && !extra.has(r.slug) && isCandidate(r))
    if (!top) break
    fresh.push(top)
    extra.add(top.slug)
  }
  const overRows = unitLift(late, over).filter(isCandidate)
  // 현재 칸 표를 적용한 뒤에도 '칸 = 레벨 − 1' 인 보드 (진짜 1칸 비움 + 미확인 요인)
  extra.clear()
  const residual = late.filter(residualShort).length
  return {
    late: late.length,
    shortBase: late.filter(short).length,
    overBase: late.filter(over).length,
    residual,
    known,
    fresh,
    overRows,
  }
}

/* ───────── 2. 시너지 이중 계산 ───────── */

function emblemCount(units, traitName) {
  return units.reduce((s, u) => s + (u.items || []).filter((i) => i === `${traitName} 상징`).length, 0)
}

function detectTraitCounts(boards) {
  // 모든 기물의 시너지를 아는 보드만 (모르는 기물이 있으면 기대 인원을 셀 수 없다)
  const usable = boards.filter((b) => b.units.every((u) => Boolean(champTraitsOf(u))))
  /** 보드·시너지별 초과 인원 */
  const excessOf = (b, t) => {
    const holders = new Set(b.units.filter((u) => champTraitsOf(u).has(t.name)).map(slugOf))
    return (t.count || 0) - holders.size - emblemCount(b.units, t.name)
  }
  // 시너지 단위 표본: (보드, 시너지, 보드의 기물 슬러그들, 사전상 그 시너지를 가진 기물, 초과 여부)
  const allPairs = usable.flatMap((b) =>
    (b.traits || []).map((t) => ({
      trait: t.name,
      units: [...new Set(b.units.map(slugOf))],
      holders: new Set(b.units.filter((u) => champTraitsOf(u).has(t.name)).map(slugOf)),
      names: new Map(b.units.map((u) => [slugOf(u), u.name])),
      excess: excessOf(b, t) > 0,
    }))
  )
  const excessPairs = allPairs.filter((p) => p.excess).length

  /**
   * 아직 설명 안 된 쌍에서 (기물, 시너지)별 초과 비율.
   * 그 시너지를 가진 기물이면 '2명으로 세는' 후보, 사전상 안 가진 기물이면 '사전에서 시너지가 빠진' 후보다
   * (예: 카직스가 사전에 라이벌만 있으면 약탈자 인원이 남고, 같이 나오는 다이애나가 엉뚱하게 지목된다).
   */
  function liftRows(pool) {
    const base = pool.length ? pool.filter((p) => p.excess).length / pool.length : 0
    const per = new Map()
    for (const p of pool) {
      for (const slug of p.units) {
        const key = `${slug}|${p.trait}`
        if (!per.has(key)) {
          const kind = p.holders.has(slug) ? 'double' : 'missing'
          per.set(key, { key, slug, name: p.names.get(slug), trait: p.trait, kind, n: 0, hit: 0 })
        }
        const r = per.get(key)
        r.n++
        if (p.excess) r.hit++
      }
    }
    return [...per.values()]
      .map((r) => ({ ...r, rate: r.hit / r.n, base, lift: base > 0 ? r.hit / r.n / base : 0 }))
      .sort((a, b) => b.lift - a.lift || b.n - a.n)
  }

  // 가장 강한 후보부터 하나씩 확정하고, 그 기물이 있는 쌍은 설명된 것으로 빼고 다시 잰다
  // (장로 드래곤과 같은 협곡야수 덱에 늘 나오는 감시자가 덩달아 뜨지 않도록)
  // 이미 아는 규칙(장로 드래곤·카직스 진화·럭스 형태)이 설명하는 쌍은 먼저 뺀다. 그러지 않으면 카직스 덱에 늘 같이 나오는
  // 다이애나·헤카림이 카직스가 진화로 얻은 처형자·약탈자·주문술사를 덮어쓴다 (16.21 DB 첫 실행)
  const explainedByKnown = (p) => p.units.some((slug) => KNOWN_TRAIT_EXCESS.has(`${slug}|${p.trait}`))
  const rows = liftRows(allPairs)
    .filter((r) => KNOWN_TRAIT_EXCESS.has(r.key) && r.n >= MIN_BOARDS && r.rate >= MIN_RATE)
    .map((r) => ({ ...r, known: KNOWN_TRAIT_EXCESS.get(r.key) }))
  let pool = allPairs.filter((p) => !explainedByKnown(p))
  for (;;) {
    const top = liftRows(pool).find(isCandidate)
    if (!top) break
    rows.push({ ...top, known: null })
    pool = pool.filter((p) => !(p.trait === top.trait && p.units.includes(top.slug)))
  }
  return { usable: usable.length, skipped: boards.length - usable.length, pairs: allPairs.length, excessPairs, rows }
}

/* ───────── 3. 성급·아이템 불가 ───────── */

function detectNeverUpgraded(boards) {
  const per = new Map()
  for (const b of boards) {
    for (const u of b.units) {
      const s = slugOf(u)
      if (!per.has(s)) per.set(s, { slug: s, name: u.name, cost: u.rarity, n: 0, maxStar: 0, withItems: 0 })
      const p = per.get(s)
      p.n++
      p.maxStar = Math.max(p.maxStar, u.tier || 1)
      if ((u.items || []).length) p.withItems++
    }
  }
  const seen = [...per.values()].filter((p) => p.n >= MIN_SEEN_NEVER)
  return {
    neverStar: seen.filter((p) => p.maxStar <= 1).sort((a, b) => b.n - a.n),
    neverItems: seen.filter((p) => p.withItems === 0).sort((a, b) => b.n - a.n),
  }
}

/* ───────── 4. 사전 누락 ───────── */

function detectDictGaps(boards) {
  const gap = { cost: new Map(), champName: new Map(), traitMap: new Map(), itemName: new Map(), traitName: new Map(), breakpoints: new Map(), noBreakpoints: new Map() }
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1)
  for (const b of boards) {
    for (const u of b.units) {
      if (getChampionCost(u.id) === undefined) bump(gap.cost, u.id)
      if (isAsciiKey(u.name)) bump(gap.champName, u.id)
      if (!champTraitsOf(u)) bump(gap.traitMap, u.id)
      for (const [i, item] of (u.items || []).entries()) if (isAsciiKey(item)) bump(gap.itemName, u.itemIds?.[i] || item)
    }
    for (const t of b.traits || []) {
      if (isAsciiKey(t.name)) bump(gap.traitName, t.traitId || t.name)
      else if (!TRAIT_BY_NAME.has(t.name)) bump(SET_TRAIT_NAMES.has(t.name) ? gap.noBreakpoints : gap.breakpoints, t.name)
    }
  }
  const sorted = (m) => [...m].sort((a, b) => b[1] - a[1])
  return Object.fromEntries(Object.entries(gap).map(([k, m]) => [k, sorted(m)]))
}

/* ───────── 보고서 ───────── */

const liftRow = (r) => `| ${r.name} (\`${r.slug}\`) | ${r.n} | ${pct(r.rate)} | ${pct(r.base)} | ×${r.lift === Infinity ? '∞' : round(r.lift, 1)} |`
const LIFT_HEAD = ['| 기물 | 나온 보드 | 해당 비율 | 다른 보드 | 배수 |', '|---|---:|---:|---:|---:|']

const GAP_LABEL = {
  cost: ['코스트를 모르는 기물', 'lib/gameData.json (npm run build:gamedata) — 패치 후 재생성했는지 확인'],
  champName: ['한글명이 없는 기물', 'lib/gameData.json (npm run build:gamedata)'],
  traitMap: ['게임 기준 DB에 없는 기물', 'lib/gameData.json (npm run build:gamedata) — 2번 탐지기가 이 보드를 건너뛴다'],
  itemName: ['한글명이 없는 아이템', 'lib/gameData.json (npm run build:gamedata)'],
  traitName: ['한글명이 없는 시너지', 'lib/gameData.json (npm run build:gamedata)'],
  breakpoints: ['단계표에 없는 시너지', 'lib/gameData.json (npm run build:gamedata) — 1명 모자란 시너지 장면이 못 본다'],
}

function report(label, lobbies, boards, slots, traits, never, gaps) {
  const L = [`## 게임 사실 탐지 — ${label}`, '', `로비 ${lobbies.length}개 · 보드 ${boards.length}개. 후보 기준: 나온 보드 ${MIN_BOARDS}개+, 해당 비율 ${pct(MIN_RATE)}+, 다른 보드 대비 ×${MIN_LIFT}+.`, '']

  L.push('### 1. 보드 칸 수 (레벨 7+ 보드)', '')
  L.push(
    `레벨 7+ 보드 ${slots.late}개 중 '기물 수 = 레벨 − 1' ${slots.shortBase}개, '기물 수 > 레벨' ${slots.overBase}개. 현재 칸 표(lib/boardSlots) 적용 후에도 1칸 남는 보드 ${slots.residual}개.`,
    ''
  )
  if (slots.known.length) L.push('**이미 반영된 2칸 기물 (확인용)**', '', ...LIFT_HEAD, ...slots.known.map(liftRow), '')
  L.push(slots.fresh.length ? '**🆕 2칸 기물 후보 (lib/boardSlots 에 없음)**' : '새 2칸 기물 후보 없음.', '')
  if (slots.fresh.length) L.push(...LIFT_HEAD, ...slots.fresh.map(liftRow), '')
  if (slots.overRows.length) L.push("**'기물 수 > 레벨' 보드에 몰린 기물** (칸을 안 쓰는 기물 또는 팀 규모 증강 동반)", '', ...LIFT_HEAD, ...slots.overRows.map(liftRow), '')

  L.push('### 2. 시너지 인원 이중 계산', '')
  L.push(
    `시너지 사전으로 셀 수 있는 보드 ${traits.usable}개 (사전에 없는 기물이 있어 건너뜀 ${traits.skipped}개). 활성 시너지 ${traits.pairs}건 중 인원이 (기물 + 상징) 보다 많은 경우 ${traits.excessPairs}건.`,
    ''
  )
  if (traits.rows.length) {
    const what = (r) => (r.known ? `이미 앎 (${r.known})` : r.kind === 'double' ? '🆕 2명으로 세는 후보' : '🆕 사전에서 이 시너지가 빠진 후보')
    L.push('| 기물 | 시너지 | 나온 경우 | 초과 비율 | 다른 경우 | 배수 | 해석 |', '|---|---|---:|---:|---:|---:|---|')
    L.push(...traits.rows.map((r) => `| ${r.name} (\`${r.slug}\`) | ${r.trait} | ${r.n} | ${pct(r.rate)} | ${pct(r.base)} | ×${round(r.lift, 1)} | ${what(r)} |`), '')
    L.push(
      '> 2명으로 세는 기물: Riot 인원 값이 맞다 — 코드에서 기물 수로 시너지를 다시 세는 곳이 있는지 확인. 사전 누락: lib/gameData.json 의 그 기물 시너지 목록 확인 (Community Dragon 원본과 다르면 lib/gameData.overrides.json).',
      ''
    )
  } else L.push('이중 계산 후보 없음.', '')

  L.push(`### 3. 성급·아이템 불가 후보 (${MIN_SEEN_NEVER}보드+ 나왔는데 한 번도 없음)`, '')
  const neverRow = (p, what) => `| ${p.name} (\`${p.slug}\`, ${p.cost}코) | ${p.n} | ${what} |`
  const neverRows = [...never.neverStar.map((p) => neverRow(p, '2성 없음')), ...never.neverItems.map((p) => neverRow(p, '아이템 없음'))]
  if (neverRows.length) {
    L.push('| 기물 | 나온 보드 | 사실 |', '|---|---:|---|', ...neverRows, '')
    L.push("> 2성이 없는 기물은 '저코스트 캐리가 1성'·'같은 기물 1성 여러 장'·'같은 구성 성급 차이' 장면에서 실수로 보면 안 된다.", '')
  } else L.push('해당 없음.', '')

  L.push('### 4. 사전 누락', '')
  let anyGap = false
  for (const [key, [title, where]] of Object.entries(GAP_LABEL)) {
    const rows = gaps[key]
    if (!rows.length) continue
    anyGap = true
    L.push(`- **${title}** (${where}): ${rows.slice(0, 12).map(([k, n]) => `\`${k}\` ×${n}`).join(', ')}${rows.length > 12 ? ` 외 ${rows.length - 12}개` : ''}`)
  }
  if (!anyGap) L.push('누락 없음.')
  if (gaps.noBreakpoints.length) {
    L.push('', `참고 — 단계가 없는 세트 시너지 (정상, 장면 대상 아님): ${gaps.noBreakpoints.map(([k, n]) => `${k} ×${n}`).join(', ')}`)
  }
  L.push('')
  return { md: L.join('\n'), anyGap }
}

async function main() {
  const { label, lobbies } = await loadLobbies()
  const boards = lobbies.flatMap((l) => l.boards)
  console.log(`출처: ${label} — 로비 ${lobbies.length}개 · 보드 ${boards.length}개`)
  if (!boards.length) {
    console.error('보드가 없습니다.')
    process.exitCode = 1
    return
  }
  const slots = detectSlots(boards)
  const traits = detectTraitCounts(boards)
  const never = detectNeverUpgraded(boards)
  const gaps = detectDictGaps(boards)
  const { md, anyGap } = report(label, lobbies, boards, slots, traits, never, gaps)
  console.log(`\n${md}`)
  writeReport(md)
  for (const r of slots.fresh) annotate('2칸 기물 후보', `${r.name} (${r.slug}) — 칸 = 레벨 − 1 보드 ${pct(r.rate)} (${r.n}보드)`)
  for (const r of traits.rows.filter((x) => !x.known)) annotate('시너지 인원 이상', `${r.name} ${r.trait} — 초과 ${pct(r.rate)} (${r.n}건)`)
  if (anyGap) annotate('사전 누락', '보고서 4번 항목 확인')

  if (arg('strict') && (slots.fresh.length || traits.rows.some((r) => !r.known) || anyGap)) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

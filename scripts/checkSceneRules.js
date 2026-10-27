/**
 * 장면 규칙 검증 — "이 장면이 뜬 보드가 실제로 등수가 나쁜가" 를 쌓인 랭크 보드로 잰다.
 *
 * 실행: npm run rules:check                 (출처 자동: DB → data/ladderBoards.json → 골든셋)
 *       npm run rules:check -- --source=db --patch=16.20 --out=tmp/rules.md --strict
 *
 * - 장면 규칙은 lib/keyMoments 의 실제 코드(allKeyMoments)를 그대로 돌린다. 규칙을 바꾸면 이 결과도 바뀐다.
 * - 레벨이 등수와 강하게 묶여 있으므로(일찍 죽은 보드 = 낮은 레벨) 같은 레벨끼리 비교한 차이를 판정에 쓴다.
 * - 장면은 모두 "다듬을 점" 이므로, 뜬 보드가 같은 레벨에서 오히려 등수가 좋으면 규칙이 틀린 것이다
 *   (예: 2026-10-22 '1성 4·5코 캐리 + 아이템 = 나쁨' 오진단 — 아래 탐침(probe)으로 코스트별로 다시 잰다).
 * - --strict: 실제 규칙 중 '반대' 판정이 있으면 종료 코드 1.
 */
const { arg, loadLobbies, writeReport, annotate } = require('./_boards')
const { allKeyMoments, nearBreakpoints, ITEMS_ON_WEAK_MIN, WEAK_MAX_COST } = require('../lib/keyMoments')
const { boardCarry } = require('../lib/deckType')
const { CARRY_STAR_ODDS_MIN, oddsWindow } = require('../lib/shopOdds')

/** 판정 기준: 같은 레벨 비교 등수 차이 (+ = 뜬 보드가 더 나쁨) · 최소 표본 */
const EFFECT_MIN = 0.25
const SAMPLE_MIN = 30
/** 레벨 층 하나에 양쪽 모두 이만큼 있어야 비교에 넣는다 */
const STRATUM_MIN = 5

const KIND_LABEL = {
  sameComp: '같은 구성 상위 등수와 성급 차이',
  duplicateCopies: '같은 기물 1성 여러 장',
  itemsOnWeak: '아이템이 1성 저코스트에',
  carryOneStar: `캐리가 1성 (상점 ${CARRY_STAR_ODDS_MIN}%+ 레벨을 지난 코스트)`,
  emptySlots: '보드 빈칸',
}
/** 정의상 1등 보드에서는 뜰 수 없는 규칙 — 1등을 빼고 비교한다 (그래도 편향이 남아 참고만) */
const EXCLUDE_FIRST = new Set(['sameComp'])

const itemCount = (u) => u.items?.length || 0
const levelKey = (lv) => Math.max(6, Math.min(10, lv || 0))
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1)
const variance = (xs) => {
  const m = mean(xs)
  return xs.length > 1 ? xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1) : 0
}
const round = (x, d = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null)

/**
 * 조건 하나(fired)에 대해 해당/비해당 보드의 등수를 비교한다.
 * adj = 레벨 층별 (해당 평균 − 비해당 평균) 을 해당 보드 수로 가중 평균, se = 그 표준오차.
 */
function compare(boards, fired, { excludeFirst = false } = {}) {
  const pool = excludeFirst ? boards.filter((b) => b.placement > 1) : boards
  const yes = []
  const no = []
  for (const b of pool) (fired(b) ? yes : no).push(b)
  const place = (bs) => bs.map((b) => b.placement)
  const top4 = (bs) => bs.filter((b) => b.placement <= 4).length / (bs.length || 1)

  const strata = new Map()
  for (const [list, side] of [[yes, 'yes'], [no, 'no']]) {
    for (const b of list) {
      const k = levelKey(b.level)
      if (!strata.has(k)) strata.set(k, { yes: [], no: [] })
      strata.get(k)[side].push(b.placement)
    }
  }
  let wSum = 0
  let diff = 0
  let varSum = 0
  for (const s of strata.values()) {
    if (s.yes.length < STRATUM_MIN || s.no.length < STRATUM_MIN) continue
    const w = s.yes.length
    wSum += w
    diff += w * (mean(s.yes) - mean(s.no))
    varSum += w ** 2 * (variance(s.yes) / s.yes.length + variance(s.no) / s.no.length)
  }
  const adj = wSum ? diff / wSum : NaN
  const se = wSum ? Math.sqrt(varSum) / wSum : NaN
  return {
    n: yes.length,
    share: yes.length / (pool.length || 1),
    covered: wSum,
    placeYes: mean(place(yes)),
    placeNo: mean(place(no)),
    top4Yes: top4(yes),
    top4No: top4(no),
    adj,
    se,
    verdict: verdictOf(yes.length, wSum, adj, se),
  }
}

function verdictOf(n, covered, adj, se) {
  if (n < SAMPLE_MIN || covered < SAMPLE_MIN || !Number.isFinite(adj)) return '표본 부족'
  if (adj >= EFFECT_MIN && adj - 1.96 * se > 0) return '✓ 근거 있음'
  if (adj <= -EFFECT_MIN && adj + 1.96 * se < 0) return '✗ 반대'
  if (adj - 1.96 * se > 0) return '△ 약하게 맞음'
  if (adj + 1.96 * se < 0) return '△ 약하게 반대'
  return '? 차이 없음'
}

/* ───────── 탐침: 규칙의 기준값(코스트 상한·개수)을 바꿔 가며 잰다 ───────── */

function carryOneStarOfCost(cost) {
  return (b) => {
    const c = boardCarry(b.units)
    return Boolean(c) && (c.tier || 1) === 1 && (c.rarity || 1) === cost && itemCount(c) >= 2
  }
}
/** 캐리(아이템 2+) 1성 · 최종 레벨까지 그 코스트가 상점에 minOdds% 이상 나온 레벨을 지남 (실제 규칙의 하한만 바꾼 것) */
function carryOneStarPastOdds(minOdds) {
  return (b) => {
    const c = boardCarry(b.units)
    return Boolean(c) && (c.tier || 1) === 1 && itemCount(c) >= 2 && Boolean(oddsWindow(c.rarity || 1, b.level, minOdds))
  }
}
/** 실제 규칙이 그 코스트를 보기 시작하는 레벨 (상점 하한 이상 나오는 첫 레벨) */
const ruleLevels = (cost) => {
  const w = oddsWindow(cost, 11)
  return w ? `Lv.${w.from}부터 대상` : 'Lv.11 까지 대상 아님'
}
function itemsOnOneStarUpTo(maxCost) {
  return (b) => b.units.filter((u) => (u.tier || 1) === 1 && (u.rarity || 1) <= maxCost).reduce((s, u) => s + itemCount(u), 0) >= ITEMS_ON_WEAK_MIN
}
const emptyByUnitCount = (b) => (b.level || 0) - b.units.length > 0

const PROBES = [
  ...[1, 2, 3, 4, 5].map((c) => ({
    label: `캐리(아이템 2+)가 1성 ${c}코스트 (전 레벨)`,
    note: `실제 규칙: ${ruleLevels(c)}`,
    fired: carryOneStarOfCost(c),
  })),
  ...[20, 25, 30, 35].map((t) => ({
    label: `캐리(아이템 2+) 1성 · 그 코스트 상점 ${t}%+ 레벨을 지남`,
    note: t === CARRY_STAR_ODDS_MIN ? '현재 기준' : '대안 기준',
    fired: carryOneStarPastOdds(t),
  })),
  {
    label: '캐리(아이템 2+) 1성 5코스트 · Lv.9 이하',
    note: '정상 운영 가정 (5코스트 상점 15% 이하)',
    fired: (b) => carryOneStarOfCost(5)(b) && (b.level || 0) <= 9,
  },
  ...[3, 4, 5].map((c) => ({
    label: `1성 1~${c}코스트에 아이템 ${ITEMS_ON_WEAK_MIN}개+`,
    note: c === WEAK_MAX_COST ? '현재 기준' : '대안 기준',
    fired: itemsOnOneStarUpTo(c),
  })),
  { label: '빈칸 (기물 수로 셈, 2칸 기물 무시)', note: '보정 전 규칙', fired: emptyByUnitCount },
  { label: '1명 모자란 시너지', note: '장면에서 뺌 (10-22 정답셋 0/19)', fired: (b) => nearBreakpoints(b).length > 0 },
]

/* ───────── 실행 ───────── */

function fmtRow(label, r, note = '') {
  const ci = Number.isFinite(r.se) ? `±${round(1.96 * r.se)}` : ''
  const adj = Number.isFinite(r.adj) ? `${r.adj > 0 ? '+' : ''}${round(r.adj)} ${ci}` : '–'
  return `| ${label} | ${r.n} (${round(r.share * 100, 1)}%) | ${round(r.placeYes)} / ${round(r.placeNo)} | ${round(r.top4Yes * 100, 0)}% / ${round(
    r.top4No * 100,
    0
  )}% | ${adj} | ${r.verdict}${note ? ` · ${note}` : ''} |`
}

const HEADER = [
  '| 조건 | 해당 보드 | 평균 등수 (해당/비해당) | 4등 안 (해당/비해당) | 같은 레벨 비교 차이 (+ = 해당이 나쁨) | 판정 |',
  '|---|---:|---:|---:|---:|---|',
]

async function main() {
  const { label, lobbies } = await loadLobbies()
  const boards = lobbies.flatMap((l) => l.boards)
  console.log(`출처: ${label} — 로비 ${lobbies.length}개 · 보드 ${boards.length}개`)
  if (!boards.length) {
    console.error('보드가 없습니다.')
    process.exitCode = 1
    return
  }

  // 보드마다 실제 규칙을 한 번만 돌린다
  const fired = new Map(boards.map((b) => [b, new Set(allKeyMoments(b).map((k) => k.kind))]))

  const ruleRows = Object.keys(KIND_LABEL).map((kind) => {
    const r = compare(boards, (b) => fired.get(b).has(kind), { excludeFirst: EXCLUDE_FIRST.has(kind) })
    return { kind, r }
  })
  const probeRows = PROBES.map((p) => ({ p, r: compare(boards, p.fired) }))

  const lines = [
    `## 장면 규칙 검증 — ${label}`,
    '',
    `로비 ${lobbies.length}개 · 보드 ${boards.length}개. 판정 = 같은 레벨 보드끼리 비교한 등수 차이 (|차이| ≥ ${EFFECT_MIN} 이고 95% 구간이 0을 넘으면 확정, 해당 보드 ${SAMPLE_MIN}개 미만은 표본 부족).`,
    '',
    '### 실제 규칙 (lib/keyMoments)',
    '',
    ...HEADER,
    ...ruleRows.map(({ kind, r }) => fmtRow(`${KIND_LABEL[kind]} \`${kind}\``, r, EXCLUDE_FIRST.has(kind) ? '1등 제외 비교 (정의상 편향 — 참고만)' : '')),
    '',
    '### 탐침 — 기준값을 바꿔 잰 결과',
    '',
    ...HEADER,
    ...probeRows.map(({ p, r }) => fmtRow(p.label, r, p.note)),
    '',
  ]
  const opposed = ruleRows.filter(({ kind, r }) => r.verdict === '✗ 반대' && !EXCLUDE_FIRST.has(kind))
  if (opposed.length) {
    lines.push(`> ⚠️ 반대 판정 규칙: ${opposed.map(({ kind }) => `\`${kind}\``).join(', ')} — 장면이 뜬 보드가 같은 레벨에서 오히려 등수가 좋습니다. 규칙 기준을 다시 보세요.`, '')
  }
  const md = lines.join('\n')
  console.log(`\n${md}`)
  writeReport(md)
  for (const { kind, r } of opposed) annotate('장면 규칙 반대', `${kind}: 같은 레벨 비교 ${round(r.adj)} (해당 보드 ${r.n}개)`)

  if (arg('strict') && opposed.length) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

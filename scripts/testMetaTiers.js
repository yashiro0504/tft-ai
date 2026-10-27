/**
 * 메타 표 티어 검증 (app/components/metaShared · lib/statsShared) — 저장소의 메타 스냅샷으로 확인한다.
 *
 *  1. 표본 하한: 덱·기물·시너지·아이템이 같은 오차 기준(30판, ±0.42)
 *  2. 수축 추정: 표본 적은 덱일수록 4.5등 쪽으로 더 당긴다 (35판 3.17등 vs 177판 3.58등 — 2026-10-27 평가)
 *  3. 표본 부족 행은 티어 '-' · 티어 순서
 *  4. 기물 티어는 코스트별 — S티어가 5코로만 차지 않는다
 *
 * 사용법: node scripts/testMetaTiers.js   (npm run test:tiers)
 */
require('./_ts')
const { assignSampleTiers, shrinkPlacements, tierRank } = require('../app/components/metaShared')
const { MIN_SAMPLE, MAX_PLACEMENT_MARGIN, placementMargin } = require('../lib/statsShared')
const { buildMetaPayload } = require('../lib/metaPayload')
const decksData = require('../lib/decksData.json')

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${!ok && detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

console.log('표본 하한')
check('덱·기물·시너지·아이템 하한이 같음 (30판)', [MIN_SAMPLE.deck, MIN_SAMPLE.unit, MIN_SAMPLE.trait, MIN_SAMPLE.item].every((n) => n === 30), JSON.stringify(MIN_SAMPLE))
check('하한 판수의 오차가 기준 안 · 한 판 적으면 기준 밖', placementMargin(30) <= MAX_PLACEMENT_MARGIN && placementMargin(29) > MAX_PLACEMENT_MARGIN)

console.log('수축 추정')
const deckRows = decksData.decks.map((d) => ({ name: d.name, avg: d.avgPlacement, sample: d.sampleSize }))
const est = shrinkPlacements(deckRows)
const at = (name) => {
  const i = deckRows.findIndex((r) => r.name === name)
  return { raw: deckRows[i], est: est[i] }
}
const small = at('주문술사 알룬')
const big = at('협곡야수 장로 드래곤')
check('스냅샷에 비교 덱 2개', small.raw && big.raw, deckRows.map((r) => r.name).join(','))
if (small.raw && big.raw) {
  check('모든 추정값은 원래 평균과 4.5등 사이', deckRows.every((r, i) => (est[i] - r.avg) * (4.5 - r.avg) >= 0 && Math.abs(est[i] - 4.5) <= Math.abs(r.avg - 4.5)))
  check(
    '표본 적은 덱을 더 많이 당김 (35판 3.17 → 177판 3.58 과의 차이가 0.41 → 0.1 미만)',
    small.est - small.raw.avg > big.est - big.raw.avg && Math.abs(small.est - big.est) < 0.1,
    `${small.est.toFixed(2)} vs ${big.est.toFixed(2)}`
  )
}
check('표본 0 은 4.5등', shrinkPlacements([{ avg: 1, sample: 0 }])[0] === 4.5)
check('행이 1개여도 계산됨 (기본 세기)', Math.abs(shrinkPlacements([{ avg: 3, sample: 30 }])[0] - 3.75) < 1e-9)

console.log('티어')
const t = assignSampleTiers(
  [
    { avg: 2.0, sample: 10 },
    { avg: 3.5, sample: 200 },
    { avg: 4.5, sample: 200 },
    { avg: 5.5, sample: 200 },
  ],
  30
)
check('표본 부족 행은 티어 없음 (평균 2.0등이어도)', t[0] === '-' && t[1] === 'S', JSON.stringify(t))
check('티어 순서: S < A < D < 표본 부족', tierRank('S') < tierRank('A') && tierRank('D') < tierRank('-'))

console.log('기물 코스트')
const champs = buildMetaPayload().champions
const champTiers = assignSampleTiers(
  champs.map((c) => ({ avg: c.avgPlacement, sample: c.sampleSize, group: c.cost ?? 0 })),
  MIN_SAMPLE.unit
)
const sCosts = new Set(champs.filter((_, i) => champTiers[i] === 'S').map((c) => c.cost))
const flatTiers = assignSampleTiers(champs.map((c) => ({ avg: c.avgPlacement, sample: c.sampleSize })), MIN_SAMPLE.unit)
const flatS = new Set(champs.filter((_, i) => flatTiers[i] === 'S').map((c) => c.cost))
check('코스트별 티어: S티어에 1~5코가 모두', [1, 2, 3, 4, 5].every((c) => sCosts.has(c)), [...sCosts].join(','))
console.log(`  (참고: 한 줄로 매기면 S티어 코스트 = ${[...flatS].join(',')})`)

console.log(failures.length ? `\n❌ 실패 ${failures.length}건` : '\n✅ 메타 티어 테스트 통과')
if (failures.length) process.exitCode = 1

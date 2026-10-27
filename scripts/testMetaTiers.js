/**
 * 메타 표 티어 검증 (app/components/metaShared · lib/statsShared).
 * 덱 수축 사례는 고정 수치(2026-10-25 스냅샷)로, 나머지는 매일 갱신되는 저장소 메타 데이터로 확인한다
 * (덱 이름·구성은 매일 바뀌므로 이름으로 찾지 않는다).
 *
 *  1. 표본 하한: 덱·기물·시너지·아이템이 같은 오차 기준(30판, ±0.42)
 *  2. 수축 추정: 표본 적은 덱일수록 4.5등 쪽으로 더 당긴다 (35판 3.17등 vs 177판 3.58등 — 2026-10-27 평가)
 *  3. 표본 부족 행은 티어 '-' · 티어 순서
 *  4. 기물 티어는 코스트별 — S티어가 5코로만 차지 않는다
 *  5. 동률은 같은 티어 (2026-10-27: 3.68등·38판 두 덱이 S·A 로 갈림) · 경계의 근소한 차이만 위 티어로
 *
 * 사용법: node scripts/testMetaTiers.js   (npm run test:tiers)
 */
require('./_ts')
const { assignSampleTiers, assignTiers, shrinkPlacements, tierRank } = require('../app/components/metaShared')
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
// 2026-10-25 덱 스냅샷 24개 [평균등수, 판수] — 평가 사례: 0번 주문술사 알룬(35판 3.17) vs 1번 장로 드래곤(177판 3.58)
const EVAL_DECKS = [[3.17, 35], [3.58, 177], [3.61, 41], [3.7, 33], [4.05, 97], [4.06, 32], [4.14, 64], [4.16, 38], [4.19, 48], [4.27, 79], [4.31, 32], [4.48, 93], [4.5, 32], [4.58, 69], [4.62, 221], [4.7, 91], [4.71, 35], [4.76, 66], [4.94, 32], [4.95, 82], [5.06, 35], [5.12, 41], [5.22, 37], [6.11, 38]]
const evalEst = shrinkPlacements(EVAL_DECKS.map(([avg, sample]) => ({ avg, sample })))
check(
  '표본 적은 덱을 더 많이 당김 (35판 3.17 → 177판 3.58 과의 차이가 0.41 → 0.1 미만)',
  evalEst[0] - 3.17 > evalEst[1] - 3.58 && Math.abs(evalEst[0] - evalEst[1]) < 0.1,
  `${evalEst[0].toFixed(2)} vs ${evalEst[1].toFixed(2)}`
)
const deckRows = decksData.decks.map((d) => ({ avg: d.avgPlacement, sample: d.sampleSize }))
const est = shrinkPlacements(deckRows)
check(
  '저장소 덱 데이터: 모든 추정값은 원래 평균과 4.5등 사이',
  deckRows.length > 0 && deckRows.every((r, i) => (est[i] - r.avg) * (4.5 - r.avg) >= 0 && Math.abs(est[i] - 4.5) <= Math.abs(r.avg - 4.5))
)
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

console.log('동률 · 경계')
{
  const others = [4.0, 4.2, 4.4, 4.6, 4.8, 5.0, 5.2, 5.4].map((avg) => ({ avg, sample: 200 }))
  const tie = assignSampleTiers([{ avg: 3.68, sample: 38 }, { avg: 3.68, sample: 38 }, ...others], 30)
  check('같은 평균·판수 두 덱은 같은 티어 (10행 중 1·2등 = S·A 경계)', tie[0] === tie[1] && tie[0] === 'S', JSON.stringify(tie))
  const avgs = [1, 1.02, 3, 4, 5, 6, 7, 8, 9, 10]
  const sds = avgs.map(() => 0.2)
  const plain = assignTiers(avgs)
  const near = assignTiers(avgs, sds)
  check('경계: 위 티어 마지막 행과 근소한 차이(0.02)면 위 티어', plain[1] === 'A' && near[1] === 'S', `${plain} / ${near}`)
  check('경계: 올린 행을 타고 줄줄이 올라가지 않음 (3.0 은 A 그대로)', near[2] === 'A' && near.slice(3).join() === plain.slice(3).join(), `${near}`)
  const decks = decksData.decks.filter((d) => d.sampleSize >= MIN_SAMPLE.deck)
  const ts = assignSampleTiers(decks.map((d) => ({ avg: d.avgPlacement, sample: d.sampleSize })), MIN_SAMPLE.deck)
  const sameValue = decks.flatMap((d, i) => decks.slice(i + 1).map((e, k) => [i, i + 1 + k, e])).filter(([i, , e]) => e.avgPlacement === decks[i].avgPlacement && e.sampleSize === decks[i].sampleSize)
  check('저장소 덱 데이터: 평균·판수가 같은 덱은 모두 같은 티어', sameValue.every(([i, j]) => ts[i] === ts[j]), `${sameValue.length}쌍`)
}

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

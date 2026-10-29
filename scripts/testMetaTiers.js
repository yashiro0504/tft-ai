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
const { adjustedPlacement, assignSampleTiers, assignTiers, deckTier, deckTierFromAdjusted, DECK_TIER_RULE_SHORT, shrinkPlacements, shrunkPlacementSds, tierRank } = require('../app/components/metaShared')
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

console.log('덱 티어: 보정 평균등수 고정 구간 (2026-10-29 지시문 1)')
{
  // 지시문 원문 공식·구간을 함수 구현을 보지 않고 그대로 옮긴 것
  const hand = (avg, n) => {
    if (n < 50) return '-'
    const adj = (n * avg + 50 * 4.5) / (n + 50)
    const v = Math.round(adj * 1000) / 1000
    return v <= 3.9 ? 'S' : v <= 4.3 ? 'A' : v <= 4.7 ? 'B' : v <= 5.1 ? 'C' : 'D'
  }
  check('처형자 럭스 57판 3.05 → 보정 3.73 · S', adjustedPlacement(3.05, 57).toFixed(2) === '3.73' && deckTier(3.05, 57) === 'S')
  check('개화 카르마 933판 5.68 → 보정 5.62 · D', adjustedPlacement(5.68, 933).toFixed(2) === '5.62' && deckTier(5.68, 933) === 'D')
  check('경계값은 위 티어 (3.90 → S, 4.30 → A, 5.10 → C, 5.11 → D)', [deckTierFromAdjusted(3.9), deckTierFromAdjusted(4.3), deckTierFromAdjusted(5.1), deckTierFromAdjusted(5.11)].join() === 'S,A,C,D')
  check('49판은 평균 2.0등이어도 티어 없음 (참고용) · 50판부터 티어', deckTier(2.0, 49) === '-' && deckTier(2.0, 50) === 'S')
  // 지시문의 10.29 예시: 표본이 커 보정이 거의 없는 덱
  check('예시: 3.46 대형 표본 S · 4.82 C · 3.62 S', deckTier(3.46, 600) === 'S' && deckTier(4.82, 3000) === 'C' && deckTier(3.62, 2000) === 'S')

  // 저장소 덱 데이터 전체: 화면이 쓰는 경로(assignSampleTiers deck) = 손 계산
  const rows = decksData.decks.map((d) => ({ avg: d.avgPlacement, sample: d.sampleSize, name: d.name }))
  const tiers = assignSampleTiers(rows, MIN_SAMPLE.deck, { deck: true })
  const diff = rows.filter((r, i) => hand(r.avg, r.sample) !== tiers[i])
  console.log(`  (저장소 덱 ${rows.length}개: ${['S', 'A', 'B', 'C', 'D', '-'].map((t) => `${t === '-' ? '참고용' : t}${tiers.filter((x) => x === t).length}`).join(' ')})`)
  check('저장소 덱 데이터: 공식·구간으로 다시 계산한 티어와 불일치 0개', diff.length === 0, diff.map((r) => r.name).join(','))
  check('저장소 덱 데이터: 50판 미만 덱은 모두 티어 없음', rows.every((r, i) => r.sample >= 50 || tiers[i] === '-'))

  // 무작위 덱 표 500개도 손 계산과 같음
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  let mismatch = 0
  for (let t = 0; t < 500; t++) {
    const avg = +(2.5 + rnd() * 4).toFixed(2)
    const n = Math.floor(rnd() * 3000)
    if (hand(avg, n) !== deckTier(avg, n)) mismatch++
  }
  check('무작위 덱 500개: 함수 = 공식대로 센 티어', mismatch === 0, `${mismatch}개 다름`)

  const dash = require('fs').readFileSync(require('path').join(__dirname, '..', 'app', 'components', 'MetaDashboard.tsx'), 'utf8')
  check(
    '화면 문구 = 지시문 문구',
    DECK_TIER_RULE_SHORT === '티어 = 보정 평균등수 기준 (S ≤3.90 · A ≤4.30 · B ≤4.70 · C ≤5.10) · 50판 미만 참고용' && /\{DECK_TIER_RULE_SHORT\}/.test(dash) && !/오차가 겹치면 같은 티어/.test(dash)
  )
  // 티어 칩 개수는 S~D 만 센다 ('-' 참고용은 칩이 없다)
  check('티어 칩 개수 집계에 참고용 없음', /countOf\(t\)/.test(dash) && !/TIERS[^\n]*'-'/.test(dash))
}

console.log('메타 첫 진입 (2026-10-29 지시문 5)')
{
  const dash = require('fs').readFileSync(require('path').join(__dirname, '..', 'app', 'components', 'MetaDashboard.tsx'), 'utf8')
  // 첫 응답 전(data 없음)에는 '패치 정보 없음'·'덱 N개' 칩 대신 스켈레톤 — 칩은 data 가 있는 분기 안에만
  const head = dash.slice(dash.indexOf('<div className="rk-evidence">'), dash.indexOf('</header>'))
  check('응답 전 스켈레톤 칩 (!data)', /\{!data \? \(/.test(head) && /rk-skel-chip/.test(head))
  check("'덱 N개' 칩은 data 가 있을 때만", /\{data \? \(\s*<EvidenceChip>\s*덱 \{data\.decks\.length\}개/.test(head))
  check("'패치 정보 없음'은 !data 분기 뒤 (응답 받은 뒤에만)", head.indexOf('패치 정보 없음') > head.indexOf('{!data ? ('))
  check('표 자리도 응답 전엔 스켈레톤 (빈 상태 문구 없음)', /!data \|\| \(loading && !rowsAll\.length\) \? \(\s*<div className="rk-skeleton">/.test(dash))
}

console.log(failures.length ? `\n❌ 실패 ${failures.length}건` : '\n✅ 메타 티어 테스트 통과')
if (failures.length) process.exitCode = 1

// 접근성 (2026-10-28 P2-9): 메타 랭킹 화면 컴포넌트에 alt 가 빈 이미지가 없어야 한다 (덱 상세 패널 시너지·기물·아이템 20개)
{
  const fs = require('fs')
  const path = require('path')
  const files = ['MetaDashboard.tsx', 'LabUI.tsx', 'MetaDetailModal.tsx', 'EntityDetail.tsx', 'UserMenu.tsx']
  const empty = files.flatMap((f) => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'components', f), 'utf8')
    return [...src.matchAll(/<img\b[\s\S]*?\/>/g)]
      .filter((m) => /alt=""/.test(m[0]) || !/alt=/.test(m[0]))
      .map((m) => ({ f, i: src.slice(0, m.index).split('\n').length }))
  })
  const ok = empty.length === 0
  console.log(`  ${ok ? '✅' : '❌'} 메타 랭킹 이미지 alt 빈 값 0개${ok ? '' : ` — ${empty.map((x) => `${x.f}:${x.i}`).join(', ')}`}`)
  const dash = fs.readFileSync(path.join(__dirname, '..', 'app', 'components', 'MetaDashboard.tsx'), 'utf8')
  const aria = /aria-label=\{\s*tab === 'decks'/.test(dash)
  console.log(`  ${aria ? '✅' : '❌'} 덱 행 버튼 aria-label ("덱 이름, S티어, 평균 N등, N판")`)
  if (!ok || !aria) process.exitCode = 1
}

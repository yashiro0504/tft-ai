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
const { assignSampleTiers, assignSeparatedTiers, assignTiers, shrinkPlacements, shrunkPlacementSds, tierRank } = require('../app/components/metaShared')
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

console.log('덱 티어: 기준 덱 비교 · 3~5개 · 한 티어 50% 이하 (2026-10-28 머지 후 재평가)')
{
  const { PLACEMENT_SD } = require('../lib/statsShared')
  const named = decksData.decks.filter((d) => d.sampleSize >= MIN_SAMPLE.deck)
  const rows = named.map((d) => ({ avg: d.avgPlacement, sample: d.sampleSize }))
  const tiers = assignSampleTiers(rows, MIN_SAMPLE.deck, { separated: true })
  const m = rows.map((r) => PLACEMENT_SD / Math.sqrt(r.sample))
  const kinds = new Set(tiers)
  const counts = [...kinds].map((t) => tiers.filter((x) => x === t).length)
  console.log(`  (저장소 덱 ${rows.length}개: ${['S', 'A', 'B', 'C', 'D'].map((t) => `${t}${tiers.filter((x) => x === t).length}`).join(' ')})`)
  check('저장소 덱 데이터: 티어 3개 이상 5개 이하', kinds.size >= 3 && kinds.size <= 5, `${kinds.size}개`)
  check('저장소 덱 데이터: 한 티어가 전체의 50% 이하', Math.max(...counts) <= rows.length / 2, counts.join(','))
  const far = []
  rows.forEach((a, i) => rows.forEach((b, j) => i < j && tiers[i] === tiers[j] && Math.abs(a.avg - b.avg) >= 1 && far.push(`${named[i].name}·${named[j].name}`)))
  check('평균등수 1등 이상 차이 나는 덱은 같은 티어 아님 (3.84 vs 6.06)', far.length === 0, far.join(', '))
  const order = rows.map((_, i) => i).sort((a, b) => rows[a].avg - rows[b].avg)
  check('티어는 평균등수 순서를 거스르지 않음', order.every((i, k) => !k || tierRank(tiers[order[k - 1]]) <= tierRank(tiers[i])))
  const firstOf = new Map()
  order.forEach((i) => firstOf.has(tiers[i]) || firstOf.set(tiers[i], i))
  const ov = (i, j) => Math.abs(rows[i].avg - rows[j].avg) <= m[i] + m[j]
  const notAnchored = order.filter((i) => !ov(i, firstOf.get(tiers[i])))
  check('모든 덱이 자기 티어 기준 덱(첫 덱)과 구간이 겹침', notAnchored.length === 0, notAnchored.map((i) => named[i].name).join(','))
  // 새 티어가 앞 티어 기준 덱과 겹치는데도 시작됐다면, 앞 티어에 넣었을 때 50% 를 넘는 경우(재분할)뿐이다
  const stray = [...firstOf.entries()].filter(([t, i]) => {
    const prev = [...firstOf.entries()].find(([u]) => tierRank(u) === tierRank(t) - 1)
    if (!prev || !ov(i, prev[1])) return false
    const from = order.indexOf(prev[1])
    let k = from
    while (k < order.length && ov(order[k], prev[1])) k++
    return k - from <= rows.length / 2
  })
  check('기준 덱과 겹치는 덱은 50% 재분할 말고는 다음 티어로 안 밀림', stray.length === 0, stray.map(([, i]) => named[i].name).join(','))
  const sep = assignSeparatedTiers([3.5, 3.6, 4.5, 4.6, 5.8], [0.1, 0.1, 0.1, 0.1, 0.1])
  check('구간이 떨어진 곳에서는 끊음 (3.5·3.6 | 4.5·4.6 | 5.8)', sep[0] === sep[1] && sep[2] === sep[3] && sep[1] !== sep[2] && sep[3] !== sep[4] && sep[0] === 'S', JSON.stringify(sep))
  const one = assignSeparatedTiers([3.84, 4.16, 4.6, 5.0, 5.4], [0.4, 0.41, 0.1, 0.1, 0.1])
  check('이즈리얼 3.84±0.40 · 니달리 4.16±0.41 → 같은 티어 (기준 덱과 겹침)', one[0] === one[1], JSON.stringify(one))
  // 연쇄 비교면 3.5→3.9→4.3→4.7 이 줄줄이 이어져 한 티어가 된다. 기준 덱 비교는 3.5 와 안 겹치는 4.3 에서 끊는다
  const chain = assignSeparatedTiers([3.5, 3.9, 4.3, 4.7, 5.1, 5.5], [0.25, 0.25, 0.25, 0.25, 0.25, 0.25])
  check('연쇄 비교 안 함: 3.5 와 4.3 은 다른 티어', chain[0] !== chain[2], JSON.stringify(chain))
  const crowd = assignSeparatedTiers([4, 4.05, 4.1, 4.15, 4.2, 4.25, 4.3, 4.35, 6, 7], new Array(10).fill(0.4))
  const crowdMax = Math.max(...['S', 'A', 'B', 'C', 'D'].map((t) => crowd.filter((x) => x === t).length))
  check('한 티어에 50% 넘게 몰리면 다시 나눔', crowdMax <= 5, JSON.stringify(crowd))
  const many = assignSeparatedTiers([1, 2, 3, 4, 5, 6, 7, 8], new Array(8).fill(0.1))
  check('티어는 최대 5개', new Set(many).size === 5, JSON.stringify(many))
  const dash = require('fs').readFileSync(require('path').join(__dirname, '..', 'app', 'components', 'MetaDashboard.tsx'), 'utf8')
  check('화면 설명 문구 = 계산 규칙 상수 (DECK_TIER_RULE)', /DECK_TIER_RULE_SHORT/.test(dash) && /\$\{DECK_TIER_RULE\}/.test(dash) && !/오차가 겹치면 같은 티어 ·/.test(dash))
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

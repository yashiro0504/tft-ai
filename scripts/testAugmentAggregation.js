/**
 * 증강 집계 회귀 테스트 (외부 API 불필요).
 *
 * 실행: node scripts/testAugmentAggregation.js
 *  - 문자열/객체/단일 문자열 등 다양한 증강 스키마를 처리하는지
 *  - aggregateMatch → buildOutput 이 실제로 증강 통계를 만드는지
 */
process.env.MIN_SAMPLE = process.env.MIN_SAMPLE || '2'

const {
  createState,
  aggregateMatch,
  buildOutput,
  extractAugmentNames,
  hasAugmentField,
  describeAugmentDiagnostics,
} = require('./buildMetaStats')

let failures = 0

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`)
  } else {
    failures += 1
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// 1) 스키마 추출
check(
  'string[] 형태',
  JSON.stringify(extractAugmentNames({ augments: ['Augment_A', 'Augment_B'] })) ===
    JSON.stringify(['Augment_A', 'Augment_B'])
)
check(
  '객체 배열/혼합 형태',
  JSON.stringify(extractAugmentNames({ augments: [{ name: 'X' }, { id: 'Y' }, 'Z'] })) ===
    JSON.stringify(['X', 'Y', 'Z'])
)
check('단일 문자열 형태', JSON.stringify(extractAugmentNames({ augment: 'Solo' })) === JSON.stringify(['Solo']))
check('필드 없음', extractAugmentNames({}) .length === 0)
check('필드 존재 판별(true)', hasAugmentField({ augments: [] }) === true)
check('필드 존재 판별(false)', hasAugmentField({ units: [] }) === false)

// 2) 집계 (8인 × 3경기)
const state = createState()
for (let game = 0; game < 3; game++) {
  const participants = Array.from({ length: 8 }, (_, index) => ({
    placement: index + 1,
    level: 8,
    last_round: 20,
    gold_left: 10,
    augments: index < 4 ? ['Augment_A', 'Augment_B', 'Augment_C'] : ['Augment_A'],
    units: [{ character_id: 'TFT18_Ahri', tier: 2, itemNames: ['TFT_Item_GuinsoosRageblade'] }],
    traits: [{ name: 'TFT18_Arcanist', tier_current: 2 }],
  }))
  aggregateMatch({ info: { tft_set_number: 18, participants } }, state)
}

const { augments } = buildOutput(state)
check('증강 3종 집계', Object.keys(augments).length === 3, JSON.stringify(Object.keys(augments)))
// cleanName 이 'Augment_' 접두사를 제거하므로 키는 A/B/C 가 된다.
check('Augment_A 표본 24', augments.A && augments.A.sampleSize === 24, String(augments.A && augments.A.sampleSize))
check(
  'Augment_A 평균등수 4.5',
  augments.A && augments.A.avgPlacement === 4.5,
  String(augments.A && augments.A.avgPlacement)
)
check(
  'pickRate 계산(24/48=0.5)',
  augments.A && augments.A.pickRate === 0.5,
  String(augments.A && augments.A.pickRate)
)

const diag = describeAugmentDiagnostics(state)
check('진단: 참가자 24명', diag.text.includes('참가자 24명'), diag.text)
check('진단: 힌트 없음', diag.hint === '', diag.hint)

// 3) 빈 값 진단 힌트
const emptyState = createState()
aggregateMatch(
  { info: { tft_set_number: 18, participants: [{ placement: 1, augments: [] }] } },
  emptyState
)
const emptyDiag = describeAugmentDiagnostics(emptyState)
check('빈 값이면 힌트 생성', emptyDiag.hint.length > 0, emptyDiag.hint)

if (failures > 0) {
  console.error(`\n❌ 증강 집계 테스트 실패 (${failures}건)`)
  process.exit(1)
}
console.log('\n✅ 증강 집계 테스트 통과')

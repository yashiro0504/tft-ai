/**
 * 의미(엔티티 사실) 검증기 테스트 — lib/semanticGrounding.ts (AI-EVAL A1).
 *
 * 실행: node scripts/testSemanticGrounding.js   (npm run test:ai)
 *  - 실제 리포트 오류 문장("피들스틱·르블랑·오른 모두 3성", 피들스틱은 1성) 검출
 *  - 정상 문장·일반 표현·상대 이야기·겹치는 이름은 오탐 0
 *  - 리포트 결과(grounding.entityErrors)에 포함 (폴백 경로)
 */
process.env.DEEPSEEK_API_KEY = ''
process.env.GEMINI_API_KEY = ''
require('./_env').loadEnv()
require('./_ts')
const { validateEntityFacts, feedbackTexts } = require('../lib/semanticGrounding')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  ✅ ${label}`)
  else {
    failures++
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const fixture = require('../data/evalMatches.json')
// 기준 샘플 KR_8414975456: 베이가·알리스타·오른·렉사이·르블랑 3성, 카시오페아 2성, 피들스틱 1성 / 주문술사 2단계
const sample = fixture.cases.find((c) => c.name === 'Seed01 contested-bot4 5등 6-1').matches
const errs = (texts, matches = sample) => validateEntityFacts(Array.isArray(texts) ? texts : [texts], matches)
const show = (e) => JSON.stringify(e.map((x) => `${x.type}: ${x.actual} (데이터 ${x.expected})`))

;(async () => {
  console.log('기물 성급')
  const real = errs('로비 수렴도 37/100으로 경합은 강하지 않았고, 피들스틱·르블랑·오른 모두 3성 확보에 성공했습니다.')
  check('실제 리포트 문장 → 피들스틱 3성 오류 1건', real.length === 1 && real[0].type === 'unit_star' && real[0].actual === '피들스틱 3성' && real[0].expected === '피들스틱 1성', show(real))
  check('"베이가·알리스타·오른 3성" → 오류 0', errs('베이가·알리스타·오른 3성으로 전열을 세웠습니다.').length === 0)
  check('"카시오페아는 2성" → 오류 0', errs('카시오페아는 2성에 머물렀습니다.').length === 0)
  check('"카시오페아 3성" → 오류 1', errs('카시오페아 3성이 완성되었습니다.').length === 1)
  check('목록 중간 오류도 각각 검사 ("베이가, 카시오페아와 오른 모두 3성")', errs('베이가, 카시오페아와 오른 모두 3성입니다.').map((e) => e.actual).join() === '카시오페아 3성')

  console.log('3성 개수')
  check('"3성 5개" (실제 5) → 오류 0', errs('3성 5개·2성+ 6개로 완성도 79점을 챙겼습니다.').length === 0)
  check('서술형 조각 "3성 4개, 2성+ 6개로 견고" (축 한 줄) → 오류 1', errs('3성 4개, 2성+ 6개로 견고').length === 1)
  const cnt = errs('3성 4개로 보드를 마무리했습니다.')
  check('"3성 4개" → 오류 1', cnt.length === 1 && cnt[0].type === 'three_star_count', show(cnt))

  console.log('아이템 소유')
  const own = errs('피들스틱의 보석 건틀릿이 딜을 책임졌습니다.')
  check('"피들스틱의 보석 건틀릿" (피들스틱은 모렐로노미콘) → 오류 1', own.length === 1 && own[0].type === 'item_owner', show(own))
  check('"베이가의 보석 건틀릿·루덴의 폭풍" → 오류 0', errs('베이가의 보석 건틀릿·루덴의 폭풍 조합은 정석입니다.').length === 0)
  check('"르블랑에 크라운가드를 줬습니다" (르블랑 아이템 없음) → 오류 1', errs('르블랑에 크라운가드를 줬습니다.').length === 1)
  check('"르블랑에 크라운가드를 줬어야 합니다" (가정·처방) → 오류 0', errs('르블랑에 크라운가드를 줬어야 합니다.').length === 0)

  console.log('시너지 단계')
  const tr = errs('주문술사 3단계를 유지했습니다.')
  check('"주문술사 3단계" (실제 2) → 오류 1', tr.length === 1 && tr[0].type === 'trait_tier', show(tr))
  check('"주문술사(2단계)" → 오류 0', errs('주문술사(2단계)가 핵심이었습니다.').length === 0)
  // a1-rules 실제 출력: 기물 수(4)를 단계로 혼동
  const t4 = errs('베이가에게 보석 건틀릿·루덴의 폭풍·새벽심장을, 카시오페아에게 쇼진의 창·거인 학살자·보석 건틀릿을 분배한 구성은 주문술사 4단계와 맞물려 유효했습니다.')
  check('실제 출력 "주문술사 4단계" (기물 4명 · 실제 2단계) → 오류 1 · 아이템 분배는 정상', t4.length === 1 && t4[0].type === 'trait_tier', show(t4))

  console.log('오탐 방지')
  const generic = [
    '3성작보다 2성 굳히기가 먼저입니다.',
    '2성 이상 4개로는 후반을 버티기 어렵습니다.',
    '코어 2성을 먼저 확정하세요.',
    '상대 2명이 피들스틱 3성을 노렸습니다.',
    '로비 1등은 3성 4개였습니다.',
    // baseline 실제 출력에서 나온 처방·목표 문장 (사실 주장 아님)
    '3성 후보를 1개로 압축해 5-1까지 3성 1개를 확보하세요.',
    '5-1까지 3성 1개 확보를 목표로 합니다.',
    '3성 1개 이상 확보 전 넓히기 금지',
    '3성 1개 없이 Lv.8 진입 금지',
    '5-1까지 3성 1개 확보',
    '다음 3판 동안 4-1에 Lv.7 도달 시 2성+ 기물 6개 이상과 3성 1개 이상을 동시에 충족하지 못하면 레벨업을 보류하고 리롤에 골드를 투입하십시오.',
    '카시오페아 3성을 목표로 리롤하세요.',
    // a1-rules 실제 출력: 다른 순위가 주어인 문장
    '반면 2등은 카시오페아★3·렝가★3·람머스★3로 3성 3개를 확보했고, 4등도 요릭★3·카르마★3·세주아니★3·유나라★3로 3성 4개를 갖췄습니다.',
    // comparisons 실제 출력: 비교 사실(로비 N등) 인용 + 처방
    '3성 5개로 로비 2등(3성 3개)보다 성급 개수가 많았으니, 3성 후보를 2명으로 압축해 집중도를 높이세요.',
  ]
  const g = errs(generic)
  check('일반 표현 · 상대/로비 1등 문장 → 오류 0', g.length === 0, show(g))
  // 이름이 겹치는 기물: 긴 이름 우선 매칭 ("거대 나르" 를 "나르" 로 읽지 않는다)
  const gnar = [{ ...sample[0], units: [{ id: 'TFT18_Gnar', name: '나르', tier: 1, items: [] }, { id: 'TFT18_GnarBig', name: '거대 나르', tier: 2, items: [] }], traits: [] }]
  check('겹치는 이름("나르"/"거대 나르") 오탐 0', errs('거대 나르 2성과 나르 1성을 함께 썼습니다.', gnar).length === 0)
  check('겹치는 이름에서 실제 오류는 검출 ("거대 나르 3성")', errs('거대 나르 3성이 아쉬웠습니다.', gnar).length === 1)
  // multi: 판마다 성급이 다르면 어느 판이든 맞으면 통과
  const multi = [gnar[0], { ...gnar[0], units: [{ id: 'TFT18_Gnar', name: '나르', tier: 3, items: [] }] }]
  check('multi: 어느 판이든 맞으면 통과 ("나르 3성")', errs('나르 3성을 만든 판도 있었습니다.', multi).length === 0)

  console.log('리포트 통합 (폴백 경로)')
  const { generateMetaCoachFeedback } = require('../lib/llm')
  const fb = await generateMetaCoachFeedback('Fixture#KR1', sample, 'single')
  check('결과 grounding.entityErrors 가 배열로 포함', fb.isFallback === true && Array.isArray(fb.grounding && fb.grounding.entityErrors), JSON.stringify(fb.grounding && fb.grounding.entityErrors))
  check('폴백 리포트(코드 생성)는 의미 오류 0', fb.grounding.entityErrors.length === 0, show(fb.grounding.entityErrors))
  check('feedbackTexts: 강의·축 한 줄까지 수집', feedbackTexts({ overview: 'a', lecture: { concept: 'b', checklist: ['c'] } }, { economy: 'd' }).join('') === 'abcd')

  console.log(failures ? `\n❌ 실패 ${failures}건` : '\n✅ 의미 검증 테스트 통과')
  if (failures) process.exitCode = 1
})()

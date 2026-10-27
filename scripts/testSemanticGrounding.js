/**
 * 의미(엔티티 사실) 검증기 테스트 — lib/semanticGrounding.ts (AI-EVAL A1).
 *
 * 실행: node scripts/testSemanticGrounding.js   (npm run test:ai)
 *  - 실제 리포트 오류 문장("피들스틱·르블랑·오른 모두 3성", 피들스틱은 1성) 검출
 *  - 정상 문장·일반 표현·상대 이야기·겹치는 이름은 오탐 0
 *  - 리포트 결과(grounding.entityErrors)에 포함 (폴백 경로)
 *  - 오류 문장 수리(repairEntityErrors): 값이 하나면 고치고, 아니면 문장을 지운다
 *  - 강의 규칙 위반(validateCoachingRules): 리롤형 레벨 지적 · 평균 수준 운영도를 약점으로 · 덱 단정 · 빈집 지어내기 · 피봇 시점
 */
process.env.DEEPSEEK_API_KEY = ''
process.env.GEMINI_API_KEY = ''
require('./_env').loadEnv()
require('./_ts')
const { validateEntityFacts, feedbackTexts, validateCoachingRules, repairEntityErrors } = require('../lib/semanticGrounding')

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
  // 시너지를 받치는 기물은 올리라는 조언 (lib/traitAnchors) — 2026-10-23 평가 오탐
  check('"1성 피들스틱을 2성으로 올리는" → 오류 0 (목표)', errs('남는 골드는 1성 피들스틱을 2성으로 올리는 데 우선 사용한다.').length === 0)
  check('"돌거북·타릭을 2성으로 올릴지" → 오류 0 (목표)', errs('돌거북·타릭을 2성으로 올릴지 최종 보드 직전에 선택한다.', [{ ...sample[0], units: [...sample[0].units, { id: 'x', name: '돌거북', tier: 1, items: [] }, { id: 'y', name: '타릭', tier: 1, items: [] }] }]).length === 0)
  check('"피들스틱은 3성으로 마감" → 오류 1 (사실 주장은 그대로 검사)', errs('피들스틱은 3성으로 마감했습니다.').length === 1)
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
  // 1명 모자란 시너지 장면의 목표 단계 (2026-10-23 평가 오탐) — 같은 절에 열린다·올린다가 오면 목표다
  check('"채워야 주문술사 3단계가 열립니다" → 오류 0 (목표)', errs('한 칸을 채워야 주문술사 3단계가 열립니다.').length === 0)
  check('"주문술사 3단계까지 올리는" → 오류 0 (목표)', errs('남는 자리로 주문술사 3단계까지 올리는 선택지입니다.').length === 0)
  check('"주문술사 3단계를 유지했고, 다음엔 열립니다" → 오류 1 (절이 다르면 사실 주장)', errs('주문술사 3단계를 유지했고, 다음 판엔 다른 시너지가 열립니다.').length === 1)
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
    // schema-v2 실제 출력: 기준값(시점·까지만)·상위 보드 비교
    '3성 탐색은 3성 3개 확보 시점에서 중단하고, 그 골드를 레벨업에 우선 배분합니다.',
    '3성 3개 확보 시 추가 리롤 중단 여부 확인',
    '8레벨 도달 전 리롤은 3성 2개 확보까지만 한다',
    '3성 3개를 확보한 시점에서 레벨업을 먼저 누르는 습관을 측정합니다.',
    '완성도는 2성 5개·3성 5개로 코어는 단단하나 상위 보드의 3성 1개와 비교됩니다.',
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

  console.log('강의 규칙 위반')
  const rules = (text, ctx) => validateCoachingRules([text], { facts: '', mode: 'single', ...ctx }).map((v) => v.type)
  check('리롤형에 "레벨이 낮다" → rerollLevelBlame', rules('최종 레벨 7로 레벨이 낮아 보드가 약했습니다.', { deckType: 'reroll' }).includes('rerollLevelBlame'))
  check('리롤형 해설("리롤형이라 레벨이 낮은 건 문제가 아니다")은 통과', rules('리롤형이라 레벨이 낮은 건 문제가 아닙니다.', { deckType: 'reroll' }).length === 0)
  check('표준형의 레벨 지적은 대상 아님', rules('레벨이 낮아 보드가 약했습니다.', { deckType: 'standard' }).length === 0)
  const evenFacts = '- 가장 유사한 메타 덱: X · 운영도: 메타 평균 수준'
  check('평균 수준인데 "메타 평균보다 못 굴렸다" → metaEvenAsWeakness', rules('메타 평균보다 못 굴린 판입니다.', { facts: evenFacts }).includes('metaEvenAsWeakness'))
  check('평균 수준 아니면 대상 아님', rules('메타 평균보다 못 굴린 판입니다.', { facts: '운영도: 메타 평균보다 못 굴림' }).length === 0)
  check('"이 덱을 갔어야 했다" → deckMustClaim', rules('처형자 이즈리얼 덱을 갔어야 했습니다.', {}).includes('deckMustClaim'))
  check('후보 표현("같은 재료로 ~도 가능했다")은 통과', rules('같은 재료로 처형자 이즈리얼 덱도 가능했습니다.', { facts: '빈집 메타 덱 후보' }).length === 0)
  check('후보 줄 없이 빈집 덱 추천 → openDeckInvented', rules('다음 판엔 빈집 메타 덱을 노리세요.', {}).includes('openDeckInvented'))
  check('후보 줄 있으면 빈집 덱 언급 통과', rules('빈집 메타 덱 후보로 처형자 이즈리얼이 있었습니다.', { facts: '- 빈집 메타 덱 후보(사후 비교): 처형자 이즈리얼' }).length === 0)
  check('"3-2에 피봇했어야" → pivotTiming', rules('3-2에 피봇했으면 좋았습니다.', {}).includes('pivotTiming'))
  const guideFacts = '- 덱 가이드 캐리 아이템(최종 보드 채용률 순, 조합 순서 아님): 쇼진의 창 70%'
  check('가이드 채용률을 순서 근거로 → guideOrderClaim', rules('채용률이 검증된 쇼진의 창을 먼저 슬램하세요.', { facts: guideFacts }).includes('guideOrderClaim'))
  check('채용률 인용만 하면 통과', rules('쇼진의 창은 이 덱 캐리의 70%가 최종 보드에 들고 있습니다.', { facts: guideFacts }).length === 0)
  check('가이드 없으면 대상 아님', rules('채용률 높은 템을 먼저 만드세요.', {}).length === 0)
  // 외부 리뷰(2026-10-21)에서 찾은 미탐·오탐 — 문장으로 고정
  check('미탐 수정: "레벨을 올려 Lv.8" (리롤형) → rerollLevelBlame', rules('남은 골드로 레벨을 올려 Lv.8 도달을 노리는 선택이 낫습니다.', { deckType: 'reroll' }).includes('rerollLevelBlame'))
  check('미탐 수정: "겹친 시점이 비틀기 신호" → pivotTiming', rules('피들스틱이 1성인 채 상대 2명과 겹친 시점이 비틀기 신호입니다.', {}).includes('pivotTiming'))
  check('오탐 수정: "빈집 덱 후보가 없었습니다" 통과', rules('빈집 덱 후보가 없었습니다.', {}).length === 0)
  check('오탐 수정: "피봇 시점이 3-2인지는 데이터로 알 수 없습니다" 통과', rules('피봇 시점이 3-2인지는 데이터로 알 수 없습니다.', {}).length === 0)
  check('오탐 수정: "채용률을 먼저 보라는 뜻은 아닙니다" 통과', rules('채용률을 먼저 보라는 뜻은 아닙니다.', { facts: guideFacts }).length === 0)
  // 상점 확률 인용은 게임 데이터 표(lib/shopOdds)와 대조한다 — 기억 속 다른 세트 확률표를 쓰면 잡힌다
  const { costOdds } = require('../lib/shopOdds')
  check('상점 확률을 표대로 인용하면 통과', rules(`Lv.8 상점에서 4코스트는 ${costOdds(8, 4)}%입니다.`, {}).length === 0)
  check('상점 확률을 표와 다르게 인용 → shopOddsMismatch', rules(`8레벨에서 4코 확률은 ${costOdds(8, 4) + 8}%라 더 굴려야 합니다.`, {}).includes('shopOddsMismatch'))
  check('레벨 없는 % 는 상점 확률 주장 아님', rules('4코스트 캐리의 채용률은 30%입니다.', {}).length === 0)

  console.log('오류 문장 수리')
  const traitSentence = '주문술사 4단계로 화력을 냈습니다.'
  const fixedTrait = repairEntityErrors({ overview: `좋은 판이었습니다. ${traitSentence}` }, errs(traitSentence))
  check('시너지 단계: 값이 하나면 맞는 값으로 교체', fixedTrait.overview === '좋은 판이었습니다. 주문술사 2단계로 화력을 냈습니다.', fixedTrait.overview)
  const listSentence = '피들스틱·르블랑·오른 모두 3성 확보에 성공했습니다.'
  const fixedList = repairEntityErrors({ overview: `중반이 안정적이었습니다. ${listSentence} 후반 운영은 무난했습니다.` }, errs(listSentence))
  check('흩어진 표현은 문장 삭제', fixedList.overview === '중반이 안정적이었습니다. 후반 운영은 무난했습니다.', fixedList.overview)
  const fixedArr = repairEntityErrors({ actions: [listSentence, '골드 50을 유지하세요.'] }, errs(listSentence))
  check('배열 항목이 비면 항목을 뺌', fixedArr.actions.length === 1 && fixedArr.actions[0] === '골드 50을 유지하세요.', JSON.stringify(fixedArr.actions))
  const onlyBad = repairEntityErrors({ overview: listSentence }, errs(listSentence))
  check('단일 필드가 통째로 비면 원문 유지', onlyBad.overview === listSentence)
  const untouched = { overview: '정상 문장입니다.', metaScore: 70 }
  check('오류 없으면 그대로', repairEntityErrors(untouched, []) === untouched)

  console.log('리포트 통합 (폴백 경로)')
  const { generateMetaCoachFeedback } = require('../lib/llm')
  const fb = await generateMetaCoachFeedback('Fixture#KR1', sample, 'single')
  check('결과 grounding.entityErrors 가 배열로 포함', fb.isFallback === true && Array.isArray(fb.grounding && fb.grounding.entityErrors), JSON.stringify(fb.grounding && fb.grounding.entityErrors))
  check('폴백 리포트(코드 생성)는 의미 오류 0', fb.grounding.entityErrors.length === 0, show(fb.grounding.entityErrors))
  check('feedbackTexts: 강의·축 한 줄까지 수집', feedbackTexts({ overview: 'a', lecture: { concept: 'b', checklist: ['c'] } }, { economy: 'd' }).join('') === 'abcd')

  console.log(failures ? `\n❌ 실패 ${failures}건` : '\n✅ 의미 검증 테스트 통과')
  if (failures) process.exitCode = 1
})()

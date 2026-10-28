/**
 * AI 리포트 ↔ 경기 데이터 일치 테스트 (2026-10-28 재평가 P1·P2) — 네트워크·LLM 없이 돈다.
 *
 *  3. 조합법: 아이템 데이터와 다른 "아이템 + 재료" 문장은 지우고 근거 검증 점수에 반영한다 (lib/itemRecipes)
 *  4. 조언 모순: 이미 3개 든 기물에 "아이템 추가" 조언 금지, 활성 시너지 수는 카드와 같은 값 (lib/boardStats · semanticGrounding)
 *
 * 실행: node scripts/testReportConsistency.js   (npm run test:ai 에 포함)
 */
require('./_ts')
const { validateItemRecipes, recipeFactsFor } = require('../lib/itemRecipes')
const { validateAdviceAndCounts, repairEntityErrors } = require('../lib/semanticGrounding')
const { boardCounts } = require('../lib/boardStats')
const { readMatch } = require('../lib/coaching')
const { CURRENT_SET } = require('../lib/gameFacts')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  ✅ ${label}`)
  else {
    failures++
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('3. 아이템 조합법')
{
  const bad = '코그모에게 보석 건틀릿 재료(곡궁+주문력)를 먼저 모으세요.'
  const r = validateItemRecipes([bad])
  check('보석 건틀릿 = 곡궁+주문력 → 불일치', r.errors.length === 1 && r.errors[0].expected.includes('연습용 장갑'), JSON.stringify(r.errors))
  check('구인수의 격노검(곡궁+주문력) → 일치', validateItemRecipes(['구인수의 격노검(곡궁+주문력)을 완성하세요.']).errors.length === 0)
  check('보석 건틀릿 = 장갑 + 지팡이 → 일치', validateItemRecipes(['보석 건틀릿은 연습용 장갑과 쓸데없이 큰 지팡이로 만듭니다.']).errors.length === 0)
  check('능력치 서술("방어력과 체력")은 조합법 주장이 아님', validateItemRecipes(['가고일 돌갑옷으로 방어력과 체력을 올리세요.']).checked === 0)
  const facts = recipeFactsFor('보석 건틀릿 · 쇼진의 창')
  check('프롬프트 조합법 줄은 게임 데이터에서', facts.includes('보석 건틀릿 = 연습용 장갑 + 쓸데없이 큰 지팡이') && facts.includes('쇼진의 창 ='), facts)
  const { errors } = validateAdviceAndCounts([`${bad} 다음 판도 같은 방향입니다.`], [])
  const fixed = repairEntityErrors({ actions: [bad, '다른 조언'] }, errors)
  check('불일치 문장은 리포트에서 지움', fixed.actions.length === 1 && fixed.actions[0] === '다른 조언', JSON.stringify(fixed))
}

console.log('4. 조언·수치 모순')
const U = (id, name, tier, items, rarity = 3) => ({ id, name, tier, rarity, items })
// 102#2600 26분 29초 7등: 코그모 3템, 시너지 적응가·개화·싸움꾼·부식
const kog = {
  matchId: 'kog',
  setNumber: CURRENT_SET,
  gameDatetime: 0,
  queueId: 1100,
  placement: 7,
  level: 7,
  lastRound: '5-2',
  goldLeft: 2,
  augments: [],
  traits: [
    { name: '적응가', tier: 1, count: 2 },
    { name: '개화', tier: 1, count: 3 },
    { name: '싸움꾼', tier: 1, count: 2 },
    { name: '부식', tier: 1, count: 1 },
  ],
  units: [
    U('DA_KogMaw18_AD', '코그모', 2, ['쇼진의 창', '붉은 덩굴정령', '죽음의 검']),
    U('DA_18_Sett', '세트', 2, ['워모그의 갑옷'], 4),
    U('DA_18_Karma', '카르마', 2, [], 1),
    U('DA_18_Yorick', '요릭', 2, [], 1),
    U('DA_18_Kobuko', '코부코', 1, [], 1),
    U('DA_18_MasterYi_AD', '마스터 이', 1, [], 3),
  ],
}
{
  const texts = [
    '무한의 대검을 추가로 맞춰 캐리 아이템 3개를 채우세요.',
    '코그모에게 아이템을 더 몰아주세요.',
    '세트에게 아이템을 더 주면 버팁니다.',
  ]
  const { errors } = validateAdviceAndCounts(texts, [kog])
  const conflicts = errors.filter((e) => e.type === 'advice_conflict').map((e) => e.text)
  check('캐리(코그모)가 이미 3템이면 "캐리 아이템 3개를 채우라" 조언은 모순', conflicts.includes(texts[0]), JSON.stringify(conflicts))
  check('3템 든 기물 이름으로 "더 몰아주라"도 모순', conflicts.includes(texts[1]))
  check('아이템 1개인 세트에게 더 주라는 조언은 허용', !conflicts.includes(texts[2]))
}
{
  const counts = boardCounts(kog)
  const plan = readMatch(kog)
  check('카드·6축 진단의 활성 시너지 수가 같음 (부식 포함 4)', counts.activeTraits === 4 && plan.activeTraits === 4, `${counts.activeTraits} / ${plan.activeTraits}`)
  const { errors } = validateAdviceAndCounts(['활성 시너지 3개(적응가, 개화, 싸움꾼, 부식)로 마무리했습니다.', '캐리 아이템 2개로 버텼습니다.'], [kog])
  const fixed = repairEntityErrors({ overview: '활성 시너지 3개(적응가, 개화, 싸움꾼, 부식)로 마무리했습니다.', lecture: { evidence: '캐리 아이템 2개로 버텼습니다.' } }, errors)
  check('리포트의 "활성 시너지 3개" → 카드 값 4개로 고침', fixed.overview.startsWith('활성 시너지 4개'), fixed.overview)
  check('리포트의 "캐리 아이템 2개" → 실제 장착 3개로 고침', fixed.lecture.evidence.includes('캐리 아이템 3개'), fixed.lecture.evidence)
}

console.log('6. 탈락 시점 → 템포·경제')
{
  const { buildCoachingPlan } = require('../lib/coaching')
  const lobby = (stage) =>
    [1, 2, 3, 4, 5, 6, 8].map((p) => ({ placement: p, gameName: `p${p}`, tagLine: 'KR1', level: 8, lastRound: p >= 6 ? `${stage}-2` : '6-3', damageToPlayers: 0, traits: [], units: [], isUser: false }))
  const at = (stage) => ({ ...kog, lastRound: `${stage}-2`, lobbyParticipants: lobby(stage) })
  const axis = (m, k) => buildCoachingPlan([m]).axes.find((a) => a.key === k)
  const t5 = axis(at(5), 'tempo')
  const t6 = axis(at(6), 'tempo')
  const e5 = axis(at(5), 'economy')
  const e6 = axis(at(6), 'economy')
  check('같은 보드, 5스테이지 탈락이 6스테이지보다 템포 낮음', t5.score < t6.score, `${t5.score} vs ${t6.score}`)
  check('같은 보드, 5스테이지 탈락이 6스테이지보다 경제 낮음', e5.score < e6.score, `${e5.score} vs ${e6.score}`)
  check('템포 근거에 탈락 시점', /탈락 5스테이지/.test(t5.detail) && (t5.effects || []).some((x) => x.key === 'exitStage' && x.points < 0), t5.detail)
  check('경제 근거에 탈락 시점·로비 레벨', /탈락 5스테이지/.test(e5.detail) && /상대 Lv\./.test(e5.detail), e5.detail)
}

console.log('8. 리롤형 아이템 지표')
{
  const { buildCoachingPlan } = require('../lib/coaching')
  const { detectDeckType } = require('../lib/deckType')
  // 리롤형: 1~2코 3성 캐리, 캐리가 아닌 4코 이즈리얼·니달리
  const reroll = {
    ...kog,
    matchId: 'reroll',
    level: 7,
    units: [
      U('DA_18_Kayle', '케일', 3, ['구인수의 격노검', '내셔의 이빨', '거인 학살자'], 2),
      U('DA_18_Leona', '레오나', 3, ['워모그의 갑옷'], 1),
      U('DA_18_Sejuani', '세주아니', 3, [], 2),
      U('DA_18_Ezreal', '이즈리얼', 1, [], 4),
      U('DA_Nidalee18_AP', '니달리', 1, [], 4),
      U('DA_18_Varus', '바루스', 2, [], 1),
    ],
  }
  check('리롤형 판정', detectDeckType(reroll).type === 'reroll', detectDeckType(reroll).type)
  const item = buildCoachingPlan([reroll]).axes.find((a) => a.key === 'itemization')
  check('리롤형 아이템 축에 "최고 코스트 기물" 지표 없음', !(item.metrics || []).some((x) => x.key === 'topCostItems') && !/최고 코스트 기물 아이템 \d/.test(item.detail), item.detail)
  const { errors } = validateAdviceAndCounts(['이즈리얼에게 아이템을 더 몰아주세요.', '니달리에게 아이템을 추가로 맞춰 주세요.'], [reroll])
  check('리롤형에서 캐리가 아닌 4코스트에 아이템 몰아주기 조언은 삭제', errors.filter((e) => e.type === 'advice_conflict').length === 2, JSON.stringify(errors.map((e) => e.expected)))
}

console.log('5. 메타 평균 스냅샷')
{
  const fs = require('fs')
  const path = require('path')
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  check('덱 성적표는 메타 덱 스냅샷(getMetaDeckSnapshot)을 씀', /getMetaDeckSnapshot\(\)/.test(read('lib/deckReport.ts')))
  check('메타 페이지 덱 탭도 같은 스냅샷을 씀', /getMetaDeckSnapshot\(\)/.test(read('app/meta/page.tsx')))
  const { metaSnapshotLabel } = require('../lib/deckReportShared')
  const label = metaSnapshotLabel({ source: 'json', patch: 'set18', updatedAt: '2026-10-28T00:29:04.802Z' })
  check('갱신 시각은 KST 분 단위 (두 화면 같은 함수)', label.includes('10.28 09:29 갱신'), label)
  const scoped = metaSnapshotLabel({ source: 'db', tier: '마스터+', patch: '16.21', matches: 12345, updatedAt: '2026-10-28T00:29:04.802Z' }, { withMatches: true })
  check('10. 메타 머리말에 수집 랭크 구간·전체 경기 수', scoped.startsWith('KR 랭크 마스터+ 집계 · 12,345판'), scoped)
  check('10. 메타 페이지 상단 배지(랭크 구간·경기 수)', /scopeBadge/.test(read('app/meta/page.tsx')) && /matchesBadge/.test(read('app/meta/page.tsx')))
}

if (failures) {
  console.error(`\n❌ 리포트 일치 테스트 실패 ${failures}건`)
  process.exit(1)
}
console.log('\n✅ 리포트 일치 테스트 통과')

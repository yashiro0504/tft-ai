/**
 * 2026-11-02 지시문 테스트 — 네트워크·DB·LLM 불필요 (가짜 보드·가짜 리포트).
 *
 *  1. 옛 버전 리포트: 저장소에서 먼저 열림(차감 없음) · 옛 버전에만 다시 분석 버튼 · 버튼만 1회 차감 · 실패하면 기존 유지 · 재차감 조회
 *  2. 시너지 단계 시뮬레이션: 난몰라#KR1 30분 31초 "원시 6명 3단계" 실패 · "럭스 대신 … 단계 합 8 이상" 실패 · "선봉대 4+2명 3단계" 통과 · 캐시 리포트 수리
 *  3. 아이템 문장: 상징 재료 조합식 · 상징 자리를 기물로 · 검은 가시 4+1명 3단계 · 상점 재료 · 캐시 리포트 수리
 *  4. 메타 캐시 헤더 · 스냅샷 사본 · 워크플로 미리 채우기
 *  5. 숫자 목표 · BIS 요약 일치 · 등수 방향 · 표기 통일
 *
 * 실행: node scripts/testDirective1102.js   (npm run test:ai 에 포함)
 */
require('./_ts')
const fs = require('fs')
const path = require('path')
const { buildBoardTable, boardTableFacts, stageSumOf, traitStatic } = require('../lib/boardTable')
const { validateStructuredAdvice, validateTierClaims, validateDerivedClaims, parseStructuredAdvice } = require('../lib/adviceCheck')
const { validateAdviceAndCounts, repairEntityErrors, feedbackTexts, numericDrill, hasMeasurableTarget } = require('../lib/semanticGrounding')
const { validateComponentLists, EMBLEM_RECIPES } = require('../lib/itemRecipes')
const { revalidateReport } = require('../lib/reportRevalidate')
const { fixEnglishTerms } = require('../lib/grounding')
const { bisMatchLabel } = require('../lib/playbook')
const { isOutdatedReport, servableFromCache } = require('../lib/matchAnalysis')
const { REPORT_GENERATOR_VERSION } = require('../lib/llm')
const { findRecharges } = require('./findSilentRecharges')

let failures = 0
function check(label, ok, detail = '') {
  if (ok) console.log(`  ✅ ${label}`)
  else {
    failures++
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8')
const U = (id, name, tier, items = [], rarity) => ({ id, name, tier, items, rarity })

/** 난몰라#KR1 30분 31초 — 4등 · Lv.8 · 원시 4 · 선봉대 4 · 사냥꾼 2 · 화신 1 (단계 합 6) */
const mNan = {
  matchId: 'KR_NAN_3031',
  placement: 4,
  level: 8,
  lastRound: '5-5',
  goldLeft: 0,
  augments: [],
  units: [
    U('DA_Nidalee18_AP', '니달리', 2, [], 4),
    U('DA_18_Sivir', '시비르', 2, [], 4),
    U('DA_Vi18', '바이', 2, [], 3),
    U('DA_Lux18_Base', '럭스', 1, [], 5),
    U('DA_Sentinel18', '파수꾼', 1, [], 4),
    U('DA_18_Hecarim', '헤카림', 2, [], 3),
    U('DA_18_Diana', '다이애나', 2, [], 3),
    U('DA_18_Elise', '엘리스', 2, ['사냥꾼 상징'], 2),
  ],
  traits: [
    { name: '원시', tier: 2, count: 4 },
    { name: '선봉대', tier: 2, count: 4 },
    { name: '사냥꾼', tier: 1, count: 2 },
    { name: '화신', tier: 1, count: 1 },
    { name: '적응가', tier: 0, count: 1 },
    { name: '전쟁기계', tier: 0, count: 1 },
    { name: '협곡야수', tier: 0, count: 1 },
    { name: '기원자', tier: 0, count: 1 },
    { name: '나무정령', tier: 0, count: 1 },
    { name: '달빛', tier: 0, count: 1 },
    { name: '약탈자', tier: 0, count: 1 },
    { name: '악의 여단', tier: 0, count: 1 },
  ],
}
const PRIMAL_6 = '원시 4명을 6명으로 늘려 3단계까지 올린다.'
const CHECK_6 = '원시·선봉대 중 어느 쪽을 깊게 가져갈지 정하고 그 인원을 6명까지 채운다.'
const LUX_SWAP = '럭스 대신 원시 또는 선봉대 기물로 교체해 단계 합을 8 이상으로 만든다.'
const VANGUARD_OK = '선봉대 4명에 2명을 더해 3단계를 노린다.'

/** 백승민#agent 31분 34초 — 5등 · Lv.8 · 검은 가시 4 (워윅·렉사이·말파이트·다이애나 상징) · 렉사이가 악의 여단 상징 */
const mBack = {
  matchId: 'KR_BACK_3134',
  placement: 5,
  level: 8,
  lastRound: '5-6',
  goldLeft: 0,
  augments: [],
  units: [
    U('DA_18_Warwick', '워윅', 2, ['수은', '무한의 대검', '거인 학살자'], 2),
    U('DA_18_RekSai', '렉사이', 2, ['악의 여단 상징'], 1),
    U('DA_18_Malphite', '말파이트', 1, [], 4),
    U('DA_18_Diana', '다이애나', 2, ['검은 가시 상징'], 3),
  ],
  traits: [
    { name: '검은 가시', tier: 2, count: 4 },
    { name: '약탈자', tier: 1, count: 2 },
    { name: '거석', tier: 1, count: 1 },
    { name: '악의 여단', tier: 0, count: 1 },
  ],
}
const EMBLEM_MAT = '상점에서 상징 재료(연습용 장갑·쓸데없이 큰 지팡이)가 보이면 어느 시너지에 상징을 붙일지 먼저 정한다.'
const EMBLEM_MAT_ONLY = '상징 재료(연습용 장갑·쓸데없이 큰 지팡이)를 모으면 어느 시너지에 상징을 붙일지 먼저 정한다.'
const SLOT_SWAP = '렉사이의 악의 여단 상징 자리를 검은 가시 6명째 기물로 바꿔 3단계를 노린다.'
const BT_PLUS1 = '검은 가시 4명에서 1명 추가로 3단계를 노린다.'

const cachedFb = (actions, checklist = [], extra = {}) => ({
  mode: 'single',
  metaScore: 60,
  metaTier: 'B',
  playstyle: '',
  overview: '이번 판은 4등으로 마쳤습니다.',
  actions,
  lecture: { topic: '', concept: '', why: '', evidence: '', alternative: '', drill: '다음 3판은 최종 보드 2성 이상 기물 6개 이상', checklist, moments: [] },
  grounding: { score: 100, total: 0, supported: 0, unsupported: [], revalidated: '2026-10-30.2' },
  generatorVersion: '2026-10-30.2',
  ...extra,
})

console.log('1. 옛 버전 리포트 — 먼저 보여 주고, 버튼으로만 다시 분석')
{
  const oldResp = { success: true, matchId: 'KR_1', feedback: { generatorVersion: '2026-10-30.2' }, cached: true, outdated: true }
  const newResp = { success: true, matchId: 'KR_1', feedback: { generatorVersion: REPORT_GENERATOR_VERSION }, cached: true, outdated: false }
  check('생성기 버전을 올림 (2026-11-02.x) → 10/30 리포트는 옛 버전', REPORT_GENERATOR_VERSION.startsWith('2026-11-02') && isOutdatedReport(oldResp.feedback))
  check('"이 경기 AI 분석"(regenerate 없음) → 옛 버전 저장 리포트를 그대로 연다 (새로 만들지 않음)', servableFromCache({ response: oldResp }, false))
  check('"새 버전으로 다시 분석"(regenerate) → 옛 버전일 때만 새로 만든다', !servableFromCache({ response: oldResp }, true) && servableFromCache({ response: newResp }, true))
  check('저장 리포트가 없으면 새로 만든다 (횟수 확인 대상)', !servableFromCache(null, false))
  const ma = read('lib', 'matchAnalysis.ts')
  check('Redis 캐시가 비면 영구 저장소(analysis_reports)에서 꺼낸다 — 차감 없는 캐시 적중', /loadStoredReport/.test(ma) && /source: 'db'/.test(ma))
  check('새 AI 리포트는 영구 저장 (폴백은 저장 안 함)', /if \(!feedback\.isFallback\) await saveStoredReport/.test(ma))
  check('새 버전 생성 실패(폴백) → 기존 리포트 그대로 · 차감 없음(cached)', /cached && feedback\.isFallback[\s\S]{0,200}regenerateFailed: true[\s\S]{0,40}cached: true/.test(ma))
  check('경기 분석 캐시 TTL 24시간 → 7일 (만료 뒤에도 저장소에서 다시 채움)', /MATCH: 7 \* 24 \* 60 \* 60_000/.test(read('lib', 'cache.ts')))
  check('0012 마이그레이션: analysis_reports 표 · RLS (service role 전용)', /create table if not exists public\.analysis_reports/.test(read('supabase', 'migrations', '0012_analysis_reports.sql')) && /enable row level security/.test(read('supabase', 'migrations', '0012_analysis_reports.sql')))
  for (const route of [['app', 'api', 'tft', 'match', 'stream', 'route.ts'], ['app', 'api', 'tft', 'match', 'route.ts']]) {
    const src = read(...route)
    check(`${route.slice(3).join('/')}: 남은 횟수 0이어도 저장 리포트는 연다 (새로 만들 때만 429)`, /if \(daily && !servableFromCache\(await getCachedMatchAnalysis\(params\), params\.regenerate\)\) return daily/.test(src) && !/\n\s*if \(daily\) return daily\n/.test(src))
    check(`${route.slice(3).join('/')}: regenerate 를 받는다`, /regenerate: raw\.regenerate === true/.test(src))
    check(`${route.slice(3).join('/')}: 새로 만들었을 때만 차감 (재생성은 :gen: 멱등 키)`, /!outcome\.cached && !outcome\.response\.feedback\?\.isFallback \? await chargeQuotaOnce\(req, analysisChargeKey\(params, outcome\.regenerated\)\)/.test(src))
  }
  const ov = read('app', 'api', 'tft', 'overview', 'route.ts')
  check('종합 분석도 저장소 · 횟수 0일 때 저장 리포트 열기 · 실패 시 기존 유지', /loadStoredReport/.test(ov) && /saveStoredReport/.test(ov) && /\/\/ 새로 만들어야 할 때만 남은 횟수로 막는다\n\s*if \(daily\) return daily/.test(ov) && /regenerateFailed: true/.test(ov))
  const card = read('app', 'components', 'MatchCard.tsx')
  check('카드: 옛 버전 리포트 위 안내 문구', card.includes('이전 버전 분석입니다. 새 버전은 덱 비교·검증이 개선됐습니다.'))
  check('카드: 버튼 "새 버전으로 다시 분석 (무료 1회 차감)" · 횟수 0이면 비활성 + 이유', card.includes('새 버전으로 다시 분석 (무료 1회 차감)') && /disabled=\{isAnalyzing \|\| needsBotCheck \|\| quota\.exhausted\}/.test(card) && card.includes('오늘 무료 분석 횟수를 모두 써서 다시 분석할 수 없습니다'))
  check('카드: 버튼은 outdated 일 때만 (최신 리포트엔 없음)', /\{outdated && \(\s*<div className="mb-4/.test(card) && /feedback && !isAnalyzing \? null/.test(card))
  check('카드: 첫 열기는 횟수 0이어도 요청 (저장 리포트면 열림 · 없으면 429 → 한도 안내)', /if \(regenerate && quota\.exhausted\)/.test(card) && /err instanceof AnalysisQuotaError/.test(card))

  // 재차감 조회: 같은 멱등 키가 두 날짜에 있으면 재생성 차감 (:gen: 은 버튼 차감이라 제외)
  const rows = [
    { user_id: 'u1aaaaaaaa', day: '2026-10-30', bucket: 'analysis', idem_key: 'analysis:KR_1:p:single:v' },
    { user_id: 'u1aaaaaaaa', day: '2026-11-02', bucket: 'analysis', idem_key: 'analysis:KR_1:p:single:v' },
    { user_id: 'u1aaaaaaaa', day: '2026-11-02', bucket: 'analysis', idem_key: 'analysis:KR_2:p:single:v' },
    { user_id: 'u1aaaaaaaa', day: '2026-11-02', bucket: 'analysis', idem_key: 'analysis:KR_3:p:single:v:gen:2026-10-30.2' },
    { user_id: 'u1aaaaaaaa', day: '2026-10-31', bucket: 'analysis', idem_key: 'analysis:KR_3:p:single:v' },
  ]
  const hits = findRecharges(rows)
  check('재차감 조회: 10/30 → 11/02 같은 리포트 재차감 1건 (버튼 차감·첫 차감 제외)', hits.length === 1 && hits[0].day === '2026-11-02' && hits[0].firstDay === '2026-10-30', JSON.stringify(hits))
}

console.log('2. 시너지 단계 시뮬레이션 — 난몰라#KR1 30분 31초')
{
  const table = buildBoardTable(mNan)
  check('보드 표: 원시 단계 목록 [2, 4] · 최고 2단계 · 세트 기물 4개(니달리·시비르·바이·럭스) · 상징 있음', (() => {
    const st = traitStatic('원시')
    return st.breakpoints.join() === '2,4' && st.maxTier === 2 && st.units.length === 4 && st.units.includes('럭스') && st.emblem
  })(), JSON.stringify(traitStatic('원시')))
  check('보드 표: 선봉대 [2, 4, 6] · 화신 [1]', traitStatic('선봉대').breakpoints.join() === '2,4,6' && traitStatic('화신').breakpoints.join() === '1')
  check('단계 합 6 (원시 2 + 선봉대 2 + 사냥꾼 1 + 화신 1)', stageSumOf(table) === 6, String(stageSumOf(table)))
  const facts = boardTableFacts(mNan)
  check('프롬프트 보드 표에 단계 목록·최고 단계·세트 기물 수', /원시 4명 .*단계 목록 2\/4명\(최고 2단계\) · 세트 기물 4개 \+ 상징\(뒤집개 \+ 연습용 장갑/.test(facts), facts.split('\n').find((l) => l.startsWith('- 원시')))
  check('프롬프트 규칙: 목표 단계는 단계 목록에 있는 값만', /목표 단계·인원은 그 시너지의 단계 목록에 있는 값만/.test(facts) && /단계 목록"에 있는 값만 써라/.test(read('lib', 'llm.ts')))

  // 구조화된 조언
  const advice = parseStructuredAdvice([
    { quote: PRIMAL_6, action: 'add_trait_units', target_trait: '원시', count: 2, target_tier: 3 },
    { quote: LUX_SWAP, action: 'replace_unit', remove: '럭스', target_trait: '원시/선봉대', target_stage_sum: 8 },
    { quote: VANGUARD_OK, action: 'add_trait_units', target_trait: '선봉대', count: 2, target_tier: 3 },
  ])
  const st = validateStructuredAdvice(advice, [PRIMAL_6, LUX_SWAP, VANGUARD_OK], mNan)
  check('구조화: "원시 6명 3단계" → 실패 (원시 단계 2/4 — 3단계 없음)', st.errors.some((e) => e.text === PRIMAL_6 && /3단계 없음/.test(e.expected)), JSON.stringify(st.errors.map((e) => e.expected)))
  check('구조화: "럭스 대신 원시/선봉대 기물로 단계 합 8 이상" → 실패 (빼면 화신 꺼짐, 최대 6)', st.errors.some((e) => e.text === LUX_SWAP && /최대 [0-7]$/.test(e.expected)), JSON.stringify(st.errors.map((e) => e.expected)))
  check('구조화: "선봉대 4명에 2명을 더해 3단계" → 통과 (선봉대 2/4/6)', !st.errors.some((e) => e.text === VANGUARD_OK), JSON.stringify(st.errors.map((e) => e.expected)))
  check('단계 시뮬레이션 검사 수 = 3', st.tierSim === 3, String(st.tierSim))
  check('구조화: 레벨 칸을 넘는 추가 → 실패 (선봉대 4 + 6명 = 10명 > Lv.8)', validateStructuredAdvice([{ action: 'add_trait_units', target_trait: '선봉대', count: 6 }], [], mNan).errors.length === 1)

  // 문장 (체크리스트·강의 — 구조화 없이)
  const tc = validateTierClaims([PRIMAL_6, CHECK_6, LUX_SWAP, VANGUARD_OK], mNan)
  const failed = new Set(tc.errors.map((e) => e.text))
  check('문장: "원시 4명을 6명으로 늘려 3단계까지" → 실패', failed.has(PRIMAL_6), JSON.stringify(tc.errors))
  check('문장: 체크리스트 "원시·선봉대 중 어느 쪽 … 6명까지" → 실패 (원시는 4명이 최고)', failed.has(CHECK_6))
  check('문장: "럭스 대신 원시 또는 선봉대 기물로 교체해 단계 합 8 이상" → 실패', failed.has(LUX_SWAP))
  check('문장: "선봉대 4명에 2명을 더해 3단계" → 통과', !failed.has(VANGUARD_OK))
  check('문장: 선봉대만 6명까지 → 통과', validateTierClaims(['선봉대 인원을 6명까지 채운다.'], mNan).errors.length === 0)

  // 캐시 리포트 다시 열기 — 원시 문장 사라짐 · 근거 검증 표시에 시뮬레이션 수
  const shown = revalidateReport(cachedFb([PRIMAL_6, LUX_SWAP, VANGUARD_OK], [CHECK_6, '전투 전에 배치를 확인한다.']), [mNan])
  const texts = feedbackTexts(shown)
  check('캐시 리포트 다시 열면 원시 관련 오류 문장이 보이지 않음', !texts.some((t) => /원시 4명을 6명|그 인원을 6명|럭스 대신/.test(t)), JSON.stringify(texts))
  check('정상 조언은 남음 (선봉대 3단계)', texts.some((t) => t.includes('선봉대 4명에 2명')))
  check('근거 검증에 단계 시뮬레이션 수 (≥ 3)', (shown.grounding.tierSimChecked ?? 0) >= 3, String(shown.grounding.tierSimChecked))
  check('화면 표시: "관계 N개 · 단계 시뮬레이션 M개 검사"', /단계 시뮬레이션 \$\{g\.tierSimChecked\}개/.test(read('app', 'components', 'FeedbackReport.tsx')))
}

console.log('3. 아이템 문장 — 백승민#agent 31분 34초')
{
  check('정적 데이터: 검은 가시 상징 = 뒤집개 + 거인의 허리띠', EMBLEM_RECIPES['검은 가시 상징'].join('+') === '뒤집개+거인의 허리띠')
  const lists = validateComponentLists([EMBLEM_MAT_ONLY], ['검은 가시'])
  check('"상징 재료(연습용 장갑·쓸데없이 큰 지팡이)" → 실패 (검은 가시 상징 조합식과 다름)', lists.errors.some((e) => e.kind === 'recipe' && e.expected === '뒤집개 + 거인의 허리띠'), JSON.stringify(lists.errors))
  check('맞는 상징 재료(뒤집개·거인의 허리띠) → 통과', validateComponentLists(['상징 재료(뒤집개·거인의 허리띠)를 모으세요.'], ['검은 가시']).errors.length === 0)
  check('상징 이름이 있으면 그 상징 조합식과 대조 (원시 상징 = 뒤집개 + 연습용 장갑)', validateComponentLists(['원시 상징 재료(뒤집개와 연습용 장갑)를 모으세요.'], ['검은 가시']).errors.length === 0)
  const shop = validateComponentLists([EMBLEM_MAT], ['검은 가시'])
  check('"상점에서 상징 재료" → 게임 규칙 오류 (재료는 상점에서 팔지 않음)', shop.errors.some((e) => e.kind === 'rule' && /상점에서/.test(e.actual)), JSON.stringify(shop.errors))
  const adv = validateAdviceAndCounts([EMBLEM_MAT], [mBack])
  const repaired = repairEntityErrors({ t: [EMBLEM_MAT, '워윅 아이템은 그대로 둡니다.'] }, adv.errors).t
  check('리포트 수리: 상점 재료 문장은 지운다', repaired.length === 1, JSON.stringify(repaired))

  const slot = validateTierClaims([SLOT_SWAP], mBack)
  check('"상징 자리를 … 기물로 바꿔" → 실패 (아이템 칸 ≠ 기물 칸)', slot.errors.some((e) => e.text === SLOT_SWAP && /기물 칸이 아님/.test(e.expected)), JSON.stringify(slot.errors))
  const slotS = validateStructuredAdvice([{ action: 'replace_unit', remove: '악의 여단 상징', unit: '렉사이', target_trait: '검은 가시', quote: SLOT_SWAP }], [SLOT_SWAP], mBack)
  check('구조화: replace_unit 의 remove 가 아이템(상징) → 실패', slotS.errors.some((e) => /아이템 칸/.test(e.expected)), JSON.stringify(slotS.errors))
  check('구조화: change_items 의 add_item 이 기물 → 실패', validateStructuredAdvice([{ action: 'change_items', unit: '렉사이', remove_item: '악의 여단 상징', add_item: '아지르' }], [], mBack).errors.length === 1)
  const bt = validateTierClaims([BT_PLUS1], mBack)
  check('"검은 가시 4명에서 1명 추가로 3단계" → 실패 (3단계는 6명)', bt.errors.some((e) => e.text === BT_PLUS1 && /6명 필요/.test(e.expected)), JSON.stringify(bt.errors))
  check('"검은 가시 4명에 2명 추가로 3단계" → 통과', validateTierClaims(['검은 가시 4명에 2명 추가로 3단계를 노린다.'], mBack).errors.length === 0)
  const emb = validateStructuredAdvice([{ action: 'change_items', unit: '워윅', add_item: '검은 가시 상징', target_trait: '검은 가시', target_tier: 3 }], [], mBack)
  check('구조화: 상징 1개(+1명)로 검은 가시 3단계 → 실패 (4+1=5 < 6)', emb.errors.some((e) => /상징 1개 = \+1명/.test(e.expected)), JSON.stringify(emb.errors))

  const shown = revalidateReport(cachedFb([SLOT_SWAP, '워윅에게 아이템을 그대로 주세요.'], [EMBLEM_MAT, '검은 가시 4명을 유지합니다.']), [mBack])
  const texts = feedbackTexts(shown)
  check('캐시 리포트 다시 열면 상징 재료·상징 자리 문장이 보이지 않음', !texts.some((t) => /상징 재료|상징 자리/.test(t)), JSON.stringify(texts))
}

console.log('4. 메타 API 캐시')
{
  const route = read('app', 'api', 'tft', 'meta', 'route.ts')
  check('보기별 응답(view=summary·decks): s-maxage + stale-while-revalidate 하루', /'public, s-maxage=300, stale-while-revalidate=86400'/.test(route))
  check('전체 응답도 stale-while-revalidate 하루', /'public, s-maxage=60, stale-while-revalidate=86400'/.test(route))
  const stats = read('lib', 'tftStats.ts')
  check('서버 스냅샷: 5분 캐시가 비면 마지막 DB 스냅샷 사본을 바로 주고 뒤에서 갱신', /SNAPSHOT_STALE_KEY/.test(stats) && /refreshInBackground\(\)\n\s*return last/.test(stats) && /after\(run\)/.test(stats))
  const wf = read('.github', 'workflows', 'collect-db.yml')
  check('수집 직후 view=summary·decks·전체·/meta·덱 페이지 미리 채움', ['/api/tft/meta?view=summary', '/api/tft/meta?view=decks', '"/api/tft/meta"', '"/meta"', '/deck/'].every((p) => wf.includes(p)))
}

console.log('5. 리포트 문구')
{
  check('"다음 3판은 경제 운영 하나만 의식하세요" → 숫자 기준 없음 (3판의 3은 기준이 아님)', !hasMeasurableTarget('다음 3판은 경제 운영 하나만 의식하세요. 매 라운드 이자를 챙깁니다.'))
  check('"다음 3판은 최종 레벨 9 도달" → 숫자 기준 있음', hasMeasurableTarget('다음 3판은 최종 레벨 9 도달하기'))
  check('경제 축 기본 목표: Lv.8 판 → "최종 레벨 9 도달"', /최종 레벨 9 도달/.test(numericDrill([mNan], 'economy')), numericDrill([mNan], 'economy'))
  check('경제 축 기본 목표: Lv.9 판 → "보드 가치 NG 이상" (100G 이상)', /보드 가치 (\d+)G 이상/.test(numericDrill([{ ...mNan, level: 9 }], 'economy')) && Number(numericDrill([{ ...mNan, level: 9 }], 'economy').match(/가치 (\d+)G/)[1]) >= 100)
  check('시너지 축 기본 목표: 단계 합', /단계 합 8 이상/.test(numericDrill([mNan], 'synergy')), numericDrill([mNan], 'synergy'))
  const shown = revalidateReport({ ...cachedFb(['워윅에게 아이템을 그대로 주세요.']), lecture: { ...cachedFb([]).lecture, drill: '다음 3판은 경제 운영 하나만 의식하세요.' }, plan: { focus: 'economy', axes: [] } }, [mNan])
  check('캐시 리포트: 숫자 없는 목표 → 코드 목표로 바꿈', /레벨 9|보드 가치/.test(shown.lecture.drill), shown.lecture.drill)

  // BIS: 카르마 = 라바돈·푸른 파수꾼·처형자 상징 · BIS 세트(상징 제외) 2칸 모두 일치
  const bis = { unit: '카르마', label: 'BIS 세트', items: ['라바돈의 죽음모자', '푸른 파수꾼'], matched: 2, slots: 2, emblems: ['처형자 상징'], setAvg: 4.1, setGames: 120, deckAvg: 4.5, recommend: true }
  check('BIS 표기 하나: "상징 1칸 제외 · BIS 2/2 일치"', bisMatchLabel(bis) === '상징 1칸 제외 · BIS 2/2 일치', bisMatchLabel(bis))
  const SUMMARY = '카르마 BIS 3개 중 2개 일치에 그친 점이 다듬을 지점입니다.'
  const ACTION = '카르마는 BIS 3개 중 2개 일치로 마무리했습니다.'
  const d = validateDerivedClaims([SUMMARY, ACTION], null, bis)
  const fixed = repairEntityErrors({ t: [SUMMARY, ACTION] }, d.errors).t
  check('요약 "BIS 3개 중 2개 일치에 그친 점" → 남은 칸 모두 일치라 약점 문장 삭제', !fixed.some((t) => t.includes('그친')), JSON.stringify(fixed))
  check('개선 포인트 "BIS 3개 중 2개 일치" → "상징 1칸 제외 · BIS 2/2 일치" (비교 섹션과 같은 계산)', fixed.some((t) => t.includes('상징 1칸 제외 · BIS 2/2 일치')), JSON.stringify(fixed))
  check('비교 섹션 문장·프롬프트 사실도 같은 표기', /\(\$\{bisMatchLabel\(b\)\}\)/.test(read('lib', 'playbook.ts')) && /bisMatchLabel\(b\)\} \(이 표기 그대로 써라\)/.test(read('lib', 'comparisonFacts.ts')))

  check('"0.25등 높았습니다" → "0.25등 나빴습니다"', fixEnglishTerms('알리스타가 있을 때 평균등수가 약 0.25등 높았습니다') === '알리스타가 있을 때 평균등수가 약 0.25등 나빴습니다')
  check('"0.3등 낮았습니다" → "0.3등 좋았습니다"', fixEnglishTerms('평균등수가 약 0.3등 낮았습니다') === '평균등수가 약 0.3등 좋았습니다')
  check('플레이북 비교 문장도 "등 나빴습니다"', !/등 높았습니다/.test(read('lib', 'playbook.ts')) && /등 나빴습니다/.test(read('lib', 'playbook.ts')))
  check('"상위4위 판" → "TOP4 판", "8레벨" → "Lv.8"', fixEnglishTerms('상위4위 판의 49%가 8레벨 이상') === 'TOP4 판의 49%가 Lv.8 이상', fixEnglishTerms('상위4위 판의 49%가 8레벨 이상'))
  check('레벨 차이 "2레벨 낮은"은 그대로', fixEnglishTerms('1등보다 2레벨 낮은 상태') === '1등보다 2레벨 낮은 상태')
  check('팁에도 같은 표기 교정 (groundedTips → fixTermWording)', /\.map\(\(text\) => fixTermWording\(text\)\)/.test(read('lib', 'playbook.ts')))
}

console.log(failures ? `\n❌ 실패 ${failures}건` : '\n✅ 11/02 지시문 테스트 통과')
if (failures) process.exitCode = 1

/**
 * 2026-10-30 2차 지시문 테스트 — 네트워크·DB·LLM 불필요 (가짜 보드·가짜 리포트·래더 JSON 덱).
 *
 *  1. 덱 페이지 = 메타 스냅샷: 전체 덱의 평균등수·TOP4·표본·티어가 메타 응답과 같고, "패치 정보 없음"이 없고, 스냅샷에 없는 id 는 404
 *  2. 교체 조언 검사: 백승민#agent 31분 34초 "말파이트 1성 자리를 … 바꿔" 실패 · 유지/교체 모순 실패 · 구조화 조언 실패 · 관계 검사 수 ≥ 1 ·
 *     캐시 리포트 다시 열면 말파이트 문장이 사라짐
 *  3. BIS 세트 하나 기준 · 추천 조건 미달 세트는 개선 포인트로 안 올림 · 처형자 상징을 빼게 되는 아이템 조언 삭제
 *  5. 오래된 캐시만 다시 분석 · view=summary 에 덱 없음
 *  6. 숫자 목표 · 차이 수치 검사 · 본인 레벨 검사 · 표기 교정 · 스냅샷 판수
 *
 * 실행: node scripts/testDirective1030b.js   (npm run test:ai 에 포함)
 */
require('./_ts')
const fs = require('fs')
const path = require('path')
const { deckFromSnapshot, deckHeadline, deckSnapshotLabel } = require('../lib/deckPage')
const { getDeckViews } = require('../lib/decks')
const { toMetaDeck } = require('../lib/metaPayload')
const { toDecksOnly, toDeckSummary } = require('../lib/metaSlim')
const { deckReportMeta } = require('../lib/deckReport')
const { validateTraitRelations, repairEntityErrors, feedbackTexts, numericDrill, HELD_ITEM_NAMES } = require('../lib/semanticGrounding')
const { validateStructuredAdvice, validateEmblemItemAdvice, validateDerivedClaims, parseStructuredAdvice } = require('../lib/adviceCheck')
const { revalidateReport } = require('../lib/reportRevalidate')
const { deckBisCheck, bisRowText } = require('../lib/playbook')
const { fixEnglishTerms } = require('../lib/grounding')
const { isOutdatedReport } = require('../lib/matchAnalysis')
const { REPORT_GENERATOR_VERSION } = require('../lib/llm')
const { clusterDecks } = require('./collect/decks')

let failures = 0
function check(label, ok, detail = '') {
  if (ok) console.log(`  ✅ ${label}`)
  else {
    failures++
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const U = (id, name, tier, items = [], rarity) => ({ id, name, tier, items, rarity })

console.log('1. 덱 페이지 = 메타 스냅샷')
{
  const decks = getDeckViews().map((d) => toMetaDeck(d))
  const snapshot = { success: true, source: 'db', filter: { patch: '16.21', tier: 'master' }, updatedAt: '2026-10-30T08:03:00Z', totalMatches: 13566, decks }
  // 메타 화면이 받는 값 (withDeckSnapshot → view=decks)
  const meta = toDecksOnly({ success: true, hasMeta: true, champions: [], traits: [], items: [], combos: [], comps: [], decks: snapshot.decks, decksMeta: deckReportMeta(snapshot) })
  const mismatch = meta.decks.filter((m) => {
    const page = deckFromSnapshot(snapshot, m.id)?.deck
    return !page || page.avgPlacement !== m.avgPlacement || page.top4Rate !== m.top4Rate || page.sampleSize !== m.sampleSize || page.tier !== m.tier
  })
  check(`전체 ${meta.decks.length}개 덱: 덱 페이지 평균등수·TOP4·표본·티어 = 메타 (불일치 0개)`, meta.decks.length > 0 && mismatch.length === 0, mismatch.map((d) => d.name).join(','))
  const labels = meta.decks.map((m) => deckSnapshotLabel(deckFromSnapshot(snapshot, m.id)))
  check('모든 덱 페이지 머리말에 "패치 16.21 · 마스터+ 집계" ("패치 정보 없음" 없음)', labels.every((l) => l === '패치 16.21 · 마스터+ 집계'), labels[0])
  check('패치를 모르는 스냅샷도 "패치 정보 없음" 대신 스냅샷 표기', !deckSnapshotLabel({ patch: null, tierLabel: null }).includes('정보 없음'))
  check('개화 카르마(5.78등 · 27%) 제목 문구 = "평균 5.78등 · TOP4 27%"', deckHeadline({ avgPlacement: 5.78, top4Rate: 0.27 }) === '평균 5.78등 · TOP4 27%')
  check('스냅샷에 없는 덱 id → null (페이지는 404)', deckFromSnapshot(snapshot, 'ladder-없는-덱') === null)
  const page = fs.readFileSync(path.join(__dirname, '..', 'app', 'deck', '[id]', 'page.tsx'), 'utf8')
  const og = fs.readFileSync(path.join(__dirname, '..', 'app', 'deck', '[id]', 'opengraph-image.tsx'), 'utf8')
  check('덱 페이지·OG 이미지가 래더 JSON 덱(getDeckViews)을 읽지 않는다 (옛 조회 경로 삭제)', !/getDeckViews|getDeckMetaInfo/.test(page) && !/getDeckViews/.test(og))
  check('덱 페이지에 "패치 정보 없음" 문구 없음', !page.includes('패치 정보 없음'))
}

/** 백승민#agent 31분 34초 — 5등 · 검은 가시 4 = 워윅·렉사이·말파이트·다이애나(상징) · 거석 1 */
const mBack = {
  matchId: 'KR_BACK_3134',
  gameDatetime: 0,
  placement: 5,
  level: 8,
  lastRound: '5-6',
  goldLeft: 0,
  augments: [],
  units: [
    U('DA_18_Warwick', '워윅', 2, ['수은', '무한의 대검', '거인 학살자'], 2),
    U('DA_18_RekSai', '렉사이', 2, [], 1),
    U('DA_18_Malphite', '말파이트', 1, [], 4),
    U('DA_18_Diana', '다이애나', 2, ['검은 가시 상징'], 3),
  ],
  traits: [
    { name: '검은 가시', tier: 2, count: 4 },
    { name: '약탈자', tier: 1, count: 2 },
    { name: '거석', tier: 1, count: 1 },
  ],
}
const MALPHITE = '말파이트 1성 자리를 검은 가시 6명을 받치는 기물로 바꿔 거석 1단계 대신 검은 가시 2단계를 노립니다.'

console.log('2. 교체 조언 검사')
{
  const rel = validateTraitRelations([MALPHITE], [mBack])
  check('"말파이트 1성 자리를 … 바꿔" → 실패 (말파이트 = 검은 가시 · 빼면 2→1단계)', rel.errors.some((e) => e.text === MALPHITE), JSON.stringify(rel.errors))
  check('관계 검사 수 ≥ 1 (교체 조언이 있는데 0이 아님)', rel.checked >= 1, String(rel.checked))
  const conflict = validateTraitRelations(['워윅·렉사이·다이애나·말파이트는 유지한 채 앞라인을 보강하세요.', '말파이트를 교체해 2성 기물을 늘리세요.'], [mBack])
  check('같은 리포트에 "말파이트 유지"와 "말파이트 교체" → 실패', conflict.errors.some((e) => e.text === '말파이트를 교체해 2성 기물을 늘리세요.'), JSON.stringify(conflict.errors))
  const advice = parseStructuredAdvice([
    { quote: MALPHITE, action: 'replace_unit', remove: '말파이트', target_trait: '검은 가시', target_tier: 3 },
    { action: 'add_trait_units', target_trait: '검은 가시', count: 1, target_tier: 3 },
    { action: 'keep_unit', unit: '렉사이' },
    { action: 'replace_unit', remove: '렉사이', quote: '렉사이 대신 2성 기물을 넣으세요.' },
  ])
  const st = validateStructuredAdvice(advice, [MALPHITE, '렉사이 대신 2성 기물을 넣으세요.'], mBack)
  check('구조화 replace_unit: 빼는 기물이 target_trait(검은 가시)을 가짐 → 실패', st.errors.some((e) => e.text === MALPHITE))
  check('구조화 add_trait_units: 3단계(6명)까지 2명 필요인데 1명 → 실패', st.errors.some((e) => /6명까지 2명/.test(e.expected)), JSON.stringify(st.errors.map((e) => e.expected)))
  check('구조화 keep_unit ↔ replace_unit 같은 기물(렉사이) → 실패', st.errors.some((e) => e.text === '렉사이 대신 2성 기물을 넣으세요.'))
  check('구조화 목표 단계: 이미 2단계인데 "2단계 목표" → 실패', validateStructuredAdvice([{ action: 'other', target_trait: '검은 가시', target_tier: 2 }], [], mBack).errors.length === 1)
  check('구조화 조언 검사 수가 관계 검사 수에 더해진다', st.checked >= 3, String(st.checked))

  // 캐시 리포트: 다시 열면 말파이트 문장이 사라진다 (LLM 호출 없음 — revalidateReport 는 순수 함수)
  const cachedFb = {
    mode: 'single',
    metaScore: 60,
    metaTier: 'B',
    playstyle: '',
    overview: '검은 가시 4명으로 5등에 그쳤습니다.',
    actions: [MALPHITE, '워윅에게 아이템을 그대로 주세요.'],
    lecture: { topic: '', concept: '', why: '', evidence: '', alternative: '', drill: '다음 3판은 2성 이상 기물 6개 이상', checklist: [], moments: [] },
    grounding: { score: 100, total: 2, supported: 2, unsupported: [], revalidated: '2026-10-30.1' },
  }
  const shown = revalidateReport(cachedFb, [mBack])
  check('캐시 리포트 다시 열면 말파이트 문장이 보이지 않음', !feedbackTexts(shown).some((t) => t.includes('말파이트 1성 자리')), JSON.stringify(shown.actions))
  check('캐시 리포트 근거 검증의 관계 검사 수 ≥ 1', (shown.grounding.relationsChecked ?? 0) >= 1, String(shown.grounding.relationsChecked))
}

console.log('3. BIS 세트 하나 기준')
{
  const pb = {
    avg: 4.92,
    carry_bis: [{ key: 'DA_18_Warwick', name: '워윅', items: ['쇼진의 창', '스테락의 도전', '수은'], sets: [{ items: ['쇼진의 창', '스테락의 도전', '거인의 결의'], games: 31, avg: 4.94 }] }],
  }
  const bis = deckBisCheck(mBack, pb)
  check('BIS = BIS 세트(같은 판 3개 조합) 하나 · 일치 수 한 번 계산 (워윅 0/3)', bis && bis.matched === 0 && bis.slots === 3 && bis.items.join() === '쇼진의 창,스테락의 도전,거인의 결의', JSON.stringify(bis))
  check('표본 50판 미만 → "BIS"가 아니라 "자주 쓰는 조합"', bis.label === '자주 쓰는 조합')
  check('세트 평균(4.94)이 덱 평균(4.92)보다 좋지 않음 → 추천 안 함', bis.recommend === false)
  check('비교 섹션 문장도 같은 일치 수 · 변경 근거 아님 표시', /중 0개 일치/.test(bisRowText(bis)) && /근거로 쓰지 않음/.test(bisRowText(bis)), bisRowText(bis))
  const good = deckBisCheck(mBack, { avg: 4.92, carry_bis: [{ ...pb.carry_bis[0], sets: [{ items: ['수은', '무한의 대검', '최후의 속삭임'], games: 400, avg: 4.4 }] }] })
  check('50판 이상 + 덱 평균보다 표준오차 이상 좋음 → 추천 (2/3)', good.recommend && good.matched === 2 && good.label === 'BIS 세트', JSON.stringify(good))
  const texts = ['BIS 일치율 1/3으로 아이템이 덜 맞았습니다.', '이 덱 BIS 3개(쇼진의 창·스테락의 도전·수은) 중 1개 일치했습니다.', '다음 판에는 BIS 세트로 맞춰 워윅에게 쇼진의 창을 주세요.']
  const d = validateDerivedClaims(texts, mBack, bis)
  const fixed = repairEntityErrors({ texts }, d.errors).texts
  check('요약·비교 문장의 BIS 일치 수가 모두 같은 값(0)으로', fixed[0].includes('0/3') && fixed[1].includes('중 0개 일치'), JSON.stringify(fixed))
  check('추천 조건 미달 세트로 바꾸라는 개선 포인트 → 삭제', fixed.length === 2, JSON.stringify(fixed))

  /** 백승민#agent 36분 05초 — 카르마 = 라바돈·푸른 파수꾼·처형자 상징 (처형자 3명) */
  const mKarma = {
    ...mBack,
    matchId: 'KR_BACK_3605',
    units: [U('DA_Karma18', '카르마', 2, ['라바돈의 죽음모자', '푸른 파수꾼', '처형자 상징'], 1), U('DA_18_Warwick', '워윅', 2, [], 2)],
    traits: [{ name: '처형자', tier: 2, count: 3 }, { name: '개화', tier: 0, count: 1 }],
  }
  const KARMA = '카르마에게 보석 건틀릿을 만들어 BIS 3개를 맞춥니다.'
  const em = validateEmblemItemAdvice([KARMA, '처형자 3명을 건드리지 않습니다.'], mKarma, HELD_ITEM_NAMES)
  check('처형자 상징을 빼게 되는 아이템 조언 → 실패 (처형자 3→2명)', em.errors.some((e) => e.text === KARMA), JSON.stringify(em.errors))
  const emS = validateStructuredAdvice([{ action: 'change_items', unit: '카르마', remove_item: '처형자 상징', add_item: '보석 건틀릿', quote: KARMA }], [KARMA], mKarma)
  check('구조화 change_items: 상징을 빼면 켜진 시너지 단계 하락 → 실패', emS.errors.some((e) => e.text === KARMA))
  const cmpBis = deckBisCheck({ units: mKarma.units }, { avg: 4.5, carry_bis: [{ key: 'DA_Karma18', name: '카르마', items: [], sets: [{ items: ['라바돈의 죽음모자', '보석 건틀릿', '푸른 파수꾼'], games: 80, avg: 4.4 }] }] })
  check('상징은 BIS 일치 계산에서 제외 (카르마 2/3, 상징 따로 표시)', cmpBis.matched === 2 && cmpBis.slots === 3 && cmpBis.emblems.includes('처형자 상징'), JSON.stringify(cmpBis))
}

console.log('5. 다시 분석 · 메타 첫 화면')
{
  check('최신 버전 리포트 → 다시 분석 버튼 숨김', !isOutdatedReport({ generatorVersion: REPORT_GENERATOR_VERSION }))
  check('옛 버전 리포트 → "새 버전으로 다시 분석"', isOutdatedReport({ generatorVersion: '2026-10-29.1' }) && isOutdatedReport({}))
  check('AI 미사용 폴백 리포트는 다시 분석 대상 아님', !isOutdatedReport({ isFallback: true }))
  const summary = toDeckSummary({ success: true, hasMeta: true, champions: [], traits: [], items: [], combos: [], comps: [], decks: getDeckViews().map((d) => toMetaDeck(d)), decksMeta: { source: 'db' } })
  check('view=summary 에 덱 데이터 없음 (덱은 view=decks 한 번)', summary.decks.length === 0 && summary.decksMeta?.source === 'db')
  const dash = fs.readFileSync(path.join(__dirname, '..', 'app', 'components', 'MetaDashboard.tsx'), 'utf8')
  const top = fs.readFileSync(path.join(__dirname, '..', 'app', 'components', 'TopDecks.tsx'), 'utf8')
  check('메타 탭·추천 덱이 같은 view=decks 요청을 나눠 쓴다 (fetchMetaDecks)', /fetchMetaDecks/.test(dash) && /fetchMetaDecks/.test(top) && !/fetch\('\/api\/tft\/meta\?view=/.test(dash + top))
}

console.log('6. 표기·숫자 목표·파생 수치')
{
  const drill = numericDrill([mBack], 'synergy')
  check('숫자 목표: 시너지 축이면 단계 합 기준', /단계 합 \d+ 이상/.test(drill), drill)
  check('숫자 목표: 기본은 2성 이상 기물 수', /\d+개 이상/.test(numericDrill([mBack], 'economy')))
  const gap = validateDerivedClaims(['단계 합은 6 대 10으로 깊이가 두 단계 부족했습니다.'], mBack)
  const gapFixed = repairEntityErrors({ t: ['단계 합은 6 대 10으로 깊이가 두 단계 부족했습니다.'] }, gap.errors).t[0]
  check('"6 대 10 … 두 단계 부족" → 4단계로', gapFixed.includes('4단계 부족'), gapFixed)
  const lv = validateDerivedClaims(['최종 레벨 9에서 보드 가치 차이가 벌어졌고 2성이 부족했습니다.'], mBack)
  check('본인 레벨(8)과 다른 레벨을 본인 것처럼 쓴 문장 → 실패', lv.errors.some((e) => e.type === 'level_mismatch'))
  check('상대 레벨 문장은 통과', validateDerivedClaims(['1등(Lv.9 · 137G)보다 한 레벨 낮은 Lv.8에서 끝났습니다.'], mBack).errors.length === 0)
  check('"1코어 리롤" → "1코 리롤"', fixEnglishTerms('1코어 리롤 덱입니다') === '1코 리롤 덱입니다')
  check('"TOP4 최종 Lv.8 비율 49%" → "TOP4의 49%가 최종 Lv.8 이상"', fixEnglishTerms('TOP4 최종 Lv.8 비율 49%') === 'TOP4의 49%가 최종 Lv.8 이상')
  const boards = [...Array(24)].map((_, i) => ({ match_id: `KR_${Math.floor(i / 8)}`, placement: (i % 8) + 1, level: 8, last_round: 30, units: [{ id: 'DA_18_Warwick', star: 2, items: [] }, { id: 'DA_18_RekSai', star: 2, items: [] }], traits: [] }))
  const { rows } = clusterDecks(boards, { minGames: 3 })
  check('덱 스냅샷에 생성 시점 판수(snapshot_matches) 저장 — 화면 판수는 이 값으로 고정', rows.length === 0 || rows.every((r) => r.deck.snapshot_matches === 3), JSON.stringify(rows.map((r) => r.deck.snapshot_matches)))
}

console.log(failures ? `\n❌ 실패 ${failures}건` : '\n✅ 10/30 2차 지시문 테스트 통과')
if (failures) process.exitCode = 1

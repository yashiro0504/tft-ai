/**
 * 2026-10-30 지시문 1·2·4 테스트 — 네트워크·DB·LLM 불필요 (가짜 보드·가짜 LLM 출력).
 *
 *  1. 보드 표(lib/boardTable)와 기물–시너지 관계 검사(validateTraitRelations)
 *     - 102#2600 26분 29초 보드(세트 = 개화 + 싸움꾼, 개화 3 = 요릭·세트·마스터 이)에서
 *       "세트처럼 핵심 시너지와 무관한 1성 기물은 빼서" → 고치거나 삭제 · "세트 대신 개화를 받치는 기물을 넣어" → 실패
 *     - 캐시된 리포트 다시 검사(lib/reportRevalidate): LLM 호출 없이 오류 문장을 지우고 관계 검사 수를 남긴다
 *     - 프롬프트 "핵심 시너지와 무관한 1성 기물" 줄에 세트가 들어가지 않는다 (lib/traitAnchors freeUnits)
 *  2. AI 분석용 가장 가까운 덱 — 덱 성적표 분류(mostSimilarDeck)에서 빠진 얇은 보드도 비교 대상 덱을 찾는다
 *  4. TOP4 최종 레벨 문구에 구간이 명시된다
 *
 * 실행: node scripts/testTraitRelations.js   (npm run test:ai 에 포함)
 */
require('./_ts')
const fs = require('fs')
const path = require('path')
const { buildBoardTable, boardTableFacts } = require('../lib/boardTable')
const { validateTraitRelations, repairEntityErrors, REVALIDATOR_VERSION } = require('../lib/semanticGrounding')
const { revalidateReport } = require('../lib/reportRevalidate')
const { freeUnits, traitAnchorFacts } = require('../lib/traitAnchors')
const { mostSimilarDeck, closestDeckForAnalysis } = require('../lib/comparisonFacts')
const { levelBands, comparePlaybook, buildDeckComparison, groundedTips, DECK_COMPARISON_UNCLASSIFIED } = require('../lib/playbook')
const { fixEnglishTerms } = require('../lib/grounding')

let failures = 0
function check(label, ok, detail = '') {
  if (ok) console.log(`  ✅ ${label}`)
  else {
    failures++
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const U = (id, name, tier, items = [], rarity) => ({ id, name, tier, items, rarity })
/** 102#2600 26분 29초 — 7등 · Lv.7 · 적응가 4 · 개화 3 · 싸움꾼 3 · 부식 1 (마스터 이 ★3, 돌거북 ★3, 7기물) */
const m102 = {
  matchId: 'KR_102_2600_2629',
  gameDatetime: 0,
  placement: 7,
  level: 7,
  lastRound: '4-6',
  goldLeft: 0,
  augments: [],
  units: [
    U('DA_18_MasterYi_AD', '마스터 이', 3, ['구인수의 격노검', '거인 학살자', '최후의 속삭임'], 3),
    U('DA_Krug18', '돌거북', 3, ['가고일 돌갑옷'], 3),
    U('DA_KogMaw18_AD', '코그모', 1, [], 3),
    U('DA_18_Yorick', '요릭', 1, [], 1),
    U('DA_Nidalee18_AP', '니달리', 1, [], 4),
    U('DA_18_Sett', '세트', 1, [], 4),
    U('DA_Gromp18_AP', '심술두꺼비', 1, [], 2),
  ],
  traits: [
    { name: '적응가', tier: 3, count: 4 },
    { name: '개화', tier: 1, count: 3 },
    { name: '싸움꾼', tier: 1, count: 3 },
    { name: '부식', tier: 1, count: 1 },
    { name: '협곡야수', tier: 0, count: 2 },
  ],
}

console.log('1-1. 보드 표')
{
  const t = buildBoardTable(m102)
  const sett = t.units.find((u) => u.name === '세트')
  check('세트 기본 시너지 = 개화 + 싸움꾼 (정적 데이터)', sett && sett.baseTraits.includes('개화') && sett.baseTraits.includes('싸움꾼'), JSON.stringify(sett))
  const blossom = t.traits.find((x) => x.name === '개화')
  check('개화 3명 = 마스터 이·요릭·세트 · 1단계 · 다음 단계까지 2명', blossom && blossom.stage === 1 && blossom.toNext === 2 && ['마스터 이', '요릭', '세트'].every((n) => blossom.contributors.some((c) => c.name === n)), JSON.stringify(blossom))
  const brawler = t.traits.find((x) => x.name === '싸움꾼')
  check('Riot 인원(3)과 정적 데이터 합(2)의 차이는 그 밖의 출처로', brawler && brawler.other === 1, JSON.stringify(brawler))
  check('세트를 빼면 개화가 꺼진다', t.removal.find((r) => r.name === '세트')?.off.includes('개화'), JSON.stringify(t.removal))
  const facts = boardTableFacts(m102)
  check('프롬프트 보드 표에 "세트 빼면: 개화 꺼짐"', facts.includes('- 세트 빼면: 개화 꺼짐'), facts)
  check('프롬프트 보드 표에 관계 사용 규칙', facts.includes('이 표에 있는 내용만 써라'))
  check('"핵심 시너지와 무관한 1성 기물"에 세트 없음', !freeUnits(m102).some((u) => u.name === '세트'), freeUnits(m102).map((u) => u.name).join(','))
  check('프롬프트 시너지 유지 줄에도 세트를 무관하다고 쓰지 않음', !traitAnchorFacts(m102).some((l) => l.includes('무관') && l.includes('세트')), traitAnchorFacts(m102).join(' | '))
}

console.log('1-2. 관계 검사')
{
  const bad1 = '세트처럼 핵심 시너지와 무관한 1성 기물은 빼서 2성 기물 자리를 늘리세요.'
  const r1 = validateTraitRelations([bad1], [m102])
  check('"세트처럼 핵심 시너지와 무관한 1성 기물은 빼서" → 실패', r1.errors.some((e) => e.type === 'trait_relation' && e.text === bad1), JSON.stringify(r1))
  const stats = { fixed: 0, deleted: 0 }
  const fixed = repairEntityErrors({ overview: `개화 3을 지킨 판입니다. ${bad1} 다음 판도 같은 방향입니다.` }, r1.errors, { stats })
  check('해당 문장은 삭제되고 나머지는 남는다', !fixed.overview.includes('세트') && fixed.overview.includes('개화 3을 지킨 판입니다.') && stats.deleted === 1, fixed.overview)

  const bad2 = '세트 대신 개화를 받치는 기물을 넣어 보세요.'
  check('"세트 대신 개화를 받치는 기물을 넣어" → 실패 (세트를 빼면 개화가 꺼짐)', validateTraitRelations([bad2], [m102]).errors.length === 1)
  check('개선 포인트 원문 ("세트 대신 개화 또는 싸움꾼 1단계를 받치는 기물")도 실패', validateTraitRelations(['세트 대신 개화 또는 싸움꾼 1단계를 받치는 기물을 넣어 2성 수를 늘리세요.'], [m102]).errors.length >= 1)
  check('"세트는 개화와 무관" → 실패', validateTraitRelations(['세트는 개화와 무관합니다.'], [m102]).errors.length === 1)
  check('"세트는 적응가 시너지입니다" → 실패', validateTraitRelations(['세트는 적응가 시너지입니다.'], [m102]).errors.length === 1)
  check('"개화 기물 니달리" → 실패', validateTraitRelations(['개화 기물 니달리를 2성으로 올리세요.'], [m102]).errors.length === 1)

  const ok = [
    '세트는 싸움꾼 시너지입니다.',
    '돌거북 대신 다른 기물을 넣어 적응가를 유지하세요.',
    '세트를 2성으로 올려 개화 3을 더 단단하게 만드세요.',
    '마스터 이 3성에 아이템 3개를 모두 몰아준 것은 정석입니다.',
    '상대 3등은 세트를 빼고 싸움꾼을 올렸습니다.',
  ]
  for (const s of ok) check(`맞는 문장은 통과: "${s}"`, validateTraitRelations([s], [m102]).errors.length === 0, JSON.stringify(validateTraitRelations([s], [m102]).errors))
  const all = validateTraitRelations([bad1, bad2, ...ok], [m102])
  check('관계 검사 수를 센다', all.checked >= 4, String(all.checked))

  const core = { coreUnits: ['니달리'] }
  check('핵심 기물(등장률 80%+)을 근거 없이 빼라는 조언 → 실패', validateTraitRelations(['니달리 대신 다른 4코 기물을 쓰세요.'], [m102], core).errors.length === 1)
  check('근거(없을 때 평균등수)가 있으면 통과', validateTraitRelations(['니달리 대신 다른 4코를 쓴 판은 이 덱에서 니달리가 없을 때 평균 4.21등입니다.'], [m102], core).errors.length === 0)
}

console.log('1-3. 캐시된 리포트 다시 검사')
{
  const bad = '세트처럼 핵심 시너지와 무관한 1성 기물은 빼서 2성을 늘리세요.'
  const cached = {
    overview: '적응가 4를 켠 판입니다. 마스터 이 3성이 캐리였습니다.',
    actions: ['마스터 이 3성을 먼저 완성하는 운영을 유지하세요.', `${bad}`, '돌거북을 앞라인에 두세요.'],
    lecture: { topic: 't', concept: '보드 완성도가 핵심입니다.', why: '', evidence: '', alternative: '', drill: '다음 3판은 2성 6개', checklist: [] },
    plan: { axes: [{ key: 'itemization', label: '아이템 설계', score: 100, detail: '', verdict: 'itemization 100점으로 완벽했습니다.' }] },
    grounding: { score: 100, total: 4, supported: 4, unsupported: [], namesChecked: 7, repair: { checked: 4, fixed: 0, deleted: 0 } },
  }
  const before = JSON.stringify(cached)
  const out = revalidateReport(cached, [m102])
  check('오류 문장이 보이지 않는다', !JSON.stringify(out.actions).includes('무관'), JSON.stringify(out.actions))
  check('다른 개선 포인트는 그대로', out.actions.length === 2)
  check('삭제 기록 · 관계 검사 수 · 검증기 버전', out.grounding.repair.deleted === 1 && out.grounding.relationsChecked >= 1 && out.grounding.revalidated === REVALIDATOR_VERSION, JSON.stringify(out.grounding))
  check('영어 축 용어 → 한글 ("itemization 100점" → "아이템 설계 100점")', out.plan.axes[0].verdict === '아이템 설계 100점으로 완벽했습니다.', out.plan.axes[0].verdict)
  check('캐시 원본은 바꾸지 않는다', JSON.stringify(cached) === before)
  check('같은 버전으로 이미 검사한 리포트는 그대로', revalidateReport(out, [m102]) === out)

  const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  const ma = src('lib/matchAnalysis.ts')
  check('경기 분석 캐시 적중에 다시 검사 연결 (LLM 호출 없음)', /getCachedMatchAnalysis[\s\S]*?revalidateReport\(hit\.value\.feedback/.test(ma))
  check('캐시 키는 프롬프트 버전이 아니라 REPORT_CACHE_VERSION (프롬프트를 바꿔도 이미 만든 리포트·차감이 그대로)', /REPORT_VERSION = `\$\{REPORT_CACHE_VERSION\}:\$\{SCORING_VERSION\}`/.test(ma))
  const ov = src('app/api/tft/overview/route.ts')
  check('종합 분석 캐시 적중에도 다시 검사 연결 · 차감 없음', /revalidateReport\(cached\.value\.feedback, matches\)/.test(ov) && /캐시 적중은 횟수 차감 없음/.test(ov))
  check('영어 용어 수리: 괄호 한글 이름이 있으면 그것으로', fixEnglishTerms('economy(경제 운영) 점수가 낮습니다') === '경제 운영 점수가 낮습니다')
}

console.log('2. 가장 가까운 덱 (AI 분석용)')
{
  const D = (key, name, cost, flex = false) => ({ key, name, cost, star: 2, flex })
  const yi = {
    name: '적응가 마스터 이',
    avgPlacement: 4.2,
    sampleSize: 1331,
    carryKey: 'MasterYi_AD',
    units: [
      D('MasterYi_AD', '마스터 이', 3), D('Yorick', '요릭', 1), D('Vi', '바이', 3), D('Sett', '세트', 4), D('Krug', '돌거북', 3),
      D('Nidalee18_AP', '니달리', 4), D('KogMaw18_AD', '코그모', 3), D('Karma', '카르마', 4, true), D('Alistar', '알리스타', 1, true), D('Shen', '쉔', 2, true),
    ],
  }
  const kog = { ...yi, name: '적응가 코그모', sampleSize: 1497, carryKey: 'KogMaw18_AD', units: yi.units.map((u) => u) }
  const other = { name: '협곡야수 장로 드래곤', avgPlacement: 4.0, sampleSize: 900, carryKey: 'ElderDragon', units: [D('ElderDragon', '장로 드래곤', 5), D('Krug', '돌거북', 3), D('Gromp18_AP', '심술두꺼비', 2)] }
  const decks = [yi, kog, other]
  check('102#2600 보드는 덱 성적표 분류(Jaccard)에서 빠진다', mostSimilarDeck(m102, decks) === null, JSON.stringify(mostSimilarDeck(m102, decks)))
  const near = closestDeckForAnalysis(m102, decks)
  check('가장 가까운 덱 = 적응가 마스터 이 또는 적응가 코그모', near && ['적응가 마스터 이', '적응가 코그모'].includes(near.deck.name), JSON.stringify(near && { name: near.deck.name, sim: near.similarity }))
  check('캐리(마스터 이) 일치가 우선 — 적응가 마스터 이', near?.deck.name === '적응가 마스터 이')
  // 백승민#agent 33분 59초: 거의 같은 보드 · 8기물 → 지금처럼 정확히 분류
  const agent = { ...m102, units: [...m102.units.filter((u) => u.name !== '심술두꺼비'), U('DA_Vi18', '바이', 2, [], 3), U('DA_Karma18', '카르마', 1, [], 4)] }
  check('백승민#agent 8기물 보드는 지금처럼 "적응가 마스터 이"로 정확히 분류', mostSimilarDeck(agent, decks)?.deck.name === '적응가 마스터 이', JSON.stringify(mostSimilarDeck(agent, decks)))
  const unrelated = { ...m102, units: [U('DA_18_Shen', '쉔', 1, ['워모그의 갑옷'], 2), U('DA_18_Alistar', '알리스타', 1, [], 1)], traits: [] }
  check('관련 없는 보드는 기준 미만 (생략 안내)', closestDeckForAnalysis(unrelated, decks) === null)
  check('생략 안내 문구', DECK_COMPARISON_UNCLASSIFIED === '메타 덱으로 분류되지 않아 덱 기준 비교 생략')

  const pb = {
    patch: '16.21', deck_key: 'yi', deck_name: '적응가 마스터 이', snapshot_id: 's', sample_n: 1331, avg: 4.2, scope: 'full',
    core_units: [{ key: 'MasterYi_AD', name: '마스터 이', usage_pct: 100, star2_pct: 20, star3_pct: 80, star_avg: 2.8 }, { key: 'Nidalee18_AP', name: '니달리', usage_pct: 86, star2_pct: 60, star3_pct: 1, star_avg: 1.6 }, { key: 'Vi', name: '바이', usage_pct: 72, star2_pct: 70, star3_pct: 0, star_avg: 1.7 }],
    carry_bis: [], three_star: null, flex_units: null, traits: null,
    level_profile: { top4_n: 600, top4_level_pct: { 6: 2, 7: 30, 8: 49, 9: 17, 10: 2 }, deck_type: 'reroll', reroll_costs: [3], top4_lv8plus_pct: 68 },
    elim_profile: null, contested: null, augments: null,
    tips: [{ text: '마스터 이 ★3 달성 판 TOP4 80%', evidence: [] }, { text: '근거 없는 팁 99%', evidence: [] }],
    external_links: [],
  }
  const cmp = buildDeckComparison(m102, { name: yi.name, sampleSize: 1331 }, { playbook: pb }, 0, near.similarity)
  check('비교 항목 1개 이상 · 유사도 표시', cmp.items.length >= 1 && cmp.similarity === near.similarity && !cmp.skipped, JSON.stringify(cmp))
  check('핵심 기물 = 등장률 80% 이상만', JSON.stringify(cmp.coreUnits) === JSON.stringify(['마스터 이', '니달리']), JSON.stringify(cmp.coreUnits))
  check('팁은 숫자가 플레이북 값에 있는 것만', JSON.stringify(groundedTips(pb)) === JSON.stringify(['마스터 이 ★3 달성 판 TOP4 80%']), JSON.stringify(groundedTips(pb)))

  console.log('4. 레벨 문구')
  check('구간 표기: Lv.7 이하 32% · Lv.8 49% · Lv.9+ 19%', levelBands(pb.level_profile.top4_level_pct) === 'Lv.7 이하 32% · Lv.8 49% · Lv.9+ 19%', levelBands(pb.level_profile.top4_level_pct))
  const top4 = comparePlaybook({ ...m102, placement: 3, level: 8 }, pb).find((r) => r.id === 'level_profile')
  check('리롤 덱 레벨 문구에 구간 명시', top4 && top4.text.includes('TOP4 최종 레벨: Lv.7 이하 32% · Lv.8 49% · Lv.9+ 19%') && !/Lv\.8 비율/.test(top4.text), top4?.text)
}

if (failures) {
  console.error(`\n❌ ${failures}개 실패`)
  process.exit(1)
}
console.log('\n✅ 기물–시너지 관계 · 가장 가까운 덱 테스트 통과')

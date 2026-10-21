/**
 * [비교 사실] 블록 테스트 — lib/comparisonFacts.ts (AI-EVAL A2).
 *
 * 실행: node scripts/testComparisonFacts.js   (npm run test:ai 에 포함)
 *  - 로비 1등·로비 평균 비교 = 손계산
 *  - 메타 덱 유사도 임계(0.6) 미만이면 줄 생략
 *  - 패치 분리: 현재 패치 우선·부족하면 직전 패치 혼합 · 패치 기준 표기
 *  - 상위 랭커 운영: 줄 형식 · 표본 하한 · 집계본 형식
 *  - 덱 가이드(래더 실측): 핵심·유동 기물 · 캐리 아이템 채용률 · 레벨 분포 · 개방성 등급
 *  - 아이템 재료 매칭 · 로비 메타 덱 · 빈집 메타 덱 후보 (점령·코어 점령·약한·소표본·변형·재료 부족 제외)
 *  - 메타 덱 운영도: ±1등 경계 · 없는 기물(선택 기물 제외, 코스트순, 최대 3) · 종합 집계(표본 충분 판만 평균)
 *  - BIS 일치율 분자/분모 (표본 20판 미만 조합 제외, BIS 통계 없는 기물은 분모에서 제외)
 *  - BIS = 채용 상위 3 (평균등수 순이면 소표본 비주류템이 올라와 장로 드래곤 주류 빌드가 0% — KR_8427579901 회귀)
 *  - 나르(GnarSmall) 슬러그 = 통계 키 Gnar
 *  - 같은 구성 상대: 코어 기물 코스트 가중 유사도 · 성급 차이 손계산 · 임계 미만/공용 기물만 겹치면 생략
 *  - 실제 픽스처 6경기에서 NaN/Infinity 없음
 */
require('./_env').loadEnv()
process.env.NEXT_PUBLIC_SUPABASE_URL = ''
require('./_ts')
const { buildComparisonFacts, bisBySlug, bisMatch, metaExecution, mostSimilarDeck, mostSimilarOpponent } = require('../lib/comparisonFacts')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  ✅ ${label}`)
  else {
    failures++
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const fixture = require('../data/evalMatches.json')
const sample = fixture.cases.find((c) => c.name === 'Seed01 contested-bot4 5등 6-1').matches[0]

;(async () => {
  console.log('로비 비교 (KR_8414975456, 5등)')
  const block = buildComparisonFacts({ matches: [sample], mode: 'single', combos: [], decks: [] })
  // 손계산: 나 Lv7 · 기물 7 · 3성 5 · 시너지 단계 2+1×5=7 · 아이템 3+3+2+1+0+3+1=13
  //        1등 Lv9 · 기물 9 · 3성 0 · 시너지 단계 2+1×8=10 · 아이템 3+3+3+3+1+0+0+3+0=16
  check(
    '로비 1등 비교 = 손계산',
    block.includes('- 로비 1등과 비교: 레벨 -2 (7 vs 9) · 기물 수 7 vs 9 · 3성 5 vs 0 · 시너지 단계 합 7 vs 10 · 아이템 13 vs 16'),
    block
  )
  // 보드 가치 = Σ 코스트 × 장수(1성 1 · 2성 3 · 3성 9)
  //   나: 베이가 1×9 + 알리스타 2×9 + 오른 1×9 + 렉사이 1×9 + 르블랑 2×9 + 카시오페아 3×3 + 피들스틱 3×1 = 75
  //   1등: 2성 (5+4+4+5+4+3+3)×3 = 84 + 1성 5+3 = 92
  check('로비 1등 비교에 보드 가치 = 손계산 (75G vs 92G)', block.includes('아이템 13 vs 16 · 보드 가치 75G vs 92G'), block)
  const { boardValue } = require('../lib/boardValue')
  check('보드 가치: 1성 1장 · 2성 3장 · 3성 9장, 코스트 없으면 1', boardValue([{ rarity: 4, tier: 1 }, { rarity: 2, tier: 2 }, { rarity: 1, tier: 3 }, { tier: 2 }]) === 4 + 6 + 9 + 3)
  // 로비 평균(나 제외 7명) 레벨 (9+8+8+8+8+6+6)/7 = 7.57
  check('로비 평균 레벨 = 손계산 (-0.6, 7 vs 7.6)', block.includes('로비 평균(나 제외 7명)과 비교: 레벨 -0.6 (7 vs 7.6)'), block)
  check('블록 머리말 + 인과 아님 명시', block.startsWith('[비교 사실 — 코드 산출, 서술 통계 (원인이 아니다)]'))
  const win = fixture.cases.find((c) => c.name === 'Seed02 win 1등 6-5').matches[0]
  check('내가 1등이면 로비 2등과 비교', buildComparisonFacts({ matches: [win], mode: 'single', combos: [], decks: [] }).includes('- 로비 2등과 비교:'))

  console.log('덱 유형 판정')
  const { detectDeckType, summarizeDeckTypes } = require('../lib/deckType')
  // 기준 샘플: 3성 5개(1·1·1·2·2코) · Lv.7 · 캐리 베이가 3성 (베이가·카시오페아 캐리템 3개 동률 → 성급 높은 베이가, 알리스타는 탱커템만)
  const info = detectDeckType(sample)
  check(
    '기준 샘플 = 리롤형 (3성 5개, 1·2코)',
    info.type === 'reroll' && info.threeStars === 5 && info.threeStarCosts.join(',') === '1,1,1,2,2',
    JSON.stringify(info)
  )
  check(
    '비교 사실에 덱 유형 줄',
    block.includes('- 덱 유형: 리롤형 — 3성 5개(1·1·1·2·2코) · Lv.7 · 캐리 베이가 3성'),
    block
  )
  const standard = {
    ...sample,
    level: 9,
    units: sample.units.map((u) => ({ ...u, tier: (u.rarity ?? 1) >= 4 ? 2 : 1 })),
  }
  check('3성 없으면 표준형', detectDeckType(standard).type === 'standard', JSON.stringify(detectDeckType(standard)))
  const few = { ...sample, units: sample.units.slice(0, 3) }
  check('기물 3개면 판정 불가', detectDeckType(few).type === 'unknown', JSON.stringify(detectDeckType(few)))
  check('캐리 = 캐리템 동률이면 성급 높은 쪽 (베이가 3성, 카시오페아 2성 아님)', info.carryThreeStar === true && info.reason.endsWith('캐리 베이가 3성'), JSON.stringify(info))
  // 탱커템 3개(알리스타)는 캐리템 0개 — 캐리템 2개 든 2성이 캐리
  const tankItems = {
    ...sample,
    units: [
      { id: 'TFT18_T', name: '탱커', rarity: 2, tier: 3, items: ['워모그의 갑옷', '가고일 돌갑옷', '크라운가드'] },
      { id: 'TFT18_D', name: '딜러', rarity: 3, tier: 2, items: ['보석 건틀릿', '쇼진의 창'] },
      ...sample.units.slice(2, 5).map((u) => ({ ...u, items: [] })),
    ],
  }
  check('탱커·하이브리드 템은 캐리 판별에서 제외', detectDeckType(tankItems).reason.endsWith('캐리 딜러 2성'), detectDeckType(tankItems).reason)
  const { boardCarry } = require('../lib/deckType')
  check('메타 덱 carryKey 가 보드에 있으면 우선', boardCarry(sample.units, 'Cassiopeia').name === '카시오페아')
  const mixed = summarizeDeckTypes([sample, standard])
  check(
    '여러 판 유형 혼합 = mixed',
    mixed.type === 'mixed' && mixed.line.includes('리롤형 1/2판') && mixed.line.includes('표준형 1/2판'),
    mixed.line
  )
  // 캐리 = 아이템 최다 기물 (코스트는 동률일 때만). 아이템 없는 고코스트 탱커가 캐리로 잡히면 안 된다.
  const tankBoard = {
    ...sample,
    units: [
      ...sample.units.map((u) => ({ ...u, tier: u.name === '베이가' ? 3 : u.tier, items: u.name === '베이가' ? ['a', 'b', 'c', 'd'] : u.items })),
      { id: 'TANK', name: '탱커', rarity: 4, tier: 1, items: [] },
    ],
  }
  check('캐리 = 아이템 최다 기물 (4코 무템 탱커 아님)', detectDeckType(tankBoard).carryThreeStar === true, JSON.stringify(detectDeckType(tankBoard)))
  // 8레벨 + 4코 캐리 3성 + 3코 3성 → 저코스트 3성 0개, 캐리도 리롤 코스트가 아니므로 표준형
  const fast8 = {
    ...sample,
    level: 8,
    units: sample.units.map((u) =>
      u.name === '카시오페아' ? { ...u, rarity: 4, tier: 3 } : u.name === '피들스틱' ? { ...u, tier: 3 } : { ...u, tier: 2 }
    ),
  }
  check('8레벨 4코 캐리 3성 = 표준형', detectDeckType(fast8).type === 'standard', JSON.stringify(detectDeckType(fast8)))
  const { buildCoachingPlan } = require('../lib/coaching')
  const plan = buildCoachingPlan([sample])
  check('리롤형 판정이 강의 계획에 반영', plan.deckType === 'reroll' && plan.deckTypeLabel === '리롤형', JSON.stringify(plan.deckType))
  const tempo = plan.axes.find((a) => a.key === 'tempo')
  check(
    '리롤 템포 = 100 − 3성 부족 0 − 캐리(베이가) 3성 미완성 0 = 100 (표준형과 같은 100점 척도)',
    tempo.score === 100 &&
      tempo.effects.some((e) => e.key === 'missingThreeStars' && e.points === 0) &&
      tempo.effects.some((e) => e.key === 'carryNotThreeStar' && e.points === 0),
    JSON.stringify(tempo)
  )
  check('리롤형 템포 강의 문장', tempo.lesson.includes('리롤형은 레벨을 올리는 덱이 아니다'), tempo.lesson)
  const economyAxis = plan.axes.find((a) => a.key === 'economy')
  // 6스테이지 기준치 90G 대비 75G → (0.833 − 1) × 80 = −13.3
  check(
    '경제 축 = 보드 가치 75G / 6스테이지 기준 90G → 항목 −13.3 (잔여 골드 항목 없음)',
    economyAxis.metrics.some((x) => x.key === 'boardValue' && x.value === 75) &&
      economyAxis.metrics.some((x) => x.key === 'expectedBoardValue' && x.value === 90) &&
      economyAxis.effects.some((e) => e.key === 'boardValue' && e.points === -13.3) &&
      !economyAxis.effects.some((e) => e.key === 'idleGold') &&
      !economyAxis.metrics.some((x) => x.key === 'goldLeft'),
    JSON.stringify(economyAxis)
  )
  const economy = plan.axes.find((a) => a.key === 'economy')
  check(
    '리롤형 경제 = 레벨 격차 감점 없음 · 레벨 부족 지표 없음 · 리롤 골드 강의',
    !economy.effects.some((e) => e.key === 'levelGap' && e.points !== 0) &&
      !economy.metrics.some((x) => x.key === 'levelShort') &&
      economy.lesson.includes('리롤형의 골드'),
    JSON.stringify(economy)
  )
  const stdEconomy = buildCoachingPlan([standard]).axes.find((a) => a.key === 'economy')
  check('표준형 경제는 레벨 부족 지표 유지', stdEconomy.metrics.some((x) => x.key === 'levelShort'), JSON.stringify(stdEconomy.metrics))
  // 3성 2개(오른·렉사이)뿐인 리롤형, 캐리는 카시오페아 2성(베이가 2성과 캐리템 동률 → 코스트) → 템포 100 − 20 − 20 = 60 → 가장 약한 축
  // 보드 가치 45G 는 6스테이지 기준(90G)이면 경제가 더 약해지므로 5스테이지(기준 66G) 탈락으로 둔다
  const thinReroll = { ...sample, lastRound: '5-1', units: sample.units.map((u) => ({ ...u, tier: ['오른', '렉사이'].includes(u.name) ? 3 : Math.min(u.tier, 2) })) }
  const rerollTopicPlan = buildCoachingPlan([thinReroll])
  check(
    '리롤형에서 템포가 초점이면 주제 = 리롤 성과',
    rerollTopicPlan.deckType === 'reroll' && rerollTopicPlan.focus === 'tempo' && rerollTopicPlan.topic.includes('리롤 성과'),
    JSON.stringify({ focus: rerollTopicPlan.focus, topic: rerollTopicPlan.topic })
  )
  const mixedPlan = buildCoachingPlan([sample, standard])
  const mixedTempo = mixedPlan.axes.find((a) => a.key === 'tempo')
  check(
    '혼합이면 템포 지표·강의 모두 두 기준',
    mixedPlan.deckType === 'mixed' &&
      mixedTempo.metrics.some((x) => x.key === 'levelShort') &&
      mixedTempo.metrics.some((x) => x.key === 'carryThreeStar') &&
      mixedTempo.lesson.includes('리롤형은 코어 3성'),
    JSON.stringify(mixedTempo)
  )
  // ── 밸류 덱 오진단 회귀 (2026-10-21: Lv.10 5코스트 보드에 겹침 강의 · 템포 −36 · 1코 바루스 리롤 추천) ──
  {
    const { analyzeContest } = require('../lib/contest')
    const { openDeckCandidates } = require('../lib/comparisonFacts')
    const fast10 = { ...standard, level: 10, lastRound: '5-6' }
    const t = buildCoachingPlan([fast10]).axes.find((a) => a.key === 'tempo')
    check('템포: 표준(5스테이지 Lv.8)보다 높은 Lv.10 은 감점 없음', t.score === 100, JSON.stringify(t.effects))
    const mine = [{ id: 'DA_Taric18', name: '타릭', tier: 1, rarity: 5, items: ['수호자의 맹세'] }]
    const opp = (units) => ({ placement: 2, gameName: 'o', tagLine: 'x', level: 10, lastRound: '6-1', damageToPlayers: 0, traits: [], units, isUser: false })
    const filler = analyzeContest(mine, [], [opp([{ id: 'DA_Taric18', name: '타릭', tier: 1, rarity: 5, items: [] }])])
    const core = analyzeContest(mine, [], [opp([{ id: 'DA_Taric18', name: '타릭', tier: 2, rarity: 5, items: [] }])])
    check('경합: 상대의 1성 무템 기물(칸 채우기)은 세지 않고, 2성은 센다', !filler.isContested && core.isContested, JSON.stringify({ filler: filler.contestScore, core: core.contestScore }))
    const dup = analyzeContest([...mine, ...mine], [], [opp([{ id: 'DA_Taric18', name: '타릭', tier: 2, rarity: 5, items: [] }])])
    check('경합: 같은 기물 두 장은 한 번만 센다', dup.unitDetails.length === 1, JSON.stringify(dup.unitDetails))
    const uniq = analyzeContest(mine, [{ name: '자연의 아버지', tier: 1, count: 1 }], [{ ...opp([]), traits: [{ name: '자연의 아버지', tier: 1, count: 1 }] }])
    check('경합: 1명짜리 고유 시너지 겹침은 세지 않음', !uniq.isContested, JSON.stringify(uniq.traitDetails))
    const rerollDeck = {
      name: '테스트 리롤', avgPlacement: 4, sampleSize: 200, carryKey: 'TFT18_Varus',
      units: [{ key: 'TFT18_Varus', name: '바루스', cost: 1, star: 3, items: [{ name: '무한의 대검' }, { name: '최후의 속삭임' }] }],
    }
    const carryBoard = (level) => ({
      ...standard, level,
      units: [{ id: 'DA_18_ElderDragon', name: '장로 드래곤', tier: 2, rarity: 5, items: ['무한의 대검', '최후의 속삭임', '죽음의 검'] }],
      lobbyParticipants: [opp([])],
    })
    check(
      '빈집 후보: Lv.9 이상 보드에는 저코스트(≤3) 캐리 리롤 덱을 내지 않음 (Lv.8 은 냄)',
      openDeckCandidates(carryBoard(10), [rerollDeck]).length === 0 && openDeckCandidates(carryBoard(8), [rerollDeck]).length === 1,
      JSON.stringify(openDeckCandidates(carryBoard(8), [rerollDeck]).map((c) => c.deck.name))
    )
  }
  // ── 핵심 장면 (lib/keyMoments): 같은 구성 상위 상대 성급 차이 · 1성 중복 · 1성 기물 아이템 ──
  {
    const { keyMoments } = require('../lib/keyMoments')
    const U = (id, name, rarity, tier, items = []) => ({ id, name, rarity, tier, items })
    const core = (t) => [U('DA_18_GnarSmall', '나르', 5, 2), U('DA_18_ElderDragon', '장로 드래곤', 5, 2), U('DA_18_Ivern', '아이번', 5, t), U('DA_Taric18', '타릭', 5, t), U('DA_Amumu18', '아무무', 4, t)]
    const me = {
      ...standard, placement: 6, level: 10, lastRound: '5-6', traits: [],
      units: [...core(1), U('DA_Taric18', '타릭', 5, 1), U('DA_Vi18', '바이', 3, 1, ['수은', '가고일 돌갑옷', '쓸데없이 큰 지팡이']), U('DA_Amumu18', '아무무', 4, 1, ['찬란한 워모그의 갑옷'])],
    }
    me.lobbyParticipants = [
      { placement: 2, gameName: 'o', tagLine: 'x', level: 10, lastRound: '6-5', damageToPlayers: 0, traits: [], units: core(2), isUser: false },
      { placement: 6, gameName: 'me', tagLine: 'x', level: 10, lastRound: '5-6', damageToPlayers: 0, traits: [], units: me.units, isUser: true },
    ]
    const km = keyMoments(me)
    check('핵심 장면: 같은 구성 상위 상대 성급 차이가 1순위', km[0]?.kind === 'sameComp' && /아이번 1★ vs 2★/.test(km[0].fact) && /2등/.test(km[0].title), JSON.stringify(km[0]))
    check('핵심 장면: 같은 기물 1성 여러 장 (타릭 2장)', km.some((x) => x.kind === 'duplicateCopies' && /타릭 1성 2장/.test(x.fact)), JSON.stringify(km))
    check('핵심 장면: 1성 기물 아이템 · 찬란한 아이템', km.some((x) => x.kind === 'itemsOnWeak' && /찬란한 워모그의 갑옷\(아무무\)/.test(x.fact)), JSON.stringify(km))
    check('핵심 장면: 최대 3개', km.length <= 3)
    const worse = { ...me, placement: 1, lobbyParticipants: me.lobbyParticipants.map((p) => (p.isUser ? { ...p, placement: 1 } : p)) }
    check('핵심 장면: 같은 구성 상대가 나보다 아래 등수면 비교 장면 없음', !keyMoments(worse).some((x) => x.kind === 'sameComp'))
  }
  // ── 여러 판 반복 습관 (lib/habits) · 강의 주제 = 첫 장면 (focusOnMoment) ──
  {
    const { habitPatterns } = require('../lib/habits')
    const { focusOnMoment } = require('../lib/llm')
    const U = (id, name, rarity, tier, items = []) => ({ id, name, rarity, tier, items })
    const game = (placement, weak) => ({
      ...standard, matchId: `H${placement}${weak}`, placement, level: 8, lastRound: '5-5', traits: [], lobbyParticipants: [],
      units: [
        U('DA_18_Ezreal', '이즈리얼', 4, 2, ['무한의 대검']),
        U('DA_18_Kennen', '케넨', 5, 2),
        U('DA_18_Sett', '세트', 4, 2),
        U('DA_18_Ahri', '아리', 4, 2),
        U('DA_18_Diana', '다이애나', 3, 2),
        U('DA_18_Morgana', '모르가나', 4, 2),
        U('DA_18_Leona', '레오나', 1, 2),
        weak ? U('DA_Vi18', '바이', 3, 1, ['수은', '가고일 돌갑옷', '찬란한 워모그의 갑옷']) : U('DA_Vi18', '바이', 3, 2),
      ],
    })
    const worse = [game(7, 1), game(6, 1), game(8, 1), game(3, 0), game(2, 0)]
    const hs = habitPatterns(worse)
    const weak = hs.find((h) => h.kind === 'itemsOnWeak')
    check('습관: 3/5판 1성 기물 아이템 · 찬란한 · 있던 판/없던 판 등수', Boolean(weak) && /^3\/5판/.test(weak.fact) && /찬란한 아이템이 1성 기물에 간 판 3회/.test(weak.fact) && /있던 판 평균 7등 \/ 없던 판 2\.5등/.test(weak.fact), JSON.stringify(hs))
    const better = [game(2, 1), game(1, 1), game(3, 1), game(7, 0), game(8, 0)]
    check('습관: 있던 판이 확실히 더 좋은 등수면 습관이 아님', !habitPatterns(better).some((h) => h.kind === 'itemsOnWeak'), JSON.stringify(habitPatterns(better)))
    check('습관: 집계 판 3판 미만이면 없음', habitPatterns(worse.slice(0, 2)).length === 0)
    const plan = buildCoachingPlan(worse)
    const fp = focusOnMoment(plan, hs, 'multi')
    check('강의 주제 = 첫 습관 (1성 기물 아이템 → 아이템 축)', fp.focus === 'itemization' && fp.topic === '반복 습관 교정 — 좋은 아이템이 1성 기물에' && fp.axes === plan.axes, JSON.stringify({ focus: fp.focus, topic: fp.topic }))
    check('장면 없으면 강의 계획 그대로', focusOnMoment(plan, [], 'single') === plan)
  }
  // ── 연습 목표 (lib/goals): 장면 → 다음 3판 숫자 목표 · 설정 이후 경기로 채점 ──
  {
    const { goalFromMoment, evaluateGoal, goalText } = require('../lib/goals')
    const U = (id, name, rarity, tier, items = []) => ({ id, name, rarity, tier, items })
    const board = (t, weakItems, extra = {}) => ({
      ...standard, matchId: `G${t}`, gameDatetime: t, placement: 5, level: 8, lastRound: '5-5', traits: [], lobbyParticipants: [],
      units: [U('DA_18_Ezreal', '이즈리얼', 4, 2, ['무한의 대검']), U('DA_18_Kennen', '케넨', 5, 2), U('DA_18_Sett', '세트', 4, 2), U('DA_Vi18', '바이', 3, 1, Array.from({ length: weakItems }, (_, i) => `아이템${i}`))],
      ...extra,
    })
    const src = board(100, 5)
    const g = goalFromMoment({ kind: 'itemsOnWeak', title: '좋은 아이템이 1성 기물에' }, [src])
    check('목표: 1성 기물 아이템 → 2개 이하 · 기준 5 · since=출처 경기 시각', g && g.dir === 'max' && g.target === 2 && g.baseline === 5 && g.since === 100 && goalText(g) === '1성 기물에 든 아이템 2개 이하', JSON.stringify(g))
    check('목표: 1명 모자란 시너지는 목표로 바꾸지 않음', goalFromMoment({ kind: 'nearBreakpoint', title: 'x' }, [src]) === null)
    const later = [board(50, 0), board(200, 1), board(300, 4), board(400, 0, { lastRound: '2-2' }), board(500, 2), board(600, 0)]
    const pr = evaluateGoal(g, later)
    check(
      '채점: 설정 이후 · 초반 종료 제외 · 오래된 순 3판 · 2개 이하면 달성',
      pr.done && pr.games.map((x) => x.matchId).join(',') === 'G200,G300,G500' && pr.achieved === 2 && pr.average === 2.3,
      JSON.stringify(pr)
    )
    check('채점: 설정 이후 경기가 없으면 진행 0', evaluateGoal(g, [board(50, 0)]).games.length === 0 && !evaluateGoal(g, []).done)
  }
  // ── 내 덱 성적표 (lib/deckReport): 메타 덱으로 묶어 내 평균 vs 메타 평균 · 2판 이상만 판정 ──
  {
    const { buildDeckReport } = require('../lib/deckReport')
    const U = (id, name) => ({ id, name, rarity: 4, tier: 2, items: [] })
    const deckA = { name: '테스트 A', avgPlacement: 4, sampleSize: 200, units: ['Ahri', 'Sett', 'Morgana', 'Diana', 'Sentinel'].map((k) => ({ key: `TFT18_${k}`, name: k })) }
    const deckB = { name: '테스트 B', avgPlacement: 4.5, sampleSize: 10, units: ['Kennen', 'Draven', 'Maokai', 'Taric', 'Ivern'].map((k) => ({ key: `TFT18_${k}`, name: k })) }
    const game = (id, placement, keys) => ({ ...standard, matchId: id, placement, level: 8, lastRound: '5-5', units: keys.map((k) => U(`DA_18_${k}`, k)) })
    const aKeys = ['Ahri', 'Sett', 'Morgana', 'Diana', 'Sentinel']
    const bKeys = ['Kennen', 'Draven', 'Maokai', 'Taric', 'Ivern']
    const r = buildDeckReport(
      [game('a1', 7, aKeys), game('a2', 6, aKeys), game('b1', 1, bKeys), game('b2', 2, bKeys), game('x', 5, ['Veigar', 'Ornn', 'RekSai', 'Alistar']), { ...game('e', 8, aKeys), lastRound: '2-2' }],
      [deckA, deckB]
    )
    const A = r.rows.find((x) => x.name === '테스트 A')
    const B = r.rows.find((x) => x.name === '테스트 B')
    check('덱 성적표: 2판 평균 6.5 vs 메타 4 → 안 맞음 (초반 종료 판 제외)', A && A.games === 2 && A.avgPlacement === 6.5 && A.delta === 2.5 && A.verdict === 'bad', JSON.stringify(A))
    check('덱 성적표: 메타 표본 적은 덱은 판정 없음', B && B.games === 2 && B.verdict === null, JSON.stringify(B))
    check('덱 성적표: 메타 덱과 다른 조합은 따로 · 집계 5판', r.unmatched.games === 1 && r.unmatched.avgPlacement === 5 && r.total === 5, JSON.stringify(r.unmatched))
  }
  const early = { ...sample, lastRound: '2-2' }
  const mixedFacts = buildComparisonFacts({ matches: [sample, standard, early], mode: 'multi', combos: [], decks: [] })
  const earlyPlan = buildCoachingPlan([sample, standard, early])
  check(
    '종합: 경기 간 요약도 같은 표본 (초반 종료 1판 제외 → 2경기)',
    mixedFacts.includes('- 경기 간 요약(2경기): 등수 5·5 ·') && !mixedFacts.includes('(3경기)'),
    mixedFacts
  )
  check(
    '종합: 비교 사실과 강의 계획의 덱 유형 줄이 같은 표본(초반 종료 제외)',
    mixedFacts.includes(`- 덱 유형: ${earlyPlan.deckTypeReason}`) && earlyPlan.deckTypeReason.includes('/2판'),
    `${earlyPlan.deckTypeReason}
${mixedFacts}`
  )

  console.log('메타 덱 유사도')
  const board = { ...sample, units: ['TFT18_A', 'TFT18_B', 'TFT18_C', 'TFT18_D', 'TFT18_E'].map((id) => ({ id, name: id, tier: 2, items: [] })) }
  const near = { name: '가까운 덱', avgPlacement: 4.21, sampleSize: 120, units: ['A', 'B', 'C', 'D', 'F'].map((key) => ({ key })) } // 4/6 = 0.67
  const far = { name: '먼 덱', avgPlacement: 3.9, sampleSize: 300, units: ['A', 'B', 'X', 'Y', 'Z'].map((key) => ({ key })) } // 2/8 = 0.25
  const hit = mostSimilarDeck(board, [far, near])
  check('Jaccard 최고 덱 선택 (4/6 = 0.67)', hit && hit.deck.name === '가까운 덱' && Math.abs(hit.similarity - 4 / 6) < 1e-9)
  const withDeck = buildComparisonFacts({ matches: [board], mode: 'single', combos: [], decks: [far, near] })
  check('유사 덱 줄: 이름·유사도·표본·평균 vs 등수 차', withDeck.includes('- 가장 유사한 메타 덱: 가까운 덱 (유사도 0.67, 표본 120판) · 메타 평균 4.21등 vs 이 경기 5등 (+0.79)'), withDeck)
  const noDeck = buildComparisonFacts({ matches: [board], mode: 'single', combos: [], decks: [far] })
  check('임계(0.6) 미만이면 덱 줄 생략', !noDeck.includes('메타 덱'), noDeck)
  const small = buildComparisonFacts({ matches: [board], mode: 'single', combos: [], decks: [{ ...near, sampleSize: 12 }] })
  check('덱 표본 30판 미만이면 "참고용"', small.includes('표본 12판 · 표본이 적어 참고용'))

  console.log('메타 덱 운영도')
  check(
    '운영도 줄: +0.79 = 평균 수준 · 없는 기물 F',
    withDeck.includes('(+0.79) · 운영도: 메타 평균 수준 · 메타 덱 기물 중 내 보드에 없음: F'),
    withDeck
  )
  const at4 = { ...near, avgPlacement: 4 }
  check('경계: 3등 vs 메타 4등 (−1) = 잘 굴림', metaExecution({ ...board, placement: 3 }, [at4]).verdict === 'better')
  check('경계: 5등 vs 메타 4등 (+1) = 못 굴림', metaExecution({ ...board, placement: 5 }, [at4]).verdict === 'worse')
  check('경계 안: 4등 vs 메타 4.21등 (−0.21) = 평균 수준', metaExecution({ ...board, placement: 4 }, [near]).verdict === 'even')
  // 보드 13개(A~M) vs 덱 A~K + X(4코)·W(2코)·Y(1코)·V(1코)·Z(3코, 선택 기물) → 11/18 = 0.61
  const big = { ...sample, placement: 4, units: 'ABCDEFGHIJKLM'.split('').map((k) => ({ id: `TFT18_${k}`, name: k, tier: 2, items: [] })) }
  const bigDeck = {
    name: '큰 덱',
    avgPlacement: 4.5,
    sampleSize: 80,
    units: [
      ...'ABCDEFGHIJK'.split('').map((key) => ({ key, name: key, cost: 1 })),
      { key: 'X', name: '엑스', cost: 4 },
      { key: 'W', name: '더블유', cost: 2 },
      { key: 'Y', name: '와이', cost: 1 },
      { key: 'V', name: '브이', cost: 1 },
      { key: 'Z', name: '제트', cost: 3, flex: true },
    ],
  }
  const bigEx = metaExecution(big, [bigDeck])
  check(
    '없는 기물 = 선택 기물 제외 · 코스트 높은 순 · 최대 3개 (엑스, 더블유, 와이)',
    bigEx && bigEx.missingCore.join(',') === '엑스,더블유,와이',
    JSON.stringify(bigEx && bigEx.missingCore)
  )
  check('메타 덱 데이터 없으면 운영도 없음', metaExecution(board, []) === null)
  // 종합: b1 5등(+0.79 평균 수준) · b2 3등(−1.21 잘 굴림) · b3 표본 12판 덱(참고용) · 실제 픽스처(메타 덱 없음) · 초반 종료(제외)
  const other = { ...board, placement: 6, units: ['P', 'Q', 'R', 'S', 'T'].map((k) => ({ id: `TFT18_${k}`, name: k, tier: 2, items: [] })) }
  const otherDeck = { name: '소표본 덱', avgPlacement: 3.5, sampleSize: 12, units: ['P', 'Q', 'R', 'S', 'U'].map((key) => ({ key })) }
  const multiExec = buildComparisonFacts({
    matches: [board, { ...board, placement: 3 }, other, sample, { ...board, lastRound: '2-2' }],
    mode: 'multi',
    combos: [],
    decks: [near, otherDeck],
  })
  check(
    '종합 운영도: 3/4판 (초반 종료 제외) · 표본 충분 2판 평균 −0.21 · 분포 · 참고용 1판',
    multiExec.includes(
      '- 메타 덱 운영도: 메타 덱 3/4판 · 표본 충분 2판 평균 -0.21등 (잘 굴림 1 · 평균 수준 1 · 못 굴림 0) · 표본 적은 덱 1판은 참고용(평균 제외)'
    ),
    multiExec
  )
  // 메타 덱 보드 가치: 코스트·성급이 있는 덱만 (가까운 덱 5기물 3코 2성 = 45G vs 내 보드 TFT18_A~E 코스트 없음 1×3×5 = 15G)
  const priced = { ...near, units: near.units.map((x) => ({ ...x, cost: 3, star: 2 })) }
  const pricedLine = buildComparisonFacts({ matches: [board], mode: 'single', combos: [], decks: [priced] })
  check('메타 덱 줄에 보드 가치 (15G vs 45G)', pricedLine.includes('· 보드 가치 15G vs 메타 덱 45G'), pricedLine)
  check('코스트·성급 없는 덱은 보드 가치 생략', !withDeck.includes('메타 덱 45G') && !withDeck.includes('vs 메타 덱'), withDeck)
  const multiNone = buildComparisonFacts({ matches: [sample, sample], mode: 'multi', combos: [], decks: [near] })
  check('종합: 메타 덱 판이 없으면 운영도 줄 생략', !multiNone.includes('메타 덱 운영도'), multiNone)

  console.log('아이템 재료 매칭')
  const { componentsOf, bestBuildable } = require('../lib/itemRecipes')
  check('완성템 → 재료 2개 (모렐로노미콘 = 허리띠 + 지팡이)', JSON.stringify(componentsOf('모렐로노미콘')) === JSON.stringify(['거인의 허리띠', '쓸데없이 큰 지팡이']))
  check('재료는 자기 자신', JSON.stringify(componentsOf('여신의 눈물')) === JSON.stringify(['여신의 눈물']))
  check('조합법 없는 아이템(상징)은 null', componentsOf('기원자 상징') === null)
  check(
    '재료 공유: 대검 1개로 무한의 대검·쇼진의 창 동시 불가',
    bestBuildable(['무한의 대검', '쇼진의 창'], ['B.F. 대검', '연습용 장갑', '여신의 눈물']).length === 1
  )
  // 앞에서부터 욕심내면 쇼진의 창 1개, 최적은 무한의 대검 + 푸른 파수꾼 2개
  const opt = bestBuildable(['쇼진의 창', '무한의 대검', '푸른 파수꾼'], ['B.F. 대검', '연습용 장갑', '여신의 눈물', '여신의 눈물'])
  check('최대 묶음 탐색 (탐욕 아님): 무한의 대검 + 푸른 파수꾼', opt.join(',') === '무한의 대검,푸른 파수꾼', opt.join(','))

  console.log('로비 메타 덱 · 빈집 후보')
  const { openDeckCandidates } = require('../lib/comparisonFacts')
  const u = (k, tier = 2, items = []) => ({ id: `TFT18_${k}`, name: k, tier, items })
  const deck = (name, keys, carryKey, carryItems, avgPlacement = 3.5, sampleSize = 100) => ({
    name,
    avgPlacement,
    sampleSize,
    carryKey,
    units: keys.map((key) => ({ key, name: key === carryKey ? `${key}캐리` : key, cost: 3, items: key === carryKey ? carryItems.map((n) => ({ name: n })) : [] })),
  })
  // 내 캐리 A: 보석 건틀릿(지팡이+장갑) · 쇼진의 창(대검+눈물) · 모렐로노미콘(허리띠+지팡이)
  const me = {
    ...sample,
    placement: 5,
    units: [u('A', 2, ['보석 건틀릿', '쇼진의 창', '모렐로노미콘']), u('B'), u('C'), u('D'), u('E')],
    lobbyParticipants: [
      { placement: 5, isUser: true, units: [], traits: [], level: 7 },
      { placement: 1, isUser: false, units: ['V', 'W', 'X', 'Y', 'Z'].map((k) => u(k)), traits: [], level: 9 },
      { placement: 3, isUser: false, units: [u('L', 2), u('M', 1), u('N', 1)], traits: [], level: 8 },
    ],
  }
  const three = ['보석 건틀릿', '쇼진의 창', '모렐로노미콘']
  const lobbyDecksList = [
    deck('내 덱', ['A', 'B', 'C', 'D', 'F'], 'F', three, 4.2),
    deck('빈집1', ['P', 'Q', 'R', 'S', 'T'], 'P', ['공허의 지팡이', '모렐로노미콘', '보석 건틀릿'], 3.5), // 2/3 (곡궁 없음)
    deck('빈집2', ['K', 'Q2', 'R2', 'S2', 'T2'], 'K', ['쇼진의 창', '보석 건틀릿', '무한의 대검'], 3.0), // 2/3 (대검 공유)
    deck('빈집3', ['J', 'Q3', 'R3', 'S3', 'T3'], 'J', ['쇼진의 창', '모렐로노미콘', '공허의 지팡이'], 4.0), // 2/3, 최대 2개 밖
    deck('점령 덱', ['V', 'W', 'X', 'Y', 'Z'], 'V', three), // 1등이 탐
    deck('코어 점령', ['L', 'Q4', 'R4', 'S4', 'T4'], 'L', three), // 3등이 L 2성 보유
    deck('약한 덱', ['G', 'Q5', 'R5', 'S5', 'T5'], 'G', three, 4.8),
    deck('소표본', ['H', 'Q6', 'R6', 'S6', 'T6'], 'H', three, 3.0, 12),
    deck('내 덱 변형', ['A', 'Q7', 'R7', 'S7', 'T7'], 'A', three, 2.5), // 캐리 A가 내 보드에 있음
    deck('재료 부족', ['O', 'Q8', 'R8', 'S8', 'T8'], 'O', ['무한의 대검', '공허의 지팡이', '피바라기'], 2.0), // 0/3
  ]
  const cands = openDeckCandidates(me, lobbyDecksList)
  check(
    '빈집 후보 = 빈집2(3.00) · 빈집1(3.50) — 점령·코어 점령·약한·소표본·변형·재료 부족 제외, 최대 2개',
    cands.map((c) => c.deck.name).join(',') === '빈집2,빈집1',
    cands.map((c) => `${c.deck.name} ${c.buildable.join('+')}`).join(' | ')
  )
  const openFacts = buildComparisonFacts({ matches: [me], mode: 'single', combos: [], decks: lobbyDecksList })
  check(
    '로비 메타 덱 줄',
    openFacts.includes('- 로비 메타 덱(최종 보드 기준): 나(5등) 내 덱 · 1등 점령 덱 · 나머지 1명은 메타 덱과 유사도 0.6 미만'),
    openFacts
  )
  check(
    '빈집 후보 줄 = 손계산',
    openFacts.includes(
      '- 빈집 메타 덱 후보(사후 비교): 빈집2 · 로비 0명 · 메타 평균 3.00등(표본 100판) · 캐리 K캐리 핵심템 2/3을 내 캐리(A) 아이템 재료로 조합 가능(쇼진의 창, 보석 건틀릿)'
    ),
    openFacts
  )
  check('로비 정보 없으면 빈집 후보 없음', openDeckCandidates({ ...me, lobbyParticipants: [] }, lobbyDecksList).length === 0)
  const multiOpen = buildComparisonFacts({ matches: [me, me], mode: 'multi', combos: [], decks: lobbyDecksList })
  check('종합 분석에는 로비·빈집 줄 없음 (한 판 기준 사실)', !/빈집|로비 메타 덱/.test(multiOpen), multiOpen)

  console.log('덱 가이드 (래더 실측)')
  const { opennessLabel } = require('../lib/comparisonFacts')
  // 내 보드 A(아이템: 보석 건틀릿·쇼진의 창·루덴의 폭풍)·B·C·D·E vs 가이드 덱 A~D + F (유사도 4/6 = 0.67)
  const gBoard = { ...sample, level: 8, units: [u('A', 2, ['보석 건틀릿', '쇼진의 창', '루덴의 폭풍']), u('B'), u('C'), u('D'), u('E')] }
  const guideDeck = {
    name: '가이드 덱',
    avgPlacement: 4.0,
    sampleSize: 200,
    carryKey: 'A',
    units: ['A', 'B', 'C', 'D', 'F'].map((key) => ({ key, name: key })),
    guide: {
      boards: 200,
      core: [{ key: 'A', name: 'A', usage: 1, avgPlacement: 4 }, { key: 'B', name: 'B', usage: 0.9, avgPlacement: 4 }, { key: 'F', name: 'F', usage: 0.85, avgPlacement: 3.9 }],
      flex: [{ key: 'C', name: 'C', usage: 0.798, avgPlacement: 4.1 }, { key: 'G', name: 'G', usage: 0.3, avgPlacement: 3.5 }],
      carryItems: [
        { key: 'x', name: '쇼진의 창', rate: 0.7, avgPlacement: 3.9 },
        { key: 'y', name: '모렐로노미콘', rate: 0.5, avgPlacement: 4.123 },
      ],
      levels: { 7: 0.03, 8: 0.6, 9: 0.37 },
      carryThreeStarRate: 0.1,
      openness: { coreCount: 3, flexSlots: 5, sharedCarryDecks: 2 },
    },
  }
  const gFacts = buildComparisonFacts({ matches: [gBoard], mode: 'single', combos: [], decks: [guideDeck] })
  check(
    '가이드 기물: 핵심 3개 중 2개 (없음: F) · 유동 C 채용 79%(내림)',
    gFacts.includes('- 덱 가이드 기물(래더 200판, 가이드 덱): 핵심 기물(채용 80%+) 3개 중 2개 보유 (없음: F) · 내 유동 기물: C(채용 79%, 썼을 때 평균 4.10등)'),
    gFacts
  )
  check(
    '가이드 캐리 아이템: 채용률 순 · 내 캐리 A 1/3 (유물 제외)',
    gFacts.includes('- 덱 가이드 캐리 아이템(최종 보드 채용률 순, 조합 순서 아님): 쇼진의 창 70%(평균 3.90등) · 모렐로노미콘 50%(평균 4.12등) — 내 캐리 A 아이템 1/3개가 이 목록에 있음'),
    gFacts
  )
  check(
    '가이드 운영: 5% 미만 레벨 생략 · 개방성 높음(유동 칸 5)',
    gFacts.includes('- 덱 가이드 운영: 레벨 분포 8 60% · 9 37% (나 Lv.8) · 캐리 3성 10% · 개방성 높음 (유동 칸 5, 같은 캐리 메타 덱 2개)'),
    gFacts
  )
  check('개방성 등급 경계: 1 낮음 · 2 보통 · 4 보통 · 5 높음', [1, 2, 4, 5].map(opennessLabel).join(',') === '낮음,보통,보통,높음')
  const noGuide = buildComparisonFacts({ matches: [gBoard], mode: 'single', combos: [], decks: [{ ...guideDeck, guide: undefined }] })
  check('가이드 없는 덱(DB 구버전 등)은 가이드 줄 생략', !noGuide.includes('덱 가이드'), noGuide)

  console.log('상위 랭커 운영')
  const { topPlayerLine } = require('../lib/comparisonFacts')
  const { topPlayerStats, TOP_MIN_BOARDS } = require('../lib/topPlayers')
  const topStats = {
    boards: 12,
    players: 7,
    avgPlacement: 3.1,
    top4Rate: 0.667,
    carryThreeStarRate: 0.25,
    carryItems: [{ name: '공허의 지팡이', rate: 0.75 }, { name: '쇼진의 창', rate: 0.5 }, { name: '모렐로노미콘', rate: 0.42 }, { name: '보석 건틀릿', rate: 0.1 }],
    levels: { 8: 0.33, 9: 0.58, 10: 0.09 },
    extraUnits: [{ name: '아리', usage: 0.667 }],
  }
  check(
    '상위 랭커 줄 = 손계산 (캐리 아이템 상위 3 · 최빈 레벨 · 핵심 외 기물)',
    topPlayerLine({ ...sample, level: 8 }, { name: '가이드 덱' }, topStats, 30) ===
      '- 상위 랭커 운영(챌린저 LP 상위 30명 최근 판 중 가이드 덱 12판 · 7명): 평균 3.10등 · TOP4 67% · 캐리 아이템 공허의 지팡이 75% · 쇼진의 창 50% · 모렐로노미콘 42% · 최빈 레벨 9(58%, 나 Lv.8) · 캐리 3성 25% · 핵심 외 자주 쓴 기물 아리 67%',
    topPlayerLine({ ...sample, level: 8 }, { name: '가이드 덱' }, topStats, 30)
  )
  check(
    `상위 랭커 표본 ${TOP_MIN_BOARDS}판 미만이면 생략`,
    topPlayerStats('A', { decks: { A: { ...topStats, boards: TOP_MIN_BOARDS - 1 } } }) === undefined && topPlayerStats('A', { decks: { A: topStats } }) === topStats
  )
  const topReal = require('../lib/topPlayerGuide.json')
  check(
    '실제 집계본 형식: 덱별 판 수·평균 등수·채용률 범위',
    Object.values(topReal.decks || {}).every((d) => d.boards >= 1 && d.players >= 1 && d.players <= d.boards && d.avgPlacement >= 1 && d.avgPlacement <= 8 && d.carryItems.every((i) => i.rate > 0 && i.rate <= 1)),
    JSON.stringify(Object.keys(topReal.decks || {}))
  )

  console.log('패치 분리')
  const { choosePatchDecks } = require('./buildDecksFromBoards')
  const { patchBasisLabel } = require('../lib/comparisonFacts')
  const mk = (id, games, avg, carryKey = id) => ({ id, games, avgPlacement: avg, carryKey, guide: { openness: { sharedCarryDecks: -1 } } })
  // A: 현재 패치 40판(≥30) → 현재 패치 덱 · B: 현재 패치 10판 → 혼합 덱 · C: 현재 패치에만 있는 새 덱 35판 · D: 현재 20판(신규, 미달) 제외
  const chosen = choosePatchDecks([mk('A', 40, 3.9), mk('B', 10, 3.0), mk('C', 35, 4.5, 'A'), mk('D', 20, 3.5)], [mk('A', 90, 4.0), mk('B', 60, 4.2)], 30)
  check(
    '패치 선택: 현재 패치 표본 충분하면 현재만, 부족하면 혼합, 신규 덱은 기준 이상만 · 평균 등수 순',
    chosen.map((d) => `${d.id}:${d.games}`).join(',') === 'A:40,B:60,C:35',
    chosen.map((d) => `${d.id}:${d.games}`).join(',')
  )
  check('패치 선택 뒤 같은 캐리 덱 수 다시 셈 (A·C 같은 캐리)', chosen.find((d) => d.id === 'A').guide.openness.sharedCarryDecks === 1 && chosen.find((d) => d.id === 'B').guide.openness.sharedCarryDecks === 0)
  const notes2 = [
    { patch: '18.4', publishedAt: '2026-10-06T18:00:00.000Z', sections: [] },
    { patch: '18.5', publishedAt: '2026-10-20T18:00:00.000Z', sections: [] },
  ]
  check('패치 기준 표기: 단일 = "18.4 기준"', patchBasisLabel({ counts: { 18.4: 87 }, mixed: false }, Date.parse('2026-10-10T00:00:00Z'), notes2) === '18.4 기준')
  check(
    '패치 기준 표기: 혼합 = "18.4·18.5 혼합(18.5 12판)"',
    patchBasisLabel({ counts: { 18.5: 12, 18.4: 75 }, mixed: true }, Date.parse('2026-10-21T00:00:00Z'), notes2) === '18.4·18.5 혼합(18.5 12판)'
  )
  check(
    '경기 패치가 기준에 없으면 "이 경기는 18.5 추정, 패치 다름"',
    patchBasisLabel({ counts: { 18.4: 87 }, mixed: false }, Date.parse('2026-10-21T00:00:00Z'), notes2) === '18.4 기준 · 이 경기는 18.5 추정, 패치 다름'
  )
  check('패치 정보 없으면 표기 없음 (DB 경로 등)', patchBasisLabel(undefined, Date.now(), notes2) === '')

  console.log('패치 노트')
  const { parseBody } = require('./fetchPatchNotes')
  const { patchAt, normalizeEntity, boardPatchChanges, getPatchNotes } = require('../lib/patchNotes')
  const { patchLine } = require('../lib/comparisonFacts')
  const html =
    '<h2>대규모 변경 사항</h2><h4 class="change-detail-title">유닛: 1단계</h4><blockquote class="blockquote context"><p>해설 산문 — 저장 안 함</p></blockquote>' +
    '<ul><li>베이가<ul><li>스킬 피해량: 주문력 200 <span class="change-indicator">⇒</span> 220</li></ul></li><li>소라카:<ul><li>마나: 0/60 ⇒ 0/50</li></ul></li></ul>' +
    '<h4>증강</h4><ul><li>어떤 증강<ul><li>골드: 2 ⇒ 3</li></ul></li></ul>'
  const parsed = parseBody(html)
  check(
    '패치 본문 파싱: 섹션·대상·변경 줄, 해설(blockquote)·증강 섹션 제외, 콜론 제거',
    parsed.length === 1 && parsed[0].kind === 'unit' && parsed[0].changes.map((c) => `${c.entity}|${c.lines.join(';')}`).join(' / ') === '베이가|스킬 피해량: 주문력 200 ⇒ 220 / 소라카|마나: 0/60 ⇒ 0/50' && !JSON.stringify(parsed).includes('해설'),
    JSON.stringify(parsed)
  )
  const nested = parseBody('<h4>유닛: 4단계</h4><ul><li>니달리<ul><li>주문력 형태<ul><li>투창 피해량: 170 ⇒ 185</li></ul></li><li>공통: 1 ⇒ 2</li></ul></li></ul>')
  check('3단 중첩 = "소제목 — 변경 줄"', JSON.stringify(nested[0].changes[0].lines) === JSON.stringify(['주문력 형태 — 투창 피해량: 170 ⇒ 185', '공통: 1 ⇒ 2']), JSON.stringify(nested))
  check('대상 이름 정규화: "(9) 나무정령" · "요정 (2/4)" · "소라카:"', ['(9) 나무정령', '요정 (2/4)', '소라카:'].map(normalizeEntity).join(',') === '나무정령,요정,소라카')
  const P = (patch, day, sections) => ({ patch, url: '', publishedAt: `2026-10-${day}T18:00:00.000Z`, sections })
  const fakePatches = [
    P('18.4', '06', [{ title: '유닛', kind: 'unit', changes: [{ entity: '베이가', lines: ['A ⇒ B'] }] }]),
    P('18.5', '20', [
      { title: '특성', kind: 'trait', changes: [{ entity: '검은 가시', lines: ['(6) 구간 강화: 60% ⇒ 50%', '기본: 12% ⇒ 10%'] }, { entity: '(9) 나무정령', lines: ['체력: 140% ⇒ 125%'] }] },
      { title: '유닛: 5단계', kind: 'unit', changes: [{ entity: '알룬', lines: ['1 ⇒ 2', '3 ⇒ 4', '5 ⇒ 6'] }] },
      { title: '찬란한 아이템', kind: 'radiantItem', changes: [{ entity: '푸른 파수꾼', lines: ['30% ⇒ 25%'] }] },
    ]),
  ]
  const at = (iso) => Date.parse(iso)
  check(
    '경기 시각 → 패치 (게시 시각 기준)',
    patchAt(at('2026-10-20T17:59:00Z'), fakePatches).patch === '18.4' && patchAt(at('2026-10-20T18:00:00Z'), fakePatches).patch === '18.5' && patchAt(at('2026-10-01T00:00:00Z'), fakePatches) === undefined
  )
  const pMatch = {
    ...sample,
    gameDatetime: at('2026-10-10T00:00:00Z'),
    units: [{ id: 'TFT18_Alune', name: '알룬', tier: 1, items: ['찬란한 푸른 파수꾼'] }, { id: 'TFT18_X', name: '엑스', tier: 2, items: ['푸른 파수꾼'] }],
    traits: [{ name: '검은 가시', count: 2, tier: 1 }, { name: '나무정령', count: 3, tier: 1 }],
  }
  const pr = boardPatchChanges(pMatch, fakePatches)
  check(
    '보드 관련 변경: 경기(18.4) 이후 18.5 · 기물→아이템→시너지 순 · 닿지 않은 구간((6)·(9)) 제외 · 찬란한 아이템은 찬란한 버전만',
    pr.matchPatch === '18.4' && pr.later && pr.hits.map((h) => `${h.entity}:${h.lines.length}`).join(',') === '알룬:3,찬란한 푸른 파수꾼:1,검은 가시:1',
    JSON.stringify(pr)
  )
  check(
    '패치 변경점 줄: 대상당 2줄 + "외 N건"',
    patchLine(pMatch, fakePatches) === '- 경기 이후 패치 변경점(공식 패치 노트 18.5 · 이 경기는 18.4 추정, 내 보드 관련): 알룬 — 1 ⇒ 2; 3 ⇒ 4 외 1건 · 찬란한 푸른 파수꾼 — 30% ⇒ 25% · 검은 가시 — 기본: 12% ⇒ 10%',
    patchLine(pMatch, fakePatches)
  )
  check(
    '최신 패치에서 한 경기 = "이 경기 패치 변경점" · 관련 없으면 "변경 없음"',
    patchLine({ ...pMatch, gameDatetime: at('2026-10-21T00:00:00Z'), units: [], traits: [] }, fakePatches) === '- 이 경기 패치 변경점(공식 패치 노트 18.5, 내 보드 관련): 내 보드 기물·시너지·아이템 관련 변경 없음'
  )
  check('경기 시각이 수집 패치보다 이르면 줄 생략', patchLine({ ...pMatch, gameDatetime: at('2026-09-01T00:00:00Z') }, fakePatches) === null)
  const real = getPatchNotes()
  check(
    '실제 수집본: 패치 오름차순 · 섹션·변경 줄 존재 · 증강 섹션 없음',
    real.length > 0 && real.every((p, i) => i === 0 || p.publishedAt >= real[i - 1].publishedAt) && real.every((p) => p.sections.length && p.sections.every((s) => s.kind !== 'augment' && s.changes.every((c) => c.lines.length))),
    real.map((p) => p.patch).join(',')
  )

  console.log('BIS 일치율')
  const combos = [
    { champKey: 'Ahri', itemName: 'X', avgPlacement: 3.1, sampleSize: 50 },
    { champKey: 'Ahri', itemName: 'Y', avgPlacement: 3.5, sampleSize: 40 },
    { champKey: 'Ahri', itemName: 'W', avgPlacement: 3.2, sampleSize: 30 },
    { champKey: 'Ahri', itemName: 'Z', avgPlacement: 2.9, sampleSize: 10 }, // 표본 미달 → 제외
    { champKey: 'Ahri', itemName: 'V', avgPlacement: 4.0, sampleSize: 25 }, // 4위 → 제외
    { champKey: 'Lux18_Base', itemName: 'P', avgPlacement: 3.0, sampleSize: 25 },
  ]
  const bis = bisBySlug(combos)
  check('BIS = 표본 20판 이상 중 채용 상위 3 (X 50, Y 40, W 30)', JSON.stringify(bis.get('ahri')) === JSON.stringify(['X', 'Y', 'W']), JSON.stringify([...bis]))
  check(
    'BIS 채용 판 수가 같으면 평균등수 좋은 쪽',
    JSON.stringify(
      bisBySlug([
        { champKey: 'Jax', itemName: 'A', avgPlacement: 4.2, sampleSize: 30 },
        { champKey: 'Jax', itemName: 'B', avgPlacement: 3.8, sampleSize: 30 },
      ]).get('jax')
    ) === JSON.stringify(['B', 'A'])
  )
  const units = [
    { id: 'DA_18_Ahri', name: '아리', tier: 2, items: ['X', 'Y', 'Z'] },
    { id: 'TFT18_Garen', name: '가렌', tier: 2, items: ['Q'] }, // BIS 통계 없음 → 분모 제외
    { id: 'DA_Lux18_Base', name: '럭스', tier: 1, items: ['P'] },
  ]
  const res = bisMatch(units, bis)
  check('보드 전체 3/4 (아리 2/3 + 럭스 1/1, 가렌 제외)', res.matched === 3 && res.slots === 4, JSON.stringify(res))
  const bl = buildComparisonFacts({ matches: [{ ...sample, units, lobbyParticipants: [] }], mode: 'single', combos, decks: [] })
  check('BIS 줄: 캐리 대조 ✓/✗ · 75%', bl.includes('- BIS 일치율: 아리 2/3 (X ✓, Y ✓, Z ✗) · 보드 전체 3/4 (75%)'), bl)

  // KR_8427579901 회귀: 장로 드래곤 무한의 대검·죽음의 검·최후의 속삭임이 0/3 이던 원인 — 평균등수 순 BIS 가
  // 표본 42판 붉은 덩굴정령(3.21)을 고르고 315판 무한의 대검(3.70)을 뺐다. (lib/metaStats.json 실측 수치)
  const elder = [
    { champKey: 'ElderDragon', itemName: '무한의 대검', avgPlacement: 3.7, sampleSize: 315 },
    { champKey: 'ElderDragon', itemName: '최후의 속삭임', avgPlacement: 3.96, sampleSize: 173 },
    { champKey: 'ElderDragon', itemName: '스테락의 도전', avgPlacement: 3.59, sampleSize: 133 },
    { champKey: 'ElderDragon', itemName: '죽음의 검', avgPlacement: 3.92, sampleSize: 109 },
    { champKey: 'ElderDragon', itemName: '타격대의 철퇴', avgPlacement: 3.68, sampleSize: 96 },
    { champKey: 'ElderDragon', itemName: '붉은 덩굴정령', avgPlacement: 3.21, sampleSize: 42 },
    { champKey: 'Gnar', itemName: '스테락의 도전', avgPlacement: 3.41, sampleSize: 66 },
  ]
  const elderBis = bisBySlug(elder)
  check(
    '장로 드래곤 BIS = 무한의 대검 · 최후의 속삭임 · 스테락의 도전',
    JSON.stringify(elderBis.get('elderdragon')) === JSON.stringify(['무한의 대검', '최후의 속삭임', '스테락의 도전']),
    JSON.stringify([...elderBis])
  )
  const elderRes = bisMatch(
    [
      { id: 'DA_18_ElderDragon', name: '장로 드래곤', tier: 1, items: ['무한의 대검', '죽음의 검', '최후의 속삭임'] },
      { id: 'DA_18_GnarSmall', name: '나르', tier: 1, items: ['스테락의 도전'] },
    ],
    elderBis
  )
  check('장로 드래곤 2/3 · 나르(GnarSmall) 1/1 → 보드 전체 3/4', elderRes.matched === 3 && elderRes.slots === 4, JSON.stringify(elderRes))
  const { entitySlug } = require('../lib/entitySlug')
  check(
    '나르 슬러그: DA_18_GnarSmall · TFT18_Gnar · Gnar → gnar (통계 키와 같음), 변형 꼬리는 유지',
    ['DA_18_GnarSmall', 'TFT18_GnarSmall', 'TFT18_Gnar', 'Gnar'].every((k) => entitySlug('champion', k) === 'gnar') &&
      entitySlug('champion', 'DA_Gromp18_AP') === 'gromp18ap'
  )

  console.log('같은 구성 상대 (KR_8427579901 유형: Lv.10 5코 밸류 6등 vs 같은 5코 2성 2등)')
  const U = (id, name, rarity, tier, items = []) => ({ id, name, rarity, tier, items })
  const Opp = (placement, level, units) => ({ placement, gameName: `p${placement}`, level, lastRound: '6-1', damageToPlayers: 0, traits: [], units, isUser: false })
  const myUnits = [
    U('DA_18_GnarSmall', '나르', 5, 1),
    U('DA_18_ElderDragon', '장로 드래곤', 5, 1, ['무한의 대검', '죽음의 검', '최후의 속삭임']),
    U('DA_Amumu18', '아무무', 4, 1, ['가고일 돌갑옷']),
    U('DA_18_Ivern', '아이번', 5, 1),
    U('DA_Taric18', '타릭', 5, 1, ['워모그의 갑옷']),
    U('DA_Sentinel18', '감시자', 4, 1),
    U('DA_18_Soraka', '소라카', 4, 2),
    U('DA_18_Sett', '세트', 4, 1, ['크라운가드']),
    U('DA_Scuttlecrab18', '바위 게', 2, 2),
    U('DA_18_Sentry', '조약돌', 1, 1), // 1성 무템 1코 → 코어 아님
  ]
  const second = Opp(2, 10, [
    U('TFT18_Gnar', '나르', 5, 2),
    U('DA_18_ElderDragon', '장로 드래곤', 5, 2, ['무한의 대검', '스테락의 도전', '최후의 속삭임']),
    U('DA_Amumu18', '아무무', 4, 2, ['가고일 돌갑옷']),
    U('DA_18_Ivern', '아이번', 5, 2),
    U('DA_Taric18', '타릭', 5, 2, ['워모그의 갑옷']),
    U('DA_18_Soraka', '소라카', 4, 2),
    U('DA_Lux18_Base', '럭스', 5, 1),
    U('DA_18_Alune', '알룬', 5, 1),
    U('DA_Scuttlecrab18', '바위 게', 2, 2),
  ])
  // 1등은 리롤 Lv.8 (공용 기물 감시자·조약돌만 겹침), 4등은 장로·타릭만 겹침
  const first = Opp(1, 8, [
    U('DA_Krug18', '돌거북', 3, 3, ['스테락의 도전']),
    U('DA_18_Sapling', '불타는 묘목', 1, 3),
    U('DA_Sentinel18', '감시자', 4, 2),
    U('DA_18_Sentry', '조약돌', 1, 2),
  ])
  const fourth = Opp(4, 9, [
    U('DA_18_ElderDragon', '장로 드래곤', 5, 1, ['무한의 대검']),
    U('DA_Taric18', '타릭', 5, 1),
    U('DA_18_Alune', '알룬', 5, 2),
    U('DA_Lux18_Base', '럭스', 5, 2),
  ])
  const value = { ...sample, placement: 6, level: 10, units: myUnits, traits: [], lobbyParticipants: [first, second, fourth] }
  const sim = mostSimilarOpponent(value)
  // 코어: 나 38(조약돌 제외) · 2등 40 · 겹침 나르5+장로5+아무무4+아이번5+타릭5+소라카4+바위 게2 = 30 → 30/(38+40−30) = 0.625
  check(
    '가장 비슷한 상대 = 2등 · 유사도 0.625 · 겹치는 코어 기물 7개',
    sim && sim.opponent.placement === 2 && Math.abs(sim.similarity - 0.625) < 1e-9 && sim.shared.length === 7,
    JSON.stringify(sim && { p: sim.opponent.placement, s: sim.similarity, n: sim.shared.length })
  )
  const vb = buildComparisonFacts({ matches: [value], mode: 'single', combos: [], decks: [] })
  // 2성 이상: 나 소라카·바위 게 2 / 2등 7 · 아이템 3+1+1+1=6 vs 3+1+1=5
  // 보드 가치: 나 5+5+4+5+5+4+4×3+4+2×3+1 = 51 / 2등 (5+5+4+5+5+4+2)×3 + 5 + 5 = 100
  check(
    '같은 구성 상대 줄 = 손계산',
    vb.includes(
      '- 같은 구성 상대(2등, 겹치는 코어 기물 7개 · 유사도 0.63)와 비교(나 6등): 레벨 0 (10 vs 10) · 2성 이상 2 vs 7 · 코어 기물 성급 차이: 나르 1★ vs 2★, 장로 드래곤 1★ vs 2★, 아이번 1★ vs 2★, 타릭 1★ vs 2★, 아무무 1★ vs 2★ (같은 성급 2개) · 아이템 6 vs 5 · 보드 가치 51G vs 100G'
    ),
    vb
  )
  check(
    '로비 1등 비교 줄은 유지 · 같은 구성 줄은 그 다음',
    vb.indexOf('- 로비 1등과 비교:') >= 0 && vb.indexOf('- 로비 1등과 비교:') < vb.indexOf('- 같은 구성 상대('),
    vb
  )
  check('같은 구성 줄에 인과 표현 없음', !/때문|원인|그래서|졌다/.test(vb.split('\n').find((l) => l.startsWith('- 같은 구성 상대(')) || ''))
  const sameStars = {
    ...value,
    lobbyParticipants: [{ ...second, units: second.units.map((u) => ({ ...u, tier: myUnits.find((m) => m.name === u.name)?.tier ?? u.tier })) }],
  }
  check(
    '겹치는 코어 기물 성급이 모두 같으면 "모두 같음"',
    buildComparisonFacts({ matches: [sameStars], mode: 'single', combos: [], decks: [] }).includes('겹치는 코어 기물 성급 모두 같음')
  )
  check(
    '공용 기물만 겹치는 상대뿐이면 줄 생략',
    !buildComparisonFacts({ matches: [{ ...value, lobbyParticipants: [first, fourth] }], mode: 'single', combos: [], decks: [] }).includes('같은 구성 상대')
  )
  // 겹치는 코어 3개(나르·장로·아이번)뿐이면 유사도 1이어도 생략
  const trio = [myUnits[0], myUnits[1], myUnits[3]]
  check('겹치는 코어 기물 4개 미만이면 생략', mostSimilarOpponent({ ...value, units: trio, lobbyParticipants: [Opp(3, 9, trio.map((u) => ({ ...u, tier: 2 })))] }) === null)
  check(
    '같은 유사도면 등수 높은 상대',
    mostSimilarOpponent({ ...value, lobbyParticipants: [{ ...second, placement: 5 }, { ...second, placement: 3 }] })?.opponent.placement === 3
  )
  const aliAlune = fixture.cases.find((c) => c.name === 'Seed01 contested-top4 4등 5-6').matches[0]
  check('픽스처: 아리·알룬 캐리 vs 돌거북 리롤(공용 기물 5개 공유)은 같은 구성 아님', mostSimilarOpponent(aliAlune) === null)
  const seed05 = fixture.cases.find((c) => c.name === 'Seed05 contested-bot4 5등 5-3').matches[0]
  const s05 = mostSimilarOpponent(seed05)
  check('픽스처: Seed05 5등 ↔ 6등 같은 구성(돌거북·덩굴정령…)', s05 && s05.opponent.placement === 6 && s05.similarity > 0.8, JSON.stringify(s05 && s05.similarity))

  console.log('실제 픽스처 6경기 (JSON 메타 통계)')
  const { getStats, getDecks } = require('../lib/tftStats')
  const { DEFAULT_FILTER } = require('../lib/statsShared')
  const { EVAL_CASES } = require('./evalAiVariants')
  const comboRows = (await getStats('unit_item', DEFAULT_FILTER)).rows
  const decks = (await getDecks(DEFAULT_FILTER, { withGuide: true })).decks
  const publicDecks = (await getDecks(DEFAULT_FILTER)).decks
  check('공개 덱 응답에는 guide 없음 · AI 경로(withGuide)에는 있음', publicDecks.every((d) => !d.guide) && decks.some((d) => d.guide))
  const { buildMetaPayload } = require('../lib/metaPayload')
  check('공개 메타 payload(/meta)에 guide 없음', buildMetaPayload().decks.every((d) => !d.guide))
  let bad = 0
  const lineCounts = []
  for (const c of EVAL_CASES) {
    const fc = fixture.cases.find((x) => x.name === c.name)
    const b = buildComparisonFacts({ matches: fc.matches, mode: fc.mode, combos: comboRows, decks })
    if (/NaN|Infinity|undefined/.test(b)) bad++
    lineCounts.push(`${c.id}:${b.split('\n').length - 1}`)
  }
  check('NaN/Infinity/undefined 없음 · 케이스마다 1줄 이상', bad === 0 && lineCounts.every((x) => Number(x.split(':')[1]) >= 1), lineCounts.join(' '))

  console.log(failures ? `\n❌ 실패 ${failures}건` : '\n✅ 비교 사실 테스트 통과')
  if (failures) process.exitCode = 1
})()

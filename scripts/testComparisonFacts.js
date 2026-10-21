/**
 * [비교 사실] 블록 테스트 — lib/comparisonFacts.ts (AI-EVAL A2).
 *
 * 실행: node scripts/testComparisonFacts.js   (npm run test:ai 에 포함)
 *  - 로비 1등·로비 평균 비교 = 손계산
 *  - 메타 덱 유사도 임계(0.6) 미만이면 줄 생략
 *  - 덱 가이드(래더 실측): 핵심·유동 기물 · 캐리 아이템 채용률 · 레벨 분포 · 개방성 등급
 *  - 아이템 재료 매칭 · 로비 메타 덱 · 빈집 메타 덱 후보 (점령·코어 점령·약한·소표본·변형·재료 부족 제외)
 *  - 메타 덱 운영도: ±1등 경계 · 없는 기물(선택 기물 제외, 코스트순, 최대 3) · 종합 집계(표본 충분 판만 평균)
 *  - BIS 일치율 분자/분모 (표본 20판 미만 조합 제외, BIS 통계 없는 기물은 분모에서 제외)
 *  - 실제 픽스처 6경기에서 NaN/Infinity 없음
 */
require('./_env').loadEnv()
process.env.NEXT_PUBLIC_SUPABASE_URL = ''
require('./_ts')
const { buildComparisonFacts, bisBySlug, bisMatch, metaExecution, mostSimilarDeck } = require('../lib/comparisonFacts')

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
  const completionAxis = plan.axes.find((a) => a.key === 'completion')
  check(
    '완성도 축 지표에 보드 가치 75G · 점수 항목(effects)에는 없음',
    completionAxis.metrics.some((x) => x.key === 'boardValue' && x.value === 75) && !completionAxis.effects.some((e) => e.key === 'boardValue'),
    JSON.stringify(completionAxis)
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
  const thinReroll = { ...sample, units: sample.units.map((u) => ({ ...u, tier: ['오른', '렉사이'].includes(u.name) ? 3 : Math.min(u.tier, 2) })) }
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
      mixedTempo.metrics.some((x) => x.key === 'levelGap') &&
      mixedTempo.metrics.some((x) => x.key === 'carryThreeStar') &&
      mixedTempo.lesson.includes('리롤형은 코어 3성'),
    JSON.stringify(mixedTempo)
  )
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
  check('BIS = 표본 20판 이상 중 평균등수 상위 3 (X, W, Y)', JSON.stringify(bis.get('ahri')) === JSON.stringify(['X', 'W', 'Y']), JSON.stringify([...bis]))
  const units = [
    { id: 'DA_18_Ahri', name: '아리', tier: 2, items: ['X', 'Y', 'Z'] },
    { id: 'TFT18_Garen', name: '가렌', tier: 2, items: ['Q'] }, // BIS 통계 없음 → 분모 제외
    { id: 'DA_Lux18_Base', name: '럭스', tier: 1, items: ['P'] },
  ]
  const res = bisMatch(units, bis)
  check('보드 전체 3/4 (아리 2/3 + 럭스 1/1, 가렌 제외)', res.matched === 3 && res.slots === 4, JSON.stringify(res))
  const bl = buildComparisonFacts({ matches: [{ ...sample, units, lobbyParticipants: [] }], mode: 'single', combos, decks: [] })
  check('BIS 줄: 캐리 대조 ✓/✗ · 75%', bl.includes('- BIS 일치율: 아리 2/3 (X ✓, Y ✓, Z ✗) · 보드 전체 3/4 (75%)'), bl)

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

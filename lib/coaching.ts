import type {
  AxisEffect,
  AxisMetric,
  CoachingAxis,
  CoachingAxisKey,
  CoachingPlan,
  DeckType,
  DeckTypeInfo,
  SlimMatchData,
} from './types'
import { expectedLevel, isEarlyGame, lowSampleReason, scoringSample, stageOfRound } from './quality'
import { AXIS_CONFIG, SCORING_VERSION } from './axisConfig'
import { DECK_TYPE_LABEL, detectDeckType, summarizeDeckInfos } from './deckType'
import { boardValue } from './boardValue'
import breakpointData from './traitBreakpoints.json'

/** 시너지 이름 → 브레이크포인트 (예: 나무정령 [3,5,7,9,11]) */
const BREAKPOINTS: Record<string, number[]> = Object.fromEntries(
  Object.values((breakpointData as { traits: Record<string, { name: string; breakpoints: number[] }> }).traits).map(
    (t) => [t.name, t.breakpoints]
  )
)

/**
 * 강의형 코칭 진단 (결정론적)
 *
 * 경기 데이터에서 6개 축을 계산해 0~100 점을 매기고,
 * 가장 약한 축을 '이번 강의 주제'로 고정한다. (LLM은 이 주제를 벗어나지 않는다)
 *
 * 축: 경제 · 아이템 설계 · 템포(레벨/리롤) · 보드 완성도 · 시너지 설계 · 유연성 (key: contest, 입력은 로비 수렴도)
 * 덱 유형(리롤형/표준형)은 최종 보드의 3성 개수·코스트·레벨로 먼저 판정하고(lib/deckType.ts),
 * 리롤형이면 템포 축을 레벨 격차 대신 3성 완성·캐리 3성으로 평가한다.
 * 초반 종료(2-2 등) 표본은 정상 경기와 섞지 않는다.
 *
 * 공식의 숫자는 모두 axisConfig.json 에 있다. 각 축은 경기마다 "가점/감점 항목(effects)"의 합을
 * 0~100 으로 자른 값이고, 여러 경기면 평균한다. 항목은 UI·프롬프트에 그대로 노출된다.
 */

const clamp = (n: number, min = 0, max = 100) => Math.min(Math.max(n, min), max)
const avg = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0)
const round1 = (n: number) => Math.round(n * 10) / 10

export interface PerMatchMetrics {
  placement: number
  top4: boolean
  goldLeft: number
  level: number
  stage: number
  carryItems: number
  totalItems: number
  units: number
  /** 보드 가치(G) — 지표만, 점수 미반영 (lib/boardValue) */
  boardValue: number
  twoPlus: number
  three: number
  /** 3성 기물의 코스트 (오름차순) */
  threeStarCosts: number[]
  /** 아이템을 가장 많이 든 캐리가 3성인가 */
  carryThreeStar: boolean
  /** 최종 보드 기준 덱 유형 (리롤형/표준형/판정 불가) */
  deckType: Exclude<DeckType, 'mixed'>
  activeTraits: number
  bestTraitCount: number
  /** 켠 시너지 단계(tier_current)의 합 — 고유 시너지 포함 */
  traitTierTotal: number
  contested: boolean
  contestScore: number
  contestLevel?: string
  compKey: string
}

export function readMatch(m: SlimMatchData, deck: DeckTypeInfo = detectDeckType(m)): PerMatchMetrics {
  const units = m.units || []
  // 아이템 축의 '캐리' = 최고 코스트 기물 (아이템이 비싼 기물에 몰렸는가를 본다).
  // 덱 유형의 캐리 3성은 다른 정의(아이템 최다 기물, deckType.boardCarry)를 쓴다.
  const carry = units
    .slice()
    .sort((a, b) => (b.rarity ?? 1) - (a.rarity ?? 1) || b.items.length - a.items.length)[0]
  const syn = AXIS_CONFIG.axes.synergy
  const allTraits = m.traits || []
  const traits = syn.excludeUniqueTraits
    ? allTraits.filter((t) => (BREAKPOINTS[t.name]?.[0] ?? 2) > 1 && (t.count || 0) >= 2)
    : allTraits
  return {
    placement: Math.min(Math.max(m.placement || 8, 1), 8),
    top4: (m.placement || 8) <= 4,
    goldLeft: m.goldLeft || 0,
    level: m.level || 0,
    stage: stageOfRound(m.lastRound),
    carryItems: carry ? carry.items.length : 0,
    totalItems: units.reduce((s, u) => s + (u.items?.length || 0), 0),
    units: units.length,
    boardValue: boardValue(units),
    twoPlus: units.filter((u) => (u.tier || 1) >= 2).length,
    three: units.filter((u) => u.tier === 3).length,
    threeStarCosts: deck.threeStarCosts,
    carryThreeStar: deck.carryThreeStar,
    deckType: deck.type,
    activeTraits: traits.length,
    bestTraitCount: traits.reduce((s, t) => Math.max(s, t.count || 0), 0),
    traitTierTotal: allTraits.reduce((s, t) => s + (t.tier || 0), 0),
    contested: Boolean(m.contestedInfo?.isContested),
    contestScore: m.contestedInfo?.contestScore ?? 0,
    contestLevel: m.contestedInfo?.level,
    compKey: units
      .map((u) => u.name)
      .sort()
      .join('|'),
  }
}

/* ───────────── 축별 공식 (한 경기) ───────────── */

/** 한 경기의 축 점수 + 가점/감점 항목 (key → points) */
export interface AxisResult {
  score: number
  effects: Record<string, number>
}

const EFFECT_LABEL: Record<string, string> = {
  base: '기본',
  idleGold: '쓰지 않은 골드',
  levelGap: '표준 레벨 대비 격차',
  earlyExit: '이른 탈락',
  carryItems: '캐리 아이템',
  boardItems: '보드 전체 아이템',
  missingThreeStars: '3성 부족',
  carryNotThreeStar: '캐리 3성 미완성',
  unknownStage: '탈락 라운드 불명(중립값)',
  boardFill: '보드 충원',
  twoPlus: '2성 이상 비율',
  threeStar: '3성 보너스',
  spread: '활성 시너지 개수',
  depth: '시너지 단계 합',
  condition: '경합 조건 점수',
}

function economyAxis(m: PerMatchMetrics): AxisResult {
  // 잔여 골드만 보면 "다 써서 조기 탈락"이 만점이 된다.
  // 표준 레벨 대비 격차 + 초반 종료 페널티로 실제 운영을 평가한다.
  // 리롤형은 골드를 레벨이 아니라 리롤(3성)에 쓰는 덱이라 레벨 격차를 감점하지 않는다 (템포 축과 같은 기준).
  const c = AXIS_CONFIG.axes.economy
  const levelGap = m.deckType === 'reroll' ? 0 : Math.max(0, expectedLevel(m.stage) - m.level)
  const early = m.stage > 0 ? c.earlyExitPenalty.find((p) => m.stage <= p.maxStage) : undefined
  const idle = c.idleGoldExemptPlacements.includes(m.placement) ? 0 : Math.max(0, m.goldLeft - c.idleGoldFree)
  const effects = {
    base: 100,
    idleGold: -idle * c.idleGoldPenaltyPerGold,
    levelGap: -levelGap * c.levelGapPenaltyPerLevel,
    earlyExit: -(early?.penalty ?? 0),
  }
  return { score: clamp(Math.round(sum(effects))), effects }
}

function itemizationAxis(m: PerMatchMetrics): AxisResult {
  const c = AXIS_CONFIG.axes.itemization
  const effects = {
    carryItems: (Math.min(m.carryItems, c.carryItemsMax) / c.carryItemsMax) * c.carryWeight,
    boardItems: (Math.min(m.totalItems, c.boardItemsMax) / c.boardItemsMax) * c.boardWeight,
  }
  return { score: clamp(sum(effects)), effects }
}

function tempoAxis(m: PerMatchMetrics): AxisResult {
  const c = AXIS_CONFIG.axes.tempo
  // 리롤형은 레벨을 올리는 덱이 아니다. 3성 완성과 캐리 3성으로 성과를 평가한다.
  if (m.deckType === 'reroll') {
    const r = c.reroll
    const effects = {
      base: 100,
      missingThreeStars: -Math.max(r.targetThreeStars - m.three, 0) * r.missingThreeStarPenalty,
      carryNotThreeStar: m.carryThreeStar ? 0 : -r.carryNotThreeStarPenalty,
    }
    return { score: clamp(Math.round(sum(effects))), effects }
  }
  if (!m.stage) return { score: c.unknownStageScore, effects: { unknownStage: c.unknownStageScore } }
  const effects = {
    base: 100,
    levelGap: -Math.abs(m.level - expectedLevel(m.stage)) * c.levelGapPenaltyPerLevel,
  }
  return { score: clamp(sum(effects)), effects }
}

/** 보드 완성도: 레벨만큼 채웠는가(충원율) × 2성 비율 + 3성 보너스. metaScore 의 덱 완성도와 공용. */
export function completionAxis(m: Pick<PerMatchMetrics, 'units' | 'level' | 'stage' | 'twoPlus' | 'three'>): AxisResult {
  const c = AXIS_CONFIG.axes.completion
  if (!m.units) return { score: 0, effects: { boardFill: 0 } }
  const slots = Math.max(m.level, expectedLevel(m.stage), 1)
  const fill = Math.min(m.units / slots, 1)
  const twoPlusRate = m.twoPlus / m.units
  const effects = {
    boardFill: fill * c.fillBase,
    twoPlus: fill * c.twoPlusBonus * twoPlusRate,
    threeStar: Math.min(m.three, c.threeStarMax) * c.threeStarBonusEach,
  }
  // 점수는 기존 식 그대로 계산한다 (항목 합과 부동소수 반올림이 갈리지 않게)
  const score = clamp(Math.round(fill * (c.fillBase + c.twoPlusBonus * twoPlusRate) + effects.threeStar))
  return { score, effects }
}

function synergyAxis(m: PerMatchMetrics): AxisResult {
  // 활성 시너지가 이상 범위(idealActiveMin~Max) 밖이면 개당 감점 + 켠 시너지 단계 합(tierTotalTarget=만점)
  // v2 는 "3개가 이상 + 주력 인원"이라 상위권의 넓은 보드를 깎았다 (골든셋 등수 상관 -0.21).
  // 단계 합은 골든셋에서 등수 상관이 가장 높았다 (0.52, 최대 단계 하나만 보면 -0.28).
  const c = AXIS_CONFIG.axes.synergy
  const outside = Math.max(0, c.idealActiveMin - m.activeTraits, m.activeTraits - c.idealActiveMax)
  const spread = clamp(100 - outside * c.spreadPenaltyPerTrait)
  const tiers = clamp((m.traitTierTotal / c.tierTotalTarget) * 100)
  const effects = { spread: spread * c.spreadWeight, depth: tiers * c.tierWeight }
  return { score: clamp(sum(effects)), effects }
}

/** 경합은 원인이 아니라 조건: 경합 없음 / 경합+순방 / 경합+하위권. metaScore 의 경합 대응과 공용. */
export function contestAxis(m: Pick<PerMatchMetrics, 'contested' | 'top4' | 'contestLevel'>): AxisResult {
  // 겹친 기물이 하나라도 있으면 isContested=true 라 상위 티어 판은 거의 다 '경합'이 된다 → 등급으로 나눈다.
  const c = AXIS_CONFIG.axes.contest
  const byLevel = m.contestLevel ? c.byLevel[m.contestLevel] : undefined
  const score = byLevel
    ? m.top4
      ? byLevel.top4
      : byLevel.bottom4
    : !m.contested
      ? c.uncontested
      : m.top4
        ? c.contestedTop4
        : c.contestedBottom4
  return { score, effects: { condition: score } }
}

function sum(effects: Record<string, number>): number {
  return Object.values(effects).reduce((a, b) => a + b, 0)
}

/** 경기별 항목을 평균해 UI/프롬프트용 effects 로 만든다. (모든 경기에 같은 키가 없을 수도 있다) */
function averageEffects(results: AxisResult[]): AxisEffect[] {
  const keys = [...new Set(results.flatMap((r) => Object.keys(r.effects)))]
  return keys.map((key) => ({
    key,
    label: EFFECT_LABEL[key] ?? key,
    points: round1(avg(results.map((r) => r.effects[key] ?? 0))),
  }))
}

const LESSON: Record<
  CoachingAxisKey,
  {
    label: string
    lesson: string
    topic: string
    /** 덱 유형별 강의 문장·주제 (없으면 기본값) */
    byDeck?: Partial<Record<DeckType, { lesson: string; topic: string }>>
  }
> = {
  economy: {
    label: '경제 운영',
    lesson:
      '골드와 레벨의 교환비 — 쓸 타이밍에 쓰지 않으면 골드는 그냥 사망 직전의 숫자다.',
    topic: '골드는 "언제 쓰느냐"가 전부다 — 레벨·리롤 타이밍 강의',
    byDeck: {
      reroll: {
        lesson:
          '리롤형의 골드는 레벨이 아니라 3성에 쓰는 돈이다. 이자를 지키며 모은 골드를 코어 3성이 나올 구간에 몰아 써야 한다.',
        topic: '리롤형 골드 운용 강의 — 이자를 지키며 3성 구간에 몰아 쓰기',
      },
    },
  },
  itemization: {
    label: '아이템 설계',
    lesson:
      'BIS는 목표가 아니라 순서다. 캐리 확정 전에도 손해 없는 템을 먼저 만드는 게 핵심이다.',
    topic: '아이템 3신기는 "만드는 순서"가 실력이다 — 슬램과 보류의 기준',
  },
  tempo: {
    label: '템포(레벨/리롤)',
    lesson:
      '레벨은 보드의 그릇이다. 그릇을 키우는 타이밍이 늦으면 좋은 기물도 들어갈 자리가 없다.',
    topic: '레벨업 타이밍 강의 — 언제 6·7·8·9를 찍어야 하는가',
    // 리롤형은 레벨이 아니라 3성 완성 속도와 캐리 3성으로 평가한다. 혼합은 두 기준을 함께 다룬다.
    byDeck: {
      reroll: {
        lesson:
          '리롤형은 레벨을 올리는 덱이 아니다. 정해진 라운드 안에 코어 3성을 얼마나 완성했는가가 승패를 가른다.',
        topic: '리롤 성과 강의 — 3성 완성과 캐리 3성',
      },
      mixed: {
        lesson:
          '덱마다 템포의 기준이 다르다. 표준형은 레벨을 올리는 타이밍, 리롤형은 코어 3성을 완성하는 타이밍이 승패를 가른다.',
        topic: '템포 강의 — 표준형은 레벨 타이밍, 리롤형은 3성 완성',
      },
    },
  },
  completion: {
    label: '보드 완성도',
    lesson:
      '2성 8개 보드가 1성 9개 보드보다 강하다. 넓히기 전에 코어를 단단히 굳혀라.',
    topic: '2성작 우선순위 강의 — 넓히기와 굳히기의 순서',
  },
  synergy: {
    label: '시너지 설계',
    lesson:
      '시너지는 개수보다 "몇 명이 함께 켜는가"다. 얕게 여러 개보다 깊게 2~3개다.',
    topic: '시너지 밀도 강의 — 얕은 판 vs 깊은 판',
  },
  contest: {
    label: '유연성',
    lesson:
      '겹침은 원인이 아니라 조건이다. 수렴도가 높으면 "같이 갈 것인가, 비틀 것인가"를 라운드 단위로 정해야 한다.',
    topic: '유연성 강의 — 겹쳤을 때 비트는 기준',
  },
}


const ORDER: CoachingAxisKey[] = ['economy', 'itemization', 'tempo', 'completion', 'synergy', 'contest']

const AXIS_FN: Record<CoachingAxisKey, (m: PerMatchMetrics) => AxisResult> = {
  economy: economyAxis,
  itemization: itemizationAxis,
  tempo: tempoAxis,
  completion: completionAxis,
  synergy: synergyAxis,
  contest: contestAxis,
}

/** 축별 원시 지표 (공식의 입력값) */
function axisMetrics(key: CoachingAxisKey, metrics: PerMatchMetrics[], deckType: DeckType): AxisMetric[] {
  const mean = (f: (m: PerMatchMetrics) => number) => round1(avg(metrics.map(f)))
  const gap = (m: PerMatchMetrics) => (m.stage ? m.level - expectedLevel(m.stage) : 0)
  switch (key) {
    case 'economy': {
      // 레벨 부족은 표준형 경기만으로 센다 (리롤형은 공식에서도 감점하지 않는다)
      const standard = metrics.filter((m) => m.deckType !== 'reroll')
      return [
        { key: 'goldLeft', label: '잔여 골드', value: mean((m) => m.goldLeft), unit: 'G' },
        ...(standard.length
          ? [{ key: 'levelShort', label: '표준 레벨보다 부족', value: round1(avg(standard.map((m) => Math.max(0, -gap(m))))), unit: '레벨' }]
          : []),
        { key: 'stage', label: '탈락 스테이지', value: mean((m) => m.stage) },
      ]
    }
    case 'itemization':
      return [
        { key: 'carryItems', label: '캐리 아이템', value: mean((m) => m.carryItems), unit: '개' },
        { key: 'boardItems', label: '보드 전체 아이템', value: mean((m) => m.totalItems), unit: '개' },
      ]
    case 'tempo': {
      // 리롤형은 3성 완성·캐리 3성, 표준형은 레벨 격차, 혼합은 둘 다 보여 준다 (점수는 경기별 유형으로 매긴다).
      const reroll: AxisMetric[] = [
        { key: 'threeStars', label: '3성', value: mean((m) => m.three), unit: '개' },
        { key: 'carryThreeStar', label: '캐리 3성', value: mean((m) => (m.carryThreeStar ? 1 : 0)), unit: '/1' },
      ]
      if (deckType === 'reroll') return [...reroll, { key: 'level', label: '최종 레벨', value: mean((m) => m.level) }]
      const standard: AxisMetric[] = [
        { key: 'level', label: '최종 레벨', value: mean((m) => m.level) },
        { key: 'expectedLevel', label: '표준 레벨', value: mean((m) => (m.stage ? expectedLevel(m.stage) : m.level)) },
        { key: 'levelGap', label: '표준 대비 격차(절대값)', value: mean((m) => Math.abs(gap(m))), unit: '레벨' },
      ]
      return deckType === 'mixed' ? [...standard, ...reroll] : standard
    }
    case 'completion':
      return [
        { key: 'units', label: '유닛 수', value: mean((m) => m.units), unit: '개' },
        { key: 'twoPlus', label: '2성 이상', value: mean((m) => m.twoPlus), unit: '개' },
        { key: 'three', label: '3성', value: mean((m) => m.three), unit: '개' },
        // 점수 미반영 지표 — 스테이지 보정 측정 후 반영 여부 결정 (testAxes 타당도)
        { key: 'boardValue', label: '보드 가치', value: mean((m) => m.boardValue), unit: 'G' },
      ]
    case 'synergy':
      return [
        { key: 'activeTraits', label: '활성 시너지', value: mean((m) => m.activeTraits), unit: '개' },
        { key: 'bestTraitCount', label: '주력 시너지 인원', value: mean((m) => m.bestTraitCount), unit: '명' },
        { key: 'traitTierTotal', label: '시너지 단계 합', value: mean((m) => m.traitTierTotal), unit: `/${AXIS_CONFIG.axes.synergy.tierTotalTarget}` },
      ]
    case 'contest':
      return [
        { key: 'contestedGames', label: '경합 경기', value: metrics.filter((m) => m.contested).length, unit: '판' },
        { key: 'contestScore', label: '로비 수렴도', value: mean((m) => m.contestScore), unit: '/100' },
      ]
  }
}

/** 덱 유형에 맞는 강의 문장·주제 (리롤형/혼합이면 템포 강의가 바뀐다) */
function lessonFor(key: CoachingAxisKey, deckType: DeckType): { lesson: string; topic: string } {
  return LESSON[key].byDeck?.[deckType] ?? LESSON[key]
}

/** 6축 진단 + 이번 강의 주제 결정 */
export function buildCoachingPlan(matches: SlimMatchData[]): CoachingPlan {
  const valid = (matches || []).filter(Boolean)
  const { sample: base, full } = scoringSample(valid)
  const deckInfos = base.map(detectDeckType)
  const metrics = base.map((m, i) => readMatch(m, deckInfos[i]))
  const lowSample = full.length === 0
  const excludedMatches = valid.length - base.length
  const reasons = [...new Set(valid.filter(isEarlyGame).map(lowSampleReason).filter(Boolean))]
  const basis = base.length === 1 ? '이 경기' : '평균'
  const deck = summarizeDeckInfos(deckInfos)
  const deckLabel = DECK_TYPE_LABEL[deck.type]

  const detail: Record<CoachingAxisKey, string> = {
    economy: `${basis} 잔여 골드 ${round1(avg(metrics.map((m) => m.goldLeft)))} · ${basis} 탈락 ${round1(
      avg(metrics.map((m) => m.stage))
    )}스테이지`,
    itemization: `${basis} 캐리 아이템 ${round1(avg(metrics.map((m) => m.carryItems)))}개 · 보드 총 아이템 ${round1(
      avg(metrics.map((m) => m.totalItems))
    )}개`,
    tempo:
      deck.type === 'reroll' || deck.type === 'mixed'
        ? `${basis} 덱 유형 ${deckLabel}${
            deck.type === 'mixed' ? ` (리롤 ${deck.reroll}/${base.length})` : ''
          } · 3성 ${round1(avg(metrics.map((m) => m.three)))}개 · ${
            base.length === 1
              ? metrics[0].carryThreeStar
                ? '캐리 3성 완성'
                : '캐리 3성 미완성'
              : `캐리 3성 ${metrics.filter((m) => m.carryThreeStar).length}/${base.length}판`
          }`
        : `${basis} 레벨 ${round1(avg(metrics.map((m) => m.level)))} · ${basis} 탈락 ${round1(
            avg(metrics.map((m) => m.stage))
          )}스테이지`,
    completion: `${basis} 2성+ ${round1(avg(metrics.map((m) => m.twoPlus)))}개 · 3성 ${metrics.reduce(
      (s, m) => s + m.three,
      0
    )}회`,
    synergy: `${basis} 활성 시너지 ${round1(avg(metrics.map((m) => m.activeTraits)))}개 · 최대 겹침 ${round1(
      avg(metrics.map((m) => m.bestTraitCount))
    )}명`,
    contest: `${metrics.filter((m) => m.contested).length}/${base.length}경기 경합 · ${basis} 수렴도 ${round1(
      avg(metrics.map((m) => m.contestScore))
    )}/100`,
  }

  const axes: CoachingAxis[] = ORDER.map((key) => {
    const results = metrics.map(AXIS_FN[key])
    return {
      key,
      label: LESSON[key].label,
      score: Math.round(avg(results.map((r) => r.score))),
      detail: detail[key],
      lesson: lessonFor(key, deck.type).lesson,
      metrics: axisMetrics(key, metrics, deck.type),
      effects: averageEffects(results),
    }
  })

  // 가장 약한 축 = 강의 주제. 단, '경합'은 다른 축보다 focusMinGap 점 이상 낮을 때만 주제로 채택.
  const sorted = [...axes].sort(
    (a, b) => a.score - b.score || ORDER.indexOf(a.key) - ORDER.indexOf(b.key)
  )
  let focus = sorted[0]
  if (focus.key === 'contest' && sorted[1] && sorted[1].score - focus.score < AXIS_CONFIG.axes.contest.focusMinGap) {
    focus = sorted[1]
  }

  const sampleWarning = lowSample
    ? `표본 부족: 초반 종료 경기만 있어 강의·점수 해석에 주의가 필요합니다${reasons.length ? ` (${reasons.join(', ')})` : ''}.`
    : excludedMatches
      ? `초반 종료 ${excludedMatches}경기는 강의·점수에서 제외했습니다${reasons.length ? ` (${reasons.join(', ')})` : ''}.`
      : undefined

  // 덱 유형을 주제 선택에 반영한다: 리롤형에서 템포가 초점이면 '레벨업'이 아니라 '리롤 성과' 강의.
  const { topic, lesson: drillTemplate } = lessonFor(focus.key, deck.type)

  return {
    focus: focus.key,
    focusLabel: focus.label,
    topic,
    axes,
    drillTemplate,
    matchCount: base.length,
    deckType: deck.type,
    deckTypeLabel: deckLabel,
    deckTypeReason: deck.line,
    lowSample,
    excludedMatches,
    sampleWarning,
    scoringVersion: SCORING_VERSION,
  }
}

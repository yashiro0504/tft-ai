import type { CoachingAxis, CoachingAxisKey, CoachingPlan, SlimMatchData } from './types'
import { expectedLevel, isEarlyGame, lowSampleReason, stageOfRound } from './quality'

/**
 * 강의형 코칭 진단 (결정론적)
 *
 * 경기 데이터에서 6개 축을 계산해 0~100 점을 매기고,
 * 가장 약한 축을 '이번 강의 주제'로 고정한다. (LLM은 이 주제를 벗어나지 않는다)
 *
 * 축: 경제 · 아이템 설계 · 템포(레벨/리롤) · 보드 완성도 · 시너지 설계 · 로비 수렴도
 * 초반 종료(2-2 등) 표본은 정상 경기와 섞지 않는다.
 */

const clamp = (n: number, min = 0, max = 100) => Math.min(Math.max(n, min), max)
const avg = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0)
const round1 = (n: number) => Math.round(n * 10) / 10

interface PerMatchMetrics {
  placement: number
  top4: boolean
  goldLeft: number
  level: number
  stage: number
  carryItems: number
  totalItems: number
  units: number
  twoPlus: number
  three: number
  activeTraits: number
  bestTraitCount: number
  contested: boolean
  contestScore: number
  compKey: string
}

function readMatch(m: SlimMatchData): PerMatchMetrics {
  const units = m.units || []
  const withCost = units.map((u) => ({ u, cost: u.rarity ?? 1 }))
  const carry = withCost
    .slice()
    .sort((a, b) => b.cost - a.cost || b.u.items.length - a.u.items.length)[0]
  const traits = (m.traits || []).filter((t) => (t.count || 0) >= 2)
  return {
    placement: Math.min(Math.max(m.placement || 8, 1), 8),
    top4: (m.placement || 8) <= 4,
    goldLeft: m.goldLeft || 0,
    level: m.level || 0,
    stage: stageOfRound(m.lastRound),
    carryItems: carry ? carry.u.items.length : 0,
    totalItems: units.reduce((s, u) => s + (u.items?.length || 0), 0),
    units: units.length,
    twoPlus: units.filter((u) => (u.tier || 1) >= 2).length,
    three: units.filter((u) => u.tier === 3).length,
    activeTraits: traits.length,
    bestTraitCount: traits.reduce((s, t) => Math.max(s, t.count || 0), 0),
    contested: Boolean(m.contestedInfo?.isContested),
    contestScore: m.contestedInfo?.contestScore ?? 0,
    compKey: units
      .map((u) => u.name)
      .sort()
      .join('|'),
  }
}

const LESSON: Record<CoachingAxisKey, { label: string; lesson: string; topic: string }> = {
  economy: {
    label: '경제 운영',
    lesson:
      '골드와 레벨의 교환비 — 쓸 타이밍에 쓰지 않으면 골드는 그냥 사망 직전의 숫자다.',
    topic: '골드는 "언제 쓰느냐"가 전부다 — 레벨·리롤 타이밍 강의',
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
    label: '로비 수렴도 대응',
    lesson:
      '겹침은 원인이 아니라 조건이다. 수렴도가 높으면 "같이 갈 것인가, 비틀 것인가"를 라운드 단위로 정해야 한다.',
    topic: '수렴도 대응 강의 — 겹쳤을 때 비트는 기준',
  },
}

const ORDER: CoachingAxisKey[] = ['economy', 'itemization', 'tempo', 'completion', 'synergy', 'contest']

/** 6축 진단 + 이번 강의 주제 결정 */
export function buildCoachingPlan(matches: SlimMatchData[]): CoachingPlan {
  const valid = (matches || []).filter(Boolean)
  const full = valid.filter((m) => !isEarlyGame(m))
  const base = full.length ? full : valid
  const metrics = base.map(readMatch)
  const lowSample = full.length === 0
  const excludedMatches = valid.length - base.length
  const reasons = [...new Set(valid.filter(isEarlyGame).map(lowSampleReason).filter(Boolean))]
  const basis = base.length === 1 ? '이 경기' : '평균'

  const economyScores = metrics.map((m) => {
    // 잔여 골드만 보면 "다 써서 조기 탈락"이 만점이 된다.
    // 표준 레벨 대비 격차 + 초반 종료 페널티로 실제 운영을 평가한다.
    const levelGap = Math.max(0, expectedLevel(m.stage) - m.level)
    const earlyPenalty = m.stage > 0 && m.stage < 3 ? 30 : m.stage > 0 && m.stage < 4 ? 15 : 0
    const idle = Math.max(0, m.goldLeft - 50)
    return clamp(Math.round(100 - idle * 1.2 - levelGap * 12 - earlyPenalty))
  })

  const itemScores = metrics.map((m) =>
    clamp((Math.min(m.carryItems, 3) / 3) * 55 + (Math.min(m.totalItems, 9) / 9) * 45)
  )

  const tempoScores = metrics.map((m) => {
    if (!m.stage) return 60
    const gap = Math.abs(m.level - expectedLevel(m.stage))
    return clamp(100 - gap * 18)
  })

  const completionScores = metrics.map((m) => {
    if (!m.units) return 0
    const slots = Math.max(m.level, expectedLevel(m.stage), 1)
    const fill = Math.min(m.units / slots, 1)
    const twoPlusRate = m.twoPlus / m.units
    return clamp(Math.round(fill * (55 + 45 * twoPlusRate) + Math.min(m.three, 3) * 2))
  })

  const synergyScores = metrics.map((m) => {
    // 활성 시너지 3개 근처가 이상적, 4명 이상 겹치는 주력 시너지에 가점
    const spread = clamp(100 - Math.abs(m.activeTraits - 3) * 15)
    const depth = clamp((m.bestTraitCount / 4) * 100)
    return clamp(spread * 0.55 + depth * 0.45)
  })

  const contestScores = metrics.map((m) => (!m.contested ? 70 : m.top4 ? 95 : 45))

  const detail: Record<CoachingAxisKey, string> = {
    economy: `${basis} 잔여 골드 ${round1(avg(metrics.map((m) => m.goldLeft)))} · ${basis} 탈락 ${round1(
      avg(metrics.map((m) => m.stage))
    )}스테이지`,
    itemization: `${basis} 캐리 아이템 ${round1(avg(metrics.map((m) => m.carryItems)))}개 · 보드 총 아이템 ${round1(
      avg(metrics.map((m) => m.totalItems))
    )}개`,
    tempo: `${basis} 레벨 ${round1(avg(metrics.map((m) => m.level)))} · ${basis} 탈락 ${round1(
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

  const raw: Record<CoachingAxisKey, number> = {
    economy: Math.round(avg(economyScores)),
    itemization: Math.round(avg(itemScores)),
    tempo: Math.round(avg(tempoScores)),
    completion: Math.round(avg(completionScores)),
    synergy: Math.round(avg(synergyScores)),
    contest: Math.round(avg(contestScores)),
  }

  const axes: CoachingAxis[] = ORDER.map((key) => ({
    key,
    label: LESSON[key].label,
    score: raw[key],
    detail: detail[key],
    lesson: LESSON[key].lesson,
  }))

  // 가장 약한 축 = 강의 주제. 단, '경합'은 다른 축보다 10점 이상 낮을 때만 주제로 채택.
  const sorted = [...axes].sort(
    (a, b) => a.score - b.score || ORDER.indexOf(a.key) - ORDER.indexOf(b.key)
  )
  let focus = sorted[0]
  if (focus.key === 'contest' && sorted[1] && sorted[1].score - focus.score < 10) {
    focus = sorted[1]
  }

  const sampleWarning = lowSample
    ? `표본 부족: 초반 종료 경기만 있어 강의·점수 해석에 주의가 필요합니다${reasons.length ? ` (${reasons.join(', ')})` : ''}.`
    : excludedMatches
      ? `초반 종료 ${excludedMatches}경기는 강의·점수에서 제외했습니다${reasons.length ? ` (${reasons.join(', ')})` : ''}.`
      : undefined

  return {
    focus: focus.key,
    focusLabel: focus.label,
    topic: LESSON[focus.key].topic,
    axes,
    drillTemplate: LESSON[focus.key].lesson,
    matchCount: base.length,
    lowSample,
    excludedMatches,
    sampleWarning,
  }
}

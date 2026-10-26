import type { ScoreBreakdown, ScoreComponent, SlimMatchData } from './types'
import { isEarlyGame, lowSampleReason, scoringSample, stageOfRound } from './quality'
import { AXIS_CONFIG, SCORING_VERSION } from './axisConfig'
import { completionAxis, contestAxis } from './coaching'
import { boardCarryKey } from './deckType'
import { slotsUsed } from './boardSlots'

/**
 * 결정론적 점수 산출 (LLM 미사용)
 *
 * 같은 경기 데이터 → 항상 같은 점수. LLM은 이 점수를 '해설'만 한다.
 *
 * 구성 (가중 합산, 가중치·기준값은 axisConfig.json 의 metaScore):
 *  - 결과(등수)     40% : (8 - 등수) / 7 × 100
 *  - 덱 완성도      25% : 6축의 보드 완성도와 같은 공식 (충원율 × 2성 비율)
 *  - 아이템 활용    20% : 장착 아이템 수 / boardItemsMax × 100
 *  - 경합 대응      15% : 6축의 유연성(로비 수렴도 조건 점수)과 같은 공식
 *
 * v2: 2-2에 끝난 판처럼 보드가 성립하지 않은 표본은 집계에서 제외한다.
 */
export { SCORING_VERSION }

const WEIGHTS = AXIS_CONFIG.metaScore.weights

function clamp(n: number, min = 0, max = 100): number {
  return Math.min(Math.max(n, min), max)
}

export function scoreToTier(score: number): string {
  const tiers = AXIS_CONFIG.metaScore.tiers
  return (tiers.find((t) => score >= t.min) ?? tiers[tiers.length - 1]).tier
}

interface RawMetrics {
  placement: number
  units: number
  /** 보드 칸 합 (lib/boardSlots) */
  slotsUsed: number
  twoPlus: number
  three: number
  items: number
  contested: boolean
  contestScore?: number
  contestLevel?: string
  top4: boolean
  level: number
  stage: number
  /** 캐리 슬러그 — 완성도의 스테이지 기준 레벨을 6축과 같은 칸에서 찾는다 */
  carryKey: string | null
}

function readMetrics(m: SlimMatchData): RawMetrics {
  const units = m.units || []
  return {
    placement: Math.min(Math.max(m.placement || 8, 1), 8),
    units: units.length,
    slotsUsed: slotsUsed(units),
    twoPlus: units.filter((u) => (u.tier || 1) >= 2).length,
    three: units.filter((u) => u.tier === 3).length,
    items: units.reduce((sum, u) => sum + (u.items?.length || 0), 0),
    contested: Boolean(m.contestedInfo?.isContested),
    contestScore: m.contestedInfo?.contestScore,
    contestLevel: m.contestedInfo?.level,
    top4: (m.placement || 8) <= 4,
    level: m.level || 0,
    stage: stageOfRound(m.lastRound),
    carryKey: boardCarryKey(units),
  }
}

function placementScore(placement: number): number {
  return Math.round(((8 - placement) / 7) * 100)
}

/**
 * 덱 완성도: 보드가 레벨만큼 채워졌는가(충원율) × 2성 비율. (6축 completion 과 같은 공식)
 * 1유닛 3성 보드가 90점을 받던 v1의 역전을 막는다.
 */
function completionScore(r: RawMetrics): number {
  return completionAxis(r).score
}

function itemScore(r: RawMetrics): number {
  return clamp(Math.round((r.items / AXIS_CONFIG.metaScore.boardItemsMax) * 100))
}

function contestScore(r: RawMetrics): number {
  return contestAxis(r).score
}

/** 단일 경기의 결정론적 점수 */
export function computeMatchScore(m: SlimMatchData): { total: number; components: ScoreComponent[] } {
  const r = readMetrics(m)
  const comps: ScoreComponent[] = [
    {
      key: 'placement',
      label: '결과(등수)',
      weight: WEIGHTS.placement,
      score: placementScore(r.placement),
      contribution: 0,
      detail: `${r.placement}등`,
    },
    {
      key: 'completion',
      label: '덱 완성도',
      weight: WEIGHTS.completion,
      score: completionScore(r),
      contribution: 0,
      detail: `2성+ ${r.twoPlus}/${r.units} · 3성 ${r.three}`,
    },
    {
      key: 'items',
      label: '아이템 활용',
      weight: WEIGHTS.items,
      score: itemScore(r),
      contribution: 0,
      detail: `장착 아이템 ${r.items}개 (${AXIS_CONFIG.metaScore.boardItemsMax}개=100)`,
    },
    {
      key: 'contest',
      label: '경합 대응(조건)',
      weight: WEIGHTS.contest,
      score: contestScore(r),
      contribution: 0,
      detail: r.contested
        ? `경합 ${r.contestLevel ?? ''} ${r.contestScore ?? '?'}/100 · ${r.top4 ? '순방' : '하위권'}`
        : `경합 없음(유리한 조건) ${r.contestScore ?? 0}/100`,
    },
  ]
  comps.forEach((c) => {
    c.contribution = Math.round(c.weight * c.score * 10) / 10
  })
  const total = Math.round(comps.reduce((sum, c) => sum + c.contribution, 0))
  return { total, components: comps }
}

/** 여러 경기 집계 → 결정론적 점수 + 근거 분해 */
export function computeScoreBreakdown(matches: SlimMatchData[]): ScoreBreakdown | null {
  const valid = (matches || []).filter(Boolean)
  if (valid.length === 0) return null

  const early = valid.filter(isEarlyGame)
  // 초반 종료 판이 섞여 있으면 정상 경기만 집계한다. 전부 초반이면 어쩔 수 없이 전체 사용 + lowSample.
  const { sample, full } = scoringSample(valid)
  const metrics = sample.map(readMetrics)
  const per = sample.map((m) => computeMatchScore(m))
  const avg = (nums: number[]) => nums.reduce((a, b) => a + b, 0) / (nums.length || 1)
  const single = sample.length === 1

  const components: ScoreComponent[] = [
    {
      key: 'placement',
      label: '결과(등수)',
      weight: WEIGHTS.placement,
      score: Math.round(avg(per.map((p) => p.components[0].score))),
      contribution: 0,
      detail: single ? `${metrics[0].placement}등` : `평균 ${avg(metrics.map((m) => m.placement)).toFixed(2)}등`,
    },
    {
      key: 'completion',
      label: '덱 완성도',
      weight: WEIGHTS.completion,
      score: Math.round(avg(per.map((p) => p.components[1].score))),
      contribution: 0,
      detail: single
        ? `2성+ ${metrics[0].twoPlus}/${metrics[0].units} · 3성 ${metrics[0].three}`
        : `평균 2성+ ${avg(metrics.map((m) => m.twoPlus)).toFixed(1)}개 · 3성 ${metrics.reduce(
            (s, m) => s + m.three,
            0
          )}회`,
    },
    {
      key: 'items',
      label: '아이템 활용',
      weight: WEIGHTS.items,
      score: Math.round(avg(per.map((p) => p.components[2].score))),
      contribution: 0,
      detail: single ? `장착 아이템 ${metrics[0].items}개` : `평균 장착 ${avg(metrics.map((m) => m.items)).toFixed(1)}개`,
    },
    {
      key: 'contest',
      label: '경합 대응(조건)',
      weight: WEIGHTS.contest,
      score: Math.round(avg(per.map((p) => p.components[3].score))),
      contribution: 0,
      detail: `${metrics.filter((m) => m.contested).length}/${sample.length}경기 경합 · 순방 ${metrics.filter(
        (m) => m.top4
      ).length}회`,
    },
  ]
  components.forEach((c) => {
    c.contribution = Math.round(c.weight * c.score * 10) / 10
  })

  const total = Math.round(components.reduce((sum, c) => sum + c.contribution, 0))
  const lowSample = full.length === 0
  const excludedMatches = valid.length - sample.length
  const reasons = [...new Set(early.map(lowSampleReason).filter(Boolean))]
  const sampleWarning = lowSample
    ? `표본 부족: 초반 종료 경기만 있어 점수를 신뢰하기 어렵습니다${reasons.length ? ` (${reasons.join(', ')})` : ''}.`
    : excludedMatches
      ? `초반 종료 ${excludedMatches}경기는 점수 집계에서 제외했습니다${reasons.length ? ` (${reasons.join(', ')})` : ''}.`
      : undefined

  return {
    total,
    tier: scoreToTier(total),
    components,
    matches: sample.length,
    perMatch: per.map((p) => p.total),
    excludedMatches,
    lowSample,
    sampleWarning,
    version: SCORING_VERSION,
  }
}

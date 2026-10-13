import metaStatsData from './metaStats.json'
import { AugmentAnalysis, AugmentMetaDetail } from './types'

/**
 * 증강 메타 통계 조회/분석 (메타 데이터 파이프라인).
 *
 * 데이터 출처:
 *  - lib/metaStats.json (scripts/buildMetaStats.js 로 Riot 매치 표본을 집계해 생성)
 *  - 현재 파일은 sample=true 인 '샘플(검증 전)' 데이터입니다.
 *    sample=true 인 동안 UI/LLM 모두 "실측 통계로 단정 금지"로 처리합니다.
 */

interface AugmentStat {
  avgPlacement: number
  top4Rate?: number
  pickRate?: number
  sampleSize?: number
}

const AUGMENTS = (metaStatsData.augments || {}) as Record<string, AugmentStat>
const BASELINE =
  typeof metaStatsData.baselineAvgPlacement === 'number' ? metaStatsData.baselineAvgPlacement : 4.5

/** 평균 등수 → 티어 (낮을수록 좋음) */
export function tierFromAvgPlacement(avg: number): string {
  if (avg <= 3.95) return 'S'
  if (avg <= 4.15) return 'A'
  if (avg <= 4.4) return 'B'
  if (avg <= 4.65) return 'C'
  return 'D'
}

export interface MetaInfo {
  patch?: string
  source?: string
  sample: boolean
  baselineAvgPlacement: number
  augmentCount: number
}

export function getMetaInfo(): MetaInfo {
  return {
    patch: metaStatsData.patch,
    source: metaStatsData.source,
    sample: Boolean(metaStatsData.sample),
    baselineAvgPlacement: BASELINE,
    augmentCount: Object.keys(AUGMENTS).length,
  }
}

export function getAugmentStat(name: string): (AugmentStat & { tier: string }) | null {
  const stat = AUGMENTS[name]
  if (!stat) return null
  return { ...stat, tier: tierFromAvgPlacement(stat.avgPlacement) }
}

export function hasMetaStats(): boolean {
  return Object.keys(AUGMENTS).length > 0
}

/**
 * 한 경기의 증강 선택을 메타 통계와 대조해 분석한다.
 * 메타가 없으면 hasMeta=false (LLM은 단정 금지).
 */
export function analyzeAugments(augmentNames: string[]): AugmentAnalysis {
  const details: AugmentMetaDetail[] = (augmentNames || []).map((name) => {
    const stat = getAugmentStat(name)
    if (!stat) return { name }
    return {
      name,
      avgPlacement: stat.avgPlacement,
      top4Rate: stat.top4Rate,
      pickRate: stat.pickRate,
      sampleSize: stat.sampleSize,
      tier: stat.tier,
      deltaVsBaseline: Math.round((BASELINE - stat.avgPlacement) * 100) / 100,
    }
  })

  const known = details.filter((d) => typeof d.avgPlacement === 'number')
  const hasMeta = known.length > 0

  let augmentScore: number | undefined
  if (hasMeta) {
    const avg = known.reduce((s, d) => s + (d.avgPlacement as number), 0) / known.length
    // baseline 4.5 기준: 3.5 -> ~90, 4.5 -> 50, 5.5 -> ~10
    augmentScore = Math.round(Math.min(Math.max(50 + (BASELINE - avg) * 40, 0), 100))
  }

  return {
    hasMeta,
    sample: Boolean(metaStatsData.sample),
    patch: metaStatsData.patch,
    source: metaStatsData.source,
    baselineAvgPlacement: BASELINE,
    details,
    augmentScore,
  }
}

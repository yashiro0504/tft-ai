import cfg from './contestConfig.json'
import { ContestLevel } from './types'

/**
 * 경합 분석 튜닝 파라미터 (contestConfig.json 기반).
 * 실측 데이터로 재보정하려면: node scripts/tuneContest.js data/contestSamples.json --write
 */
export interface ContestConfig {
  starSensitivity: Record<string, number>
  frequencyStep: number
  traitTierWeight: number
  saturationK: number
  thresholds: { binzip: number; boTong: number; gyeonghap: number }
  coreUnitMinTier: number
  coreUnitMinItems: number
}

export const CONTEST_CONFIG = cfg as ContestConfig

/** 내 성급에 따른 경합 민감도 (1성 미완성일 때 가장 치명적) */
export function starSensitivity(tier: number): number {
  return CONTEST_CONFIG.starSensitivity[String(tier)] ?? CONTEST_CONFIG.starSensitivity.default ?? 1.0
}

/** 경합 강도 → 등급 */
export function levelFromScore(score: number): ContestLevel {
  const t = CONTEST_CONFIG.thresholds
  if (score < t.binzip) return '빈집'
  if (score < t.boTong) return '보통'
  if (score < t.gyeonghap) return '경합'
  return '심각'
}

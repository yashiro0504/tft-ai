import type { SlimMatchData } from './types'
import { AXIS_CONFIG } from './axisConfig'
import { baselineLevel } from './baselines'

/**
 * 경기 표본 품질 판정 (점수·강의·프롬프트 공용)
 *
 * TFT 매치는 2-2에 끝난 판처럼 "보드가 성립하지 않은" 표본이 섞인다.
 * 이런 판을 정상 경기와 같은 무게로 점수화하면 1유닛 3성 보드가 B등급을 받는다.
 */

/** "5-2" → 5 */
export function stageOfRound(lastRound?: string): number {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(String(lastRound || '').trim())
  return m ? Number(m[1]) : 0
}

/**
 * 탈락 스테이지의 표준 레벨 — 마스터+ 실측 중앙값 (같은 캐리 × 스테이지 → 스테이지, lib/baselines).
 * 실측 칸이 없으면 axisConfig.expectedLevelByStage (6레벨 3-2, 7레벨 4-1, 8레벨 5-1, 9레벨 6-1).
 */
export function expectedLevel(stage: number, carryKey?: string | null): number {
  return baselineLevel(stage, carryKey)
}

/** 점수/강의에 쓰기 어려운 표본인가 (초반 종료·보드 미완성) */
export function isEarlyGame(m: SlimMatchData): boolean {
  const { minStage, minUnits, minGameSec } = AXIS_CONFIG.earlyGame
  const stage = stageOfRound(m.lastRound)
  const units = m.units?.length ?? 0
  if (stage > 0 && stage < minStage) return true
  if (units < minUnits) return true
  if (m.gameLengthSec && m.gameLengthSec < minGameSec) return true
  return false
}

/** UI/프롬프트에 표시할 표본 부족 사유 */
export function lowSampleReason(m: SlimMatchData): string {
  const { minStage, minUnits, minGameSec } = AXIS_CONFIG.earlyGame
  const stage = stageOfRound(m.lastRound)
  if (stage > 0 && stage < minStage) return `${m.lastRound} 초반 종료`
  if ((m.units?.length ?? 0) < minUnits) return `보드 ${m.units?.length ?? 0}유닛`
  if (m.gameLengthSec && m.gameLengthSec < minGameSec) return `${Math.round(m.gameLengthSec / 60)}분 종료`
  return ''
}

/** 점수·강의에 쓸 표본: 초반 종료 판을 뺀 정상 경기. 전부 초반이면 어쩔 수 없이 전체를 쓴다. */
export function scoringSample(matches: SlimMatchData[]): { sample: SlimMatchData[]; full: SlimMatchData[] } {
  const full = matches.filter((m) => !isEarlyGame(m))
  return { sample: full.length ? full : matches, full }
}

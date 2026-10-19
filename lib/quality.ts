import type { SlimMatchData } from './types'

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

/** 스테이지별 표준 레벨 (6레벨 3-2, 7레벨 4-1, 8레벨 5-1, 9레벨 6-1 기준) */
export function expectedLevel(stage: number): number {
  if (stage <= 1) return 4
  if (stage === 2) return 5
  if (stage === 3) return 6
  if (stage === 4) return 7
  if (stage === 5) return 8
  return 9
}

/** 점수/강의에 쓰기 어려운 표본인가 (초반 종료·보드 미완성) */
export function isEarlyGame(m: SlimMatchData): boolean {
  const stage = stageOfRound(m.lastRound)
  const units = m.units?.length ?? 0
  if (stage > 0 && stage < 3) return true
  if (units < 4) return true
  if (m.gameLengthSec && m.gameLengthSec < 15 * 60) return true
  return false
}

/** UI/프롬프트에 표시할 표본 부족 사유 */
export function lowSampleReason(m: SlimMatchData): string {
  const stage = stageOfRound(m.lastRound)
  if (stage > 0 && stage < 3) return `${m.lastRound} 초반 종료`
  if ((m.units?.length ?? 0) < 4) return `보드 ${m.units?.length ?? 0}유닛`
  if (m.gameLengthSec && m.gameLengthSec < 15 * 60) return `${Math.round(m.gameLengthSec / 60)}분 종료`
  return ''
}

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

/**
 * 초반 종료: 탈락 라운드로만 판정한다 (minStage 스테이지 전 탈락). 보드 기물이 적다는 이유만으로는 초반 종료가 아니다 —
 * 6-2 2등 판이 기물 3개로 잡혀 "초반 종료"로 빠졌다 (2026-10-28). 라운드 정보가 없을 때만 게임 길이로 본다.
 */
export function isEarlyExit(m: SlimMatchData): boolean {
  const { minStage, minGameSec } = AXIS_CONFIG.earlyGame
  const stage = stageOfRound(m.lastRound)
  if (stage > 0) return stage < minStage
  return Boolean(m.gameLengthSec && m.gameLengthSec < minGameSec)
}

/** 보드 데이터 불완전: 늦게 끝났는데 최종 보드 기물이 minUnits 개 미만으로 잡힌 판 (Riot 데이터 누락 등) */
export function isIncompleteBoard(m: SlimMatchData): boolean {
  return !isEarlyExit(m) && (m.units?.length ?? 0) < AXIS_CONFIG.earlyGame.minUnits
}

/** 표본에서 빼는 사유 — 'early'(초반 종료) · 'incomplete'(보드 데이터 불완전) · null(정상) */
export function sampleIssue(m: SlimMatchData): 'early' | 'incomplete' | null {
  if (isEarlyExit(m)) return 'early'
  if (isIncompleteBoard(m)) return 'incomplete'
  return null
}

/**
 * 점수/강의에 쓰기 어려운 표본인가 (초반 종료 또는 보드 데이터 불완전).
 * 이름은 예전 그대로지만 두 사유를 모두 포함한다 — 사유 구분은 sampleIssue · lowSampleReason.
 */
export function isEarlyGame(m: SlimMatchData): boolean {
  return sampleIssue(m) !== null
}

/** UI/프롬프트에 표시할 표본 부족 사유 */
export function lowSampleReason(m: SlimMatchData): string {
  const issue = sampleIssue(m)
  if (issue === 'early') {
    const stage = stageOfRound(m.lastRound)
    if (stage > 0) return `${m.lastRound} 초반 종료`
    return `${Math.round((m.gameLengthSec ?? 0) / 60)}분 초반 종료`
  }
  if (issue === 'incomplete') return `보드 데이터 불완전 (${m.lastRound} 종료 · 기물 ${m.units?.length ?? 0}개만 잡힘)`
  return ''
}

/** 제외 경기 요약 문구 (예: "초반 종료 1경기 · 보드 데이터 불완전 1경기") */
export function excludedSummary(matches: SlimMatchData[], unit = '경기'): string {
  const early = matches.filter((m) => sampleIssue(m) === 'early').length
  const incomplete = matches.filter((m) => sampleIssue(m) === 'incomplete').length
  return [early ? `초반 종료 ${early}${unit}` : '', incomplete ? `보드 데이터 불완전 ${incomplete}${unit}` : ''].filter(Boolean).join(' · ')
}

/** 점수·강의에 쓸 표본: 초반 종료 판을 뺀 정상 경기. 전부 초반이면 어쩔 수 없이 전체를 쓴다. */
export function scoringSample(matches: SlimMatchData[]): { sample: SlimMatchData[]; full: SlimMatchData[] } {
  const full = matches.filter((m) => !isEarlyGame(m))
  return { sample: full.length ? full : matches, full }
}

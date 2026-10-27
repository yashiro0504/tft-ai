import type { SlimMatchData } from './types'
import { CURRENT_SET } from './gameFacts'

/**
 * 분석 대상 판 고르기 — 현재 세트의 랭크 게임만 분석한다 (클라이언트·서버 공용, lite 게임 데이터만 읽는다).
 *
 * Riot TFT 매치 ID 목록 API 는 큐·세트로 거를 수 없어서 최근 N판에 일반·초고속·더블 업·이벤트 판과
 * 지난 시즌 판이 섞여 온다. 목록에는 모드·시즌과 함께 보여 주고, 점수·습관·목표·덱 성적표·AI 분석은
 * 현재 세트 랭크 판만 쓴다 (비교 대상인 메타 통계가 현재 세트 랭크 판이고, 이벤트 모드·지난 세트는 규칙과 기물이 다르다).
 */
export const RANKED_QUEUE_ID = 1100

const QUEUE_LABEL: Record<number, string> = {
  1100: '랭크 게임',
  1090: '일반 게임',
  1130: '초고속 모드',
  1160: '더블 업',
}

/** 큐 id → 화면 이름. 표에 없는 큐는 기간 한정 이벤트 모드다 (예전엔 '랭크 게임'으로 잘못 나왔다) */
export function queueLabel(queueId: number | null | undefined): string {
  return (queueId != null && QUEUE_LABEL[queueId]) || '이벤트·기타 모드'
}

/** 랭크 판인가. queueId 가 없는 예전 데이터(데모 포함)는 화면 이름으로 판단한다 */
export function isRankedMatch(m: Pick<SlimMatchData, 'queueId' | 'queueType'>): boolean {
  if (m.queueId != null) return m.queueId === RANKED_QUEUE_ID
  return (m.queueType ?? '랭크 게임') === '랭크 게임'
}

/** 현재 세트 판인가. 세트 번호가 없는 판은 현재 세트로 본다 */
export function isCurrentSetMatch(m: Pick<SlimMatchData, 'setNumber'>): boolean {
  return m.setNumber == null || m.setNumber === CURRENT_SET
}

type MatchKind = Pick<SlimMatchData, 'queueId' | 'queueType' | 'setNumber'>

/** 분석에 쓰는 판인가: 현재 세트 랭크 */
export function isAnalyzableMatch(m: MatchKind): boolean {
  return isRankedMatch(m) && isCurrentSetMatch(m)
}

/** 분석에 쓰는 판: 현재 세트 랭크만 */
export function analyzableMatches<T extends MatchKind>(matches: T[]): T[] {
  return (matches || []).filter(isAnalyzableMatch)
}

export interface MatchBreakdown {
  total: number
  /** 분석 대상 (현재 세트 랭크) */
  analyzed: number
  /** 현재 세트의 일반·초고속·더블 업·이벤트 판 */
  otherQueue: number
  /** 다른 세트 판 (모드 무관) */
  previousSet: number
}

/** 불러온 판을 분석 대상 · 다른 모드 · 이전 시즌으로 나눠 센다 (화면의 경기 수 표기를 한 기준으로) */
export function matchBreakdown(matches: MatchKind[]): MatchBreakdown {
  const list = matches || []
  const previousSet = list.filter((m) => !isCurrentSetMatch(m)).length
  const analyzed = list.filter(isAnalyzableMatch).length
  return { total: list.length, analyzed, otherQueue: list.length - previousSet - analyzed, previousSet }
}

/** 분석에서 뺀 판 설명 (예: "일반·이벤트 1판 · 이전 시즌 2판"). 뺀 판이 없으면 빈 문자열 */
export function excludedLabel(b: MatchBreakdown): string {
  return [b.otherQueue ? `일반·이벤트 ${b.otherQueue}판` : '', b.previousSet ? `이전 시즌 ${b.previousSet}판` : '']
    .filter(Boolean)
    .join(' · ')
}

import type { SlimMatchData } from './types'

/**
 * 게임 모드(큐) — 분석은 랭크 게임만 한다 (클라이언트·서버 공용, 데이터 import 없음).
 *
 * Riot TFT 매치 ID 목록 API 는 큐로 거를 수 없어서 최근 N판에 일반·초고속·더블 업·이벤트 판이 섞여 온다.
 * 목록에는 모드 이름과 함께 보여 주고, 점수·습관·목표·덱 성적표·AI 분석은 랭크 판만 쓴다
 * (비교 대상인 메타 통계가 랭크 판이고, 이벤트 모드는 규칙이 다르다).
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

/** 분석에 쓰는 판: 랭크만 */
export function rankedMatches<T extends Pick<SlimMatchData, 'queueId' | 'queueType'>>(matches: T[]): T[] {
  return (matches || []).filter(isRankedMatch)
}

/**
 * 경기 경과 시간 ("N분 전 / N시간 전 / N일 전") — 화면에 그릴 때마다 현재 시각으로 계산한다.
 * 캐시·응답에는 경기 시각(gameDatetime, ms)만 둔다: 문자열을 캐시하면 이틀 뒤에도 "19시간 전"이 남았다 (2026-10-28).
 *
 * 계산 기준 (docs/MATCH-TIME.md): 경기 종료 시각(Riot game_datetime)과 지금의 타임스탬프 차이만 쓴다 — 달력 날짜·시간대 무관.
 * 각 단위는 반올림하고, 44분까지 분 · 21시간까지 시간 · 그 뒤로 일 (moment/dayjs fromNow 와 같은 경계).
 * 24시간 단위 내림이던 2026-10-28 16시엔 새벽 경기 10판이 lolchess 보다 모두 하루 적었다 (2.56일 → 내림 2 · lolchess 3).
 * 클라이언트 공용 (의존성 없음).
 */
export function formatTimeAgo(timestamp: number, now: number = Date.now()): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '최근'
  const diff = Math.max(0, now - timestamp)
  const mins = Math.round(diff / MINUTE)
  if (mins < TIME_AGO_MINUTES_UNTIL) return `${Math.max(mins, 1)}분 전`
  const hours = Math.round(diff / HOUR)
  if (hours < TIME_AGO_HOURS_UNTIL) return `${Math.max(hours, 1)}시간 전`
  return `${Math.max(Math.round(diff / DAY), 1)}일 전`
}

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
/** 반올림한 분이 이 값 미만이면 분 (44분까지), 반올림한 시간이 이 값 미만이면 시간 (21시간까지) */
export const TIME_AGO_MINUTES_UNTIL = 45
export const TIME_AGO_HOURS_UNTIL = 22

/** 경기 목록 정렬: 경기 시각 최신순 (같은 시각이면 원래 순서) */
export function sortByRecent<T extends { gameDatetime?: number }>(matches: T[]): T[] {
  return matches
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (b.m.gameDatetime || 0) - (a.m.gameDatetime || 0) || a.i - b.i)
    .map((x) => x.m)
}

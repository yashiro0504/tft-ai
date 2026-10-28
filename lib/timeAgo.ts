/**
 * 경기 경과 시간 ("N분 전 / N시간 전 / N일 전") — 화면에 그릴 때마다 현재 시각으로 계산한다.
 * 캐시·응답에는 경기 시각(gameDatetime, ms)만 둔다: 문자열을 캐시하면 이틀 뒤에도 "19시간 전"이 남았다 (2026-10-28).
 * 클라이언트 공용 (의존성 없음).
 */
export function formatTimeAgo(timestamp: number, now: number = Date.now()): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '최근'
  const diffMins = Math.floor(Math.max(0, now - timestamp) / (1000 * 60))
  if (diffMins < 60) return `${Math.max(diffMins, 1)}분 전`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}시간 전`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}일 전`
}

/** 경기 목록 정렬: 경기 시각 최신순 (같은 시각이면 원래 순서) */
export function sortByRecent<T extends { gameDatetime?: number }>(matches: T[]): T[] {
  return matches
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (b.m.gameDatetime || 0) - (a.m.gameDatetime || 0) || a.i - b.i)
    .map((x) => x.m)
}

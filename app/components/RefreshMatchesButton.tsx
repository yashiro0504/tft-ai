'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

/** "방금 전 / N분 전 / N시간 전" (클라이언트 전용 — 서버 렌더와 시각이 달라질 수 있음) */
function formatUpdatedAgo(fetchedAt: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - fetchedAt) / 1000))
  if (sec < 60) return '방금 전'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}분 전`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}시간 전`
  return `${Math.floor(hour / 24)}일 전`
}

/**
 * 전적 갱신 버튼 + 최근 업데이트 시각.
 * 서버가 알려준 refreshAvailableAt 전까지는 남은 시간을 보여주고 버튼을 잠근다.
 */
export function RefreshMatchesButton({
  fetchedAt,
  refreshAvailableAt,
  refreshing,
  onRefresh,
}: {
  fetchedAt?: number
  refreshAvailableAt?: number
  refreshing: boolean
  onRefresh: () => void
}) {
  const [now, setNow] = useState(() => Date.now())

  // 쿨다운 중에는 1초, 그 외에는 30초마다 표시를 갱신한다.
  const cooling = Boolean(refreshAvailableAt && refreshAvailableAt > now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), cooling ? 1000 : 30_000)
    return () => clearInterval(id)
  }, [cooling])

  const waitSec = cooling && refreshAvailableAt ? Math.ceil((refreshAvailableAt - now) / 1000) : 0
  const waitLabel = waitSec >= 60 ? `${Math.floor(waitSec / 60)}:${String(waitSec % 60).padStart(2, '0')}` : `${waitSec}초`

  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing || cooling}
        title={cooling ? '같은 소환사는 2분에 한 번 갱신할 수 있어요' : 'Riot 서버에서 최근 전적을 다시 불러옵니다'}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-control bg-accent px-3 py-2 text-sm font-bold text-on-accent transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
        {refreshing ? '갱신 중...' : cooling ? `${waitLabel} 후 갱신` : '전적 갱신'}
      </button>
      {fetchedAt ? (
        <span className="text-xs text-subtle" aria-live="polite">
          최근 업데이트 {formatUpdatedAgo(fetchedAt, now)}
        </span>
      ) : null}
    </div>
  )
}

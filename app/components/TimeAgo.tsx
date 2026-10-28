'use client'

import { useEffect, useState } from 'react'
import { formatTimeAgo } from '@/lib/timeAgo'

/**
 * 경기 경과 시간 — 현재 시각 기준으로 그리고 1분마다 다시 계산한다 (lib/timeAgo).
 * 서버 렌더와 브라우저 시각이 몇 초 다를 수 있어 첫 그림의 불일치 경고는 끈다.
 */
export function TimeAgo({ timestamp }: { timestamp?: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  if (!timestamp) return <>최근</>
  return (
    <time dateTime={new Date(timestamp).toISOString()} title={new Date(timestamp).toLocaleString('ko-KR')} suppressHydrationWarning>
      {formatTimeAgo(timestamp, now)}
    </time>
  )
}

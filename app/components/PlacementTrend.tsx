'use client'

import { useEffect, useRef, useState } from 'react'
import type { SlimMatchData } from '@/lib/types'

/**
 * 최근 경기 등수 흐름 (단일 시리즈 꺾은선).
 * - 위로 갈수록 좋은 등수 (1등이 위, 8등이 아래)
 * - 1~4등 구간은 옅은 띠로 표시, 평균 등수는 점선
 * - 마우스를 올리면 가장 가까운 경기에 세로선 + 툴팁
 */
const H = 184
const PAD = { top: 14, right: 14, bottom: 26, left: 30 }

export function PlacementTrend({ matches }: { matches: SlimMatchData[] }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(320)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 검색 결과는 최근 경기가 먼저 → 왼쪽이 오래된 경기가 되도록 뒤집는다
  const data = [...matches].reverse()
  if (!data.length) return null

  const plotW = width - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (data.length === 1 ? plotW / 2 : (i * plotW) / (data.length - 1))
  const y = (p: number) => PAD.top + ((p - 1) / 7) * plotH
  const avg = data.reduce((s, m) => s + m.placement, 0) / data.length

  const path = data.map((m, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(m.placement).toFixed(1)}`).join(' ')

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left + PAD.left
    let best = 0
    for (let i = 1; i < data.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i
    setHover(best)
  }

  const h = hover != null ? data[hover] : null
  const tipLeft = hover != null ? Math.min(Math.max(x(hover) - 70, 0), width - 140) : 0

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={`최근 ${data.length}경기 등수 흐름. 평균 ${avg.toFixed(1)}등. 오래된 경기부터 ${data
          .map((m) => `${m.placement}등`)
          .join(', ')}`}
        className="block overflow-visible"
      >
        {/* 1~4등 구간 */}
        <rect x={PAD.left} y={y(1) - 6} width={plotW} height={y(4.5) - y(1) + 6} fill="var(--surface-2)" opacity={0.6} rx={6} />
        {[1, 4, 8].map((p) => (
          <g key={p}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(p)} y2={y(p)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(p) + 4} textAnchor="end" fontSize={12} fill="var(--text-3)">
              {p}
            </text>
          </g>
        ))}
        {/* 평균 */}
        <line
          x1={PAD.left}
          x2={PAD.left + plotW}
          y1={y(avg)}
          y2={y(avg)}
          stroke="var(--text-3)"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <text x={PAD.left + plotW} y={y(avg) - 6} textAnchor="end" fontSize={12} fill="var(--text-2)">
          평균 {avg.toFixed(1)}등
        </text>

        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {hover != null ? (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top - 6} y2={PAD.top + plotH} stroke="var(--text-3)" strokeWidth={1} />
        ) : null}

        {data.map((m, i) => (
          <circle
            key={m.matchId || i}
            cx={x(i)}
            cy={y(m.placement)}
            r={hover === i ? 6 : 4.5}
            fill="var(--accent)"
            stroke="var(--surface)"
            strokeWidth={2}
          />
        ))}

        <text x={PAD.left} y={H - 6} fontSize={12} fill="var(--text-3)">
          오래된 경기
        </text>
        <text x={PAD.left + plotW} y={H - 6} textAnchor="end" fontSize={12} fill="var(--text-3)">
          최근
        </text>

        {/* 마우스 영역 (가장 가까운 경기로 스냅) */}
        <rect
          x={PAD.left - 10}
          y={0}
          width={plotW + 20}
          height={H - PAD.bottom}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      {h ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-0 z-10 w-[140px] rounded-control border border-line bg-panel px-3 py-2 text-xs shadow-card"
          style={{ left: tipLeft }}
        >
          <p className="font-bold text-ink">{h.placement}등</p>
          <p className="text-muted">
            {h.timeAgo || '최근'} · Lv.{h.level}
          </p>
          <p className="text-subtle">{h.lastRound} 라운드</p>
        </div>
      ) : null}
    </div>
  )
}

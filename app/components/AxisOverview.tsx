'use client'

import { useMemo } from 'react'
import { buildCoachingPlan } from '@/lib/coaching'
import type { CoachingAxisKey, SlimMatchData } from '@/lib/types'

/**
 * 6축 진단 개요 (AI 미사용 — lib/coaching.ts 가 경기 데이터로 계산한 점수).
 * 레이더는 전체 모양, 막대는 정확한 점수를 보여준다.
 */
const SHORT: Record<CoachingAxisKey, string> = {
  economy: '경제',
  itemization: '아이템',
  tempo: '템포',
  completion: '완성도',
  synergy: '시너지',
  contest: '수렴도',
}

const SIZE = 200
const C = SIZE / 2
const R = 64

function point(i: number, ratio: number) {
  const a = ((-90 + i * 60) * Math.PI) / 180
  return [C + Math.cos(a) * R * ratio, C + Math.sin(a) * R * ratio] as const
}

export function AxisOverview({ matches }: { matches: SlimMatchData[] }) {
  const plan = useMemo(() => buildCoachingPlan(matches), [matches])
  if (!plan.matchCount) return null

  const poly = plan.axes.map((a, i) => point(i, Math.max(a.score, 4) / 100).join(',')).join(' ')

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`6축 진단: ${plan.axes.map((a) => `${a.label} ${a.score}점`).join(', ')}`}
        className="shrink-0"
      >
        {[0.25, 0.5, 0.75, 1].map((r) => (
          <polygon
            key={r}
            points={plan.axes.map((_, i) => point(i, r).join(',')).join(' ')}
            fill="none"
            stroke="var(--border)"
            strokeWidth={1}
          />
        ))}
        {plan.axes.map((_, i) => {
          const [px, py] = point(i, 1)
          return <line key={i} x1={C} y1={C} x2={px} y2={py} stroke="var(--border)" strokeWidth={1} />
        })}
        <polygon points={poly} fill="var(--accent)" fillOpacity={0.18} stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        {plan.axes.map((a, i) => {
          const [px, py] = point(i, Math.max(a.score, 4) / 100)
          return <circle key={a.key} cx={px} cy={py} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
        })}
        {plan.axes.map((a, i) => {
          const [lx, ly] = point(i, 1.32)
          return (
            <text
              key={a.key}
              x={lx}
              y={ly + 4}
              textAnchor="middle"
              fontSize={12}
              fontWeight={a.key === plan.focus ? 700 : 500}
              fill={a.key === plan.focus ? 'var(--accent)' : 'var(--text-2)'}
            >
              {SHORT[a.key]}
            </text>
          )
        })}
      </svg>

      <ul className="min-w-[220px] flex-1 space-y-2">
        {plan.axes.map((a) => (
          <li key={a.key} title={a.detail}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5 text-ink">
                {a.label}
                {a.key === plan.focus ? (
                  <span className="rounded-chip bg-accent-bg px-1.5 py-0.5 text-xs font-semibold text-accent">보완 1순위</span>
                ) : null}
              </span>
              <span className="font-bold text-ink">{a.score}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(a.score, 2)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

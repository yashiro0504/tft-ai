'use client'

import { useMemo } from 'react'
import { habitPatterns, HABIT_MIN_MATCHES } from '@/lib/habits'
import type { SlimMatchData } from '@/lib/types'

/**
 * 최근 경기 반복 습관 (AI 미사용 — lib/habits 가 경기마다 핵심 장면을 세어 반복된 것만 남긴다).
 * 종합 AI 분석은 이 습관들의 '왜·다음엔'을 해설한다.
 */
export function HabitOverview({ matches }: { matches: SlimMatchData[] }) {
  const habits = useMemo(() => habitPatterns(matches), [matches])
  if (matches.length < HABIT_MIN_MATCHES) return null

  return (
    <div>
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted">
        반복 습관
        <span className="rounded-chip border border-line px-1.5 py-0.5 text-xs font-medium text-subtle">
          최근 {matches.length}경기 · AI 미사용
        </span>
      </p>
      {habits.length ? (
        <ul className="space-y-2">
          {habits.map((h) => (
            <li key={h.kind} className="rounded-control border border-line bg-sunken px-3 py-2 text-xs leading-relaxed">
              <p className="font-semibold text-ink">
                {h.title} <span className="font-normal text-subtle">· {h.count}/{h.of}판</span>
              </p>
              <p className="mt-0.5 text-muted">{h.fact.replace(/^\d+\/\d+판: /, '')}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-subtle">여러 판에 반복된 장면이 없습니다 (한두 판에만 나온 장면은 경기 카드에서 확인하세요).</p>
      )}
    </div>
  )
}

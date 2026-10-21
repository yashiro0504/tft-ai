'use client'

import { useMemo } from 'react'
import { Target } from 'lucide-react'
import { evaluateGoal, goalStorageKey, goalText } from '@/lib/goals'
import { useGoal } from '@/lib/useGoal'
import type { SlimMatchData } from '@/lib/types'

/**
 * 연습 목표 진행 (AI 미사용). AI 리포트의 '이 목표 추적하기'로 정한 목표를, 설정 이후 경기로 코드가 채점한다.
 * 목표는 이 브라우저에만 저장된다 (lib/useGoal).
 */
export function GoalTracker({ gameName, tagLine, matches }: { gameName: string; tagLine: string; matches: SlimMatchData[] }) {
  const { goal, clearGoal } = useGoal(goalStorageKey(gameName, tagLine))
  const progress = useMemo(() => (goal ? evaluateGoal(goal, matches) : null), [goal, matches])
  if (!goal || !progress) return null

  const left = goal.games - progress.games.length
  return (
    <div className="rounded-card border border-accent/30 bg-accent-bg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Target className="h-4 w-4 text-accent" /> 연습 목표: {goalText(goal)}
        </p>
        <button type="button" onClick={clearGoal} className="text-xs text-muted underline hover:text-ink">
          {progress.done ? '목표 지우기' : '그만두기'}
        </button>
      </div>
      <p className="mt-0.5 text-xs text-subtle">
        출처: {goal.source} · 설정 전 {goal.baseline}
        {goal.unit} · 설정 이후 {goal.games}판으로 채점
      </p>

      <ol className="mt-3 flex flex-wrap gap-2" aria-label="목표 채점 경기">
        {Array.from({ length: goal.games }, (_, i) => {
          const g = progress.games[i]
          return (
            <li
              key={i}
              className={`min-w-[84px] rounded-control border px-2.5 py-1.5 text-xs ${
                !g ? 'border-line bg-panel text-subtle' : g.ok ? 'border-good/50 bg-good/10 text-ink' : 'border-bad/50 bg-bad/10 text-ink'
              }`}
            >
              {g ? (
                <>
                  <span className="font-semibold">{g.ok ? '달성' : '미달'}</span> · {g.value}
                  {goal.unit}
                  <span className="block text-subtle">{g.placement}등</span>
                </>
              ) : (
                <>
                  {i + 1}번째 판
                  <span className="block">대기 중</span>
                </>
              )}
            </li>
          )
        })}
      </ol>

      <p className="mt-2 text-xs text-muted">
        {progress.done
          ? `${goal.games}판 중 ${progress.achieved}판 달성 · 평균 ${goal.baseline}${goal.unit} → ${progress.average}${goal.unit}`
          : progress.games.length
            ? `${progress.games.length}/${goal.games}판 진행 · 지금까지 ${progress.achieved}판 달성 (남은 ${left}판은 다음 경기 후 전적을 새로 불러오면 채점됩니다)`
            : '설정 이후 끝난 경기가 아직 없습니다. 다음 경기 후 전적을 새로 불러오면 채점됩니다.'}
      </p>
    </div>
  )
}

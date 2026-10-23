'use client'

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'

/**
 * 종합 분석 대기 표시. Pro 추론 리포트는 20~30초 걸리므로 경과 시간에 따라 단계 문구를 바꿔
 * 멈춘 것처럼 보이지 않게 한다. (실제 서버 진행률이 아니라 경과 시간 기준)
 */
const STAGES: Array<{ at: number; text: string }> = [
  { at: 0, text: '경기 데이터와 메타 통계를 정리하는 중...' },
  { at: 4, text: 'AI 코치가 판별 흐름을 깊게 분석하는 중... (보통 20~30초)' },
  { at: 18, text: '아이템·시너지·운영 근거를 맞춰 보는 중...' },
  { at: 30, text: '거의 다 됐어요. 사실 검증을 마무리하는 중...' },
]

export function OverviewProgress() {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const startedAt = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])

  const stage = [...STAGES].reverse().find((s) => elapsed >= s.at) ?? STAGES[0]
  // 30초 기준으로 차오르다 95% 에서 멈춘다 (완료 전에 꽉 차지 않게)
  const percent = Math.min(95, Math.round((elapsed / 30) * 95))

  return (
    <div className="mt-4 rounded-control border border-line bg-panel p-4" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-ink">
        <Sparkles className="h-4 w-4 shrink-0 animate-pulse text-accent" aria-hidden="true" />
        <span>{stage.text}</span>
        <span className="ml-auto text-xs tabular-nums text-subtle">{elapsed}초</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-accent transition-all duration-1000" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

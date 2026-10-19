'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'
import { FREE_ANALYSIS_LIMIT } from '@/lib/useQuota'
import { track } from '@/lib/analytics'

const PRO_BENEFITS = ['하루 분석 횟수 확대', '최근 10경기 종합 분석', '분석 기록 저장']

/**
 * 하루 무료 분석 한도 도달 안내 (전환 지시서 단계 2).
 * 기본 버튼은 Pro 출시 알림(현재 /pro 페이지)으로 연결한다. 단계 4에서 이메일 입력으로 교체 예정.
 */
export function LimitModal({
  open,
  onClose,
  scope,
}: {
  open: boolean
  onClose: () => void
  /** 어떤 분석에서 한도에 걸렸는지 (이벤트 기록용) */
  scope: 'match' | 'overview'
}) {
  const router = useRouter()
  const primaryRef = useRef<HTMLButtonElement | null>(null)
  // 부모가 다시 렌더링되어도 포커스가 튀지 않도록 열릴 때만 효과를 건다.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    track('limit_reached', { scope, limit: FREE_ANALYSIS_LIMIT })
    primaryRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // scope 는 열릴 때의 값만 기록한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="limit-modal-title"
        className="relative w-full max-w-md rounded-card border border-line bg-panel p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="absolute right-3 top-3 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-control text-muted transition hover:bg-sunken hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 id="limit-modal-title" className="pr-8 text-xl font-bold text-ink">
          오늘 무료 분석 {FREE_ANALYSIS_LIMIT}회를 모두 사용했어요
        </h2>
        <p className="mt-2 text-sm text-muted">내일 오전 0시(한국 시간)에 다시 {FREE_ANALYSIS_LIMIT}회가 채워져요.</p>

        <ul className="mt-4 space-y-2 rounded-control border border-line bg-sunken p-4">
          {PRO_BENEFITS.map((b) => (
            <li key={b} className="flex items-center gap-2 text-sm text-ink">
              <Check className="h-4 w-4 shrink-0 text-accent" />
              <span>{b}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-control border border-line bg-sunken px-4 py-2 text-sm font-bold text-ink transition hover:border-accent"
          >
            닫기
          </button>
          <button
            ref={primaryRef}
            type="button"
            onClick={() => {
              track('pro_waitlist_click', { surface: 'limit_modal', scope })
              onClose()
              router.push('/pro')
            }}
            className="cursor-pointer rounded-control bg-accent px-4 py-2 text-sm font-bold text-on-accent transition hover:opacity-90"
          >
            Pro 출시 알림 받기
          </button>
        </div>
      </div>
    </div>
  )
}

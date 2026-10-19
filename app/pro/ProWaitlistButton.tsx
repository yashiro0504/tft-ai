'use client'

import { useEffect, useState } from 'react'
import { Bell, Check, Sparkles } from 'lucide-react'
import { track } from '@/lib/analytics'

const STORAGE_KEY = 'tftlab:pro-waitlist'

/**
 * Pro 출시 알림(대기자) 버튼.
 *
 * 결제/이메일 수집은 하지 않는다. 클릭 1회를 `pro_waitlist_click` 이벤트로만 집계하고,
 * 같은 브라우저에서 중복 클릭하지 않도록 localStorage 플래그를 둔다.
 * (localStorage 차단 환경에서는 세션 내 상태로만 동작한다.)
 */
export function ProWaitlistButton() {
  const [joined, setJoined] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') setJoined(true)
    } catch {
      /* localStorage 차단 환경 무시 */
    }
  }, [])

  const join = () => {
    if (joined) return
    track('pro_waitlist_click', {
      surface: 'pro_page',
      priceKrw: 3900,
      billing: 'monthly',
    })
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* 저장 실패해도 UI 는 완료 상태로 전환 */
    }
    setJoined(true)
  }

  return (
    <div>
      <button
        type="button"
        onClick={join}
        disabled={joined}
        aria-describedby="pro-waitlist-note"
        className={`mt-5 inline-flex w-full items-center justify-center gap-2 rounded-control px-4 py-3 text-sm font-black transition ${
          joined
            ? 'cursor-default border border-good/30 bg-good/10 text-good'
            : 'cursor-pointer bg-accent text-on-accent hover:opacity-90'
        }`}
      >
        {joined ? (
          <>
            <Check className="h-4 w-4" />
            <span>알림 신청 완료</span>
          </>
        ) : (
          <>
            <Bell className="h-4 w-4" />
            <span>Pro 출시 알림 받기</span>
            <Sparkles className="h-3.5 w-3.5 opacity-70" />
          </>
        )}
      </button>

      <p
        id="pro-waitlist-note"
        aria-live="polite"
        className="mt-2.5 text-xs leading-relaxed text-subtle"
      >
        {joined
          ? '관심 신호가 접수되었습니다. 정식 출시 시 사이트 공지로 가장 먼저 안내드릴게요.'
          : '이메일·결제 정보는 받지 않습니다. 클릭 한 번으로 관심만 집계합니다.'}
      </p>
    </div>
  )
}

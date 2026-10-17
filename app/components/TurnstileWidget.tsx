'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Cloudflare Turnstile 위젯 (explicit render).
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY` 가 없으면 아무것도 렌더링하지 않는다(로컬 개발용).
 */
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''

interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string
  reset: (widgetId?: string) => void
  remove: (widgetId?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
    onTurnstileLoad?: () => void
  }
}

export function TurnstileWidget({
  onToken,
  resetSignal = 0,
}: {
  onToken: (token: string | null) => void
  resetSignal?: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!SITE_KEY) return
    const container = containerRef.current
    if (!container) return
    let cancelled = false

    const renderWidget = () => {
      if (cancelled || widgetIdRef.current || !window.turnstile) return
      widgetIdRef.current = window.turnstile.render(container, {
        sitekey: SITE_KEY,
        theme: 'auto',
        size: 'flexible',
        callback: (token: string) => onToken(token),
        'expired-callback': () => onToken(null),
        'error-callback': () => {
          setFailed(true)
          onToken(null)
        },
      })
      setReady(true)
    }

    if (window.turnstile) {
      renderWidget()
    } else {
      const scriptId = 'cf-turnstile-script'
      const existing = document.getElementById(scriptId) as HTMLScriptElement | null

      window.onTurnstileLoad = renderWidget

      if (existing) {
        existing.addEventListener('load', renderWidget)
      } else {
        const script = document.createElement('script')
        script.id = scriptId
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit'
        script.async = true
        script.defer = true
        script.onerror = () => setFailed(true)
        document.head.appendChild(script)
      }
    }

    return () => {
      cancelled = true
      const id = widgetIdRef.current
      if (id && window.turnstile) window.turnstile.remove(id)
      widgetIdRef.current = null
    }
  }, [onToken])

  // 토큰은 1회용이므로 요청 후 부모가 resetSignal 을 증가시켜 위젯을 초기화한다.
  useEffect(() => {
    if (resetSignal <= 0) return
    const id = widgetIdRef.current
    if (id && window.turnstile) window.turnstile.reset(id)
    onToken(null)
  }, [resetSignal, onToken])

  if (!SITE_KEY) return null

  return (
    <div className="min-h-[65px]">
      <div ref={containerRef} />
      {!ready && !failed ? <p className="text-[11px] text-muted">로봇 확인 로딩 중…</p> : null}
      {failed ? (
        <p className="text-[11px] font-semibold text-rose-400">
          로봇 확인을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.
        </p>
      ) : null}
    </div>
  )
}

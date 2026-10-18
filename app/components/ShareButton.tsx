'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { track } from '@/lib/analytics'

/** 공유 대상 분류 (경로에 Riot ID 가 들어가므로 원문 경로는 전송하지 않는다) */
function shareTarget(path: string): 'deck' | 'profile' | 'other' {
  if (path.startsWith('/deck/')) return 'deck'
  if (path.startsWith('/profile/')) return 'profile'
  return 'other'
}

/** 현재 오리진 기준 절대 URL 을 클립보드에 복사한다. */
export function ShareButton({
  path,
  label = '링크 복사',
  surface = 'unknown',
}: {
  path: string
  label?: string
  /** 어느 화면에서 눌렀는지 (집계용) */
  surface?: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    const url = typeof window === 'undefined' ? path : new URL(path, window.location.origin).toString()

    track('share_click', { surface, target: shareTarget(path) })

    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // 클립보드 권한이 없을 때의 폴백
      const textarea = document.createElement('textarea')
      textarea.value = url
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      try {
        document.execCommand('copy')
      } catch {
        window.prompt('아래 링크를 복사하세요', url)
      }
      document.body.removeChild(textarea)
    }

    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-line/15 bg-elev/5 px-3.5 py-2 text-xs font-bold text-muted transition hover:border-cyan-400/40 hover:text-ink"
      aria-label="전적 페이지 링크 복사"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      <span>{copied ? '복사됨' : label}</span>
    </button>
  )
}

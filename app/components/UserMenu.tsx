'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { track } from '@/lib/analytics'

interface MeResponse {
  configured: boolean
  user: {
    id: string
    email: string | null
    displayName: string | null
    avatarUrl: string | null
  } | null
  plan: 'free' | 'pro' | 'anonymous'
  usage: Record<string, number> | null
  limits: Record<string, number> | null
}

/** 헤더 우측 로그인/계정 메뉴 (Supabase 미설정 시 아무것도 렌더하지 않음) */
export function UserMenu() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/me', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: MeResponse) => {
        if (alive) setMe(data)
      })
      .catch(() => {
        /* 익명 유지 */
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  if (!me || !me.configured) return null

  if (!me.user) {
    return (
      <Link
        href="/login"
        onClick={() => track('login_click', { surface: 'header' })}
        className="ml-1 rounded-lg border border-line/15 px-2.5 py-2 text-[11px] font-bold text-muted transition hover:bg-elev/5 hover:text-ink"
      >
        로그인
      </Link>
    )
  }

  const name = me.user.displayName || me.user.email?.split('@')[0] || '소환사'
  const analysisUsed = me.usage?.analysis ?? 0
  const analysisLimit = me.limits?.analysis ?? 0

  const signOut = async () => {
    const supabase = createSupabaseBrowserClient()
    await supabase?.auth.signOut()
    window.location.reload()
  }

  return (
    <div className="relative ml-1" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="계정 메뉴"
        aria-expanded={open}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line/10 px-1.5 py-1.5 text-xs font-bold text-muted transition hover:bg-elev/5 hover:text-ink"
      >
        {me.user.avatarUrl ? (
          <img src={me.user.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-600/30 text-[10px] text-cyan-300">
            {name.slice(0, 1)}
          </span>
        )}
        <span className="hidden max-w-[80px] truncate sm:inline">{name}</span>
        {me.plan === 'pro' ? (
          <span className="rounded border border-amber-400/40 bg-amber-500/15 px-1 py-0.5 text-[9px] font-black text-amber-300">
            PRO
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-line/15 bg-panel p-3 text-xs shadow-2xl">
          <p className="truncate font-bold text-ink">{name}</p>
          <p className="mt-0.5 truncate text-[11px] text-subtle">{me.user.email || 'Discord 계정'}</p>
          <div className="mt-2 flex items-center justify-between rounded-lg border border-line/10 bg-sunken/60 px-2.5 py-1.5">
            <span className="text-muted">오늘 AI 분석</span>
            <span className="font-mono font-bold text-ink">
              {analysisUsed}/{analysisLimit}
            </span>
          </div>
          <Link
            href="/privacy"
            className="mt-2 block text-[11px] text-muted underline-offset-2 hover:text-ink hover:underline"
            onClick={() => setOpen(false)}
          >
            개인정보처리방침
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="mt-2 w-full cursor-pointer rounded-lg border border-line/15 px-2 py-1.5 text-[11px] font-bold text-muted transition hover:border-rose-400/40 hover:text-rose-300"
          >
            로그아웃
          </button>
        </div>
      ) : null}
    </div>
  )
}

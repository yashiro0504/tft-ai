'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

/** Discord OAuth 로그인 버튼 */
export function LoginButton({ next = '/' }: { next?: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signIn = async () => {
    const supabase = createSupabaseBrowserClient()
    if (!supabase) {
      setError('로그인 설정이 아직 완료되지 않았습니다. (Supabase 환경변수 확인)')
      return
    }

    setLoading(true)
    setError(null)
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })
    if (authError) {
      setError(authError.message)
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={signIn}
        disabled={loading}
        className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-900/30 transition hover:bg-[#4752c4] disabled:cursor-default disabled:opacity-60"
      >
        <span aria-hidden="true" className="text-base">🎮</span>
        {loading ? '이동 중…' : 'Discord로 로그인'}
      </button>
      {error ? <p className="text-xs font-semibold text-rose-400">{error}</p> : null}
    </div>
  )
}

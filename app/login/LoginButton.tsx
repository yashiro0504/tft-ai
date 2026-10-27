'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { AUTH_PROVIDER_LABEL, type AuthProvider } from '@/lib/authProviders'

/** 제공자별 공식 가이드에 맞춘 버튼 색 (카카오 #FEE500 + 검정 85% 글자, 구글 흰 바탕 + 테두리) */
const STYLE: Record<AuthProvider, string> = {
  kakao: 'bg-[#FEE500] text-black/85 hover:bg-[#f2da00]',
  google: 'border border-[#dadce0] bg-white text-[#1f1f1f] hover:bg-[#f8f9fa]',
  discord: 'bg-[#5865F2] text-white hover:bg-[#4752c4]',
}

function ProviderIcon({ provider }: { provider: AuthProvider }) {
  if (provider === 'kakao') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M12 3C6.48 3 2 6.48 2 10.78c0 2.78 1.86 5.22 4.66 6.6l-.95 3.48c-.08.3.26.54.52.37l4.15-2.74c.53.06 1.07.09 1.62.09 5.52 0 10-3.48 10-7.8S17.52 3 12 3z" />
      </svg>
    )
  }
  if (provider === 'google') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.94l3.66-2.84z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
      </svg>
    )
  }
  return <span aria-hidden="true" className="text-base">🎮</span>
}

/** OAuth 로그인 버튼 목록 (Supabase Auth) */
export function LoginButtons({ providers, next = '/' }: { providers: AuthProvider[]; next?: string }) {
  const [loading, setLoading] = useState<AuthProvider | null>(null)
  const [error, setError] = useState<string | null>(null)

  const signIn = async (provider: AuthProvider) => {
    const supabase = createSupabaseBrowserClient()
    if (!supabase) {
      setError('로그인 설정이 아직 완료되지 않았습니다. (Supabase 환경변수 확인)')
      return
    }

    setLoading(provider)
    setError(null)
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })
    if (authError) {
      setError(authError.message)
      setLoading(null)
    }
  }

  return (
    <div className="space-y-2.5">
      {providers.map((provider) => (
        <button
          key={provider}
          type="button"
          onClick={() => signIn(provider)}
          disabled={loading !== null}
          className={`inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-control px-4 py-3 text-sm font-bold shadow-card transition disabled:cursor-default disabled:opacity-60 ${STYLE[provider]}`}
        >
          <ProviderIcon provider={provider} />
          {loading === provider ? '이동 중…' : `${AUTH_PROVIDER_LABEL[provider]}로 로그인`}
        </button>
      ))}
      {error ? <p className="text-xs font-semibold text-bad">{error}</p> : null}
    </div>
  )
}

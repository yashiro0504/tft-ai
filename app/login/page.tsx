import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { SimpleHeader } from '@/app/components/SimpleHeader'
import { SiteFooter } from '@/app/components/SiteFooter'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { getAuthUser } from '@/lib/supabase/server'
import { LoginButton } from './LoginButton'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '로그인',
  description: 'Discord 계정으로 TFT LAB에 로그인하고 일일 AI 코칭 쿼터를 확인하세요.',
  robots: { index: false, follow: false },
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const configured = isSupabaseConfigured()
  const user = configured ? await getAuthUser() : null
  if (user) redirect('/')

  const { error, next } = await searchParams
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/'

  return (
    <div className="min-h-screen bg-app text-ink">
      <SimpleHeader active="profile" />

      <main className="mx-auto flex max-w-md flex-col px-4 py-14">
        <div className="rounded-card border border-line bg-panel p-6 shadow-card">
          <h1 className="text-xl font-black tracking-tight">TFT LAB 로그인</h1>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Discord 계정으로 로그인하면 <strong className="text-ink-soft">일일 AI 코칭 쿼터</strong>가
            계정 기준으로 관리되고, 기기를 바꿔도 플랜이 유지됩니다. 전적 검색 자체는 로그인 없이도
            가능합니다.
          </p>

          <ul className="mt-4 space-y-1.5 text-xs text-muted">
            <li>· 무료 플랜: AI 분석 10회/일</li>
            <li>· Pro 플랜: AI 분석 50회/일 (운영자가 수동 부여)</li>
            <li>· 수집 항목: Discord ID, 이메일, 표시 이름, 프로필 이미지</li>
          </ul>

          <div className="mt-6">
            {configured ? (
              <LoginButton next={target} />
            ) : (
              <div className="rounded-card border border-bad/30 bg-bad/10 p-4 text-xs leading-relaxed text-ink">
                로그인 기능이 아직 설정되지 않았습니다.
                <br />
                Supabase 프로젝트와 Discord OAuth 를 연결한 뒤 환경변수를 등록해 주세요.
                <span className="mt-2 block text-muted">docs/supabase-auth.md 참고</span>
              </div>
            )}
          </div>

          {error ? (
            <p className="mt-4 rounded-control border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">
              로그인에 실패했습니다. 다시 시도해 주세요. ({error})
            </p>
          ) : null}

          <p className="mt-6 text-xs leading-relaxed text-subtle">
            계속 진행하면{' '}
            <Link href="/terms" className="underline hover:text-ink">
              이용약관
            </Link>
            과{' '}
            <Link href="/privacy" className="underline hover:text-ink">
              개인정보처리방침
            </Link>
            에 동의하는 것으로 간주합니다.
          </p>
        </div>

        <div className="mt-4 text-center">
          <Link href="/" className="text-xs text-muted underline hover:text-ink">
            로그인 없이 계속하기 →
          </Link>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}

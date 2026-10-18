import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Supabase OAuth 콜백 (Discord 등).
 * PKCE code 를 세션으로 교환한 뒤 next 경로로 이동한다.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const rawNext = url.searchParams.get('next') || '/'
  // open redirect 방지: 내부 절대 경로만 허용
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'

  if (code) {
    const supabase = await createSupabaseServerClient()
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) {
        return NextResponse.redirect(new URL('/login?error=auth', url.origin))
      }
    }
  }

  return NextResponse.redirect(new URL(next, url.origin))
}

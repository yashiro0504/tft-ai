import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from '@/lib/supabase/config'

/**
 * Supabase 세션 쿠키 갱신 미들웨어.
 * - API 라우트는 자체적으로 getAuthUser() 를 호출하므로 제외한다.
 * - Supabase 미설정 시 아무 것도 하지 않는다.
 */
export async function middleware(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.next()

  let response = NextResponse.next({ request })

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  // getUser() 는 토큰 검증/갱신을 수행한다. (getSession 보다 안전)
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|css|js|woff2?)$).*)',
  ],
}

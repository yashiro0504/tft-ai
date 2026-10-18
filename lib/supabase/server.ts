import { cookies } from 'next/headers'
import { cache } from 'react'
import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './config'

/** 서버(라우트/서버 컴포넌트)용 Supabase 클라이언트. 미설정 시 null. */
export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  if (!isSupabaseConfigured()) return null

  const cookieStore = await cookies()

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Server Component 에서는 쿠키 쓰기가 불가능하다. (middleware 가 갱신 담당)
        }
      },
    },
  })
}

/** 현재 요청의 로그인 사용자. 미설정/비로그인 시 null. */
export const getAuthUser = cache(async (): Promise<User | null> => {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return null

  try {
    const { data, error } = await supabase.auth.getUser()
    if (error) return null
    return data.user ?? null
  } catch {
    return null
  }
})

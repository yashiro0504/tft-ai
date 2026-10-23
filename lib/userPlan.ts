import { createSupabaseServerClient } from './supabase/server'
import { errorFields, logEvent } from './observability'

export type UserPlan = 'free' | 'pro'

/**
 * 로그인 사용자의 플랜 (profiles.plan). 비로그인·Supabase 미설정·조회 실패는 'free' 로 본다.
 * /api/me 와 같은 기준 — plan 이 정확히 'pro' 일 때만 Pro.
 */
export async function getUserPlan(userId: string | null | undefined): Promise<UserPlan> {
  if (!userId) return 'free'
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return 'free'
    const { data, error } = await supabase.from('profiles').select('plan').eq('id', userId).maybeSingle()
    if (error) {
      logEvent('warn', 'user_plan_lookup_failed', errorFields(error))
      return 'free'
    }
    return data?.plan === 'pro' ? 'pro' : 'free'
  } catch (err) {
    logEvent('warn', 'user_plan_lookup_failed', errorFields(err))
    return 'free'
  }
}

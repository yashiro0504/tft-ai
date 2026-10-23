import { NextResponse } from 'next/server'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createSupabaseServerClient, getAuthUser } from '@/lib/supabase/server'
import { dailyQuotaLimit } from '@/lib/quota'
import { isQuotaExempt } from '@/lib/quotaExempt'

export const dynamic = 'force-dynamic'

/**
 * 현재 로그인 사용자 + 플랜 + 오늘 사용량.
 * Supabase 미설정/비로그인 시에도 200 을 반환해 UI 가 조용히 익명 모드로 동작한다.
 */
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { success: true, configured: false, user: null, plan: 'anonymous', usage: null },
      { headers }
    )
  }

  const user = await getAuthUser()
  if (!user) {
    return NextResponse.json(
      { success: true, configured: true, user: null, plan: 'anonymous', usage: null },
      { headers }
    )
  }

  const supabase = await createSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json(
      { success: true, configured: false, user: null, plan: 'anonymous', usage: null },
      { headers }
    )
  }

  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())

  const [profileResult, usageResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('plan, display_name, avatar_url')
      .eq('id', user.id)
      .maybeSingle(),
    supabase.from('usage_daily').select('bucket, used').eq('user_id', user.id).eq('day', day),
  ])

  const plan = profileResult.data?.plan === 'pro' ? 'pro' : 'free'
  const usage: Record<string, number> = { search: 0, analysis: 0, overview: 0 }
  for (const row of usageResult.data || []) {
    if (row && typeof row.bucket === 'string') usage[row.bucket] = Number(row.used) || 0
  }

  // 0 = 무제한 (QUOTA_* 와 같은 규칙). 면제 계정은 전부 무제한
  const limits = isQuotaExempt(user)
    ? { search: 0, analysis: 0, overview: 0 }
    : plan === 'pro'
      ? {
          search: dailyQuotaLimit('QUOTA_SEARCH_PRO_PER_DAY', 200),
          analysis: dailyQuotaLimit('QUOTA_ANALYSIS_PRO_PER_DAY', 10),
          overview: dailyQuotaLimit('QUOTA_OVERVIEW_PRO_PER_DAY', 10),
        }
      : {
          search: dailyQuotaLimit('QUOTA_SEARCH_PER_DAY', 50),
          analysis: dailyQuotaLimit('QUOTA_ANALYSIS_PER_DAY', 3),
          overview: dailyQuotaLimit('QUOTA_OVERVIEW_PER_DAY', 3),
        }

  return NextResponse.json(
    {
      success: true,
      configured: true,
      user: {
        id: user.id,
        email: user.email ?? null,
        displayName:
          profileResult.data?.display_name ||
          (user.user_metadata?.full_name as string | undefined) ||
          (user.user_metadata?.name as string | undefined) ||
          null,
        avatarUrl:
          profileResult.data?.avatar_url ||
          (user.user_metadata?.avatar_url as string | undefined) ||
          null,
      },
      plan,
      usage,
      limits,
      day,
    },
    { headers }
  )
}

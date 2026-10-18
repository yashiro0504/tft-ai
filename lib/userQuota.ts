import { createSupabaseServerClient } from './supabase/server'
import { secondsUntilReset } from './dayWindow'
import { errorFields, incrMetric, logEvent } from './observability'
import type { QuotaResult } from './quota'

/**
 * 로그인 사용자 기준 일일 쿼터 소모 (Supabase RPC).
 * - profiles.plan 이 'pro' 면 proLimit, 아니면 freeLimit 적용
 * - Supabase 미설정/오류 시 null 을 반환해 호출부가 IP 기반으로 폴백한다.
 */
export async function consumeUserQuota(
  userId: string,
  bucket: string,
  freeLimit: number,
  proLimit: number
): Promise<QuotaResult | null> {
  if (!userId) return null

  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return null

    const { data, error } = await supabase.rpc('consume_user_quota', {
      p_bucket: bucket,
      p_free_limit: freeLimit,
      p_pro_limit: proLimit,
    })

    if (error) {
      incrMetric('quota.user_rpc_error')
      logEvent('warn', 'quota_user_rpc_failed', { bucket, ...errorFields(error) })
      return null
    }

    const row = Array.isArray(data) ? data[0] : null
    if (!row) return null

    const limit = Number(row.quota_limit) || freeLimit
    const used = Number(row.used) || 0
    const allowed = Boolean(row.allowed)

    if (!allowed) incrMetric(`quota.blocked.user.${bucket}`)

    return {
      allowed,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      retryAfterSec: secondsUntilReset(),
    }
  } catch (err) {
    incrMetric('quota.user_rpc_error')
    logEvent('warn', 'quota_user_rpc_failed', { bucket, ...errorFields(err) })
    return null
  }
}

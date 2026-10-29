import { createSupabaseServerClient } from './supabase/server'
import { secondsUntilReset } from './dayWindow'
import { errorFields, incrMetric, logEvent } from './observability'
import type { QuotaResult } from './quota'
import { kstDayWindow } from './dayWindow'

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

/**
 * consumeUserQuota 로 소모한 1회를 되돌린다 (Supabase RPC refund_user_quota, 0009 마이그레이션).
 * 마이그레이션 전이거나 실패하면 로그만 남긴다.
 */
export async function refundUserQuota(bucket: string): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return false
    const { error } = await supabase.rpc('refund_user_quota', { p_bucket: bucket })
    if (error) {
      incrMetric('quota.user_refund_error')
      logEvent('warn', 'quota_user_refund_failed', { bucket, ...errorFields(error) })
      return false
    }
    return true
  } catch (err) {
    incrMetric('quota.user_refund_error')
    logEvent('warn', 'quota_user_refund_failed', { bucket, ...errorFields(err) })
    return false
  }
}

/**
 * 오늘 사용량만 읽는다 (소모하지 않음). profiles.plan 으로 한도를 고른다.
 * Supabase 미설정/오류 시 null → 호출부가 IP 기준으로 폴백한다.
 */
export async function peekUserQuota(
  userId: string,
  bucket: string,
  freeLimit: number,
  proLimit: number
): Promise<QuotaResult | null> {
  if (!userId) return null
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return null
    const day = kstDayWindow().key
    const [profile, usage] = await Promise.all([
      supabase.from('profiles').select('plan').eq('id', userId).maybeSingle(),
      supabase.from('usage_daily').select('used').eq('user_id', userId).eq('day', day).eq('bucket', bucket).maybeSingle(),
    ])
    if (profile.error || usage.error) return null
    const limit = profile.data?.plan === 'pro' ? proLimit : freeLimit
    const used = Number(usage.data?.used) || 0
    return { allowed: limit <= 0 || used < limit, limit, used, remaining: Math.max(0, limit - used), retryAfterSec: secondsUntilReset() }
  } catch (err) {
    logEvent('warn', 'quota_user_peek_failed', { bucket, ...errorFields(err) })
    return null
  }
}

/**
 * 멱등 키당 한 번만 1회 소모 (Supabase RPC charge_user_quota, 0010 마이그레이션).
 * 마이그레이션 전이면 consume_user_quota 로 폴백한다 (이때 멱등은 호출부의 인스턴스 메모리로만).
 */
export async function chargeUserQuotaOnce(
  userId: string,
  bucket: string,
  freeLimit: number,
  proLimit: number,
  idemKey: string
): Promise<(QuotaResult & { charged: boolean }) | null> {
  if (!userId) return null
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return null
    const { data, error } = await supabase.rpc('charge_user_quota', {
      p_bucket: bucket,
      p_idem_key: idemKey,
      p_free_limit: freeLimit,
      p_pro_limit: proLimit,
    })
    if (error) {
      logEvent('warn', 'quota_user_charge_rpc_failed', { bucket, ...errorFields(error) })
      const r = await consumeUserQuota(userId, bucket, freeLimit, proLimit)
      return r ? { ...r, charged: true } : null
    }
    const row = Array.isArray(data) ? data[0] : null
    if (!row) return null
    const limit = Number(row.quota_limit) || freeLimit
    const used = Number(row.used) || 0
    return { allowed: used <= limit, limit, used, remaining: Math.max(0, limit - used), retryAfterSec: secondsUntilReset(), charged: Boolean(row.charged) }
  } catch (err) {
    incrMetric('quota.user_rpc_error')
    logEvent('warn', 'quota_user_charge_failed', { bucket, ...errorFields(err) })
    return null
  }
}

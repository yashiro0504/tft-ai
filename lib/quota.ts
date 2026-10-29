/**
 * 일일 사용 쿼터 (IP 기준).
 *
 * - Redis(Upstash/Vercel KV)가 설정되어 있으면 인스턴스 간 공유된다.
 * - 미설정/장애 시 인메모리로 폴백한다(인스턴스별 best-effort).
 * - 한도 0 이하는 "무제한"으로 해석한다.
 *
 * ⚠️ IP 기준이므로 NAT/CGNAT 환경에서는 여러 사용자가 한도를 공유할 수 있다.
 *    로그인 도입 후에는 계정 ID 기준으로 전환하는 것이 좋다.
 */
import { kstDayWindow, secondsUntilReset } from './dayWindow'
import { incrMetric } from './observability'
import { redisConfigured, redisExpire, redisGet, redisIncrBy, redisSetNx } from './redisRest'

export interface QuotaResult {
  allowed: boolean
  limit: number
  used: number
  remaining: number
  retryAfterSec: number
}

const memory = new Map<string, { used: number; resetAt: number }>()

function memoryIncr(key: string, resetAt: number): number {
  const now = Date.now()
  const entry = memory.get(key)
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { used: 1, resetAt })
    return 1
  }
  entry.used += 1
  return entry.used
}

/** env 에서 일일 한도를 읽는다 (정수, 음수/오류 시 fallback). 0 = 무제한. */
export function dailyQuotaLimit(envName: string, fallback: number): number {
  const raw = Number(process.env[envName])
  if (!Number.isFinite(raw)) return fallback
  return Math.max(0, Math.floor(raw))
}

/**
 * 일일 쿼터를 1회 소모한다. 반환값의 allowed=false 이면 호출을 거부해야 한다.
 */
export async function consumeDailyQuota(
  bucket: string,
  identity: string,
  limit: number
): Promise<QuotaResult> {
  if (limit <= 0) {
    return { allowed: true, limit: 0, used: 0, remaining: 0, retryAfterSec: 0 }
  }

  const { key: day, resetAt } = kstDayWindow()
  const key = `quota:${day}:${bucket}:${identity}`
  const retryAfterSec = secondsUntilReset()

  let used: number
  if (redisConfigured()) {
    const redisUsed = await redisIncrBy(key, 1)
    if (redisUsed !== null) {
      if (redisUsed === 1) await redisExpire(key, retryAfterSec)
      used = redisUsed
    } else {
      used = memoryIncr(key, resetAt)
    }
  } else {
    used = memoryIncr(key, resetAt)
  }

  const allowed = used <= limit
  if (!allowed) incrMetric(`quota.blocked.${bucket}`)

  return {
    allowed,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    retryAfterSec,
  }
}

/**
 * consumeDailyQuota 로 소모한 1회를 되돌린다. (AI 제공자 장애로 규칙 기반 폴백만 준 경우 등)
 * best-effort — 실패해도 호출부를 막지 않는다.
 */
export async function refundDailyQuota(bucket: string, identity: string): Promise<void> {
  const { key: day } = kstDayWindow()
  const key = `quota:${day}:${bucket}:${identity}`
  if (redisConfigured()) {
    const left = await redisIncrBy(key, -1)
    if (left !== null) return
  }
  const entry = memory.get(key)
  if (entry && entry.used > 0) entry.used -= 1
}

/** 오늘 사용량만 읽는다 (소모하지 않음). 분석 시작 전 한도 확인용 */
export async function peekDailyQuota(bucket: string, identity: string, limit: number): Promise<QuotaResult> {
  const retryAfterSec = secondsUntilReset()
  if (limit <= 0) return { allowed: true, limit: 0, used: 0, remaining: 0, retryAfterSec }
  const { key: day } = kstDayWindow()
  const key = `quota:${day}:${bucket}:${identity}`
  let used = 0
  const fromRedis = redisConfigured() ? await redisGet(key) : null
  if (fromRedis !== null) used = Number(fromRedis) || 0
  else {
    const entry = memory.get(key)
    used = entry && entry.resetAt > Date.now() ? entry.used : 0
  }
  return { allowed: used < limit, limit, used, remaining: Math.max(0, limit - used), retryAfterSec }
}

/** 멱등 키별로 한 번만 소모했는지 (Redis 미설정·장애 시 인스턴스 메모리) */
const chargedOnce = new Map<string, number>()

/**
 * 멱등 키(idemKey)당 한 번만 1회를 소모한다 — 더블클릭·재시도·같은 경기 재분석으로 두 번 차감되지 않게.
 * charged=false 면 이미 같은 키로 차감한 적이 있어 이번엔 차감하지 않은 것.
 */
export async function chargeDailyQuotaOnce(
  bucket: string,
  identity: string,
  limit: number,
  idemKey: string
): Promise<QuotaResult & { charged: boolean }> {
  const { key: day, resetAt } = kstDayWindow()
  const ttl = secondsUntilReset()
  const onceKey = `quota-idem:${day}:${bucket}:${identity}:${idemKey}`
  let fresh: boolean | null = redisConfigured() ? await redisSetNx(onceKey, '1', ttl) : null
  if (fresh === null) {
    const now = Date.now()
    for (const [k, exp] of chargedOnce) if (exp <= now) chargedOnce.delete(k)
    fresh = !chargedOnce.has(onceKey)
    if (fresh) chargedOnce.set(onceKey, resetAt)
  }
  if (!fresh) return { ...(await peekDailyQuota(bucket, identity, limit)), charged: false }
  const r = await consumeDailyQuota(bucket, identity, limit)
  return { ...r, charged: true }
}

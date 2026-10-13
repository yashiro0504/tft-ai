/**
 * 경량 in-memory 고정 윈도우 레이트 리미터 (best-effort).
 *
 * ⚠️ 주의: 서버리스(예: Vercel) 환경에서는 인스턴스별 메모리라서 완벽한 전역
 * 제한이 아닙니다. 단일 인스턴스 내 반복 호출/남용을 1차 차단하는 용도이며,
 * 분산 환경의 강한 제한이 필요하면 Phase 2에서 Upstash Redis 등으로 이전합니다.
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

// 메모리 누수 방지: 큰 맵이 되면 만료된 버킷을 청소
const MAX_BUCKETS = 5000

function sweep(now: number) {
  if (buckets.size <= MAX_BUCKETS) return
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  retryAfterSec: number
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  sweep(now)

  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, limit, remaining: limit - 1, retryAfterSec: 0 }
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    }
  }

  bucket.count += 1
  return { allowed: true, limit, remaining: limit - bucket.count, retryAfterSec: 0 }
}

/**
 * 요청 헤더에서 클라이언트 IP를 최대한 추출 (Vercel/일반 프록시 대응)
 */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip') || headers.get('cf-connecting-ip') || 'unknown'
}

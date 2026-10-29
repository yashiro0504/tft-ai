/**
 * Upstash Redis / Vercel KV REST 최소 클라이언트 (의존성 없음).
 *
 * 필요한 환경변수(둘 중 하나의 조합):
 *  - UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *  - KV_REST_API_URL + KV_REST_API_TOKEN
 *
 * ⚠️ 미설정 시 모든 함수가 null 을 반환하며, 상위 캐시는 메모리(L1)만 사용한다.
 * ⚠️ Redis 장애는 서비스 장애로 전파하지 않는다(fail-open).
 */
import { errorFields, incrMetric, logEvent } from './observability'

const RAW_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || ''
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || ''
const BASE_URL = RAW_URL.replace(/\/+$/, '')

const TIMEOUT_MS = (() => {
  const parsed = Number(process.env.REDIS_TIMEOUT_MS)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 800
})()

export function redisConfigured(): boolean {
  return Boolean(BASE_URL && TOKEN)
}

async function command(path: string, init?: RequestInit): Promise<unknown | null> {
  if (!redisConfigured()) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${BASE_URL}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(init?.headers || {}),
      },
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) {
      incrMetric(`redis.http_${response.status}`)
      logEvent('warn', 'redis_command_failed', { status: response.status })
      return null
    }

    const data = (await response.json()) as { result?: unknown; error?: string }
    if (data.error) {
      incrMetric('redis.command_error')
      logEvent('warn', 'redis_command_error', { errorMessage: data.error })
      return null
    }
    return data.result ?? null
  } catch (err) {
    incrMetric('redis.transport_error')
    logEvent('warn', 'redis_transport_error', errorFields(err))
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 문자열 값 조회. 실패/미설정 시 null. */
export async function redisGet(key: string): Promise<string | null> {
  const result = await command(`get/${encodeURIComponent(key)}`)
  return typeof result === 'string' ? result : null
}

/** 문자열 값 저장 (EX 초 단위). 실패해도 예외를 던지지 않는다. */
export async function redisSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const ex = Math.max(1, Math.floor(ttlSeconds))
  await command(`set/${encodeURIComponent(key)}?EX=${ex}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: value,
  })
}

/** 정수 값 증가 후 결과 반환. 실패/미설정 시 null. */
export async function redisIncrBy(key: string, by = 1): Promise<number | null> {
  const result = await command(`incrby/${encodeURIComponent(key)}/${Math.trunc(by)}`)
  const parsed = typeof result === 'number' ? result : Number(result)
  return Number.isFinite(parsed) ? parsed : null
}

/** TTL 설정(초). 실패해도 예외를 던지지 않는다. */
export async function redisExpire(key: string, ttlSeconds: number): Promise<void> {
  await command(`expire/${encodeURIComponent(key)}/${Math.max(1, Math.floor(ttlSeconds))}`)
}


/** 키가 없을 때만 저장 (SET NX EX). 새로 저장했으면 true, 이미 있으면 false, 실패/미설정이면 null. */
export async function redisSetNx(key: string, value: string, ttlSeconds: number): Promise<boolean | null> {
  const ex = Math.max(1, Math.floor(ttlSeconds))
  const result = await command(`set/${encodeURIComponent(key)}?EX=${ex}&NX=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: value,
  })
  if (result === 'OK') return true
  // NX 로 거절되면 Upstash 는 result: null 을 준다 — command 도 null 이라 실패와 구분하려고 GET 으로 확인
  return (await redisGet(key)) !== null ? false : null
}

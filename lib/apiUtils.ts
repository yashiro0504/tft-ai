import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp } from './rateLimit'
import { consumeDailyQuota, type QuotaResult } from './quota'
import { consumeUserQuota } from './userQuota'
import { isQuotaExempt } from './quotaExempt'
import { hasOwnerCookie } from './ownerKey'
import { getAuthUser } from './supabase/server'
import { verifyTurnstile } from './turnstile'
import { incrMetric, logEvent } from './observability'
import { RiotApiError } from './riot'

/**
 * API 라우트 공통 유틸: 레이트리밋 가드 / JSON 파싱 / 입력 정규화 / 에러 처리.
 * (여러 라우트에서 중복되던 로직을 한 곳으로 통합)
 */

/** 레이트리밋 초과 시 429 응답을 반환하고, 허용되면 null 을 반환한다. */
export function rateLimitGuard(
  req: NextRequest,
  bucket: string,
  limit = 20,
  windowMs = 60_000
): NextResponse | null {
  const ip = getClientIp(req.headers)
  const result = rateLimit(`${bucket}:${ip}`, limit, windowMs)
  if (!result.allowed) {
    return NextResponse.json(
      { success: false, error: `요청이 너무 많습니다. ${result.retryAfterSec}초 후 다시 시도해주세요.` },
      { status: 429, headers: { 'Retry-After': String(result.retryAfterSec) } }
    )
  }
  return null
}

/** 초 단위 대기 시간을 사람이 읽기 쉬운 문구로. */
function humanizeRetry(seconds: number): string {
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)}시간`
  if (seconds >= 60) return `${Math.ceil(seconds / 60)}분`
  return `${seconds}초`
}

/**
 * 일일 쿼터를 1회 소모한다. 초과 시 429 응답을 반환하고, 허용되면 null.
 * - 로그인 사용자(userId)는 Supabase RPC 로 계정 기준 쿼터를 적용한다.
 * - 비로그인/미설정/RPC 오류 시 IP 기준(Redis 또는 메모리)으로 폴백한다.
 */
export async function quotaGuard(
  req: NextRequest,
  bucket: string,
  limit: number,
  userId?: string,
  proLimit?: number
): Promise<NextResponse | null> {
  if (limit <= 0 && !proLimit) return null

  let result: QuotaResult | null = null

  // 운영자 키 쿠키(/owner, QUOTA_EXEMPT_KEY) 또는 면제 계정(QUOTA_EXEMPT_USERS)은 쿼터를 소모하지 않는다.
  // getAuthUser 는 요청 단위 캐시라 추가 호출이 없다.
  if (hasOwnerCookie(req) || (userId && isQuotaExempt(await getAuthUser()))) {
    incrMetric(`quota.exempt.${bucket}`)
    return null
  }

  if (userId) {
    result = await consumeUserQuota(userId, bucket, Math.max(0, limit), proLimit ?? Math.max(0, limit))
  }

  if (!result) {
    if (limit <= 0) return null
    const ip = getClientIp(req.headers)
    result = await consumeDailyQuota(bucket, ip, limit)
  }

  if (result.allowed) return null

  incrMetric(`quota.blocked_response.${bucket}`)
  logEvent('warn', 'quota_blocked', {
    bucket,
    scope: userId ? 'user' : 'ip',
    limit: result.limit,
    used: result.used,
    resetInSec: result.retryAfterSec,
  })

  return NextResponse.json(
    {
      success: false,
      error: `오늘 이용 한도(${result.limit}회)를 초과했습니다. 약 ${humanizeRetry(result.retryAfterSec)} 후(한국 시간 자정) 다시 이용할 수 있습니다.`,
      quota: {
        bucket,
        limit: result.limit,
        used: result.used,
        remaining: 0,
        resetInSec: result.retryAfterSec,
      },
    },
    {
      status: 429,
      headers: { 'Retry-After': String(result.retryAfterSec) },
    }
  )
}

/**
 * Turnstile 토큰을 검증한다. 강제되지 않았거나 통과 시 null.
 * 검증 실패 시 403 응답.
 */
export async function turnstileGuard(
  req: NextRequest,
  raw: Record<string, unknown>
): Promise<NextResponse | null> {
  const token = typeof raw.turnstileToken === 'string' ? raw.turnstileToken.trim() : ''
  const result = await verifyTurnstile(token, getClientIp(req.headers))
  if (result.ok) return null

  incrMetric('turnstile.blocked')
  logEvent('warn', 'turnstile_blocked', { reason: result.reason })
  return NextResponse.json(
    {
      success: false,
      code: 'TURNSTILE_FAILED',
      error: '로봇 확인에 실패했습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.',
    },
    { status: 403 }
  )
}

/** JSON 본문을 안전하게 파싱한다. 실패 시 400 응답을 반환한다. */
export async function readJson(req: NextRequest): Promise<Record<string, unknown> | NextResponse> {
  try {
    const body = await req.json()
    return (body ?? {}) as Record<string, unknown>
  } catch {
    return NextResponse.json(
      { success: false, error: '요청 본문(JSON) 형식이 올바르지 않습니다.' },
      { status: 400 }
    )
  }
}

/** gameName/tagLine 을 정규화(공백/`#` 분리/길이 제한/기본 태그). 실패 시 400 응답. */
export function normalizeGameNameTagLine(
  raw: Record<string, unknown>
): { gameName: string; tagLine: string } | NextResponse {
  let gameName = typeof raw.gameName === 'string' ? raw.gameName.trim() : ''
  let tagLine = typeof raw.tagLine === 'string' ? raw.tagLine.trim() : ''

  if (!gameName) {
    return NextResponse.json({ success: false, error: '소환사 닉네임을 입력해주세요.' }, { status: 400 })
  }

  if (gameName.includes('#')) {
    const [namePart, tagPart] = gameName.split('#')
    gameName = (namePart || '').trim()
    tagLine = (tagPart || '').trim() || tagLine
  }

  if (gameName.length > 32) {
    return NextResponse.json({ success: false, error: '소환사 닉네임은 32자 이내로 입력해주세요.' }, { status: 400 })
  }
  if (tagLine.length > 10) {
    return NextResponse.json({ success: false, error: '태그는 10자 이내로 입력해주세요.' }, { status: 400 })
  }
  if (!tagLine) tagLine = 'KR1'

  return { gameName, tagLine }
}

/** NextResponse 여부 타입 가드. */
export function isNextResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse
}

/** 공통 에러 응답 (RiotApiError 는 상태/메시지 그대로, 그 외는 내부 정보 비노출). */
export function handleApiError(err: unknown, context = 'API'): NextResponse {
  console.error(`[${context}] Error:`, err)
  if (err instanceof RiotApiError) {
    return NextResponse.json({ success: false, error: err.message }, { status: err.statusCode })
  }
  return NextResponse.json(
    { success: false, error: '요청 처리 중 예기치 못한 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' },
    { status: 500 }
  )
}

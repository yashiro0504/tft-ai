import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp } from './rateLimit'
import { chargeDailyQuotaOnce, consumeDailyQuota, peekDailyQuota, refundDailyQuota, type QuotaResult } from './quota'
import { chargeUserQuotaOnce, consumeUserQuota, peekUserQuota, refundUserQuota } from './userQuota'
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

/** quotaGuard 가 이 요청에서 실제로 소모한 쿼터 (refundQuota 가 같은 곳에 되돌린다) */
const charged = new WeakMap<NextRequest, { bucket: string; scope: 'user' | 'ip'; identity: string }>()

/**
 * 이 요청에서 quotaGuard 가 소모한 1회를 되돌린다. 소모하지 않았으면(면제·무제한) 아무것도 안 한다.
 * AI 제공자 장애(DeepSeek 잔액 소진·예산 초과 등)로 규칙 기반 폴백만 준 경우에 쓴다.
 */
export async function refundQuota(req: NextRequest, reason: string): Promise<void> {
  const c = charged.get(req)
  if (!c) return
  charged.delete(req)
  try {
    if (c.scope === 'user') await refundUserQuota(c.bucket)
    else await refundDailyQuota(c.bucket, c.identity)
    incrMetric(`quota.refund.${c.bucket}`)
    logEvent('info', 'quota_refunded', { bucket: c.bucket, scope: c.scope, reason })
  } catch {
    /* best-effort */
  }
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
    if (result) charged.set(req, { bucket, scope: 'user', identity: userId })
  }

  if (!result) {
    if (limit <= 0) return null
    const ip = getClientIp(req.headers)
    result = await consumeDailyQuota(bucket, ip, limit)
    charged.set(req, { bucket, scope: 'ip', identity: ip })
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


/** 응답에 실어 화면 카운터를 서버 값과 맞추는 쿼터 상태 (차감 여부 포함) */
export interface QuotaInfo {
  bucket: string
  charged: boolean
  used: number
  limit: number
  remaining: number
}

interface QuotaPlan {
  bucket: string
  limit: number
  proLimit: number
  scope: 'user' | 'ip'
  identity: string
  userId?: string
  peek: QuotaResult
}

/** quotaCheck 가 확인한 이 요청의 쿼터 (chargeQuotaOnce 가 같은 곳에 차감한다) */
const planned = new WeakMap<NextRequest, QuotaPlan>()

function quotaExceeded(bucket: string, scope: 'user' | 'ip', result: QuotaResult): NextResponse {
  incrMetric(`quota.blocked_response.${bucket}`)
  logEvent('warn', 'quota_blocked', { bucket, scope, limit: result.limit, used: result.used, resetInSec: result.retryAfterSec })
  return NextResponse.json(
    {
      success: false,
      error: `오늘 이용 한도(${result.limit}회)를 초과했습니다. 약 ${humanizeRetry(result.retryAfterSec)} 후(한국 시간 자정) 다시 이용할 수 있습니다.`,
      quota: { bucket, limit: result.limit, used: result.used, remaining: 0, resetInSec: result.retryAfterSec },
    },
    { status: 429, headers: { 'Retry-After': String(result.retryAfterSec) } }
  )
}

/**
 * AI 분석용 쿼터 확인 — 남은 횟수만 보고 **차감하지 않는다** (2026-10-29 지시문 2).
 * 차감은 새 리포트 생성이 성공해 저장된 뒤 chargeQuotaOnce 로만 한다. 캐시 적중·실패·타임아웃은 차감 없음.
 * 한도를 다 썼으면 429, 아니면 null.
 */
export async function quotaCheck(
  req: NextRequest,
  bucket: string,
  limit: number,
  userId?: string,
  proLimit?: number
): Promise<NextResponse | null> {
  if (limit <= 0 && !proLimit) return null
  if (hasOwnerCookie(req) || (userId && isQuotaExempt(await getAuthUser()))) {
    incrMetric(`quota.exempt.${bucket}`)
    return null
  }
  const pro = proLimit ?? Math.max(0, limit)
  let plan: QuotaPlan | null = null
  if (userId) {
    const peek = await peekUserQuota(userId, bucket, Math.max(0, limit), pro)
    if (peek) plan = { bucket, limit: Math.max(0, limit), proLimit: pro, scope: 'user', identity: userId, userId, peek }
  }
  if (!plan) {
    if (limit <= 0) return null
    const ip = getClientIp(req.headers)
    plan = { bucket, limit, proLimit: pro, scope: 'ip', identity: ip, peek: await peekDailyQuota(bucket, ip, limit) }
  }
  planned.set(req, plan)
  return plan.peek.allowed ? null : quotaExceeded(bucket, plan.scope, plan.peek)
}

/** 차감 없이 지금 쿼터 상태 (캐시 적중 응답용). quotaCheck 를 안 거쳤거나 면제면 null */
export function quotaStatus(req: NextRequest): QuotaInfo | null {
  const p = planned.get(req)
  if (!p) return null
  return { bucket: p.bucket, charged: false, used: p.peek.used, limit: p.peek.limit, remaining: p.peek.remaining }
}

/**
 * 새 리포트를 만들어 저장한 뒤 1회 차감한다. 멱등 키(idemKey)가 같으면 한 번만 — 더블클릭·재시도 대비.
 * quotaCheck 를 안 거쳤거나 면제면 아무것도 안 하고 null.
 */
export async function chargeQuotaOnce(req: NextRequest, idemKey: string): Promise<QuotaInfo | null> {
  const p = planned.get(req)
  if (!p) return null
  planned.delete(req)
  let r: (QuotaResult & { charged: boolean }) | null = null
  if (p.scope === 'user' && p.userId) r = await chargeUserQuotaOnce(p.userId, p.bucket, p.limit, p.proLimit, idemKey)
  if (!r) r = await chargeDailyQuotaOnce(p.bucket, p.identity, p.limit, idemKey)
  incrMetric(r.charged ? `quota.charged.${p.bucket}` : `quota.idem_skip.${p.bucket}`)
  logEvent('info', 'quota_charged', { bucket: p.bucket, scope: p.scope, charged: r.charged, used: r.used })
  return { bucket: p.bucket, charged: r.charged, used: r.used, limit: r.limit, remaining: r.remaining }
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

import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp } from './rateLimit'
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

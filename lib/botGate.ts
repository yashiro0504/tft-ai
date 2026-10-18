import { createHmac, timingSafeEqual } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * 봇 게이트 — "검색을 통과한 브라우저" 증명 쿠키.
 *
 * 배경: /api/tft/search 는 Turnstile 로 봇을 막지만, 분석 라우트
 * (/api/tft/match, /api/tft/match/stream)는 토큰을 받지 않아 누구나 직접 호출할 수 있었다.
 * 클라이언트를 건드리지 않고 막기 위해, 검색 성공 시 HMAC 서명 쿠키를 발급하고
 * 분석 라우트가 그 쿠키(또는 유효한 Turnstile 토큰)를 요구한다.
 *
 * - 쿠키: HttpOnly / Secure / SameSite=Lax, 30분 만료, IP 바인딩(HMAC)
 * - 서명 키: BOT_GATE_SECRET → 없으면 TURNSTILE_SECRET_KEY 사용
 * - 키가 하나도 없으면 게이트 비활성(로컬 개발/미설정 환경에서 기존 동작 유지)
 */
const COOKIE_NAME = 'tftlg'
const TTL_SEC = 60 * 30

function gateSecret(): string {
  return process.env.BOT_GATE_SECRET || process.env.TURNSTILE_SECRET_KEY || ''
}

export function botGateEnabled(): boolean {
  return Boolean(gateSecret())
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for') || ''
  const first = fwd.split(',')[0]?.trim()
  return first || req.headers.get('x-real-ip') || 'unknown'
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

/** 검색 성공 응답에 게이트 쿠키를 실어 보낸다. */
export function issueBotGate(res: NextResponse, req: NextRequest, ttlSec: number = TTL_SEC): NextResponse {
  const secret = gateSecret()
  if (!secret) return res

  const ts = Math.floor(Date.now() / 1000).toString()
  const ip = clientIp(req)
  const payload = ts + '.' + ip
  res.cookies.set(COOKIE_NAME, payload + '.' + sign(payload, secret), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ttlSec,
  })
  return res
}

/** 유효한 게이트 쿠키를 가지고 있는지 확인한다. */
export function hasBotGate(req: NextRequest): boolean {
  const secret = gateSecret()
  if (!secret) return true

  const raw = req.cookies.get(COOKIE_NAME)?.value || ''
  const parts = raw.split('.')
  if (parts.length !== 3) return false

  const ts = parts[0]
  const ip = parts[1]
  const sig = parts[2]
  const payload = ts + '.' + ip
  const expected = sign(payload, secret)
  if (sig.length !== expected.length) return false
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false
  if (ip !== clientIp(req)) return false

  const age = Math.floor(Date.now() / 1000) - Number(ts)
  return Number.isFinite(age) && age >= 0 && age <= TTL_SEC
}

/** 게이트 미통과 시 응답 (분석 라우트 공통). */
export function botGateForbidden(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      code: 'BOT_GATE_REQUIRED',
      error: '먼저 소환사 전적 검색을 완료해 주세요. 봇 확인 후 30분간 분석을 사용할 수 있습니다.',
    },
    { status: 403 }
  )
}

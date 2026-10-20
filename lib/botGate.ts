import { createHmac, timingSafeEqual } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { incrMetric, logEvent } from './observability'

/**
 * 봇 게이트 — "검색(또는 Turnstile)을 통과한 브라우저" 증명 쿠키.
 *
 * 배경: /api/tft/search 는 Turnstile 로 봇을 막지만, 분석 라우트
 * (/api/tft/match, /api/tft/match/stream)는 토큰을 받지 않아 누구나 직접 호출할 수 있었다.
 * 검색 성공 시 HMAC 서명 쿠키를 발급하고, 분석 라우트가 그 쿠키(또는 유효한 Turnstile 토큰)를 요구한다.
 * 분석 라우트에서 Turnstile 로 통과하면 쿠키를 새로 발급해 다음 경기 분석은 바로 통과한다.
 *
 * - 쿠키: HttpOnly / Secure / SameSite=Lax, 2시간 만료
 * - IP 에 묶지 않는다. 이전 형식 `ts.ip.sig` 는 IPv4 주소의 '.' 때문에 split('.') 결과가 3조각이 아니어서
 *   IPv4 사용자는 검색 직후에도 항상 "먼저 검색을 완료해 주세요"로 막혔다(로컬은 IP 가 'unknown' 이라 재현 안 됨).
 *   모바일 망·IPv4/IPv6 전환으로 IP 가 바뀌는 문제도 있어 바인딩을 뺐다. 남용은 일일 쿼터·rate limit 이 막는다.
 * - 서명 키: BOT_GATE_SECRET → 없으면 TURNSTILE_SECRET_KEY 사용
 * - 키가 하나도 없으면 게이트 비활성(로컬 개발/미설정 환경에서 기존 동작 유지)
 */
const COOKIE_NAME = 'tftlg'
const TTL_SEC = 60 * 60 * 2

function gateSecret(): string {
  return process.env.BOT_GATE_SECRET || process.env.TURNSTILE_SECRET_KEY || ''
}

export function botGateEnabled(): boolean {
  return Boolean(gateSecret())
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/** 검색 성공(또는 분석 라우트 Turnstile 통과) 응답에 게이트 쿠키를 실어 보낸다. */
export function issueBotGate(res: NextResponse, _req?: NextRequest, ttlSec: number = TTL_SEC): NextResponse {
  const secret = gateSecret()
  if (!secret) return res

  const ts = Math.floor(Date.now() / 1000).toString()
  res.cookies.set(COOKIE_NAME, ts + '.' + sign(ts, secret), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ttlSec,
  })
  return res
}

export type BotGateReason = 'disabled' | 'ok' | 'missing' | 'malformed' | 'bad_signature' | 'expired'

/**
 * 게이트 쿠키 검증. 마지막 '.' 뒤가 서명, 그 앞 전체가 서명 대상, 첫 조각이 발급 시각.
 *  - `ts.sig`      (현재) sig = HMAC(ts)
 *  - `ts.ip.sig`   (이전, IP 바인딩) sig = HMAC(ts.ip) — ip 에 '.' 이 여러 개 있어도(IPv4) 서명만 확인하고 IP 는 보지 않는다.
 *                  배포 직후 기존 쿠키가 끊기지 않게 한다.
 */
export function checkBotGate(cookieValue: string | undefined, nowSec = Math.floor(Date.now() / 1000)): BotGateReason {
  const secret = gateSecret()
  if (!secret) return 'disabled'
  if (!cookieValue) return 'missing'

  const cut = cookieValue.lastIndexOf('.')
  if (cut <= 0 || cut === cookieValue.length - 1) return 'malformed'
  const sig = cookieValue.slice(cut + 1)
  const payload = cookieValue.slice(0, cut)
  if (!safeEqual(sig, sign(payload, secret))) return 'bad_signature'

  const age = nowSec - Number(payload.split('.')[0])
  if (!Number.isFinite(age) || age < 0 || age > TTL_SEC) return 'expired'
  return 'ok'
}

/** 유효한 게이트 쿠키를 가지고 있는지 확인한다. 실패 사유는 로그·지표로 남긴다. */
export function hasBotGate(req: NextRequest): boolean {
  const reason = checkBotGate(req.cookies.get(COOKIE_NAME)?.value)
  if (reason === 'ok' || reason === 'disabled') return true
  incrMetric(`bot_gate.${reason}`)
  logEvent('info', 'bot_gate_rejected', { reason, path: req.nextUrl.pathname })
  return false
}

/** 게이트 미통과 시 응답 (분석 라우트 공통). 클라이언트는 code 를 보고 Turnstile 확인 후 재시도한다. */
export function botGateForbidden(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      code: 'BOT_GATE_REQUIRED',
      error: '로봇 확인이 필요합니다. 확인을 마치면 분석이 이어집니다. (계속 보이면 소환사 전적을 다시 검색해 주세요)',
    },
    { status: 403 }
  )
}

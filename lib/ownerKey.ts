import { createHmac, timingSafeEqual } from 'node:crypto'
import type { NextRequest, NextResponse } from 'next/server'

/**
 * 운영자 키 쿠키 — 로그인 없이 운영자 브라우저만 일일 쿼터를 면제한다.
 * QUOTA_EXEMPT_KEY(16자 이상)를 /owner 에서 한 번 입력하면 httpOnly 쿠키가 발급된다.
 * 쿠키에는 키 원문이 아니라 HMAC(키, 라벨) 을 넣는다 — 환경변수 키를 바꾸면 기존 쿠키는 모두 무효.
 * LLM 일일 예산(LLM_DAILY_BUDGET_USD)은 면제하지 않는다.
 */
export const OWNER_COOKIE = 'tftlab_owner'
const MIN_KEY_LENGTH = 16
const TTL_SEC = 60 * 60 * 24 * 365

function ownerKey(): string {
  const key = (process.env.QUOTA_EXEMPT_KEY || '').trim()
  return key.length >= MIN_KEY_LENGTH ? key : ''
}

export function isOwnerKeyConfigured(): boolean {
  return Boolean(ownerKey())
}

/** 설정 진단 (키 값은 노출하지 않는다): 미등록 / 16자 미만 / 정상 */
export function ownerKeyStatus(): 'missing' | 'too_short' | 'ok' {
  const raw = (process.env.QUOTA_EXEMPT_KEY || '').trim()
  if (!raw) return 'missing'
  return raw.length >= MIN_KEY_LENGTH ? 'ok' : 'too_short'
}

function token(key: string): string {
  return createHmac('sha256', key).update('tftlab-owner-v1').digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** 입력한 키가 환경변수 키와 같은가 (미설정이면 항상 false) */
export function checkOwnerKey(input: string): boolean {
  const key = ownerKey()
  return Boolean(key && input) && safeEqual(token(input.trim()), token(key))
}

/** 요청 쿠키가 유효한 운영자 쿠키인가 */
export function hasOwnerCookie(req: Pick<NextRequest, 'cookies'>): boolean {
  return isOwnerCookieValue(req.cookies.get(OWNER_COOKIE)?.value)
}

/** 쿠키 값이 유효한 운영자 토큰인가 (서버 컴포넌트에서 next/headers cookies() 로 읽은 값용) */
export function isOwnerCookieValue(value: string | undefined): boolean {
  const key = ownerKey()
  return Boolean(key && value) && safeEqual(value as string, token(key))
}

export function issueOwnerCookie(res: NextResponse): NextResponse {
  const key = ownerKey()
  if (!key) return res
  res.cookies.set(OWNER_COOKIE, token(key), { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: TTL_SEC })
  return res
}

export function clearOwnerCookie(res: NextResponse): NextResponse {
  res.cookies.set(OWNER_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}

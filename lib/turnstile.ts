/**
 * Cloudflare Turnstile 서버 검증.
 *
 * - `TURNSTILE_SECRET_KEY` 가 설정되어 있으면 검증을 강제한다.
 * - `TURNSTILE_ENFORCE=false` 로 일시 해제할 수 있다.
 * - 사이트 키(`NEXT_PUBLIC_TURNSTILE_SITE_KEY`)는 클라이언트 위젯 렌더링용이다.
 *   둘 중 하나만 설정하면 /api/health 경고가 뜬다.
 *
 * ⚠️ Cloudflare 장애 시에는 fail-open(통과)한다. 비용/트래픽 방어 목적이므로
 *    가용성을 우선하며, 대신 로그/카운터로 감지한다.
 */
import { errorFields, incrMetric, logEvent } from './observability'

const SECRET = process.env.TURNSTILE_SECRET_KEY || ''
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''
const TIMEOUT_MS = (() => {
  const parsed = Number(process.env.TURNSTILE_TIMEOUT_MS)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 3_000
})()

export interface TurnstileStatus {
  configured: boolean
  enforced: boolean
  siteKeyConfigured: boolean
}

export function turnstileStatus(): TurnstileStatus {
  const enforced = Boolean(SECRET) && process.env.TURNSTILE_ENFORCE !== 'false'
  return {
    configured: Boolean(SECRET && SITE_KEY),
    enforced,
    siteKeyConfigured: Boolean(SITE_KEY),
  }
}

export interface TurnstileResult {
  ok: boolean
  reason?: string
}

export async function verifyTurnstile(token: string, ip?: string): Promise<TurnstileResult> {
  const status = turnstileStatus()
  if (!status.enforced) return { ok: true }

  if (!token) {
    incrMetric('turnstile.missing_token')
    return { ok: false, reason: 'missing-token' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const body = new URLSearchParams({ secret: SECRET, response: token })
    if (ip && ip !== 'unknown') body.set('remoteip', ip)

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
      signal: controller.signal,
    })

    const data = (await response.json()) as { success?: boolean; 'error-codes'?: string[] }
    if (data.success) {
      incrMetric('turnstile.ok')
      return { ok: true }
    }

    const codes = data['error-codes'] || []
    incrMetric('turnstile.failed')
    logEvent('warn', 'turnstile_failed', { codes })
    return { ok: false, reason: codes.join(',') || 'verification-failed' }
  } catch (err) {
    // Cloudflare 측 장애/타임아웃은 사용자를 막지 않는다.
    incrMetric('turnstile.unavailable')
    logEvent('warn', 'turnstile_unavailable', errorFields(err))
    return { ok: true }
  } finally {
    clearTimeout(timer)
  }
}

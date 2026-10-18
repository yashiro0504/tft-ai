import { NextRequest, NextResponse } from 'next/server'
import { isNextResponse, rateLimitGuard, readJson } from '@/lib/apiUtils'
import {
  MAX_ROUTE_LENGTH,
  SESSION_ID_PATTERN,
  isAnalyticsEventName,
  normalizeRoute,
  sanitizeProps,
} from '@/lib/eventSchema'
import { recordEvent } from '@/lib/events'
import { incrMetric, logEvent } from '@/lib/observability'

export const dynamic = 'force-dynamic'

/** 계측 응답은 절대 캐시하지 않는다. */
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

/** IP당 분당 이벤트 상한. 한 세션에서 탭 전환/클릭이 잦아도 걸리지 않을 정도로 넉넉히 둔다. */
const EVENT_RATE_LIMIT = 120
const EVENT_RATE_WINDOW_MS = 60_000

function badRequest(message: string): NextResponse {
  return NextResponse.json({ success: false, error: message }, { status: 400, headers: NO_STORE_HEADERS })
}

/**
 * POST /api/events — 클라이언트 이벤트 수집.
 *
 * - Turnstile 은 적용하지 않는다. (봇 차단이 아니라 집계용이며, IP 레이트리밋으로 남용을 완화)
 * - 항상 `no-store`. 저장 성공 시 본문 없는 204.
 * - PII 는 받지 않는다: 이벤트 이름 화이트리스트 + props 정제(키/값) 를 서버에서 재적용.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimitGuard(req, 'events', EVENT_RATE_LIMIT, EVENT_RATE_WINDOW_MS)
  if (limited) return limited

  const raw = await readJson(req)
  if (isNextResponse(raw)) return raw

  if (!isAnalyticsEventName(raw.name)) {
    return badRequest('알 수 없는 이벤트입니다.')
  }
  const name = raw.name

  const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId.trim() : ''
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return badRequest('sessionId 형식이 올바르지 않습니다.')
  }

  const route = typeof raw.route === 'string' ? normalizeRoute(raw.route.slice(0, MAX_ROUTE_LENGTH)) : '/'
  const props = sanitizeProps(raw.props)

  const storage = await recordEvent({ name, sessionId, props, route })
  incrMetric(`event.${name}`)
  logEvent('debug', 'analytics_event_stored', { name, storage })

  return new NextResponse(null, { status: 204, headers: NO_STORE_HEADERS })
}

/** GET 등 다른 메서드는 405 (계측 엔드포인트는 쓰기 전용) */
export async function GET() {
  return NextResponse.json(
    { success: false, error: 'POST 만 지원합니다.' },
    { status: 405, headers: { ...NO_STORE_HEADERS, Allow: 'POST' } }
  )
}

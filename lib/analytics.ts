'use client'

/**
 * 클라이언트 이벤트 계측 (P0-1).
 *
 * - 세션 식별자는 `sessionStorage` 의 UUID 하나만 쓴다. (탭/세션 단위, 브라우저 종료 시 소멸)
 * - 개인정보(Riot ID, 이메일, PUUID 등)는 보내지 않는다. `lib/eventSchema.ts` 의
 *   `sanitizeProps` 가 키/값 양쪽에서 PII 를 걸러낸다.
 * - `fetch(..., { keepalive: true })` 로 페이지 이탈(링크 이동) 중에도 전송을 시도한다.
 * - 계측 실패는 절대 UX 를 막지 않는다. (모든 예외 무시)
 */

import {
  normalizeRoute,
  sanitizeProps,
  ANON_ID_PATTERN,
  type AnalyticsEventName,
  type AnalyticsProps,
} from './eventSchema'

const ENDPOINT = '/api/events'
const SESSION_STORAGE_KEY = 'tftlab:session'
const VISITOR_STORAGE_KEY = 'tftlab:visitor'

/** storage 접근이 차단된 환경(시크릿 모드 일부)에서도 동작하도록 메모리 폴백을 둔다. */
let memorySessionId = ''
let memoryVisitorId = ''
const firedOnce = new Set<string>()

function createId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* randomUUID 미지원 환경 폴백 */
  }
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** 현재 세션 식별자 (없으면 생성). 서버 렌더 시에는 빈 문자열. */
export function getSessionId(): string {
  if (typeof window === 'undefined') return ''
  if (memorySessionId) return memorySessionId

  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (existing) {
      memorySessionId = existing
      return existing
    }
    const created = createId()
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, created)
    memorySessionId = created
    return created
  } catch {
    memorySessionId = createId()
    return memorySessionId
  }
}

/**
 * 현재 브라우저의 익명 방문자 ID (없으면 생성).
 *
 * - localStorage 에 보관해 재방문/리텐션을 같은 이용자로 묶는다.
 * - 임의 UUID 이며 이메일·Riot ID·IP 등 개인정보를 포함하지 않는다.
 * - 브라우저 데이터를 삭제하면 새 ID 가 발급된다.
 */
export function getVisitorId(): string {
  if (typeof window === 'undefined') return ''
  if (memoryVisitorId) return memoryVisitorId

  try {
    const existing = window.localStorage.getItem(VISITOR_STORAGE_KEY)
    if (existing && ANON_ID_PATTERN.test(existing)) {
      memoryVisitorId = existing
      return existing
    }
    const created = createId()
    window.localStorage.setItem(VISITOR_STORAGE_KEY, created)
    memoryVisitorId = created
    return created
  } catch {
    memoryVisitorId = createId()
    return memoryVisitorId
  }
}

/**
 * 이벤트 1건 전송. 실패해도 예외를 던지지 않는다.
 * @param name 허용 목록(`ANALYTICS_EVENT_NAMES`) 중 하나
 * @param props 집계용 속성 (PII 금지)
 */
export function track(name: AnalyticsEventName, props?: AnalyticsProps): void {
  if (typeof window === 'undefined') return

  const sessionId = getSessionId()
  const visitorId = getVisitorId()
  if (!sessionId || !visitorId) return

  const body = JSON.stringify({
    name,
    sessionId,
    visitorId,
    props: sanitizeProps(props),
    route: normalizeRoute(window.location.pathname),
  })

  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      cache: 'no-store',
    }).catch(() => {
      /* 네트워크 실패 무시 */
    })
  } catch {
    /* fetch 자체가 throw 하는 환경(드묾)도 무시 */
  }
}

/**
 * 세션 내 1회만 전송한다. (페이지 진입 이벤트의 중복 집계 방지 — React StrictMode 대응)
 * @param key 중복 판정 키 (예: `deck_open:auto-soraka`)
 */
export function trackOnce(key: string, name: AnalyticsEventName, props?: AnalyticsProps): void {
  if (typeof window === 'undefined') return
  if (firedOnce.has(key)) return
  firedOnce.add(key)
  track(name, props)
}

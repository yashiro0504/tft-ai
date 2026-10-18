/**
 * 이벤트 계측 스키마 (클라이언트·서버 공용).
 *
 * - 이 파일은 순수 함수/상수만 담는다. (서버 전용 모듈을 import 하지 않는다)
 * - 클라이언트(`lib/analytics.ts`)와 API 라우트(`app/api/events/route.ts`)가
 *   **같은 허용 목록·같은 정제 규칙**을 쓰도록 하기 위한 단일 출처(single source of truth)다.
 * - PII(Riot ID, 이메일, PUUID, IP 등)는 수집하지 않는다. 키 이름 차단 + 값 패턴 차단을
 *   이중으로 적용하고, 서버에서 한 번 더 정제한다(defense in depth).
 */

/** 수집 허용 이벤트 이름 (이 외의 이름은 400 으로 거부) */
export const ANALYTICS_EVENT_NAMES = [
  'search_submit',
  'search_success',
  'analysis_click',
  'analysis_success',
  'tab_view',
  'deck_open',
  'share_click',
  'login_click',
  'pro_waitlist_click',
] as const

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number]

export type AnalyticsPropValue = string | number | boolean
export type AnalyticsProps = Record<string, AnalyticsPropValue | null | undefined>

export interface AnalyticsEventPayload {
  name: AnalyticsEventName
  sessionId: string
  /** localStorage 기반 익명 방문자 ID (재방문/리텐션 집계용, PII 아님) */
  visitorId: string
  props: Record<string, AnalyticsPropValue>
  route: string
}

/**
 * 익명 식별자(UUID v4 또는 fallback id) 형식.
 * sessionStorage 세션 ID와 localStorage 방문자 ID에 공통으로 사용한다.
 */
export const ANON_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

/** sessionStorage UUID 형식 (하위 호환 alias) */
export const SESSION_ID_PATTERN = ANON_ID_PATTERN

export const MAX_PROPS = 12
export const MAX_PROP_STRING = 120
export const MAX_ROUTE_LENGTH = 80

/** prop 키 이름 자체가 PII 를 암시하는 경우 전송/저장하지 않는다. */
const BLOCKED_PROP_KEYS = new Set([
  'email',
  'mail',
  'riotid',
  'riot_id',
  'gamename',
  'game_name',
  'tagline',
  'tag_line',
  'summonername',
  'summoner_name',
  'puuid',
  'accountid',
  'account_id',
  'ip',
  'ipaddress',
  'token',
  'accesstoken',
  'refreshtoken',
  'phone',
  'discordid',
  'userid',
])

/** 값이 이메일 형태면 PII 로 간주하고 버린다. */
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/

const PROP_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/

export function isAnalyticsEventName(value: unknown): value is AnalyticsEventName {
  return typeof value === 'string' && (ANALYTICS_EVENT_NAMES as readonly string[]).includes(value)
}

/**
 * props 를 화이트리스트 방식으로 정제한다.
 * - 키: 영문 시작 + 영숫자/언더스코어, 32자 이내, PII 차단 목록 제외
 * - 값: string(120자 절단) / number(유한값) / boolean 만 허용, 이메일 형태 문자열 폐기
 * - 최대 12개 키
 */
export function sanitizeProps(input: unknown): Record<string, AnalyticsPropValue> {
  const out: Record<string, AnalyticsPropValue> = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out

  let count = 0
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (count >= MAX_PROPS) break
    if (!PROP_KEY_PATTERN.test(key)) continue
    if (BLOCKED_PROP_KEYS.has(key.toLowerCase())) continue
    if (value === null || value === undefined) continue

    let normalized: AnalyticsPropValue
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue
      normalized = value
    } else if (typeof value === 'boolean') {
      normalized = value
    } else if (typeof value === 'string') {
      if (EMAIL_PATTERN.test(value)) continue
      normalized = value.slice(0, MAX_PROP_STRING)
    } else {
      continue
    }

    out[key] = normalized
    count += 1
  }

  return out
}

/**
 * 경로를 집계용으로 정규화한다.
 * `/profile/kr/이름/태그` 처럼 Riot ID 가 들어가는 경로는 템플릿으로 치환한다.
 */
export function normalizeRoute(pathname: string): string {
  if (!pathname) return '/'
  const path = pathname.split('?')[0].split('#')[0]
  if (/^\/profile\/[^/]+\/[^/]+\/[^/]+/.test(path)) return '/profile/[region]/[name]/[tag]'
  return path.slice(0, MAX_ROUTE_LENGTH)
}

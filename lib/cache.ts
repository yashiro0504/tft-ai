/**
 * 경량 in-memory TTL 캐시 (best-effort).
 *
 * ⚠️ 서버리스 환경에서는 인스턴스별 메모리라 완벽한 전역 캐시가 아닙니다.
 * 같은 인스턴스에 들어온 반복 요청(예: 동일 경기 재분석)을 즉시 응답하는 용도이며,
 * 분산 캐시가 필요하면 Phase 2에서 Upstash Redis 등으로 이전합니다.
 *
 * 매치 데이터는 불변(immutable)이므로 경기 단위 결과는 길게 캐시해도 안전합니다.
 */

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const store = new Map<string, CacheEntry<unknown>>()

const MAX_ENTRIES = 2000

function sweep(now: number) {
  if (store.size <= MAX_ENTRIES) return
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key)
  }
}

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    store.delete(key)
    return null
  }
  return entry.value
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  const now = Date.now()
  sweep(now)
  store.set(key, { value, expiresAt: now + ttlMs })
}

export const CACHE_TTL = {
  /** 검색(매치 리스트): 새 경기가 곧 반영되도록 짧게 */
  SEARCH: 60_000,
  /** 경기별 AI 분석: 매치 데이터는 불변 → 길게 */
  MATCH: 24 * 60 * 60_000,
  /** 종합 분석: 입력 매치 목록 기준 */
  OVERVIEW: 6 * 60 * 60_000,
} as const

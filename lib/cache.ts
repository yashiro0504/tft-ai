/**
 * 2계층 TTL 캐시: L1 인메모리 + L2 Redis(Upstash/Vercel KV REST, 선택).
 *
 * - L1: 인스턴스 로컬. 콜드스타트 시 사라지지만, 웜 인스턴스에서는 Redis 왕복을 생략한다.
 * - L2: 서버리스 인스턴스 간 공유. Redis 미설정 시 자동으로 L1만 사용한다.
 * - Redis 장애는 fail-open (L1으로 계속 서비스, 예외 없음).
 *
 * 키 규칙: 라우트/서비스에서 사람이 읽을 수 있는 키를 넘기면 `tft:v1:` 프리픽스가 붙는다.
 * 값: JSON 직렬화. TTL 은 ms 단위로 받아 Redis EX(초)로 변환한다.
 */
import { incrMetric } from './observability'
import { redisConfigured, redisGet, redisSet } from './redisRest'

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const store = new Map<string, CacheEntry<unknown>>()

const MAX_ENTRIES = 2000
const PREFIX = 'tft:v1:'

/** L1 보관 상한. L2가 있으면 L1은 짧게 두어 인스턴스 간 불일치를 줄인다. */
const L1_MAX_TTL_MS = (() => {
  const parsed = Number(process.env.CACHE_L1_MAX_TTL_MS)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5 * 60_000
})()

function sweep(now: number) {
  if (store.size <= MAX_ENTRIES) return
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key)
  }
}

export interface CacheHit<T> {
  value: T
  source: 'memory' | 'redis'
}

export function cacheBackend(): 'redis+memory' | 'memory' {
  return redisConfigured() ? 'redis+memory' : 'memory'
}

/** L1에만 저장 (Redis 쓰기 없이 콜드스타트 완화용). */
export function cacheSetMemory<T>(key: string, value: T, ttlMs: number): void {
  const now = Date.now()
  sweep(now)
  store.set(key, { value, expiresAt: now + Math.min(Math.max(ttlMs, 1), L1_MAX_TTL_MS) })
}

/** 값을 조회하고 어느 계층에서 왔는지 함께 반환한다. */
export async function cacheGetWithSource<T>(key: string): Promise<CacheHit<T> | null> {
  const now = Date.now()
  const entry = store.get(key) as CacheEntry<T> | undefined

  if (entry && entry.expiresAt > now) {
    incrMetric('cache.hit.memory')
    return { value: entry.value, source: 'memory' }
  }
  if (entry) store.delete(key)

  if (redisConfigured()) {
    const raw = await redisGet(PREFIX + key)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { value: T }
        incrMetric('cache.hit.redis')
        cacheSetMemory(key, parsed.value, L1_MAX_TTL_MS)
        return { value: parsed.value, source: 'redis' }
      } catch {
        incrMetric('cache.redis_parse_error')
      }
    }
  }

  incrMetric('cache.miss')
  return null
}

/** 값 조회. 없으면 null. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const hit = await cacheGetWithSource<T>(key)
  return hit ? hit.value : null
}

/** L1 + L2 동시 저장. L2 실패는 무시된다. */
export async function cacheSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
  cacheSetMemory(key, value, ttlMs)
  if (redisConfigured()) {
    await redisSet(PREFIX + key, JSON.stringify({ value }), Math.ceil(ttlMs / 1000))
  }
}

export const CACHE_TTL = {
  /** 검색(매치 리스트): 새 경기가 곧 반영되도록 짧게 */
  SEARCH: 60_000,
  /** Riot ID → PUUID: 계정 식별자는 거의 변하지 않음 */
  ACCOUNT: 24 * 60 * 60_000,
  /** 소환사 레벨/아이콘 */
  SUMMONER: 6 * 60 * 60_000,
  /** TFT 랭크(티어/LP) — 승강 변동을 반영하되 호출은 줄이는 10분 */
  RANK: 10 * 60_000,
  /** 최근 매치 ID 목록 */
  MATCH_IDS: 45_000,
  /** 경기별 AI 분석: 매치 데이터는 불변 → 길게 */
  MATCH: 24 * 60 * 60_000,
  /** 짧은 인트로(핵심 진단): 전체 리포트보다 짧게 재사용 */
  INTRO: 6 * 60 * 60_000,
  /** 정규화된 매치 상세(SlimMatchData): 불변 데이터 → 사실상 영구 */
  IMMUTABLE: 30 * 24 * 60 * 60_000,
  /** 종합 분석: 입력 매치 목록 기준 */
  OVERVIEW: 6 * 60 * 60_000,
  /** AI 미사용 폴백 리포트: 제공자 복구(잔액 충전 등) 후 곧 AI 리포트로 바뀌도록 짧게 */
  FALLBACK_REPORT: 5 * 60_000,
} as const

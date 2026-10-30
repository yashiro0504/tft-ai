import { NextRequest, NextResponse } from 'next/server'
import { buildMetaPayload } from '@/lib/metaPayload'
import { cacheGetWithSource, cacheSet, CACHE_TTL } from '@/lib/cache'
import { elapsedMs, errorFields, incrMetric, logEvent } from '@/lib/observability'
import { rateLimitGuard, handleApiError } from '@/lib/apiUtils'
import type { TftMetaResponse } from '@/lib/types'
import { withDeckSnapshot } from '@/lib/metaSnapshot'
import { toDeckSummary, toDecksOnly, withoutLegacyDeckMeta } from '@/lib/metaSlim'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tft/meta
 *
 * 기물·시너지·아이템·BIS 는 빌드 타임 JSON(lib/metaStats.json 등)에서, **덱은 덱 성적표와 같은 스냅샷**(getMetaDeckSnapshot)에서 온다.
 * 2026-10-28: 홈 메타 탭(/?tab=meta)·홈 추천 덱이 이 API 로 래더 JSON(292판 · 09:29)만 읽어, DB 스냅샷(8,776판 · 13:36)을 읽는
 * 덱 성적표와 평균이 갈렸다. 이제 JSON 부분만 캐시하고 덱은 요청마다 공유 스냅샷(Redis 5분)을 덮어쓴다.
 * - s-maxage=60: 엣지 캐시도 스냅샷 TTL 안에서만 (예전 5분 + stale 1시간이면 갱신이 한참 늦었다)
 * - 인메모리 memo: JSON 부분 재가공 비용 제거
 *
 * 페이지(/meta)도 같은 빌더·같은 스냅샷을 사용한다(lib/metaPayload.ts · lib/tftStats.ts).
 */
const META_MEMO_TTL_MS = (() => {
  const parsed = Number(process.env.META_MEMO_TTL_MS)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5 * 60_000
})()

const META_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60',
} as const

/**
 * 첫 화면용 부분 응답(view=summary · decks) 캐시 — 덱 스냅샷은 하루 한 번 바뀌고 서버 스냅샷 캐시는 5분이다.
 * 엣지 5분 + stale 10분: 첫 진입이 매번 원본을 기다리지 않게 (2026-10-30 지시문 3).
 */
const META_VIEW_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
} as const

let metaMemo: { value: TftMetaResponse; expiresAt: number } | null = null
/** 보기별 최종 응답 메모 (인스턴스 메모리) — 스냅샷 TTL(5분) 안에서는 Redis·JSON 재가공 없이 바로 응답 (2026-10-30 2차 지시문 5-3) */
const viewMemo = new Map<string, { value: TftMetaResponse; expiresAt: number }>()

/** 빌드 타임 JSON 부분 (memo → Redis → 빌드) */
async function basePayload(): Promise<{ value: TftMetaResponse; cacheSource: string }> {
  const now = Date.now()
  if (metaMemo && metaMemo.expiresAt > now) {
    incrMetric('cache.hit.meta_memo')
    return { value: metaMemo.value, cacheSource: 'memo' }
  }
  const cacheKey = 'meta:rankings'
  const cached = await cacheGetWithSource<TftMetaResponse>(cacheKey)
  if (cached) {
    incrMetric(`cache.hit.meta_${cached.source}`)
    metaMemo = { value: cached.value, expiresAt: now + META_MEMO_TTL_MS }
    return { value: cached.value, cacheSource: cached.source }
  }
  const response = buildMetaPayload()
  await cacheSet(cacheKey, response, CACHE_TTL.SEARCH)
  metaMemo = { value: response, expiresAt: Date.now() + META_MEMO_TTL_MS }
  return { value: response, cacheSource: 'miss' }
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now()
  try {
    const limited = rateLimitGuard(req, 'meta', 60, 60_000)
    if (limited) return limited

    // ?view=summary: 스냅샷 정보만 · ?view=decks: 덱 목록·상세(메타 첫 화면·추천 덱) · 없으면 전체 (기물·아이템·조합 탭)
    const view = req.nextUrl.searchParams.get('view')
    const memoKey = view === 'summary' || view === 'decks' ? view : 'full'
    const memoHit = viewMemo.get(memoKey)
    let cacheSource = 'view_memo'
    let response: TftMetaResponse
    if (memoHit && memoHit.expiresAt > Date.now()) {
      response = memoHit.value
    } else {
      const base = await basePayload()
      cacheSource = base.cacheSource
      const full = await withDeckSnapshot(base.value)
      response = view === 'summary' ? toDeckSummary(full) : view === 'decks' ? toDecksOnly(full) : withoutLegacyDeckMeta(full)
      // 스냅샷을 못 읽은 폴백 응답은 짧게만 둔다 — 복구되면 바로 DB 스냅샷으로
      const ttl = full.decksMeta?.fallbackReason ? 30_000 : META_MEMO_TTL_MS
      viewMemo.set(memoKey, { value: response, expiresAt: Date.now() + ttl })
    }
    logEvent('info', 'api_meta', {
      ms: elapsedMs(startedAt),
      cacheSource,
      champions: response.champions.length,
      decks: response.decks.length,
      decksSource: response.decksMeta?.source,
      view: response.view ?? 'full',
    })
    return NextResponse.json(response, { headers: response.view ? META_VIEW_CACHE_HEADERS : META_CACHE_HEADERS })
  } catch (err) {
    logEvent('error', 'api_meta_failed', { ms: elapsedMs(startedAt), ...errorFields(err) })
    return handleApiError(err, 'meta')
  }
}

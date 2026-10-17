import { NextRequest, NextResponse } from 'next/server'
import { buildMetaPayload } from '@/lib/metaPayload'
import { cacheGetWithSource, cacheSet, CACHE_TTL } from '@/lib/cache'
import { elapsedMs, errorFields, incrMetric, logEvent } from '@/lib/observability'
import { rateLimitGuard, handleApiError } from '@/lib/apiUtils'
import type { TftMetaResponse } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tft/meta
 *
 * 응답은 빌드 타임 JSON(lib/metaStats.json, lib/decksData.json)만으로 만들어진다.
 * - s-maxage=300: 엣지 캐시 (Riot/LLM 호출 없음)
 * - stale-while-revalidate=3600
 * - 인메모리 memo: 웜 인스턴스에서 재가공 비용 제거
 *
 * 페이지(/meta)도 같은 빌더를 사용한다(lib/metaPayload.ts).
 */
const META_MEMO_TTL_MS = (() => {
  const parsed = Number(process.env.META_MEMO_TTL_MS)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5 * 60_000
})()

const META_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
} as const

let metaMemo: { value: TftMetaResponse; expiresAt: number } | null = null

function metaJson(payload: TftMetaResponse): NextResponse {
  return NextResponse.json(payload, { headers: META_CACHE_HEADERS })
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now()
  try {
    const limited = rateLimitGuard(req, 'meta', 60, 60_000)
    if (limited) return limited

    const now = Date.now()
    if (metaMemo && metaMemo.expiresAt > now) {
      incrMetric('cache.hit.meta_memo')
      logEvent('info', 'api_meta', { ms: elapsedMs(startedAt), cacheSource: 'memo' })
      return metaJson(metaMemo.value)
    }

    const cacheKey = 'meta:rankings'
    const cached = await cacheGetWithSource<TftMetaResponse>(cacheKey)
    if (cached) {
      incrMetric(`cache.hit.meta_${cached.source}`)
      metaMemo = { value: cached.value, expiresAt: now + META_MEMO_TTL_MS }
      logEvent('info', 'api_meta', { ms: elapsedMs(startedAt), cacheSource: cached.source })
      return metaJson(cached.value)
    }

    const response = buildMetaPayload()
    await cacheSet(cacheKey, response, CACHE_TTL.SEARCH)
    metaMemo = { value: response, expiresAt: Date.now() + META_MEMO_TTL_MS }

    logEvent('info', 'api_meta', {
      ms: elapsedMs(startedAt),
      cacheSource: 'miss',
      champions: response.champions.length,
      decks: response.decks.length,
    })
    return metaJson(response)
  } catch (err) {
    logEvent('error', 'api_meta_failed', { ms: elapsedMs(startedAt), ...errorFields(err) })
    return handleApiError(err, 'meta')
  }
}

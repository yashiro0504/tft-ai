import { NextRequest, NextResponse } from 'next/server'
import { loadSummonerData, DEFAULT_MATCH_LIMIT } from '@/lib/tftService'
import { calculateProfileStats } from '@/lib/profile'
import { cacheGetWithSource, cacheSet, CACHE_TTL } from '@/lib/cache'
import { elapsedMs, errorFields, logEvent } from '@/lib/observability'
import { quotaGuard, rateLimitGuard, readJson, normalizeGameNameTagLine, isNextResponse, handleApiError, turnstileGuard } from '@/lib/apiUtils'
import { dailyQuotaLimit } from '@/lib/quota'
import { TftSearchResponse } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/tft/search
 * 소환사 ID 로 최근 매치 "리스트"와 프로필만 반환한다. (AI 분석은 하지 않음 → 빠름)
 * 경기별 상세/코칭은 POST /api/tft/match 로 개별 요청한다.
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  try {
    const limited = rateLimitGuard(req, 'search', 30, 60_000)
    if (limited) return limited

    const daily = await quotaGuard(req, 'search', dailyQuotaLimit('QUOTA_SEARCH_PER_DAY', 50))
    if (daily) return daily

    const raw = await readJson(req)
    if (isNextResponse(raw)) return raw

    const botCheck = await turnstileGuard(req, raw)
    if (botCheck) return botCheck

    const nt = normalizeGameNameTagLine(raw)
    if (isNextResponse(nt)) return nt
    const { gameName, tagLine } = nt

    const limit = typeof raw.limit === 'number' ? raw.limit : DEFAULT_MATCH_LIMIT
    const isDemo = raw.isDemo === true

    // 키 정규화: 대소문자/공백 차이로 캐시가 갈라지지 않도록 한다.
    const cacheKey = `search:${gameName.toLowerCase()}#${tagLine.toUpperCase()}:${limit}:${isDemo}`
    const cached = await cacheGetWithSource<TftSearchResponse>(cacheKey)
    if (cached) {
      logEvent('info', 'api_search', {
        ms: elapsedMs(startedAt),
        cacheSource: cached.source,
        isDemo,
      })
      return NextResponse.json(cached.value)
    }

    const data = await loadSummonerData(gameName, tagLine, limit, isDemo)
    const summonerProfile = calculateProfileStats(
      data.matches,
      data.gameName,
      data.tagLine,
      data.summonerLevel,
      data.profileIconId
    )

    const response: TftSearchResponse = {
      success: true,
      gameName: data.gameName,
      tagLine: data.tagLine,
      puuid: data.puuid,
      summonerProfile,
      matches: data.matches,
      isDemo: data.isDemo,
    }

    await cacheSet(cacheKey, response, CACHE_TTL.SEARCH)
    logEvent('info', 'api_search', {
      ms: elapsedMs(startedAt),
      cacheSource: 'miss',
      isDemo: data.isDemo,
      matches: data.matches.length,
    })
    return NextResponse.json(response)
  } catch (err) {
    logEvent('error', 'api_search_failed', { ms: elapsedMs(startedAt), ...errorFields(err) })
    return handleApiError(err, 'search')
  }
}

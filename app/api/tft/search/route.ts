import { NextRequest, NextResponse } from 'next/server'
import { loadSummonerData, DEFAULT_MATCH_LIMIT } from '@/lib/tftService'
import { calculateProfileStats } from '@/lib/profile'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/cache'
import { rateLimitGuard, readJson, normalizeGameNameTagLine, isNextResponse, handleApiError } from '@/lib/apiUtils'
import { TftSearchResponse } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/tft/search
 * 소환사 ID 로 최근 매치 "리스트"와 프로필만 반환한다. (AI 분석은 하지 않음 → 빠름)
 * 경기별 상세/코칭은 POST /api/tft/match 로 개별 요청한다.
 */
export async function POST(req: NextRequest) {
  try {
    const limited = rateLimitGuard(req, 'search', 30, 60_000)
    if (limited) return limited

    const raw = await readJson(req)
    if (isNextResponse(raw)) return raw

    const nt = normalizeGameNameTagLine(raw)
    if (isNextResponse(nt)) return nt
    const { gameName, tagLine } = nt

    const limit = typeof raw.limit === 'number' ? raw.limit : DEFAULT_MATCH_LIMIT
    const isDemo = raw.isDemo === true

    const cacheKey = `search:${gameName}#${tagLine}:${limit}:${isDemo}`
    const cached = cacheGet<TftSearchResponse>(cacheKey)
    if (cached) return NextResponse.json(cached)

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

    cacheSet(cacheKey, response, CACHE_TTL.SEARCH)
    return NextResponse.json(response)
  } catch (err) {
    return handleApiError(err, 'search')
  }
}

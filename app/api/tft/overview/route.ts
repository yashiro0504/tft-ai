import { NextRequest, NextResponse } from 'next/server'
import { generateMetaCoachFeedback } from '@/lib/llm'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/cache'
import { rateLimitGuard, readJson, normalizeGameNameTagLine, isNextResponse, handleApiError } from '@/lib/apiUtils'
import { MAX_MATCH_LIMIT } from '@/lib/tftService'
import { SlimMatchData, TftOverviewResponse } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/tft/overview
 * 이미 로드된 여러 경기의 SlimMatchData[] 를 받아 "종합" AI 분석을 수행한다.
 * (검색 시 클라이언트가 보유한 데이터를 재사용 → Riot 재호출 없음)
 */
export async function POST(req: NextRequest) {
  try {
    const limited = rateLimitGuard(req, 'overview', 10, 60_000)
    if (limited) return limited

    const raw = await readJson(req)
    if (isNextResponse(raw)) return raw

    const nt = normalizeGameNameTagLine(raw)
    if (isNextResponse(nt)) return nt
    const { gameName, tagLine } = nt

    const inputMatches = Array.isArray(raw.matches) ? (raw.matches as SlimMatchData[]) : []
    const matches = inputMatches
      .filter((m): m is SlimMatchData => Boolean(m && typeof m.placement === 'number' && Array.isArray(m.units)))
      .slice(0, MAX_MATCH_LIMIT)

    if (matches.length === 0) {
      return NextResponse.json(
        { success: false, error: '종합 분석할 경기 데이터가 없습니다. 먼저 전적 검색을 실행해주세요.' },
        { status: 400 }
      )
    }

    const mode: 'single' | 'multi' = raw.mode === 'single' ? 'single' : 'multi'
    const ids = matches.map((m) => m.matchId).join(',')

    const cacheKey = `overview:${gameName}#${tagLine}:${mode}:${ids}`
    const cached = cacheGet<TftOverviewResponse>(cacheKey)
    if (cached) return NextResponse.json(cached)

    const feedback = await generateMetaCoachFeedback(gameName, matches, mode)

    const response: TftOverviewResponse = {
      success: true,
      gameName,
      tagLine,
      mode,
      matchCount: matches.length,
      feedback,
    }

    cacheSet(cacheKey, response, CACHE_TTL.OVERVIEW)
    return NextResponse.json(response)
  } catch (err) {
    return handleApiError(err, 'overview')
  }
}

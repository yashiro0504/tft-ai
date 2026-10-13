import { NextRequest, NextResponse } from 'next/server'
import { getTftMatchDetail, getAccountByRiotId } from '@/lib/riot'
import { extractSlimMatchData } from '@/lib/summarize'
import { getDemoMatches } from '@/lib/demo'
import { generateMetaCoachFeedback } from '@/lib/llm'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/cache'
import { rateLimitGuard, readJson, normalizeGameNameTagLine, isNextResponse, handleApiError } from '@/lib/apiUtils'
import { SlimMatchData, TftMatchAnalysisResponse } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/tft/match
 * 특정 경기(matchId) 1개를 정밀 AI 분석한다.
 * - 매치 데이터는 불변 → matchId 기준으로 결과를 캐시하여 재분석은 즉시 응답.
 * - 실데이터: puuid(권장, 검색 응답에서 획득) 또는 gameName/tagLine 으로 계정 조회.
 */
export async function POST(req: NextRequest) {
  try {
    const limited = rateLimitGuard(req, 'match', 30, 60_000)
    if (limited) return limited

    const raw = await readJson(req)
    if (isNextResponse(raw)) return raw

    const matchId = typeof raw.matchId === 'string' ? raw.matchId.trim() : ''
    if (!matchId) {
      return NextResponse.json({ success: false, error: '분석할 경기(matchId)가 필요합니다.' }, { status: 400 })
    }

    const isDemo = raw.isDemo === true
    const mode: 'single' | 'multi' = raw.mode === 'multi' ? 'multi' : 'single'
    let puuid = typeof raw.puuid === 'string' ? raw.puuid.trim() : ''
    const gameNameInput = typeof raw.gameName === 'string' ? raw.gameName.trim() : ''

    const cacheKey = `match:${matchId}:${puuid}:${gameNameInput}:${mode}`
    const cached = cacheGet<TftMatchAnalysisResponse>(cacheKey)
    if (cached) {
      return NextResponse.json({ ...cached, cached: true })
    }

    const hasApiKey = Boolean(process.env.RIOT_API_KEY)
    let match: SlimMatchData | null = null
    let displayName = gameNameInput || '소환사'

    if (isDemo || !hasApiKey) {
      match = getDemoMatches(displayName).find((m) => m.matchId === matchId) || null
    } else {
      if (!puuid) {
        const nt = normalizeGameNameTagLine(raw)
        if (isNextResponse(nt)) return nt
        const account = await getAccountByRiotId(nt.gameName, nt.tagLine)
        puuid = account.puuid
        displayName = account.gameName
      }
      const rawMatch = await getTftMatchDetail(matchId)
      match = extractSlimMatchData(rawMatch, puuid)
    }

    if (!match) {
      return NextResponse.json(
        { success: false, error: '해당 경기 데이터를 찾을 수 없습니다. (matchId 또는 소환사 정보를 확인해주세요)' },
        { status: 404 }
      )
    }

    const feedback = await generateMetaCoachFeedback(displayName, [match], mode)

    const response: TftMatchAnalysisResponse = {
      success: true,
      matchId,
      match,
      feedback,
      cached: false,
    }

    cacheSet(cacheKey, response, CACHE_TTL.MATCH)
    return NextResponse.json(response)
  } catch (err) {
    return handleApiError(err, 'match')
  }
}

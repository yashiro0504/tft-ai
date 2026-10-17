import { NextRequest, NextResponse } from 'next/server'
import { getTftMatchDetail, getAccountByRiotId } from '@/lib/riot'
import { extractSlimMatchData } from '@/lib/summarize'
import { getDemoMatches } from '@/lib/demo'
import { generateMetaCoachFeedback } from '@/lib/llm'
import { cacheGetWithSource, cacheSet, CACHE_TTL } from '@/lib/cache'
import { elapsedMs, errorFields, incrMetric, logEvent } from '@/lib/observability'
import { COACH_PROMPT_VERSION } from '@/lib/llm'
import { quotaGuard, rateLimitGuard, readJson, normalizeGameNameTagLine, isNextResponse, handleApiError } from '@/lib/apiUtils'
import { dailyQuotaLimit } from '@/lib/quota'
import { SlimMatchData, TftMatchAnalysisResponse } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/tft/match
 * 특정 경기(matchId) 1개를 정밀 AI 분석한다.
 * - 매치 데이터는 불변 → matchId 기준으로 결과를 캐시하여 재분석은 즉시 응답.
 * - 실데이터: puuid(권장, 검색 응답에서 획득) 또는 gameName/tagLine 으로 계정 조회.
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  try {
    const limited = rateLimitGuard(req, 'match', 30, 60_000)
    if (limited) return limited

    const daily = await quotaGuard(req, 'analysis', dailyQuotaLimit('QUOTA_ANALYSIS_PER_DAY', 10))
    if (daily) return daily

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

    // 프롬프트 버전을 키에 포함: 프롬프트를 바꾸면 자동으로 새 분석을 생성한다.
    const subject = puuid || gameNameInput.toLowerCase() || 'anon'
    const cacheKey = `analysis:${matchId}:${subject}:${mode}:${COACH_PROMPT_VERSION}`
    const cached = await cacheGetWithSource<TftMatchAnalysisResponse>(cacheKey)
    if (cached) {
      incrMetric('llm.cache_hit.match_analysis')
      logEvent('info', 'api_match', {
        ms: elapsedMs(startedAt),
        cacheSource: cached.source,
        matchId,
        mode,
      })
      return NextResponse.json({ ...cached.value, cached: true })
    }

    const hasApiKey = Boolean(process.env.RIOT_API_KEY)
    let match: SlimMatchData | null = null
    let displayName = gameNameInput || '소환사'

    // 프로덕션에서 키가 없을 때 데모 데이터로 조용히 폴백하지 않는다.
    if (!isDemo && !hasApiKey && process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { success: false, error: '서비스 준비 중입니다. 잠시 후 다시 시도해주세요.' },
        { status: 503 }
      )
    }

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

    await cacheSet(cacheKey, response, CACHE_TTL.MATCH)
    logEvent('info', 'api_match', {
      ms: elapsedMs(startedAt),
      cacheSource: 'miss',
      matchId,
      mode,
      isDemo,
    })
    return NextResponse.json(response)
  } catch (err) {
    logEvent('error', 'api_match_failed', { ms: elapsedMs(startedAt), ...errorFields(err) })
    return handleApiError(err, 'match')
  }
}

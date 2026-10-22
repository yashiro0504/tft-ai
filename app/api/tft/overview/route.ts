import { NextRequest, NextResponse } from 'next/server'
import { generateMetaCoachFeedback } from '@/lib/llm'
import { cacheGetWithSource, cacheSet, CACHE_TTL } from '@/lib/cache'
import { elapsedMs, errorFields, incrMetric, logEvent } from '@/lib/observability'
import { COACH_PROMPT_VERSION } from '@/lib/llm'
import { SCORING_VERSION } from '@/lib/axisConfig'
import { quotaGuard, rateLimitGuard, readJson, normalizeGameNameTagLine, isNextResponse, handleApiError } from '@/lib/apiUtils'
import { dailyQuotaLimit } from '@/lib/quota'
import { getAuthUser } from '@/lib/supabase/server'
import { MAX_MATCH_LIMIT } from '@/lib/tftService'
import { rankedMatches } from '@/lib/queue'
import { SlimMatchData, TftOverviewResponse } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/tft/overview
 * 이미 로드된 여러 경기의 SlimMatchData[] 를 받아 "종합" AI 분석을 수행한다.
 * (검색 시 클라이언트가 보유한 데이터를 재사용 → Riot 재호출 없음)
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  try {
    const limited = rateLimitGuard(req, 'overview', 10, 60_000)
    if (limited) return limited

    const daily = await quotaGuard(
      req,
      'overview',
      dailyQuotaLimit('QUOTA_OVERVIEW_PER_DAY', 10),
      (await getAuthUser())?.id,
      dailyQuotaLimit('QUOTA_OVERVIEW_PRO_PER_DAY', 10)
    )
    if (daily) return daily

    const raw = await readJson(req)
    if (isNextResponse(raw)) return raw

    const nt = normalizeGameNameTagLine(raw)
    if (isNextResponse(nt)) return nt
    const { gameName, tagLine } = nt

    const inputMatches = Array.isArray(raw.matches) ? (raw.matches as SlimMatchData[]) : []
    const valid = inputMatches
      .filter((m): m is SlimMatchData => Boolean(m && typeof m.placement === 'number' && Array.isArray(m.units)))
      .slice(0, MAX_MATCH_LIMIT)
    // 이벤트·일반 판은 분석에서 뺀다 (lib/queue)
    const matches = rankedMatches(valid)

    if (matches.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: valid.length
            ? '최근 경기에 랭크 게임이 없습니다. 종합 분석은 랭크 게임만 합니다.'
            : '종합 분석할 경기 데이터가 없습니다. 먼저 전적 검색을 실행해주세요.',
        },
        { status: 400 }
      )
    }

    const mode: 'single' | 'multi' = raw.mode === 'single' ? 'single' : 'multi'
    // 신뢰성 평가 하네스용 캐시 우회 (프로덕션에서는 무시)
    const nocache = raw.nocache === true && process.env.NODE_ENV !== 'production'
    const ids = matches.map((m) => m.matchId).join(',')

    const cacheKey = `overview:${gameName.toLowerCase()}#${tagLine.toUpperCase()}:${mode}:${COACH_PROMPT_VERSION}:${SCORING_VERSION}:${ids}`
    if (!nocache) {
      const cached = await cacheGetWithSource<TftOverviewResponse>(cacheKey)
      if (cached) {
        incrMetric('llm.cache_hit.overview')
        logEvent('info', 'api_overview', {
          ms: elapsedMs(startedAt),
          cacheSource: cached.source,
          mode,
          matchCount: matches.length,
        })
        return NextResponse.json(cached.value)
      }
    }

    const feedback = await generateMetaCoachFeedback(gameName, matches, mode)

    const response: TftOverviewResponse = {
      success: true,
      gameName,
      tagLine,
      mode,
      matchCount: matches.length,
      feedback,
    }

    if (!nocache) await cacheSet(cacheKey, response, CACHE_TTL.OVERVIEW)
    logEvent('info', 'api_overview', {
      ms: elapsedMs(startedAt),
      cacheSource: nocache ? 'bypass' : 'miss',
      mode,
      matchCount: matches.length,
    })
    return NextResponse.json(response)
  } catch (err) {
    logEvent('error', 'api_overview_failed', { ms: elapsedMs(startedAt), ...errorFields(err) })
    return handleApiError(err, 'overview')
  }
}

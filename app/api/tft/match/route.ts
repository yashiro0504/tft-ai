import { NextRequest, NextResponse } from 'next/server'
import { elapsedMs, errorFields, logEvent } from '@/lib/observability'
import {
  MatchAnalysisError,
  runMatchAnalysis,
  type MatchAnalysisParams,
} from '@/lib/matchAnalysis'
import {
  quotaGuard,
  rateLimitGuard,
  readJson,
  normalizeGameNameTagLine,
  isNextResponse,
  handleApiError,
  turnstileGuard,
} from '@/lib/apiUtils'
import { dailyQuotaLimit } from '@/lib/quota'
import { getAuthUser } from '@/lib/supabase/server'
import { botGateForbidden, hasBotGate, issueBotGate } from '@/lib/botGate'

export const dynamic = 'force-dynamic'

/**
 * POST /api/tft/match
 * 특정 경기(matchId) 1개를 정밀 AI 분석한다. (동기 JSON 응답)
 *
 * - 매치 데이터는 불변 → matchId 기준으로 결과를 캐시하여 재분석은 즉시 응답.
 * - 실데이터: puuid(권장, 검색 응답에서 획득) 또는 gameName/tagLine 으로 계정 조회.
 * - 진행 상황이 필요하면 `POST /api/tft/match/stream` (SSE) 을 쓴다.
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  try {
    const limited = rateLimitGuard(req, 'match', 30, 60_000)
    if (limited) return limited

    const raw = await readJson(req)
    if (isNextResponse(raw)) return raw

    // 봇 게이트: 검색 통과 쿠키가 있으면 통과, 없으면 Turnstile 토큰을 검증한다.
    // Turnstile 로 통과했으면 응답에 게이트 쿠키를 새로 실어 다음 경기 분석은 바로 통과시킨다.
    let passedByTurnstile = false
    if (!hasBotGate(req)) {
      const hasToken = typeof raw.turnstileToken === 'string' && raw.turnstileToken.trim().length > 0
      if (!hasToken) return botGateForbidden()
      const botCheck = await turnstileGuard(req, raw)
      if (botCheck) return botCheck
      passedByTurnstile = true
    }

    const daily = await quotaGuard(
      req,
      'analysis',
      dailyQuotaLimit('QUOTA_ANALYSIS_PER_DAY', 10),
      (await getAuthUser())?.id,
      dailyQuotaLimit('QUOTA_ANALYSIS_PRO_PER_DAY', 10)
    )
    if (daily) return daily

    const matchId = typeof raw.matchId === 'string' ? raw.matchId.trim() : ''
    if (!matchId) {
      return NextResponse.json({ success: false, error: '분석할 경기(matchId)가 필요합니다.' }, { status: 400 })
    }

    const params: MatchAnalysisParams = {
      matchId,
      puuid: typeof raw.puuid === 'string' ? raw.puuid.trim() : '',
      isDemo: raw.isDemo === true,
      mode: raw.mode === 'multi' ? 'multi' : 'single',
    }

    if (!params.puuid) {
      const nt = normalizeGameNameTagLine(raw)
      if (isNextResponse(nt)) return nt
      params.gameName = nt.gameName
      params.tagLine = nt.tagLine
    }

    const outcome = await runMatchAnalysis(params)

    logEvent('info', 'api_match', {
      ms: elapsedMs(startedAt),
      cacheSource: outcome.cached ? 'hit' : 'miss',
      matchId,
      mode: params.mode,
      isDemo: params.isDemo,
    })
    const res = NextResponse.json(outcome.response)
    return passedByTurnstile ? issueBotGate(res, req) : res
  } catch (err) {
    if (err instanceof MatchAnalysisError) {
      logEvent('warn', 'api_match_rejected', {
        ms: elapsedMs(startedAt),
        status: err.status,
        errorMessage: err.message,
      })
      return NextResponse.json({ success: false, error: err.message }, { status: err.status })
    }
    logEvent('error', 'api_match_failed', { ms: elapsedMs(startedAt), ...errorFields(err) })
    return handleApiError(err, 'match')
  }
}

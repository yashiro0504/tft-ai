import { NextRequest, NextResponse } from 'next/server'
import { loadDeckReport } from '@/lib/deckReport'
import { loadSummonerData, DEFAULT_MATCH_LIMIT } from '@/lib/tftService'
import { calculateProfileStats } from '@/lib/profile'
import { cacheGet, cacheGetWithSource, cacheSet, CACHE_TTL } from '@/lib/cache'
import { elapsedMs, errorFields, logEvent } from '@/lib/observability'
import { quotaGuard, rateLimitGuard, readJson, normalizeGameNameTagLine, isNextResponse, handleApiError, turnstileGuard } from '@/lib/apiUtils'
import { dailyQuotaLimit } from '@/lib/quota'
import { hasBotGate, issueBotGate } from '@/lib/botGate'
import { getAuthUser } from '@/lib/supabase/server'
import { TftSearchResponse } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** 같은 소환사의 Riot 재조회(전적 갱신) 최소 간격 */
const REFRESH_COOLDOWN_MS = 2 * 60_000

/**
 * POST /api/tft/search
 * 소환사 ID 로 최근 매치 "리스트"와 프로필만 반환한다. (AI 분석은 하지 않음 → 빠름)
 * 경기별 상세/코칭은 POST /api/tft/match 로 개별 요청한다.
 *
 * `refresh: true`(전적 갱신)면 검색 캐시와 매치 목록/랭크 캐시를 건너뛰고 Riot 에서 다시 받는다.
 * 같은 소환사는 REFRESH_COOLDOWN_MS 에 한 번만 재조회하며, 쿨다운 중에는 캐시 응답을 그대로 준다.
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  try {
    const limited = rateLimitGuard(req, 'search', 30, 60_000)
    if (limited) return limited

    const daily = await quotaGuard(
      req,
      'search',
      dailyQuotaLimit('QUOTA_SEARCH_PER_DAY', 50),
      (await getAuthUser())?.id,
      dailyQuotaLimit('QUOTA_SEARCH_PRO_PER_DAY', 200)
    )
    if (daily) return daily

    const raw = await readJson(req)
    if (isNextResponse(raw)) return raw

    const refresh = raw.refresh === true

    // 갱신은 직전 검색에서 받은 게이트 쿠키로 통과할 수 있다. (Turnstile 토큰은 1회용이라 재발급을 기다리지 않게)
    if (!(refresh && hasBotGate(req))) {
      const botCheck = await turnstileGuard(req, raw)
      if (botCheck) return botCheck
    }

    const nt = normalizeGameNameTagLine(raw)
    if (isNextResponse(nt)) return nt
    const { gameName, tagLine } = nt

    const limit = typeof raw.limit === 'number' ? raw.limit : DEFAULT_MATCH_LIMIT
    const isDemo = raw.isDemo === true

    // 키 정규화: 대소문자/공백 차이로 캐시가 갈라지지 않도록 한다.
    const summonerKey = `${gameName.toLowerCase()}#${tagLine.toUpperCase()}`
    const cacheKey = `search:${summonerKey}:${limit}:${isDemo}`
    // Riot 에서 마지막으로 받아온 시각 (쿨다운 동안만 남는다)
    const cooldownKey = `search-fetched:${summonerKey}:${limit}:${isDemo}`
    const lastFetchedAt = await cacheGet<number>(cooldownKey)
    const refreshAvailableAt = lastFetchedAt ? lastFetchedAt + REFRESH_COOLDOWN_MS : Date.now()
    const canRefresh = refresh && !isDemo && Date.now() >= refreshAvailableAt

    const cached = canRefresh ? null : await cacheGetWithSource<TftSearchResponse>(cacheKey)
    if (cached) {
      logEvent('info', 'api_search', {
        ms: elapsedMs(startedAt),
        cacheSource: cached.source,
        isDemo,
        refresh,
      })
      // 덱 성적표는 캐시 값에 넣지 않고 매번 붙인다 (메타 덱 통계가 갱신되면 바로 반영 · 메모 캐시라 비용이 작다)
      const deckReport = await loadDeckReport(cached.value.matches)
      return issueBotGate(NextResponse.json({ ...cached.value, deckReport, refreshAvailableAt }), req)
    }

    const data = await loadSummonerData(gameName, tagLine, limit, isDemo, { fresh: canRefresh })
    const fetchedAt = Date.now()
    const summonerProfile = calculateProfileStats(
      data.matches,
      data.gameName,
      data.tagLine,
      data.summonerLevel,
      data.profileIconId,
      data.rank
    )

    const response: TftSearchResponse = {
      success: true,
      gameName: data.gameName,
      tagLine: data.tagLine,
      puuid: data.puuid,
      summonerProfile,
      matches: data.matches,
      olderScanned: data.olderScanned,
      isDemo: data.isDemo,
      fetchedAt,
    }

    await Promise.all([
      cacheSet(cacheKey, response, CACHE_TTL.SEARCH),
      cacheSet(cooldownKey, fetchedAt, REFRESH_COOLDOWN_MS),
    ])
    logEvent('info', 'api_search', {
      ms: elapsedMs(startedAt),
      cacheSource: 'miss',
      isDemo: data.isDemo,
      matches: data.matches.length,
      refresh,
    })
    const deckReport = await loadDeckReport(response.matches)
    return issueBotGate(NextResponse.json({ ...response, deckReport, refreshAvailableAt: fetchedAt + REFRESH_COOLDOWN_MS }), req)
  } catch (err) {
    logEvent('error', 'api_search_failed', { ms: elapsedMs(startedAt), ...errorFields(err) })
    return handleApiError(err, 'search')
  }
}

import { getAccountByRiotId, getTftMatchIds, getTftMatchDetail, getSummonerByPuuid, RiotApiError } from './riot'
import { cacheGet, cacheSet, CACHE_TTL } from './cache'
import { errorFields, incrMetric, logEvent } from './observability'
import { extractSlimMatchData } from './summarize'
import { getDemoMatches } from './demo'
import { RiotAccount, SlimMatchData } from './types'

/** 한 번에 로드 가능한 최대 매치 수 */
export const MAX_MATCH_LIMIT = 20
export const DEFAULT_MATCH_LIMIT = 10

const REGION = process.env.RIOT_REGION || 'asia'
const PLATFORM = process.env.RIOT_PLATFORM || 'kr'


export interface LoadedSummonerData {
  gameName: string
  tagLine: string
  puuid: string
  summonerLevel: number
  profileIconId: number
  matches: SlimMatchData[]
  isDemo: boolean
}

/**
 * 소환사 + 최근 매치 목록을 로드한다 (데모 모드 자동 처리 포함).
 * - API 키가 없거나 isDemo=true 이면 시뮬레이션 데이터를 반환한다.
 */
export async function loadSummonerData(
  gameName: string,
  tagLine: string,
  limit: number = DEFAULT_MATCH_LIMIT,
  isDemo = false
): Promise<LoadedSummonerData> {
  const hasApiKey = Boolean(process.env.RIOT_API_KEY)
  const normalizedLimit = Math.min(Math.max(Math.floor(limit) || DEFAULT_MATCH_LIMIT, 1), MAX_MATCH_LIMIT)

  if (isDemo || !hasApiKey) {
    const matches = getDemoMatches(gameName).slice(0, normalizedLimit)
    return {
      gameName,
      tagLine,
      puuid: 'DEMO_PUUID',
      summonerLevel: 120,
      profileIconId: 7193,
      matches,
      isDemo: !hasApiKey || isDemo,
    }
  }

  // 1. Riot Account 조회 (PUUID) — 계정 식별자는 거의 불변 → 24h 캐시
  const accountKey = `account:${REGION}:${gameName.toLowerCase()}#${tagLine.toUpperCase()}`
  let account = await cacheGet<RiotAccount>(accountKey)
  if (account) {
    incrMetric('riot.cache_hit.account')
  } else {
    account = await getAccountByRiotId(gameName, tagLine, REGION)
    await cacheSet(accountKey, account, CACHE_TTL.ACCOUNT)
  }
  const acct = account

  // 2. 소환사 기본 정보(아이콘/레벨) — 6h 캐시
  const summonerKey = `summoner:${PLATFORM}:${acct.puuid}`
  let summonerInfo = await cacheGet<{ profileIconId: number; summonerLevel: number }>(summonerKey)
  if (summonerInfo) {
    incrMetric('riot.cache_hit.summoner')
  } else {
    summonerInfo = await getSummonerByPuuid(acct.puuid, PLATFORM)
    await cacheSet(summonerKey, summonerInfo, CACHE_TTL.SUMMONER)
  }

  // 3. 최근 TFT 매치 ID 목록 — 새 경기 반영을 위해 짧게 캐시
  const matchIdsKey = `matchids:${REGION}:${acct.puuid}:${normalizedLimit}`
  let matchIds = await cacheGet<string[]>(matchIdsKey)
  if (matchIds) {
    incrMetric('riot.cache_hit.match_ids')
  } else {
    matchIds = await getTftMatchIds(acct.puuid, normalizedLimit, REGION)
    if (matchIds.length > 0) await cacheSet(matchIdsKey, matchIds, CACHE_TTL.MATCH_IDS)
  }

  if (matchIds.length === 0) {
    throw new RiotApiError(
      `소환사 '${acct.gameName}#${acct.tagLine}'의 최근 TFT 매치 기록을 찾을 수 없습니다.`,
      404
    )
  }

  // 4. 매치 세부 데이터 — 불변 데이터이므로 (matchId + puuid) 기준 장기 캐시.
  //    캐시 히트 시 Riot 호출이 0회가 되어, 웜 상태 검색은 사실상 account/summoner/matchIds 만 소모한다.
  const matchDetails = await Promise.all(
    matchIds.map(async (id) => {
      const matchKey = `match:${REGION}:${id}:${acct.puuid}`
      const cachedMatch = await cacheGet<SlimMatchData>(matchKey)
      if (cachedMatch) {
        incrMetric('riot.cache_hit.match_detail')
        return cachedMatch
      }

      try {
        const rawMatch = await getTftMatchDetail(id, REGION)
        const slim = extractSlimMatchData(rawMatch, acct.puuid)
        await cacheSet(matchKey, slim, CACHE_TTL.IMMUTABLE)
        return slim
      } catch (err) {
        incrMetric('riot.match_detail_failed')
        logEvent('warn', 'match_detail_failed', { matchId: id, ...errorFields(err) })
        return null
      }
    })
  )

  const matches = matchDetails.filter((m): m is SlimMatchData => m !== null)
  if (matches.length === 0) {
    throw new RiotApiError('TFT 매치 세부 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', 502)
  }

  return {
    gameName: acct.gameName,
    tagLine: acct.tagLine,
    puuid: acct.puuid,
    summonerLevel: summonerInfo.summonerLevel,
    profileIconId: summonerInfo.profileIconId,
    matches,
    isDemo: false,
  }
}

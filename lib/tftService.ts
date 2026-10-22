import { getAccountByRiotId, getTftLeagueByPuuid, getTftMatchIds, getTftMatchDetail, getSummonerByPuuid, RiotApiError } from './riot'
import { cacheGet, cacheSet, CACHE_TTL } from './cache'
import { errorFields, incrMetric, logEvent } from './observability'
import { extractSlimMatchData } from './summarize'
import { getDemoMatches } from './demo'
import { RiotAccount, SlimMatchData, TftRankInfo } from './types'

/** 한 번에 로드 가능한 최대 매치 수 */
export const MAX_MATCH_LIMIT = 20
export const DEFAULT_MATCH_LIMIT = 10

const REGION = process.env.RIOT_REGION || 'asia'
const PLATFORM = process.env.RIOT_PLATFORM || 'kr'

/** 데모 모드에서 보여줄 예시 랭크. (응답에 isDemo=true 가 함께 나가므로 실제 전적으로 오인되지 않는다) */
const DEMO_RANK: TftRankInfo = {
  queueType: 'RANKED_TFT',
  tier: 'GOLD',
  rank: 'II',
  leaguePoints: 45,
  wins: 32,
  losses: 28,
}


export interface LoadedSummonerData {
  gameName: string
  tagLine: string
  puuid: string
  summonerLevel: number
  profileIconId: number
  /** 랭크(티어/LP). 배치 중·조회 실패 시 null */
  rank: TftRankInfo | null
  matches: SlimMatchData[]
  isDemo: boolean
}

/** 랭크 캐시 값. `null`(배치 중)도 캐시하기 위해 래퍼로 감싼다. */
interface RankCacheEntry {
  rank: TftRankInfo | null
}

/**
 * 소환사 + 최근 매치 목록을 로드한다 (데모 모드 자동 처리 포함).
 * - API 키가 없거나 isDemo=true 이면 시뮬레이션 데이터를 반환한다.
 * - `fresh: true`(전적 갱신)면 자주 바뀌는 캐시(아이콘/레벨·매치 ID 목록·랭크)를 읽지 않고
 *   Riot 에서 다시 받아 캐시를 덮어쓴다. 계정(PUUID)·매치 상세는 불변이라 그대로 재사용한다.
 */
export async function loadSummonerData(
  gameName: string,
  tagLine: string,
  limit: number = DEFAULT_MATCH_LIMIT,
  isDemo = false,
  { fresh = false }: { fresh?: boolean } = {}
): Promise<LoadedSummonerData> {
  const hasApiKey = Boolean(process.env.RIOT_API_KEY)
  const normalizedLimit = Math.min(Math.max(Math.floor(limit) || DEFAULT_MATCH_LIMIT, 1), MAX_MATCH_LIMIT)

  // 프로덕션에서 키가 없으면 데모 데이터를 "조용히" 보여주지 않는다.
  // (키 만료 사고 시 사용자가 가짜 전적을 실제로 오인하는 것을 방지)
  if (!hasApiKey && !isDemo && process.env.NODE_ENV === 'production') {
    throw new RiotApiError('서비스 준비 중입니다. 잠시 후 다시 시도해주세요.', 503)
  }

  if (isDemo || !hasApiKey) {
    const matches = getDemoMatches(gameName).slice(0, normalizedLimit)
    return {
      gameName,
      tagLine,
      puuid: 'DEMO_PUUID',
      summonerLevel: 120,
      profileIconId: 7193,
      rank: DEMO_RANK,
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
  let summonerInfo = fresh ? null : await cacheGet<{ profileIconId: number; summonerLevel: number }>(summonerKey)
  if (summonerInfo) {
    incrMetric('riot.cache_hit.summoner')
  } else {
    summonerInfo = await getSummonerByPuuid(acct.puuid, PLATFORM)
    await cacheSet(summonerKey, summonerInfo, CACHE_TTL.SUMMONER)
  }

  // 3. 최근 TFT 매치 ID 목록 — 새 경기 반영을 위해 짧게 캐시
  //    랭크(TFT-LEAGUE-V1)는 부가 정보이므로 matchIds 와 병렬로 조회해 지연을 늘리지 않는다.
  const matchIdsPromise = (async () => {
    const matchIdsKey = `matchids:${REGION}:${acct.puuid}:${normalizedLimit}`
    const cachedIds = fresh ? null : await cacheGet<string[]>(matchIdsKey)
    if (cachedIds) {
      incrMetric('riot.cache_hit.match_ids')
      return cachedIds
    }
    const ids = await getTftMatchIds(acct.puuid, normalizedLimit, REGION)
    if (ids.length > 0) await cacheSet(matchIdsKey, ids, CACHE_TTL.MATCH_IDS)
    return ids
  })()

  const rankPromise = (async (): Promise<TftRankInfo | null> => {
    const rankKey = `rank:${PLATFORM}:${acct.puuid}`
    const cachedRank = fresh ? null : await cacheGet<RankCacheEntry>(rankKey)
    if (cachedRank) {
      incrMetric('riot.cache_hit.rank')
      return cachedRank.rank
    }
    const rank = await getTftLeagueByPuuid(acct.puuid, PLATFORM)
    // 배치 중(null)도 캐시해 미배치 계정이 매 검색마다 Riot 을 호출하지 않게 한다.
    await cacheSet<RankCacheEntry>(rankKey, { rank }, CACHE_TTL.RANK)
    return rank
  })()

  const [matchIds, rank] = await Promise.all([matchIdsPromise, rankPromise])

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
      // match2: queueId 추가 (2026-10-23) — 예전 캐시는 이벤트 판도 '랭크 게임'으로 저장돼 있어 다시 받는다
      const matchKey = `match2:${REGION}:${id}:${acct.puuid}`
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
    rank,
    matches,
    isDemo: false,
  }
}

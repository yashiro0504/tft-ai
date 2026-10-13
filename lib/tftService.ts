import { getAccountByRiotId, getTftMatchIds, getTftMatchDetail, getSummonerByPuuid, RiotApiError } from './riot'
import { extractSlimMatchData } from './summarize'
import { getDemoMatches } from './demo'
import { SlimMatchData } from './types'

/** 한 번에 로드 가능한 최대 매치 수 */
export const MAX_MATCH_LIMIT = 20
export const DEFAULT_MATCH_LIMIT = 10

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

  // 1. Riot Account 조회 (PUUID)
  const account = await getAccountByRiotId(gameName, tagLine)

  // 2. 소환사 기본 정보 (프로필 아이콘, 레벨)
  const summonerInfo = await getSummonerByPuuid(account.puuid)

  // 3. 최근 TFT 매치 ID 목록
  const matchIds = await getTftMatchIds(account.puuid, normalizedLimit)
  if (!matchIds || matchIds.length === 0) {
    throw new RiotApiError(
      `소환사 '${account.gameName}#${account.tagLine}'의 최근 TFT 매치 기록을 찾을 수 없습니다.`,
      404
    )
  }

  // 4. 매치 세부 데이터 병렬 조회 및 정제
  const matchDetails = await Promise.all(
    matchIds.map(async (id) => {
      try {
        const rawMatch = await getTftMatchDetail(id)
        return extractSlimMatchData(rawMatch, account.puuid)
      } catch (err) {
        console.error(`Failed to fetch match detail ${id}:`, err)
        return null
      }
    })
  )

  const matches = matchDetails.filter((m): m is SlimMatchData => m !== null)
  if (matches.length === 0) {
    throw new RiotApiError('TFT 매치 세부 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', 502)
  }

  return {
    gameName: account.gameName,
    tagLine: account.tagLine,
    puuid: account.puuid,
    summonerLevel: summonerInfo.summonerLevel,
    profileIconId: summonerInfo.profileIconId,
    matches,
    isDemo: false,
  }
}

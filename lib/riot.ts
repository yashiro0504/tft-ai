import { RiotAccount, RawTFTMatch } from './types'

const RIOT_API_KEY = process.env.RIOT_API_KEY || ''
const DEFAULT_REGIONAL_ROUTING = process.env.RIOT_REGION || 'asia'

export class RiotApiError extends Error {
  statusCode: number
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'RiotApiError'
    this.statusCode = statusCode
  }
}

/**
 * Riot ID(gameName + tagLine)로 Account-v1 호출하여 PUUID 획득
 */
export async function getAccountByRiotId(
  gameName: string,
  tagLine: string,
  region: string = DEFAULT_REGIONAL_ROUTING
): Promise<RiotAccount> {
  if (!RIOT_API_KEY) {
    throw new RiotApiError('RIOT_API_KEY 환경변수가 설정되지 않았습니다.', 401)
  }

  const encodedName = encodeURIComponent(gameName.trim())
  const encodedTag = encodeURIComponent(tagLine.trim())
  const url = `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodedName}/${encodedTag}`

  const response = await fetch(url, {
    headers: {
      'X-Riot-Token': RIOT_API_KEY,
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    if (response.status === 404) {
      throw new RiotApiError(`소환사 '${gameName}#${tagLine}'을(를) 찾을 수 없습니다. 닉네임과 태그를 확인하세요.`, 404)
    }
    if (response.status === 401 || response.status === 403) {
      throw new RiotApiError('Riot API 키가 방금 재발급되어 라이엇 서버 동기화(약 5~15분) 중이거나 만료되었습니다. 잠시 후 다시 시도해주세요.', response.status)
    }
    if (response.status === 429) {
      throw new RiotApiError('Riot API 요청 한도(Rate Limit)를 초과했습니다. 잠시 후 다시 시도해주세요.', 429)
    }
    throw new RiotApiError(`Riot Account API 오류 (${response.status}): ${response.statusText}`, response.status)
  }

  return response.json()
}

/**
  * PUUID로 소환사 정보(아이콘, 레벨 등) 조회
  */
export async function getSummonerByPuuid(
  puuid: string,
  platform: string = 'kr'
): Promise<{ profileIconId: number; summonerLevel: number }> {
  if (!RIOT_API_KEY) {
    return { profileIconId: 7193, summonerLevel: 100 }
  }

  try {
    const url = `https://${platform}.api.riotgames.com/tft/summoner/v1/summoners/by-puuid/${puuid}`
    const response = await fetch(url, {
      headers: { 'X-Riot-Token': RIOT_API_KEY },
      cache: 'no-store',
    })

    if (!response.ok) {
      return { profileIconId: 7193, summonerLevel: 100 }
    }

    const data = await response.json()
    return {
      profileIconId: data.profileIconId || 7193,
      summonerLevel: data.summonerLevel || 100,
    }
  } catch {
    return { profileIconId: 7193, summonerLevel: 100 }
  }
}

/**
 * PUUID로 최근 TFT 매치 ID 목록 조회 (기본 최근 3판)
 */
export async function getTftMatchIds(
  puuid: string,
  count: number = 3,
  region: string = DEFAULT_REGIONAL_ROUTING
): Promise<string[]> {
  if (!RIOT_API_KEY) {
    throw new RiotApiError('RIOT_API_KEY 환경변수가 설정되지 않았습니다.', 401)
  }

  const url = `https://${region}.api.riotgames.com/tft/match/v1/matches/by-puuid/${puuid}/ids?count=${count}`

  const response = await fetch(url, {
    headers: {
      'X-Riot-Token': RIOT_API_KEY,
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    if (response.status === 404) {
      return []
    }
    throw new RiotApiError(`TFT Match IDs API 오류 (${response.status}): ${response.statusText}`, response.status)
  }

  return response.json()
}

/**
 * 매치 ID로 TFT 매치 상세 데이터 조회
 */
export async function getTftMatchDetail(
  matchId: string,
  region: string = DEFAULT_REGIONAL_ROUTING
): Promise<RawTFTMatch> {
  if (!RIOT_API_KEY) {
    throw new RiotApiError('RIOT_API_KEY 환경변수가 설정되지 않았습니다.', 401)
  }

  const url = `https://${region}.api.riotgames.com/tft/match/v1/matches/${matchId}`

  const response = await fetch(url, {
    headers: {
      'X-Riot-Token': RIOT_API_KEY,
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new RiotApiError(`TFT Match Detail API 오류 (${response.status}): ${response.statusText}`, response.status)
  }

  return response.json()
}

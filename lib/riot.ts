import { RiotAccount, RawTFTMatch, TftRankInfo } from './types'
import { errorFields, incrMetric, logEvent } from './observability'

/**
 * Riot API 클라이언트 (TFT).
 *
 * 프로덕션 안전장치:
 *  - 요청 타임아웃 (기본 5s, RIOT_TIMEOUT_MS)
 *  - 429 / 5xx 지수 백오프 재시도 (기본 2회, RIOT_MAX_RETRIES)
 *  - 429 응답의 Retry-After 존중 (대기 시간이 상한을 넘으면 재시도하지 않고 그대로 반환)
 *  - 전역 동시성 제한 (기본 5, RIOT_MAX_CONCURRENCY) — Promise.all 폭주 방지
 *  - 모든 호출을 구조화 로그 + 카운터로 계측
 *
 * ⚠️ 개발 키 한도는 20 req/s + 100 req/2min 이다. 이 클라이언트는 한도를 "지켜주는"
 *    장치이지 한도를 늘려주지 않는다. 호출 수 자체를 줄이려면 캐시(lib/cache.ts)를 쓴다.
 */

const RIOT_API_KEY = process.env.RIOT_API_KEY || ''
const DEFAULT_REGIONAL_ROUTING = process.env.RIOT_REGION || 'asia'
const DEFAULT_PLATFORM = process.env.RIOT_PLATFORM || 'kr'

function intEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

const TIMEOUT_MS = intEnv('RIOT_TIMEOUT_MS', 5_000)
const MAX_RETRIES = intEnv('RIOT_MAX_RETRIES', 2)
const MAX_CONCURRENCY = intEnv('RIOT_MAX_CONCURRENCY', 5)
const MAX_RETRY_WAIT_MS = intEnv('RIOT_MAX_RETRY_WAIT_MS', 2_000)

export class RiotApiError extends Error {
  statusCode: number
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'RiotApiError'
    this.statusCode = statusCode
  }
}

/** 간단한 FIFO 세마포어. Riot API 전역 동시 호출 수를 제한한다. */
class Semaphore {
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active += 1
      return () => this.release()
    }
    await new Promise<void>((resolve) => this.queue.push(resolve))
    return () => this.release()
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1)
    const next = this.queue.shift()
    if (next) {
      this.active += 1
      next()
    }
  }
}

const semaphore = new Semaphore(MAX_CONCURRENCY)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Retry-After(초 또는 HTTP-date) → ms. 없으면 지수 백오프 + 지터. */
function retryDelayMs(response: Response, attempt: number): number {
  const header = response.headers.get('retry-after')
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000)
    const dateMs = Date.parse(header)
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now())
  }
  const base = 300 * 2 ** attempt
  return base + Math.floor(Math.random() * 150)
}

async function riotFetch(url: string, label: string): Promise<Response> {
  if (!RIOT_API_KEY) {
    throw new RiotApiError('RIOT_API_KEY 환경변수가 설정되지 않았습니다.', 401)
  }

  const startedAt = Date.now()

  for (let attempt = 0; ; attempt += 1) {
    const release = await semaphore.acquire()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        headers: { 'X-Riot-Token': RIOT_API_KEY },
        cache: 'no-store',
        signal: controller.signal,
      })

      incrMetric(`riot.status.${response.status}`)

      const retryable = response.status === 429 || response.status >= 500
      if (retryable) incrMetric(`riot.retryable.${response.status}`)

      if (retryable && attempt < MAX_RETRIES) {
        const waitMs = retryDelayMs(response, attempt)
        if (waitMs <= MAX_RETRY_WAIT_MS) {
          incrMetric('riot.retry')
          logEvent('warn', 'riot_retry', {
            label,
            status: response.status,
            attempt: attempt + 1,
            waitMs,
          })
          await sleep(waitMs)
          continue
        }
        logEvent('warn', 'riot_retry_skipped', {
          label,
          status: response.status,
          waitMs,
          maxWaitMs: MAX_RETRY_WAIT_MS,
        })
      }

      logEvent('info', 'riot_call', {
        label,
        status: response.status,
        ms: Date.now() - startedAt,
        attempt: attempt + 1,
      })
      return response
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError'
      if (attempt < MAX_RETRIES) {
        const waitMs = 300 * 2 ** attempt + Math.floor(Math.random() * 150)
        incrMetric(aborted ? 'riot.timeout' : 'riot.network_error')
        logEvent('warn', 'riot_retry', {
          label,
          aborted,
          attempt: attempt + 1,
          waitMs,
          ...errorFields(err),
        })
        await sleep(waitMs)
        continue
      }

      incrMetric(aborted ? 'riot.timeout_final' : 'riot.network_error_final')
      logEvent('error', 'riot_call_failed', {
        label,
        ms: Date.now() - startedAt,
        aborted,
        ...errorFields(err),
      })
      throw new RiotApiError(
        aborted
          ? 'Riot API 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.'
          : 'Riot API 네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        aborted ? 504 : 502
      )
    } finally {
      clearTimeout(timer)
      release()
    }
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
  const encodedName = encodeURIComponent(gameName.trim())
  const encodedTag = encodeURIComponent(tagLine.trim())
  const url = `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodedName}/${encodedTag}`

  const response = await riotFetch(url, 'account.by-riot-id')

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

  return (await response.json()) as RiotAccount
}

/**
 * PUUID로 소환사 정보(아이콘, 레벨 등) 조회.
 * 실패해도 검색 자체는 진행되어야 하므로 기본값으로 폴백한다(로그/카운터 기록).
 */
export async function getSummonerByPuuid(
  puuid: string,
  platform: string = DEFAULT_PLATFORM
): Promise<{ profileIconId: number; summonerLevel: number }> {
  if (!RIOT_API_KEY) {
    return { profileIconId: 7193, summonerLevel: 100 }
  }

  try {
    const url = `https://${platform}.api.riotgames.com/tft/summoner/v1/summoners/by-puuid/${encodeURIComponent(puuid)}`
    const response = await riotFetch(url, 'tft.summoner.by-puuid')

    if (!response.ok) {
      incrMetric('riot.summoner_fallback')
      logEvent('warn', 'riot_summoner_fallback', { status: response.status })
      return { profileIconId: 7193, summonerLevel: 100 }
    }

    const data = (await response.json()) as { profileIconId?: number; summonerLevel?: number }
    return {
      profileIconId: data.profileIconId || 7193,
      summonerLevel: data.summonerLevel || 100,
    }
  } catch (err) {
    incrMetric('riot.summoner_fallback')
    logEvent('warn', 'riot_summoner_fallback', errorFields(err))
    return { profileIconId: 7193, summonerLevel: 100 }
  }
}

/** Riot `tft/league/v1/by-puuid` 원본 응답 항목 (필요한 필드만) */
interface RiotTftLeagueEntry {
  queueType?: string
  tier?: string
  rank?: string
  leaguePoints?: number
  wins?: number
  losses?: number
  hotStreak?: boolean
}

/**
 * PUUID로 TFT 랭크(티어) 정보 조회 — `TFT-LEAGUE-V1`.
 *
 * - 응답은 큐별 배열이며 `queueType === 'RANKED_TFT'` 항목만 사용한다.
 * - 배치 미완료(404), 레이트리밋(429), 키 만료(401), 네트워크 오류는 모두 **null** 로 폴백한다.
 *   → 랭크는 부가 정보이므로 실패해도 검색/프로필 자체는 정상 동작해야 한다.
 */
export async function getTftLeagueByPuuid(
  puuid: string,
  platform: string = DEFAULT_PLATFORM
): Promise<TftRankInfo | null> {
  if (!RIOT_API_KEY || !puuid) return null

  try {
    const url = `https://${platform}.api.riotgames.com/tft/league/v1/by-puuid/${encodeURIComponent(puuid)}`
    const response = await riotFetch(url, 'tft.league.by-puuid')

    if (!response.ok) {
      incrMetric(`riot.league_fallback.${response.status}`)
      logEvent('warn', 'riot_league_fallback', { status: response.status })
      return null
    }

    const entries = (await response.json()) as RiotTftLeagueEntry[]
    if (!Array.isArray(entries)) return null

    const ranked = entries.find((entry) => entry.queueType === 'RANKED_TFT')
    if (!ranked || !ranked.tier) return null

    return {
      queueType: 'RANKED_TFT',
      tier: String(ranked.tier).toUpperCase(),
      rank: String(ranked.rank || 'I').toUpperCase(),
      leaguePoints: Number(ranked.leaguePoints) || 0,
      wins: Number(ranked.wins) || 0,
      losses: Number(ranked.losses) || 0,
      hotStreak: ranked.hotStreak === true,
    }
  } catch (err) {
    incrMetric('riot.league_fallback')
    logEvent('warn', 'riot_league_fallback', errorFields(err))
    return null
  }
}

/**
 * PUUID로 최근 TFT 매치 ID 목록 조회 (기본 최근 10판)
 */
export async function getTftMatchIds(
  puuid: string,
  count: number = 10,
  region: string = DEFAULT_REGIONAL_ROUTING
): Promise<string[]> {
  const url = `https://${region}.api.riotgames.com/tft/match/v1/matches/by-puuid/${encodeURIComponent(puuid)}/ids?count=${count}`

  const response = await riotFetch(url, 'tft.match.ids')

  if (!response.ok) {
    if (response.status === 404) return []
    if (response.status === 429) {
      throw new RiotApiError('Riot API 요청 한도(Rate Limit)를 초과했습니다. 잠시 후 다시 시도해주세요.', 429)
    }
    throw new RiotApiError(`TFT Match IDs API 오류 (${response.status}): ${response.statusText}`, response.status)
  }

  return (await response.json()) as string[]
}

/**
 * 매치 ID로 TFT 매치 상세 데이터 조회
 */
export async function getTftMatchDetail(
  matchId: string,
  region: string = DEFAULT_REGIONAL_ROUTING
): Promise<RawTFTMatch> {
  const url = `https://${region}.api.riotgames.com/tft/match/v1/matches/${encodeURIComponent(matchId)}`

  const response = await riotFetch(url, 'tft.match.detail')

  if (!response.ok) {
    if (response.status === 429) {
      throw new RiotApiError('Riot API 요청 한도(Rate Limit)를 초과했습니다. 잠시 후 다시 시도해주세요.', 429)
    }
    throw new RiotApiError(`TFT Match Detail API 오류 (${response.status}): ${response.statusText}`, response.status)
  }

  return (await response.json()) as RawTFTMatch
}

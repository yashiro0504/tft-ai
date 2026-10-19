/**
 * 수집기 전용 Riot 클라이언트.
 *
 * - 요청 간 최소 간격(RIOT_MIN_INTERVAL_MS)으로 키 한도의 일부만 쓴다.
 *     개발 키(100/2분)  : 1250ms (기본) → 약 0.8/초
 *     프로덕션 키(30,000/10분 = 50/초) : 34ms → 약 30/초 = 한도의 60% (나머지는 사용자 검색 몫)
 * - 429 는 Retry-After 만큼 기다리고, 연속되면 간격을 늘린다 (앱 검색이 같은 키를 쓰므로 수집기가 먼저 물러난다).
 * - 401/403 은 키 문제이므로 즉시 중단한다 (KeyError).
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class KeyError extends Error {}
class NotFoundError extends Error {}

function createRiotClient({ key, minIntervalMs = 1250, fetchImpl = fetch, log = console } = {}) {
  let interval = minIntervalMs
  let last = 0
  let calls = 0
  let throttled = 0

  async function get(url) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const wait = last + interval - Date.now()
      if (wait > 0) await sleep(wait)
      last = Date.now()
      calls++
      const res = await fetchImpl(url, { headers: { 'X-Riot-Token': key } })
      if (res.status === 429) {
        throttled++
        const ra = Number(res.headers.get('retry-after') || 2)
        interval = Math.min(interval * 1.5, 5000)
        log.warn(`  429 → ${ra}s 대기 (간격 ${Math.round(interval)}ms 로 증가)`)
        await sleep((ra + 1) * 1000)
        continue
      }
      if (res.status === 401 || res.status === 403) {
        throw new KeyError(`Riot API ${res.status}: 키가 만료되었거나 무효합니다`)
      }
      if (res.status === 404) throw new NotFoundError(`Riot API 404 :: ${url}`)
      if (res.status >= 500) {
        await sleep(1000 * (attempt + 1))
        continue
      }
      if (!res.ok) throw new Error(`Riot API ${res.status} :: ${url}`)
      return res.json()
    }
    throw new Error(`Riot API 재시도 초과 :: ${url}`)
  }

  return {
    get,
    get calls() {
      return calls
    },
    get throttled() {
      return throttled
    },
  }
}

/** TFT 리그 (challenger | grandmaster | master) → [{ puuid, lp }] */
async function getLeague(client, platform, tier) {
  const data = await client.get(`https://${platform}.api.riotgames.com/tft/league/v1/${tier}?queue=RANKED_TFT`)
  return (data.entries || [])
    .filter((e) => e.puuid)
    .map((e) => ({ puuid: e.puuid, lp: e.leaguePoints || 0 }))
    .sort((a, b) => b.lp - a.lp)
}

/** startTime(초) 이후 매치 ID (최신순) */
async function getMatchIds(client, region, puuid, { startTimeSec, count = 20 } = {}) {
  const qs = new URLSearchParams({ start: '0', count: String(count) })
  if (startTimeSec) qs.set('startTime', String(startTimeSec))
  return client.get(`https://${region}.api.riotgames.com/tft/match/v1/matches/by-puuid/${puuid}/ids?${qs}`)
}

async function getMatch(client, region, matchId) {
  return client.get(`https://${region}.api.riotgames.com/tft/match/v1/matches/${matchId}`)
}

module.exports = { createRiotClient, getLeague, getMatchIds, getMatch, KeyError, NotFoundError }

/**
 * 상위 랭커 보드 수집기 — "고수 운영" 실측용 (data/topPlayerBoards.json, 커밋하지 않음)
 *
 * 챌린저 LP 상위 N명의 최근 랭크 게임에서 "그 선수 본인의" 최종 보드만 모은다.
 * (래더 보드 수집기는 판의 8명 보드를 모으지만, 누가 추적 대상인지는 남기지 않는다)
 *
 * - 개인정보: 닉네임·PUUID 를 저장하지 않는다. 선수 키 = HMAC-SHA256(PUUID, TOP_PLAYER_SALT) 앞 12자.
 *   TOP_PLAYER_SALT 가 없으면 실행마다 임의 값을 써서, 같은 선수라도 실행 간에는 연결되지 않는다.
 * - 개발 키(2분 100회)로도 돈다: 기본 30명 × 10판 ≈ 리그 1 + 목록 30 + 매치 ≤300회 (요청 간격 1.25초 → 약 7분).
 *   상위 랭커끼리 같은 판에 있으면 매치는 한 번만 받는다.
 * - 이미 받은 (판, 선수) 조합은 건너뛴다 (중단 후 재실행 가능).
 *
 * 사용법: node scripts/collectTopPlayers.js
 * 환경변수: TOP_PLAYERS(30) · TOP_MATCHES_PER_PLAYER(10) · TOP_PLAYER_SALT · RIOT_MIN_INTERVAL_MS(1250)
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { loadEnv } = require('./_env')
loadEnv()
if (!process.env.RIOT_MIN_INTERVAL_MS) process.env.RIOT_MIN_INTERVAL_MS = '1250'

const { riotGet } = require('./buildMetaStats')

const KEY = process.env.RIOT_API_KEY || ''
const REGION = process.env.RIOT_REGION || 'asia'
const PLATFORM = process.env.RIOT_PLATFORM || 'kr'
const PLAYERS = Number(process.env.TOP_PLAYERS || 30)
const PER_PLAYER = Number(process.env.TOP_MATCHES_PER_PLAYER || 10)
const SET_NUMBER = 18
const RANKED_QUEUE = 1100
const OUT = path.join(__dirname, '..', 'data', 'topPlayerBoards.json')

const SALT = process.env.TOP_PLAYER_SALT || crypto.randomBytes(16).toString('hex')
const playerKey = (puuid) => crypto.createHmac('sha256', SALT).update(puuid).digest('hex').slice(0, 12)

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(OUT, 'utf-8'))
    if (Array.isArray(data.boards)) return data
  } catch {
    /* 첫 실행 */
  }
  return { version: 1, source: 'riot-top-players', set: SET_NUMBER, region: PLATFORM, boards: [] }
}

function save(data) {
  data.updatedAt = new Date().toISOString()
  data.boardCount = data.boards.length
  fs.writeFileSync(OUT, JSON.stringify(data), 'utf-8')
}

/** 참가자 → 저장용 보드 (collectLadderBoards.toBoards 와 같은 모양 + 선수 키·순위) */
function toBoard(p, player) {
  return {
    player: player.key,
    rank: player.rank,
    lp: player.lp,
    placement: p.placement,
    level: p.level,
    units: (p.units || []).map((u) => ({ id: u.character_id, star: u.tier, items: u.itemNames || [] })),
    traits: (p.traits || [])
      .filter((t) => t.tier_current > 0)
      .map((t) => ({ id: t.name, units: t.num_units, style: t.style, tier: t.tier_current, max: t.tier_total })),
  }
}

async function main() {
  if (!KEY) {
    console.error('RIOT_API_KEY 가 필요합니다 (.env.local)')
    process.exitCode = 1
    return
  }
  if (!process.env.TOP_PLAYER_SALT) console.warn('⚠️ TOP_PLAYER_SALT 없음 → 이번 실행의 선수 키는 이전 실행과 연결되지 않습니다.')

  const league = await riotGet(`https://${PLATFORM}.api.riotgames.com/tft/league/v1/challenger?queue=RANKED_TFT`)
  const top = (league.entries || [])
    .filter((e) => e.puuid)
    .sort((a, b) => b.leaguePoints - a.leaguePoints)
    .slice(0, PLAYERS)
    .map((e, i) => ({ puuid: e.puuid, key: playerKey(e.puuid), rank: i + 1, lp: e.leaguePoints }))
  console.log(`챌린저 ${league.entries?.length || 0}명 중 LP 상위 ${top.length}명 · 선수당 ${PER_PLAYER}판`)

  const data = load()
  const have = new Set(data.boards.map((b) => `${b.matchId}:${b.player}`))
  const matchCache = new Map()
  let added = 0
  let skipped = 0
  let failed = 0
  for (const player of top) {
    let ids = []
    try {
      ids = await riotGet(`https://${REGION}.api.riotgames.com/tft/match/v1/matches/by-puuid/${player.puuid}/ids?count=${PER_PLAYER}`)
    } catch (e) {
      failed++
      if (/만료|무효/.test(e.message)) throw e
      continue
    }
    for (const id of ids) {
      if (have.has(`${id}:${player.key}`)) continue
      try {
        if (!matchCache.has(id)) matchCache.set(id, await riotGet(`https://${REGION}.api.riotgames.com/tft/match/v1/matches/${id}`))
        const info = matchCache.get(id).info || {}
        if (info.tft_set_number !== SET_NUMBER || info.queue_id !== RANKED_QUEUE) {
          skipped++
          continue
        }
        const p = (info.participants || []).find((x) => x.puuid === player.puuid)
        if (!p) continue
        data.boards.push({ matchId: id, datetime: info.game_datetime, ...toBoard(p, player) })
        have.add(`${id}:${player.key}`)
        added++
      } catch (e) {
        failed++
        if (/만료|무효/.test(e.message)) throw e
      }
    }
    save(data)
    console.log(`  ${player.rank}위 (LP ${player.lp}) · 누적 새 보드 ${added}`)
  }
  save(data)
  console.log(`\n✅ 저장 → ${OUT}`)
  console.log(`   새 보드 ${added} · 제외(다른 세트/큐) ${skipped} · 실패 ${failed} · 매치 요청 ${matchCache.size}회 · 누적 ${data.boards.length}`)
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})

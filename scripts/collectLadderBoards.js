/**
 * 래더 최종 보드 수집기 (덱 랭킹 실측용)
 *
 * 챌린저·그랜드마스터·마스터 선수들의 최근 랭크 게임에서 8명의 "최종 보드"를 모은다.
 * 덱 랭킹은 이 보드를 묶어서 계산한다 (scripts/buildDecksFromBoards.js).
 *
 * - 세트18 랭크 큐(queue_id 1100)만 저장한다.
 * - 개인정보(닉네임, PUUID)는 저장하지 않는다. 판 id, 등수, 레벨, 기물/아이템/시너지만 남긴다.
 * - data/ladderBoards.json 에 이어서 저장하고, 이미 받은 판은 건너뛴다 (중단 후 재실행 가능).
 *
 * 사용법: node scripts/collectLadderBoards.js
 *
 * 환경변수:
 *  - MAX_MATCHES(기본 1500)          : 이번 실행에서 새로 받을 판 수 상한
 *  - PLAYERS(기본 160)               : 표본 선수 수 (상위 LP 순, 챌린저 → 그마 → 마스터)
 *  - MATCHES_PER_PLAYER(기본 15)     : 선수당 최근 판 수
 *  - RIOT_MIN_INTERVAL_MS(기본 1250) : 요청 간격 (개발 키 2분 100회 한도 대응)
 *  - MAX_MINUTES(기본 0 = 제한 없음)  : 판 수집 시간 상한 — 다음 DB 수집(매시 17분, 같은 Riot 키) 전에 끝내려고 워크플로가 정한다
 */
const fs = require('fs')
const path = require('path')
const { loadEnv } = require('./_env')
loadEnv()
if (!process.env.RIOT_MIN_INTERVAL_MS) process.env.RIOT_MIN_INTERVAL_MS = '1250'

const { riotGet } = require('./buildMetaStats')

const KEY = process.env.RIOT_API_KEY || ''
const REGION = process.env.RIOT_REGION || 'asia'
const PLATFORM = process.env.RIOT_PLATFORM || 'kr'
const MAX_MATCHES = Number(process.env.MAX_MATCHES || 1500)
const PLAYERS = Number(process.env.PLAYERS || 160)
const PER_PLAYER = Number(process.env.MATCHES_PER_PLAYER || 15)
const MAX_MINUTES = Number(process.env.MAX_MINUTES || 0)
const SET_NUMBER = 18
const RANKED_QUEUE = 1100

const OUT = path.join(__dirname, '..', 'data', 'ladderBoards.json')

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(OUT, 'utf-8'))
    if (Array.isArray(data.matches)) return data
  } catch {
    /* 첫 실행 */
  }
  return { version: 1, source: 'riot-ladder-boards', set: SET_NUMBER, region: PLATFORM, matches: [] }
}

function save(data) {
  data.updatedAt = new Date().toISOString()
  data.matchCount = data.matches.length
  fs.writeFileSync(OUT, JSON.stringify(data), 'utf-8')
}

/** 매치 응답 → 저장용 보드 8개 (개인정보 제외) */
function toBoards(match) {
  return (match.info?.participants || []).map((p) => ({
    placement: p.placement,
    level: p.level,
    units: (p.units || []).map((u) => ({
      id: u.character_id,
      star: u.tier,
      items: u.itemNames || [],
    })),
    traits: (p.traits || [])
      .filter((t) => t.tier_current > 0)
      .map((t) => ({ id: t.name, units: t.num_units, style: t.style, tier: t.tier_current, max: t.tier_total })),
  }))
}

async function main() {
  if (!KEY) {
    console.error('RIOT_API_KEY 가 필요합니다 (.env.local)')
    process.exitCode = 1
    return
  }

  const data = load()
  const have = new Set(data.matches.map((m) => m.matchId))
  console.log(`기존 저장 ${have.size}판 · 이번 목표 +${MAX_MATCHES}판`)

  // 1) 상위 LP 순으로 표본 선수
  const puuids = []
  for (const tier of ['challenger', 'grandmaster', 'master']) {
    if (puuids.length >= PLAYERS) break
    try {
      const league = await riotGet(`https://${PLATFORM}.api.riotgames.com/tft/league/v1/${tier}?queue=RANKED_TFT`)
      const list = (league.entries || []).sort((a, b) => b.leaguePoints - a.leaguePoints)
      for (const e of list) {
        if (puuids.length >= PLAYERS) break
        if (e.puuid) puuids.push(e.puuid)
      }
      console.log(`  ${tier}: ${list.length}명 → 누적 ${puuids.length}명`)
    } catch (e) {
      console.warn(`  ${tier} 조회 실패: ${e.message}`)
    }
  }
  if (!puuids.length) {
    console.error('표본 선수를 가져오지 못했습니다. (키 만료 여부 확인)')
    process.exitCode = 1
    return
  }

  // 2) 판 수집 (MAX_MINUTES 가 지나면 모은 데까지 저장하고 멈춘다)
  const deadline = MAX_MINUTES > 0 ? Date.now() + MAX_MINUTES * 60_000 : Infinity
  const timeUp = () => Date.now() >= deadline
  let added = 0
  let skipped = 0
  let failed = 0
  for (let i = 0; i < puuids.length && added < MAX_MATCHES && !timeUp(); i++) {
    let ids = []
    try {
      ids = await riotGet(
        `https://${REGION}.api.riotgames.com/tft/match/v1/matches/by-puuid/${puuids[i]}/ids?count=${PER_PLAYER}`
      )
    } catch (e) {
      failed++
      if (/만료|무효/.test(e.message)) {
        console.error(e.message)
        break
      }
      continue
    }
    for (const id of ids) {
      if (added >= MAX_MATCHES || timeUp()) break
      if (have.has(id)) continue
      have.add(id)
      try {
        const match = await riotGet(`https://${REGION}.api.riotgames.com/tft/match/v1/matches/${id}`)
        const info = match.info || {}
        if (info.tft_set_number !== SET_NUMBER || info.queue_id !== RANKED_QUEUE) {
          skipped++
          continue
        }
        data.matches.push({
          matchId: id,
          gameVersion: info.game_version,
          datetime: info.game_datetime,
          boards: toBoards(match),
        })
        added++
        if (added % 25 === 0) {
          save(data)
          console.log(`  진행: 선수 ${i + 1}/${puuids.length} · 새로 ${added}판 (제외 ${skipped}, 실패 ${failed}) · 누적 ${data.matches.length}판`)
        }
      } catch (e) {
        failed++
        if (/만료|무효/.test(e.message)) {
          console.error(e.message)
          i = puuids.length
          break
        }
      }
    }
  }

  save(data)
  if (timeUp()) console.log(`  시간 상한 ${MAX_MINUTES}분에 도달해 멈춤`)
  console.log(`\n✅ 저장 → ${OUT}`)
  console.log(`   새로 ${added}판 · 제외(다른 세트/큐) ${skipped} · 실패 ${failed} · 누적 ${data.matches.length}판 (보드 ${data.matches.length * 8}개)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

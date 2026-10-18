/**
 * 래더 광범위 표본 수집 (MetaTFT 스타일)
 *
 * 특정 소환사 ID에 의존하지 않고 챌린저·그랜드마스터·마스터 래더에서 표본 선수를 뽑아
 * 최근 매치를 대량 수집·집계한다. (외부 메타 사이트는 공개 API가 없어 직접 집계)
 *
 * 사용법: node scripts/buildMetaStatsLadder.js
 *
 * 환경변수:
 *  - PLAYERS(기본 60)             : 표본 선수 수 (티어별 분배)
 *  - MATCHES_PER_PLAYER(기본 8)   : 선수당 최근 매치 수
 *  - MAX_MATCHES(기본 400)        : 총 수집 매치 상한
 *  - RIOT_MIN_INTERVAL_MS(기본 350): Riot 요청 최소 간격
 */
const fs = require('fs')
const path = require('path')
const { loadEnv } = require('./_env')
loadEnv()

const {
  createState,
  aggregateMatch,
  buildOutput,
  describeAugmentDiagnostics,
  riotGet,
  attachDeltas,
  readPrevStats,
  archiveSnapshot,
} = require('./buildMetaStats')

const KEY = process.env.RIOT_API_KEY || ''
const REGION = process.env.RIOT_REGION || 'asia'
const PLATFORM = process.env.RIOT_PLATFORM || 'kr'
const PLAYERS = Number(process.env.PLAYERS || 60)
const PER_PLAYER = Number(process.env.MATCHES_PER_PLAYER || 8)
const MAX_MATCHES = Number(process.env.MAX_MATCHES || 400)

async function main() {
  if (!KEY) {
    console.error('RIOT_API_KEY 가 필요합니다 (.env.local)')
    process.exitCode = 1
    return
  }

  // 1) 래더에서 표본 선수 추출
  const entries = []
  for (const tier of ['challenger', 'grandmaster', 'master']) {
    try {
      const data = await riotGet(
        `https://${PLATFORM}.api.riotgames.com/tft/league/v1/${tier}?queue=RANKED_TFT`
      )
      const list = (data.entries || []).sort((a, b) => b.leaguePoints - a.leaguePoints)
      const perTier = Math.max(1, Math.ceil(PLAYERS / 3))
      const picked = list.slice(0, perTier)
      picked.forEach((e) => {
        if (e.puuid) entries.push({ puuid: e.puuid, tier })
      })
      console.log(`  ${tier}: ${list.length}명 중 ${picked.length}명 표본`)
    } catch (e) {
      console.warn(`  ${tier} 조회 실패: ${e.message}`)
    }
  }

  const players = entries.slice(0, PLAYERS)
  if (players.length === 0) {
    console.error('표본 선수를 추출하지 못했습니다.')
    process.exitCode = 1
    return
  }
  console.log(`총 ${players.length}명 표본 / 선수당 ${PER_PLAYER}경기 / 상한 ${MAX_MATCHES}경기`)

  // 2) 매치 수집 (중복 매치 제거)
  const state = createState()
  const seen = new Set()
  let fetched = 0
  let failed = 0

  for (let i = 0; i < players.length; i++) {
    if (fetched >= MAX_MATCHES) break
    let ids = []
    try {
      ids = await riotGet(
        `https://${REGION}.api.riotgames.com/tft/match/v1/matches/by-puuid/${players[i].puuid}/ids?count=${PER_PLAYER}`
      )
    } catch (e) {
      failed++
      continue
    }
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      if (fetched >= MAX_MATCHES) break
      try {
        const match = await riotGet(`https://${REGION}.api.riotgames.com/tft/match/v1/matches/${id}`)
        aggregateMatch(match, state)
        fetched++
      } catch (e) {
        failed++
      }
    }
    if ((i + 1) % 5 === 0 || fetched >= MAX_MATCHES) {
      console.log(`  진행 ${i + 1}/${players.length}명 · 수집 ${fetched}경기 (중복제외 ${seen.size})`)
    }
  }

  if (fetched === 0) {
    console.error('수집된 매치가 없습니다. (키/레이트리밋 확인)')
    process.exitCode = 1
    return
  }

  // 3) 집계 + 저장
  const { augments, champions, traits, items, combos } = buildOutput(state)
  const result = {
    version: '2',
    patch: state.patch && state.patch !== 'unknown' ? state.patch : 'set18',
    source: 'riot-ladder',
    sample: false,
    generatedAt: new Date().toISOString(),
    baselineAvgPlacement: 4.5,
    augments,
    champions,
    traits,
    items,
    combos,
  }

  const outPath = path.join(__dirname, '..', 'lib', 'metaStats.json')
  // 이전 수집본 대비 순위 변동 + 스냅샷 보관
  const prevStats = readPrevStats(outPath)
  attachDeltas(result, prevStats)
  archiveSnapshot(prevStats)
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8')

  console.log(`\n✅ 저장 완료 → ${outPath}`)
  console.log(`   래더 표본 ${players.length}명 · 수집 ${fetched}경기 (실패 ${failed})`)
  console.log(
    `   기물 ${Object.keys(champions).length}종 | 시너지 ${Object.keys(traits).length}종 | 아이템 ${Object.keys(items).length}종 | 조합 ${Object.keys(combos).length}건 | 증강 ${Object.keys(augments).length}종`
  )
  const augDiag = describeAugmentDiagnostics(state)
  console.log(`   증강 진단: ${augDiag.text}`)
  if (augDiag.hint) console.warn(`   ⚠️ ${augDiag.hint}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

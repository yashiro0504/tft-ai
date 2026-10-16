/**
 * 경합 분석 튜닝용 데이터 수집 스크립트
 *
 * 각 참가자별 "경합 특징(core 기물/시너지의 상대 겹침 수)"과 최종 등수를 수집한다.
 * → scripts/tuneContest.js 가 이 데이터로 가중치/임계값을 재보정한다.
 *
 * 사용법:
 *   RIOT_API_KEY=RGAPI-xxxx node scripts/collectContestSamples.js "닉네임#KR1" [닉네임2#KR1 ...]
 * 출력: data/contestSamples.json
 *
 * ⚠️ 개발 키는 24h 만료 / 429 시 Retry-After 대기 / 표본이 많을수록 좋음
 */
const fs = require('fs')
const path = require('path')
const CONFIG = require('../lib/contestConfig.json')

const { loadEnv, getSeeds, printKeyHelp } = require('./_env')
loadEnv()

const RIOT_API_KEY = process.env.RIOT_API_KEY || ''
const REGION = process.env.RIOT_REGION || 'asia'
const CHECK_ONLY = process.argv.includes('--check')
const MATCHES_PER_SEED = Number(process.env.MATCHES_PER_SEED || 30)
const SLEEP_MS = Number(process.env.SLEEP_MS || 1200)
const TOP_TRAITS = 4

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function riotGet(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { 'X-Riot-Token': RIOT_API_KEY } })
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after') || 2)
      console.warn(`  429 → ${ra}s 대기`)
      await sleep((ra + 1) * 1000)
      continue
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Riot API ${res.status}: 키가 만료되었거나 무효합니다 (개발 키는 24시간마다 만료)`)
    }
    if (!res.ok) throw new Error(`Riot API ${res.status} :: ${url}`)
    return res.json()
  }
  throw new Error(`재시도 초과 :: ${url}`)
}

const getAccount = (g, t) =>
  riotGet(`https://${REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(g)}/${encodeURIComponent(t)}`)
const getMatchIds = (p, c) =>
  riotGet(`https://${REGION}.api.riotgames.com/tft/match/v1/matches/by-puuid/${p}/ids?count=${c}`)
const getMatch = (id) => riotGet(`https://${REGION}.api.riotgames.com/tft/match/v1/matches/${id}`)

/** 한 매치의 참가자별 경합 특징 추출 (등수 포함) */
function extractSamples(match) {
  const parts = match?.info?.participants || []
  const traitMin = 2 // 활성 판정 최소 인원

  return parts.map((me) => {
    const others = parts.filter((p) => p.puuid !== me.puuid)

    const myUnits = (me.units || []).filter(
      (u) => (u.tier || 1) >= CONFIG.coreUnitMinTier || (u.itemNames?.length || 0) >= CONFIG.coreUnitMinItems
    )
    const units = myUnits.map((u) => {
      const opp = others.filter((o) => (o.units || []).some((ou) => ou.character_id === u.character_id)).length
      return { cost: (u.rarity ?? 0) + 1 || 3, tier: u.tier || 1, opp }
    })

    const myTraits = (me.traits || [])
      .filter((t) => t.tier_current > 0 && t.num_units >= traitMin)
      .sort((a, b) => b.tier_current - a.tier_current || b.num_units - a.num_units)
      .slice(0, TOP_TRAITS)
    const traits = myTraits.map((t) => {
      const opp = others.filter((o) =>
        (o.traits || []).some((ot) => ot.name === t.name && ot.tier_current > 0)
      ).length
      return { tier: t.tier_current, opp }
    })

    return { matchId: match.metadata?.match_id, placement: me.placement, units, traits }
  })
}

async function main() {
  if (!RIOT_API_KEY) {
    printKeyHelp()
    process.exitCode = 1
    return
  }
  const seeds = getSeeds()
  if (seeds.length === 0) {
    console.error('사용법: SEEDS="닉네임#KR1,닉네임2#KR1" node scripts/collectContestSamples.js')
    console.error('   또는: node scripts/collectContestSamples.js "닉네임#KR1" "닉네임2#KR1"')
    process.exitCode = 1
    return
  }

  // 0) 키 유효성 사전 점검
  try {
    const [g, t = 'KR1'] = seeds[0].split('#')
    const acc = await getAccount(g, t)
    console.log(`✅ 키 확인 OK — 샘플 계정: ${acc.gameName}#${acc.tagLine}`)
    if (CHECK_ONLY) {
      console.log('(--check 모드: 수집 없이 종료)')
      return
    }
  } catch (e) {
    console.error(`❌ 키/계정 확인 실패: ${e.message}`)
    printKeyHelp()
    process.exitCode = 1
    return
  }

  const samples = []
  const seen = new Set()
  let patch = 'unknown'

  for (const seed of seeds) {
    const [g, t = 'KR1'] = seed.split('#')
    let account, ids
    try {
      account = await getAccount(g, t)
    } catch (e) {
      console.warn(`skip ${seed}: ${e.message}`)
      continue
    }
    await sleep(SLEEP_MS)
    try {
      ids = await getMatchIds(account.puuid, MATCHES_PER_SEED)
    } catch (e) {
      console.warn(`matchIds ${seed}: ${e.message}`)
      continue
    }
    await sleep(SLEEP_MS)

    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      let match
      try {
        match = await getMatch(id)
      } catch (e) {
        console.warn(`match ${id}: ${e.message}`)
        continue
      }
      await sleep(SLEEP_MS)
      if (match?.info?.game_version) patch = match.info.game_version.split(' ')[0] || patch
      samples.push(...extractSamples(match))
    }
    console.log(`✔ ${seed}: 누적 매치 ${seen.size}건 / 표본 ${samples.length}건`)
  }

  const out = {
    source: 'riot-sample',
    sample: false,
    generatedAt: new Date().toISOString(),
    patch,
    configUsed: CONFIG,
    samples,
  }
  const outPath = path.join(__dirname, '..', 'data', 'contestSamples.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8')
  console.log(`저장 완료: 표본 ${samples.length}건 → ${outPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

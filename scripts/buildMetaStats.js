/**
 * 증강 메타 통계 집계 스크립트 (메타 데이터 파이프라인)
 *
 * Riot 공식 API는 집계 통계를 제공하지 않으므로, 실제 매치 표본을 수집해 자체 집계한다.
 *
 * 사용법:
 *   RIOT_API_KEY=RGAPI-xxxx node scripts/buildMetaStats.js "닉네임#KR1" "닉네임2#KR1" ...
 *   - 인자로 준 소환사들의 최근 매치(Riot ID)를 표본으로 사용
 *
 * 출력: lib/metaStats.json (sample=false, source="riot-sample")
 *
 * ⚠️ 운영 팁:
 *  - Riot 개발 키는 24시간마다 만료됩니다. (운영은 프로덕션 키 권장)
 *  - 레이트리밋(429) 시 Retry-After 만큼 자동 대기합니다.
 *  - 표본이 많을수록 안정적입니다 (증강당 최소 20건, 전체 수천 판 권장).
 *  - ⚠️ 증강 키 표기는 앱의 lib/summarize.ts cleanName() 결과와 일치해야 합니다.
 *    (이 스크립트는 동일한 정규화 규칙을 사용합니다.)
 */
const fs = require('fs')
const path = require('path')

const { loadEnv, getSeeds, printKeyHelp } = require('./_env')
loadEnv()

const RIOT_API_KEY = process.env.RIOT_API_KEY || ''
const REGION = process.env.RIOT_REGION || 'asia' // account / match 라우팅 리전
const CHECK_ONLY = process.argv.includes('--check')
const MATCHES_PER_SEED = Number(process.env.MATCHES_PER_SEED || 20)
const SLEEP_MS = Number(process.env.SLEEP_MS || 1200)
const MIN_SAMPLE = Number(process.env.MIN_SAMPLE || 20)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function riotGet(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { 'X-Riot-Token': RIOT_API_KEY } })
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after') || 2)
      console.warn(`  429 rate limit → ${ra}s 대기`)
      await sleep((ra + 1) * 1000)
      continue
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Riot API ${res.status}: 키가 만료되었거나 무효합니다 (개발 키는 24시간마다 만료)`)
    }
    if (!res.ok) throw new Error(`Riot API ${res.status} ${res.statusText} :: ${url}`)
    return res.json()
  }
  throw new Error(`Riot API 재시도 초과 :: ${url}`)
}

async function getAccount(gameName, tagLine) {
  const u = `https://${REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  return riotGet(u)
}
async function getMatchIds(puuid, count) {
  return riotGet(`https://${REGION}.api.riotgames.com/tft/match/v1/matches/by-puuid/${puuid}/ids?count=${count}`)
}
async function getMatch(id) {
  return riotGet(`https://${REGION}.api.riotgames.com/tft/match/v1/matches/${id}`)
}

/** lib/summarize.ts 의 cleanName() 과 동일한 정규화 */
function cleanName(id) {
  if (!id) return ''
  return String(id)
    .replace(/^TFT\d*_/i, '')
    .replace(/^Item_/i, '')
    .replace(/Augment_/i, '')
    .replace(/_/g, ' ')
    .trim()
}

async function main() {
  if (!RIOT_API_KEY) {
    printKeyHelp()
    process.exitCode = 1
    return
  }
  const seeds = getSeeds()
  if (seeds.length === 0) {
    console.error('사용법: SEEDS="닉네임#KR1,닉네임2#KR1" node scripts/buildMetaStats.js')
    console.error('   또는: node scripts/buildMetaStats.js "닉네임#KR1" "닉네임2#KR1"')
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

  const aug = {} // name -> { sum, count, top4 }
  let totalSlots = 0 // 증강 슬롯 총합(픽률 분모)
  let patch = 'unknown'
  const seen = new Set()

  for (const seed of seeds) {
    const [gameName, tagLine = 'KR1'] = seed.split('#')
    let account
    try {
      account = await getAccount(gameName, tagLine)
    } catch (e) {
      console.warn(`skip ${seed}: ${e.message}`)
      continue
    }
    await sleep(SLEEP_MS)

    let ids = []
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

      for (const p of match?.info?.participants || []) {
        for (const raw of p.augments || []) {
          const name = cleanName(raw)
          if (!name) continue
          totalSlots++
          const e = (aug[name] = aug[name] || { sum: 0, count: 0, top4: 0 })
          e.sum += p.placement
          e.count++
          if (p.placement <= 4) e.top4++
        }
      }
    }
    console.log(`✔ ${seed} 누적 매치 ${seen.size}건`)
  }

  const augments = {}
  for (const [name, e] of Object.entries(aug)) {
    if (e.count < MIN_SAMPLE) continue
    augments[name] = {
      avgPlacement: Math.round((e.sum / e.count) * 100) / 100,
      top4Rate: Math.round((e.top4 / e.count) * 1000) / 1000,
      pickRate: Math.round((e.count / Math.max(totalSlots, 1)) * 1000) / 1000,
      sampleSize: e.count,
    }
  }

  const result = {
    version: '1',
    patch,
    source: 'riot-sample',
    sample: false,
    generatedAt: new Date().toISOString(),
    baselineAvgPlacement: 4.5,
    augments,
  }

  const outPath = path.join(__dirname, '..', 'lib', 'metaStats.json')
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8')
  console.log(`저장 완료: ${Object.keys(augments).length}개 증강 통계 → ${outPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

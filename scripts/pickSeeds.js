/**
 * 챌린저 랭킹에서 고티어 시드를 자동 추출해 .env.local 에 저장한다.
 *
 * ⚠️ PowerShell(5.1)로 직접 파싱하면 UTF-8 JSON이 라틴1로 오디코딩되어
 *    한글 시드가 깨집니다(404 원인). 이 스크립트는 Node 로 처리해 안전합니다.
 *
 * 사용법: node scripts/pickSeeds.js   (또는 TOP_N=10 node scripts/pickSeeds.js)
 */
const fs = require('fs')
const path = require('path')
const { loadEnv } = require('./_env')
loadEnv()

const KEY = process.env.RIOT_API_KEY || ''
const REGION = process.env.RIOT_REGION || 'asia' // account 라우팅
const PLATFORM = process.env.RIOT_PLATFORM || 'kr' // 리그(챌린저) 플랫폼
const TOP_N = Number(process.env.TOP_N || 8)

async function riotGet(url) {
  const res = await fetch(url, { headers: { 'X-Riot-Token': KEY } })
  if (!res.ok) throw new Error(`Riot API ${res.status} :: ${url}`)
  return res.json()
}

async function main() {
  if (!KEY) {
    console.error('RIOT_API_KEY 가 필요합니다 (.env.local)')
    process.exitCode = 1
    return
  }

  const ch = await riotGet(`https://${PLATFORM}.api.riotgames.com/tft/league/v1/challenger?queue=RANKED_TFT`)
  const top = (ch.entries || []).sort((a, b) => b.leaguePoints - a.leaguePoints).slice(0, TOP_N)
  console.log(`챌린저 ${ch.entries?.length ?? 0}명 중 상위 ${top.length}명에서 시드 추출`)

  const ids = []
  for (const e of top) {
    try {
      const acc = await riotGet(
        `https://${REGION}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${e.puuid}`
      )
      ids.push(`${acc.gameName}#${acc.tagLine}`)
    } catch (err) {
      console.warn(`skip ${e.puuid}: ${err.message}`)
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  if (ids.length === 0) {
    console.error('시드를 하나도 추출하지 못했습니다.')
    process.exitCode = 1
    return
  }

  ids.forEach((s) => console.log('  -', s))

  const p = path.join(__dirname, '..', '.env.local')
  const lines = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8').split(/\r?\n/) : []
  const out = lines.filter((l) => l.trim() !== '' && !l.startsWith('SEEDS='))
  out.push('SEEDS=' + ids.join(','))
  fs.writeFileSync(p, out.join('\n') + '\n', 'utf-8')
  console.log(`✅ .env.local 에 SEEDS(${ids.length}명) 저장 완료`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

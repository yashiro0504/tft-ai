/**
 * 평가 하네스용 골든셋 캡처
 *
 * 실제 랭크 경기를 /api/tft/search 로 가져와 data/evalMatches.json 에 저장한다.
 * (이후 evalReports.js 가 같은 입력으로 반복 평가)
 *
 * 사용법: node scripts/captureEvalFixtures.js "닉네임#KR1" [경기수=3]
 *         node scripts/captureEvalFixtures.js --api http://localhost:3000 "닉네임#KR1" 3
 */
const fs = require('fs')
const path = require('path')
const { loadEnv } = require('./_env')
loadEnv()

const args = process.argv.slice(2)
const apiIdx = args.indexOf('--api')
const API = apiIdx >= 0 ? args[apiIdx + 1] : process.env.EVAL_API || 'http://localhost:3000'
const positional = args.filter((a, i) => {
  if (a === '--api') return false
  if (apiIdx >= 0 && i === apiIdx + 1) return false
  return true
})
const riotId = positional[0] || ''
const count = Math.min(Math.max(Number(positional[1] || 3), 1), 10)

async function main() {
  if (!riotId.includes('#')) {
    console.error('사용법: node scripts/captureEvalFixtures.js "닉네임#KR1" [경기수=3]')
    process.exitCode = 1
    return
  }
  const [gameName, tagLine] = riotId.split('#')

  const res = await fetch(`${API}/api/tft/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameName, tagLine, limit: count }),
  })
  const json = await res.json()
  if (!res.ok || !json.success || !Array.isArray(json.matches) || json.matches.length === 0) {
    console.error('캡처 실패:', json.error || `HTTP ${res.status}`)
    process.exitCode = 1
    return
  }

  const outPath = path.join(__dirname, '..', 'data', 'evalMatches.json')
  const payload = {
    version: 1,
    capturedAt: new Date().toISOString(),
    cases: [
      {
        name: `${json.gameName}#${json.tagLine} ${json.matches.length}경기`,
        gameName: json.gameName,
        tagLine: json.tagLine,
        mode: json.matches.length > 1 ? 'multi' : 'single',
        matches: json.matches,
      },
    ],
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8')
  console.log(`✅ 골든셋 저장 → ${outPath} (${json.matches.length}경기)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

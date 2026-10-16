/**
 * 수집 스크립트 공통 유틸:
 *  - .env.local / .env 자동 로드 (키 재입력 불필요)
 *  - 시드 소환사 목록 파싱 (SEEDS 환경변수 또는 CLI 인자)
 */
const fs = require('fs')
const path = require('path')

function loadEnv() {
  const root = path.join(__dirname, '..')
  for (const file of ['.env.local', '.env']) {
    const p = path.join(root, file)
    if (!fs.existsSync(p)) continue
    const text = fs.readFileSync(p, 'utf-8')
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      const key = m[1]
      let val = m[2]
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = val
    }
  }
}

function getSeeds() {
  const fromEnv = process.env.SEEDS || process.env.SEED_PLAYERS
  const list = fromEnv ? fromEnv.split(',') : process.argv.slice(2)
  return list.map((s) => s.trim()).filter((s) => s && !s.startsWith('--'))
}

/** 키가 없거나 무효할 때 공통 안내 문구 */
function printKeyHelp() {
  console.error('\n[안내] Riot API 키가 필요합니다.')
  console.error('  1) C:\\Users\\<이름>\\Desktop\\tft-ai\\.env.local 파일에 아래를 추가하세요:')
  console.error('       RIOT_API_KEY=RGAPI-xxxx   (또는 프로덕션 키)')
  console.error('       RIOT_REGION=asia')
  console.error('  2) 또는 PowerShell에서:  $env:RIOT_API_KEY="RGAPI-xxxx"; node scripts/...')
  console.error('  ⚠️ Riot "개발 키"는 24시간마다 만료됩니다. 장기 수집은 프로덕션 키를 사용하세요.\n')
}

module.exports = { loadEnv, getSeeds, printKeyHelp }

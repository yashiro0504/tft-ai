/**
 * Riot 원본 매치 응답의 증강 스키마 확인용 프로브.
 *
 * 사용법:
 *   node scripts/inspectMatch.js <matchId>
 *   node scripts/inspectMatch.js "Hide on bush#KR1" [경기수]
 *
 * 출력:
 *  - set number / game_version
 *  - 참가자 키 목록과 augment 관련 필드의 실제 값
 *  - 수집 스크립트와 동일한 집계 결과(증강 종 수, 진단 카운터)
 *
 * ⚠️ 개발 키는 24시간마다 만료됩니다. 401이 나오면 .env.local 의 키를 갱신하세요.
 */
const { loadEnv } = require('./_env')
loadEnv()

const KEY = process.env.RIOT_API_KEY || ''
const REGION = process.env.RIOT_REGION || 'asia'

async function get(url) {
  const res = await fetch(url, { headers: { 'X-Riot-Token': KEY } })
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Riot API ${res.status}: 키가 만료되었거나 무효합니다. (개발 키는 24시간 만료)`)
  }
  if (!res.ok) throw new Error(`Riot API ${res.status} ${res.statusText}`)
  return res.json()
}

async function resolveMatchId(arg, count) {
  if (!arg.includes('#')) return arg

  const [gameName, tagLine = 'KR1'] = arg.split('#')
  const account = await get(
    `https://${REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  )
  const ids = await get(
    `https://${REGION}.api.riotgames.com/tft/match/v1/matches/by-puuid/${account.puuid}/ids?count=${count}`
  )
  if (!ids.length) throw new Error('최근 매치가 없습니다.')
  console.log(`계정: ${account.gameName}#${account.tagLine} · 매치 ${ids.length}건`)
  return ids[0]
}

function describeParticipant(participant, index) {
  const keys = Object.keys(participant || {})
  const augmentKeys = keys.filter((key) => /augment/i.test(key))
  const values = augmentKeys.map((key) => `${key}=${JSON.stringify(participant[key])}`)
  console.log(`  [${index}] placement=${participant.placement} keys=${keys.length} | ${values.join(' | ') || 'augment 필드 없음'}`)
}

async function main() {
  const arg = process.argv[2]
  if (!arg) {
    console.error('사용법: node scripts/inspectMatch.js <matchId | "이름#TAG"> [경기수]')
    process.exitCode = 1
    return
  }
  if (!KEY) {
    console.error('RIOT_API_KEY 가 필요합니다 (.env.local)')
    process.exitCode = 1
    return
  }

  const matchId = await resolveMatchId(arg, Number(process.argv[3] || 1))
  const match = await get(`https://${REGION}.api.riotgames.com/tft/match/v1/matches/${matchId}`)
  const info = match.info || {}
  const participants = info.participants || []

  console.log(`\nmatchId: ${matchId}`)
  console.log(`set: ${info.tft_set_number} · game_version: ${info.game_version} · 참가자: ${participants.length}`)

  const unionKeys = new Set()
  participants.forEach((p) => Object.keys(p || {}).forEach((k) => unionKeys.add(k)))
  console.log(`참가자 키(${unionKeys.size}): ${[...unionKeys].join(', ')}`)

  participants.slice(0, 3).forEach(describeParticipant)

  const withField = participants.filter((p) => 'augments' in (p || {})).length
  const withValues = participants.filter((p) => Array.isArray(p.augments) && p.augments.length > 0).length
  console.log(`augments 필드 존재: ${withField}/${participants.length} · 값 있음: ${withValues}/${participants.length}`)

  const { createState, aggregateMatch, buildOutput, describeAugmentDiagnostics } = require('./buildMetaStats')
  const state = createState()
  aggregateMatch(match, state)
  const { augments } = buildOutput(state)
  const diag = describeAugmentDiagnostics(state)

  console.log(`\n집계 결과: 증강 ${Object.keys(augments).length}종`)
  console.log(`진단: ${diag.text}`)
  if (diag.hint) console.log(`추정: ${diag.hint}`)
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`)
  process.exit(1)
})

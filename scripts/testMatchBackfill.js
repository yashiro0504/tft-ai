/**
 * 분석 판 보충 테스트 (lib/tftService.loadSummonerData) — Riot 호출을 가짜로 바꿔 네트워크 없이 돈다.
 *
 * 2026-10-27: 최근 10판이 모두 일반 게임인 챌린저가 "진단할 수 없습니다"였다.
 *  - 최근 N판에 현재 세트 랭크 판이 N판보다 적으면 그 이전 판을 BACKFILL_SCAN_MAX 판까지 훑어 랭크 판만 덧붙인다
 *  - 이전 시즌 판을 만나면 멈춘다 (그보다 오래된 판도 이전 시즌)
 *  - 랭크 판이 충분하면 더 부르지 않는다
 *
 * 실행: node scripts/testMatchBackfill.js   (npm run test:ai 에 포함)
 */
require('./_ts')
const path = require('path')
const { CURRENT_SET } = require('../lib/gameFacts')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  ✅ ${label}`)
  else {
    failures++
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** 판 번호 → 큐·세트 (시나리오마다 바꾼다) */
let kindOf = () => ({ queueId: 1100, setNumber: CURRENT_SET })
const calls = { ids: [], details: 0 }

class RiotApiError extends Error {}
const fakeRiot = {
  RiotApiError,
  getAccountByRiotId: async (gameName, tagLine) => ({ puuid: `P-${gameName}`, gameName, tagLine }), // 시나리오마다 다른 puuid (매치 상세 캐시 키)
  getSummonerByPuuid: async () => ({ profileIconId: 1, summonerLevel: 100 }),
  getTftLeagueByPuuid: async () => null,
  getTftMatchIds: async (_puuid, count, _region, start = 0) => {
    calls.ids.push(`${start}+${count}`)
    return Array.from({ length: count }, (_, i) => `M${start + i}`)
  },
  getTftMatchDetail: async (id) => {
    calls.details++
    const n = Number(id.slice(1))
    return { matchId: id, gameDatetime: 1e12 - n, placement: 4, level: 8, lastRound: '5-5', goldLeft: 0, augments: [], traits: [], units: [], ...kindOf(n) }
  },
}
// lib/riot · lib/summarize 를 가짜로 (상세 응답이 이미 Slim 모양)
const stub = (rel, exports) => {
  const file = require.resolve(path.join(__dirname, '..', rel))
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
stub('lib/riot.ts', fakeRiot)
stub('lib/summarize.ts', { extractSlimMatchData: (raw) => raw })
process.env.RIOT_API_KEY = 'test'

const { loadSummonerData, BACKFILL_SCAN_MAX } = require('../lib/tftService')
const { analyzableMatches } = require('../lib/queue')

;(async () => {
  console.log('분석 판 보충')
  // 최근 10판 일반 게임 · 그 이전 10~14 일반, 15~ 랭크
  kindOf = (n) => (n < 15 ? { queueId: 1090, setNumber: CURRENT_SET } : { queueId: 1100, setNumber: CURRENT_SET })
  const a = await loadSummonerData('보충', 'KR1', 10, false, { fresh: true })
  check(
    '최근 10판이 일반 게임이면 이전 판에서 랭크 10판을 채움',
    analyzableMatches(a.matches).length === 10 && a.matches.length === 20 && a.olderScanned === BACKFILL_SCAN_MAX,
    JSON.stringify({ total: a.matches.length, ranked: analyzableMatches(a.matches).length, scanned: a.olderScanned })
  )
  check('덧붙인 판은 랭크 판만 (일반 게임은 목록에 늘리지 않음)', a.matches.slice(10).every((m) => m.queueId === 1100))
  check('이전 판 목록은 최근 N판 다음부터 (start=10)', calls.ids.includes(`10+${BACKFILL_SCAN_MAX}`), calls.ids.join(','))

  // 이전 시즌 판을 만나면 멈춤
  kindOf = (n) => (n < 12 ? { queueId: 1090, setNumber: CURRENT_SET } : { queueId: 1100, setNumber: CURRENT_SET - 1 })
  const b = await loadSummonerData('시즌', 'KR1', 10, false, { fresh: true })
  check('이전 시즌 판을 만나면 멈추고 그 판은 넣지 않음', analyzableMatches(b.matches).length === 0 && b.matches.length === 10, JSON.stringify({ total: b.matches.length, scanned: b.olderScanned }))

  // 랭크 판이 충분하면 더 부르지 않음
  kindOf = () => ({ queueId: 1100, setNumber: CURRENT_SET })
  calls.ids = []
  const c = await loadSummonerData('충분', 'KR1', 10, false, { fresh: true })
  check('최근 10판이 모두 랭크면 이전 판을 부르지 않음', c.matches.length === 10 && !c.olderScanned && calls.ids.length === 1, calls.ids.join(','))

  console.log(failures ? `\n❌ 실패 ${failures}건` : '\n✅ 분석 판 보충 테스트 통과')
  if (failures) process.exitCode = 1
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

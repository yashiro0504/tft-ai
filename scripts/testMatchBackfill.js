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

class RiotApiError extends Error {
  constructor(message, statusCode) {
    super(message)
    this.statusCode = statusCode
  }
}
/** 판 번호 → 남은 실패 횟수 (429). Infinity 면 계속 실패 */
let failPlan = new Map()
let nowBase = 1e12
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
    const left = failPlan.get(n)
    if (left) {
      failPlan.set(n, left - 1)
      throw new RiotApiError('rate limited', 429)
    }
    return { matchId: id, gameDatetime: nowBase - n * gapMs, placement: 4, level: 8, lastRound: '5-5', goldLeft: 0, augments: [], traits: [], units: [], ...kindOf(n) }
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
process.env.RIOT_DETAIL_RETRY_BASE_MS = '0'
/** 판 사이 간격 (기본 1분 — 30일 상한에 안 걸림) */
let gapMs = 60_000

const { loadSummonerData, BACKFILL_PAGE, BACKFILL_SCAN_CAP } = require('../lib/tftService')
const { analyzableMatches } = require('../lib/queue')

;(async () => {
  console.log('분석 판 보충')
  // 최근 10판 일반 게임 · 그 이전 10~14 일반, 15~ 랭크
  nowBase = Date.now()
  kindOf = (n) => (n < 15 ? { queueId: 1090, setNumber: CURRENT_SET } : { queueId: 1100, setNumber: CURRENT_SET })
  const a = await loadSummonerData('보충', 'KR1', 10, false, { fresh: true })
  check(
    '최근 10판이 일반 게임이면 이전 판에서 랭크 10판을 채움',
    analyzableMatches(a.matches).length === 10 && a.matches.length === 20 && a.olderScanned === 20 && a.olderAdded === 10 && a.failedMatches === 0,
    JSON.stringify({ total: a.matches.length, ranked: analyzableMatches(a.matches).length, scanned: a.olderScanned })
  )
  check('덧붙인 판은 랭크 판만 (일반 게임은 목록에 늘리지 않음)', a.matches.slice(10).every((m) => m.queueId === 1100))
  check('이전 판 목록은 최근 N판 다음부터 (start=10)', calls.ids.includes(`10+${BACKFILL_PAGE}`), calls.ids.join(','))

  // 이전 시즌 판을 만나면 멈춤
  kindOf = (n) => (n < 12 ? { queueId: 1090, setNumber: CURRENT_SET } : { queueId: 1100, setNumber: CURRENT_SET - 1 })
  const b = await loadSummonerData('시즌', 'KR1', 10, false, { fresh: true })
  check('이전 시즌 판을 만나면 멈추고 그 판은 넣지 않음', analyzableMatches(b.matches).length === 0 && b.matches.length === 10, JSON.stringify({ total: b.matches.length, scanned: b.olderScanned }))

  // 랭크 판이 충분하면 더 부르지 않음
  kindOf = () => ({ queueId: 1100, setNumber: CURRENT_SET })
  calls.ids = []
  const c = await loadSummonerData('충분', 'KR1', 10, false, { fresh: true })
  check('최근 10판이 모두 랭크면 이전 판을 부르지 않음', c.matches.length === 10 && !c.olderScanned && calls.ids.length === 1, calls.ids.join(','))

  console.log('여러 페이지 · 실패 재시도 (2026-10-29 지시문 3)')
  // 클레스메이트#KR1 재현: 최근 10판 중 랭크 4판, 이전 판엔 랭크가 드문드문 — 한 페이지(20판)로 모자라면 다음 페이지로
  kindOf = (n) => ({ queueId: (n < 10 ? n % 3 === 0 : n % 7 === 0) ? 1100 : 1090, setNumber: CURRENT_SET })
  calls.ids = []
  const d = await loadSummonerData('여러페이지', 'KR1', 10, false, { fresh: true })
  const dRanked = analyzableMatches(d.matches).length
  check('랭크 10판이 찰 때까지 페이지를 넘김 (10+20, 30+20, …)', dRanked === 10 && calls.ids.length >= 3 && calls.ids[2] === `30+${BACKFILL_PAGE}`, JSON.stringify({ dRanked, ids: calls.ids, scanned: d.olderScanned }))
  check('안내 숫자 = 실제 결과 (덧붙인 판 수 = 목록에 늘어난 판 수)', d.olderAdded === d.matches.length - 10 && d.scannedMatches === 10 + d.olderScanned)

  // 429 로 두 번 실패한 뒤 성공하는 판은 재시도로 채운다 (조용히 빠지지 않음)
  kindOf = (n) => (n < 10 ? { queueId: 1090, setNumber: CURRENT_SET } : { queueId: 1100, setNumber: CURRENT_SET })
  failPlan = new Map([[11, 2], [12, 2], [13, 1]])
  const e = await loadSummonerData('재시도', 'KR1', 10, false, { fresh: true })
  check('일시 실패(429)는 지수 백오프 재시도로 불러옴 · 실패 0', analyzableMatches(e.matches).length === 10 && e.failedMatches === 0 && e.matches.some((m) => m.matchId === 'M11'), JSON.stringify({ failed: e.failedMatches }))

  // 끝내 실패한 판은 숫자로 돌려준다
  failPlan = new Map([[0, Infinity], [3, Infinity], [10, Infinity], [11, Infinity], [12, Infinity], [13, Infinity], [14, Infinity]])
  const f = await loadSummonerData('실패', 'KR1', 10, false, { fresh: true })
  check(
    '재시도 후에도 실패한 판 수를 돌려줌 (최근 2 + 이전 5 = 7판 실패)',
    f.failedMatches === 7 && f.scannedMatches - f.failedMatches === f.matches.length + (f.olderScanned - f.olderAdded - 5),
    JSON.stringify({ failed: f.failedMatches, scanned: f.scannedMatches, total: f.matches.length, olderScanned: f.olderScanned, added: f.olderAdded })
  )
  failPlan = new Map()

  // 상한: 최근 100판
  kindOf = () => ({ queueId: 1090, setNumber: CURRENT_SET })
  calls.ids = []
  const g = await loadSummonerData('상한', 'KR1', 10, false, { fresh: true })
  check(`랭크 판이 없으면 최근 ${BACKFILL_SCAN_CAP}판에서 멈춤`, g.scannedMatches === BACKFILL_SCAN_CAP && calls.ids.at(-1) === `90+10`, JSON.stringify({ scanned: g.scannedMatches, ids: calls.ids }))

  // 상한: 30일
  gapMs = 2 * 86_400_000 // 판 사이 2일 → 15판째부터 30일 넘음
  const h = await loadSummonerData('기간', 'KR1', 10, false, { fresh: true })
  check('30일보다 오래된 판을 만나면 멈춤', h.olderScanned <= 10, JSON.stringify({ scanned: h.olderScanned }))
  gapMs = 60_000

  console.log(failures ? `\n❌ 실패 ${failures}건` : '\n✅ 분석 판 보충 테스트 통과')
  if (failures) process.exitCode = 1
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

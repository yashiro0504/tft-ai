/**
 * 2026-11-04 지시문(sitemap 덱 URL 404) 회귀 테스트 — 네트워크·DB 불필요.
 *
 *  1. 스냅샷 고르기(lib/deckSnapshotPick): 패치 전환 중에도 DB 스냅샷이 래더 JSON 으로 내려가지 않는다
 *     - 새 패치 덱 클러스터 전 → 이전 패치 DB 덱 · 새 패치 표본 부족(필터 폴백) → 마지막 DB 사본 · 반복 호출해도 같은 덱 목록
 *  2. sitemap 덱 = 덱 페이지 기본 경로가 200 으로 여는 덱 (같은 함수 · 요청 시점 · 1시간 캐시 없음)
 *  3. ops-check: sitemap 덱 URL 전수 점검(표본 아님) · 404/리다이렉트/요청 실패 모두 미충족
 *  4. 원본 정리 배치화 (statement timeout)
 *
 * 실행: node scripts/testSitemapDecks.js   (npm run test:ops 에 포함)
 */
require('./_ts')
const fs = require('fs')
const path = require('path')
const { buildMetaDeckSnapshot } = require('../lib/deckSnapshotPick')
const { deckFromSnapshot, deckIdsOfSnapshot } = require('../lib/deckPage')
const { sweepStatuses, sitemapLocs, locPath } = require('./checkOps')

let failures = 0
function check(label, ok, detail = '') {
  if (ok) console.log(`  ✅ ${label}`)
  else {
    failures++
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8')

const deck = (id) => ({ id, name: id, tier: 'A', avgPlacement: 4, top4Rate: 0.5, sampleSize: 100, units: [], traits: [] })
/** 16.21 DB 덱 100개 · 래더 JSON 덱 100개 중 47개만 겹친다 (실측 53/100 404 재현) */
const DB_1621 = Array.from({ length: 100 }, (_, i) => deck(`ladder-db-${i}`))
const JSON_LADDER = [...DB_1621.slice(0, 47), ...Array.from({ length: 53 }, (_, i) => deck(`ladder-json-${i}`))]
const DB_1622 = Array.from({ length: 30 }, (_, i) => deck(`ladder-new-${i}`))

const dbRes = (patch, decks, updatedAt = '2026-11-04T01:00:00Z') => ({
  success: true,
  source: 'db',
  filter: { patch, tier: 'master' },
  updatedAt,
  minSample: 30,
  decks,
})
const jsonRes = (reason) => ({ success: true, source: 'json', filter: null, patch: '16.21', minSample: 30, decks: JSON_LADDER, fallbackReason: reason })
const filtersDb = (...patches) => ({
  success: true,
  source: 'db',
  patches: patches.map((p) => ({ patch: p })),
  defaults: { patch: patches[0], tier: 'master', days: 'all' },
})
const filtersJson = (reason) => ({ success: true, source: 'json', patches: [], defaults: { patch: null, tier: 'master', days: 'all' }, fallbackReason: reason })

/** getDecks 흉내: 패치별 DB 덱 (없으면 JSON 폴백 'empty' — lib/tftStats getDecks 와 같은 모양) */
function deps({ filters, byPatch = {}, last = null, onGetDecks }) {
  return {
    getMetaFilters: async () => filters,
    getDecks: async (f) => {
      onGetDecks?.(f)
      if (filters.source !== 'db') return jsonRes(filters.fallbackReason)
      const decks = byPatch[f.patch]
      if (decks === 'error') return jsonRes('db_error')
      return decks?.length ? dbRes(f.patch, decks) : jsonRes('empty')
    },
    lastDbSnapshot: async () => last,
  }
}
const ids = (res) => (res.decks || []).map((d) => d.id).join(',')

;(async () => {
  console.log('1. 스냅샷 고르기 — 패치 전환 중에도 DB 스냅샷 유지')
  {
    const r = await buildMetaDeckSnapshot(deps({ filters: filtersDb('16.21'), byPatch: { '16.21': DB_1621 } }))
    check('평상시: 최신 패치 DB 덱 · heldReason 없음', r.source === 'db' && r.filter.patch === '16.21' && !r.heldReason && r.decks.length === 100)
  }
  {
    const last = dbRes('16.21', DB_1621)
    const r = await buildMetaDeckSnapshot(deps({ filters: filtersDb('16.22', '16.21'), byPatch: { '16.21': DB_1621 }, last }))
    check('16.22 덱 클러스터 전 → 16.21 DB 사본을 붙잡는다 (래더 JSON 아님)', r.source === 'db' && r.filter.patch === '16.21' && r.heldReason === 'empty', JSON.stringify({ s: r.source, p: r.filter?.patch, h: r.heldReason }))
  }
  {
    const r = await buildMetaDeckSnapshot(deps({ filters: filtersDb('17.1', '16.24'), byPatch: { '16.24': DB_1621 }, last: null }))
    check('새 세트 첫날(같은 세트 사본 없음) → 이전 세트 덱을 붙잡지 않고 래더 JSON', r.source === 'json')
  }
  {
    const last = dbRes('16.21', DB_1621)
    const r = await buildMetaDeckSnapshot(deps({ filters: filtersJson('small_sample'), last }))
    check('16.22 표본 부족(필터 폴백) → 마지막 DB 사본(16.21) · heldReason=small_sample', r.source === 'db' && ids(r) === ids(last) && r.heldReason === 'small_sample')
  }
  {
    const r = await buildMetaDeckSnapshot(deps({ filters: filtersJson('no_db') }))
    check('DB 스냅샷이 한 번도 없을 때만 래더 JSON', r.source === 'json' && r.fallbackReason === 'no_db')
  }
  {
    const r = await buildMetaDeckSnapshot(deps({ filters: filtersDb('16.22', '16.21'), byPatch: { '16.22': DB_1622, '16.21': DB_1621 } }))
    check('16.22 덱 클러스터가 생기면 16.22 로 넘어간다', r.source === 'db' && r.filter.patch === '16.22' && !r.heldReason)
  }
  {
    const seen = []
    const last = dbRes('16.21', DB_1621)
    const r = await buildMetaDeckSnapshot(deps({ filters: filtersDb('16.22', '16.21'), byPatch: { '16.22': 'error', '16.21': DB_1621 }, last, onGetDecks: (f) => seen.push(f.patch) }))
    check('DB 오류(db_error) → DB 를 더 두드리지 않고 사본', seen.join(',') === '16.22' && r.source === 'db' && r.heldReason === 'db_error', seen.join(','))
  }
  {
    // 실측 재현: 같은 상태로 여러 번 다시 만들어도 덱 목록이 바뀌지 않아야 한다 (예전: 1분마다 DB ↔ JSON)
    const last = dbRes('16.21', DB_1621)
    const lists = new Set()
    for (let i = 0; i < 5; i++) lists.add(ids(await buildMetaDeckSnapshot(deps({ filters: filtersJson('small_sample'), last }))))
    for (let i = 0; i < 5; i++) lists.add(ids(await buildMetaDeckSnapshot(deps({ filters: filtersDb('16.22', '16.21'), byPatch: { '16.21': DB_1621 }, last }))))
    check('전환 구간(표본 부족 → 덱 클러스터 전) 내내 같은 덱 목록 하나', lists.size === 1, `${lists.size}개 목록`)
  }
  const stats = read('lib', 'tftStats.ts')
  check('tftStats: 스냅샷 갱신이 buildMetaDeckSnapshot 을 쓰고, 붙잡은 스냅샷은 사본(3일)을 덮지 않는다', /buildMetaDeckSnapshot\(/.test(stats) && /fresh = res\.source === 'db' && !res\.heldReason/.test(stats) && /if \(fresh\) await cacheSet\(SNAPSHOT_STALE_KEY/.test(stats))

  console.log('2. sitemap 덱 = 덱 페이지가 200 으로 여는 덱')
  {
    const snap = dbRes('16.21', [...DB_1621, deck('ladder-db-0'), deck('')])
    const list = deckIdsOfSnapshot(snap)
    check('중복 · 빈 id 제외', list.length === 100 && new Set(list).size === 100)
    const notFound = list.filter((id) => !deckFromSnapshot(snap, id))
    check('sitemap 덱 id 전부 덱 페이지 기본 경로(deckFromSnapshot)에서 열린다 — 404 0건', notFound.length === 0, notFound.slice(0, 3).join(','))
  }
  const sitemap = read('app', 'sitemap.ts')
  check('app/sitemap.ts: 덱 페이지와 같은 함수(listDeckPageIds)', /listDeckPageIds\(\)/.test(sitemap) && !/getMetaDeckSnapshot/.test(sitemap))
  check("app/sitemap.ts: 요청 시점에 만든다 (dynamic='force-dynamic' · 1시간 캐시 없음)", /export const dynamic = 'force-dynamic'/.test(sitemap) && !/export const revalidate/.test(sitemap))
  const deckPage = read('lib', 'deckPage.ts')
  check('listDeckPageIds 와 덱 페이지(resolveDeckPage)가 같은 스냅샷 함수', /export async function listDeckPageIds[\s\S]*?getMetaDeckSnapshot\(\)/.test(deckPage) && /export async function resolveDeckPage[\s\S]*?getMetaDeckSnapshot\(\)/.test(deckPage))

  console.log('3. ops-check — sitemap 덱 URL 전수 200')
  {
    const xml = `<?xml version="1.0"?><urlset>${[...DB_1621.map((d) => `<url><loc>https://www.tftlab.kr/deck/${d.id}</loc></url>`), '<url><loc>https://www.tftlab.kr/meta</loc></url>'].join('')}</urlset>`
    const locs = sitemapLocs(xml)
    const deckPaths = locs.map(locPath).filter((p) => p.startsWith('/deck/'))
    check('sitemap <loc> 파싱 · 도메인이 달라도 경로로 본다', locs.length === 101 && deckPaths.length === 100 && deckPaths[0] === '/deck/ladder-db-0')
    const live = new Set(JSON_LADDER.map((d) => `/deck/${d.id}`))
    const r = await sweepStatuses(deckPaths, async (p) => (live.has(p) ? 200 : 404))
    check('실측 재현: 덱 100개 중 53개 404 → 53건 모두 잡는다 (첫 1개만 보던 예전 점검은 놓칠 수 있었다)', r.total === 100 && r.bad.length === 53 && r.bad.every((b) => b.status === 404), `${r.bad.length}`)
    const all = await sweepStatuses(deckPaths, async () => 200)
    check('전부 200 → 미충족 0건', all.ok === 100 && all.bad.length === 0)
    const mixed = await sweepStatuses(['/deck/a', '/deck/b', '/deck/c'], async (p) => {
      if (p === '/deck/b') return 301
      if (p === '/deck/c') throw new Error('ECONNRESET')
      return 200
    })
    check('리다이렉트(301) · 요청 실패도 200 아님으로 센다', mixed.bad.length === 2 && mixed.bad.some((b) => b.status === 301) && mixed.bad.some((b) => b.status === 0 && /ECONNRESET/.test(b.error)))
  }
  const ops = read('scripts', 'checkOps.js')
  check('checkOps: 덱 페이지를 첫 1개만 보지 않는다 (decks[0] 없음 · 전수 sweepStatuses)', !/decks\[0\]/.test(ops) && /sweepStatuses\(decks\.map\(locPath\)/.test(ops))
  check("checkOps: 리다이렉트를 따라가지 않는다 (redirect: 'manual')", /redirect: 'manual'/.test(ops))
  const wf = read('.github', 'workflows', 'meta-snapshot-check.yml')
  check('2시간마다 sitemap 덱 전수 점검 (--sitemap-only --strict)', /--sitemap-only --strict/.test(wf))
  const opsWf = read('.github', 'workflows', 'ops-check.yml')
  check('Ops Check 는 그대로 strict', /checkOps\.js "\$OPS_URL" --strict/.test(opsWf))

  console.log('4. 원본 정리 배치화 (statement timeout)')
  const store = read('scripts', 'collect', 'store.js')
  check('한 문장 tft_prune_raw RPC 대신 배치 삭제', !/rpc\('tft_prune_raw'/.test(store) && /\.delete\(\)\.in\('match_id', ids\)/.test(store) && /const PRUNE_BATCH = \d+/.test(store))
  check('배치 정리는 시간 상한이 있다 (남은 판은 다음 실행)', /while \(Date\.now\(\) < deadline\)/.test(store) && /deadlineMs: Date\.now\(\) \+ PRUNE_BUDGET_MS/.test(read('scripts', 'collectDb.js')))

  console.log(failures ? `\n❌ 실패 ${failures}건` : '\n✅ sitemap 덱 URL 회귀 테스트 통과')
  if (failures) process.exitCode = 1
})()

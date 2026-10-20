/**
 * 일별 집계 · 덱 클러스터 회귀 테스트 (Phase B).
 *
 * 실행: node scripts/testRollup.js
 *  1) JS 집계 (scripts/collect/rollup.js): 손으로 센 기대값과 비교 · 티어 누적 · 기간 필터
 *  2) 메모리 저장소: 티어 상향 후 양쪽 구간 재계산 · 정리된 패치 보호 · 덱 클러스터(stat_comp 행)
 *  3) SQL (supabase/migrations/0005 + 0006) — PGlite 가 있으면 같은 무작위 데이터로 SQL 결과 = JS 결과 인지 비교하고
 *     RLS(anon 읽기 가능 · 원본/쓰기 RPC 불가)를 확인한다. PGlite 가 없으면 건너뛴다 (CI 기본).
 *       PGLITE_PATH=<.../node_modules/@electric-sql/pglite> node scripts/testRollup.js
 */
const fs = require('fs')
const path = require('path')
const { createMemoryStore } = require('./collect/store')
const { rollupBoards, queryRollups, rollupFilters, comboKey, tierBuckets, minusDays } = require('./collect/rollup')
const { toDeckBoards, compRows } = require('./collect/decks')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  ✅ ${label}`)
  else {
    failures++
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** units=[기물,성급,아이템×3]×N · traits=[시너지,인원,단계]×N */
const board = (match_id, placement, units, traits = []) => ({
  match_id,
  placement,
  level: 8,
  last_round: 30,
  gold_left: 0,
  damage: 0,
  unit_ids: [...new Set(units.map((u) => u[0]))],
  units: units.flatMap((u) => [u[0], u[1], u[2] || 0, u[3] || 0, u[4] || 0]),
  traits: traits.flat(),
})

/** 결정적 난수 (테스트 재현용) */
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function randomData(n = 120) {
  const rand = rng(42)
  const pick = (arr) => arr[Math.floor(rand() * arr.length)]
  const dates = ['2026-10-18', '2026-10-19', '2026-10-20']
  const patches = ['16.19', '16.20']
  const tiers = ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND']
  const out = []
  for (let i = 0; i < n; i++) {
    const match_id = `KR_${1000 + i}`
    const game_date = pick(dates)
    const match = {
      match_id,
      platform: 'kr',
      set_number: 18,
      patch: i < 10 ? '16.19' : pick(patches),
      queue_id: 1100,
      game_at: `${game_date}T03:00:00.000Z`,
      game_date,
      game_length_sec: 2000,
      tier_bucket: pick(tiers),
    }
    const boards = []
    for (let p = 1; p <= 8; p++) {
      const units = Array.from({ length: 3 + Math.floor(rand() * 6) }, () => {
        const items = Array.from({ length: Math.floor(rand() * 4) }, () => 31 + Math.floor(rand() * 10))
        return [1 + Math.floor(rand() * 12), 1 + Math.floor(rand() * 3), ...items]
      })
      // 같은 기물 두 번(2성 두 개 등)도 섞는다
      if (rand() < 0.2) units.push([...units[0]])
      const traits = Array.from({ length: Math.floor(rand() * 5) }, () => [51 + Math.floor(rand() * 8), 2 + Math.floor(rand() * 4), Math.floor(rand() * 4)])
      boards.push(board(match_id, p, units, traits))
    }
    out.push({ match, boards })
  }
  return out
}

// 기물 키는 끝 숫자를 떼므로(statChampKey) 문자로 구분한다: TFT18_ChampA …
const dictApi = (id) => (id <= 30 ? `TFT18_Champ${String.fromCharCode(64 + id)}` : id <= 50 ? `TFT_Item_${id}` : `TFT18_Trait${id}`)
const dictKindOf = (id) => (id <= 30 ? 'unit' : id <= 50 ? 'item' : 'trait')

const sortRows = (rows) =>
  rows
    .map((r) => ({
      key1: r.key1 ?? null,
      key2: r.key2 ?? null,
      games: Number(r.games ?? 0),
      placement_sum: r.placement_sum == null ? null : Number(r.placement_sum),
      top4: r.top4 == null ? null : Number(r.top4),
      wins: r.wins == null ? null : Number(r.wins),
      extra1: r.extra1 == null ? null : Number(r.extra1),
      extra2: r.extra2 == null ? null : Number(r.extra2),
    }))
    .sort((a, b) => `${a.key1}|${a.key2}`.localeCompare(`${b.key1}|${b.key2}`))

;(async () => {
  console.log('JS 집계 (손으로 센 값)')
  // 보드 3개: 1등(아리 2성 아이템 2개 + 가렌 1성), 5등(아리 3성 아이템 1개), 8등(가렌 2성 두 개)
  const boards = [
    board('KR_1', 1, [[1, 2, 31, 32], [2, 1]], [[51, 4, 2], [52, 1, 0]]),
    board('KR_1', 5, [[1, 3, 31]], [[51, 2, 1]]),
    board('KR_2', 8, [[2, 2], [2, 2]], []),
  ]
  const r = rollupBoards(boards)
  const unit = (u, star) => r.unit.find((x) => x.unit === u && x.star === star)
  check('판 수 · 보드 수', r.totals.matches === 2 && r.totals.boards === 3)
  check('아리 합계: 2건 · 등수합 6 · TOP4 1 · 1등 1', JSON.stringify(unit(1, 0)) === JSON.stringify({ unit: 1, star: 0, games: 2, placement_sum: 6, top4: 1, wins: 1 }))
  check('아리 성급별 2성 1 · 3성 1', unit(1, 2).games === 1 && unit(1, 3).games === 1)
  check('가렌: 같은 보드 두 개는 2건 (기물 1개당 1건)', unit(2, 0).games === 3 && unit(2, 2).games === 2 && unit(2, 1).games === 1)
  check('아이템 31: 2건 (1등·5등)', r.item.find((x) => x.item === 31).games === 2 && r.item.find((x) => x.item === 31).placement_sum === 6)
  check('기물×아이템 아리×32: 1건', r.unitItem.find((x) => x.unit === 1 && x.item === 32).games === 1)
  check('시너지: 비활성(단계 0) 제외', !r.trait.some((x) => x.trait === 52))
  check('시너지 51: 합계 2 · 2단계 1 · 1단계 1', r.trait.find((x) => x.trait === 51 && x.tier === 0).games === 2 && r.trait.find((x) => x.trait === 51 && x.tier === 2).games === 1)

  console.log('JS 조회 (티어 누적 · 기간)')
  check('티어 필터 누적', tierBuckets('grandmaster').join() === 'CHALLENGER,GRANDMASTER' && tierBuckets('diamond').length === 4 && tierBuckets('x').length === 3)
  check('기간 3일 = 오늘 포함', minusDays('2026-10-20', 2) === '2026-10-18')
  const rollups = new Map([
    [comboKey('2026-10-20', '16.20', 'CHALLENGER'), rollupBoards([boards[0]])],
    [comboKey('2026-10-13', '16.20', 'MASTER'), rollupBoards([boards[1]])],
    [comboKey('2026-10-20', '16.20', 'DIAMOND'), rollupBoards([boards[2]])],
  ])
  const q = (o) => queryRollups(rollups, (id) => `id${id}`, { patch: '16.20', today: '2026-10-20', ...o })
  const ahri = (rows) => rows.find((x) => x.key1 === 'id1')
  check('마스터+ · 7일(10-14~20): 10-13 제외', ahri(q({ type: 'unit', tierMin: 'MASTER', days: 7 })).games === 1)
  check('마스터+ · 패치 전체: 10-13 포함', ahri(q({ type: 'unit', tierMin: 'MASTER', days: 0 })).games === 2)
  check('평균 성급 · 3성 수', ahri(q({ type: 'unit', days: 0 })).extra1 === 5 && ahri(q({ type: 'unit', days: 0 })).extra2 === 1)
  check('다이아+ 에만 가렌 2성 보드', q({ type: 'unit', tierMin: 'DIAMOND', days: 0 }).find((x) => x.key1 === 'id2').games === 3 && q({ type: 'unit', tierMin: 'MASTER', days: 0 }).find((x) => x.key1 === 'id2').games === 1)
  check('전체 보드 수 (픽률 분모)', q({ type: 'total', tierMin: 'DIAMOND', days: 0 })[0].games === 3)
  check('최소 표본 거르기', q({ type: 'unit_item', days: 0, minGames: 2 }).length === 1)
  check('필터 목록', rollupFilters(rollups).length === 3 && rollupFilters(rollups)[0].last_date === '2026-10-20')

  console.log('메모리 저장소 (티어 상향 · 정리 보호)')
  const mem = createMemoryStore()
  const m1 = { match_id: 'KR_10', platform: 'kr', set_number: 18, patch: '16.20', queue_id: 1100, game_at: '2026-10-20T03:00:00Z', game_date: '2026-10-20', tier_bucket: 'MASTER' }
  await mem.ingest(m1, [board('KR_10', 1, [[1, 1]]), board('KR_10', 2, [[2, 1]])])
  check('조합 집계 = 보드 수', (await mem.refreshRollup('2026-10-20', '16.20', 'MASTER')) === 2)
  await mem.raiseTier(['KR_10'], 'CHALLENGER')
  await mem.refreshRollup('2026-10-20', '16.20', 'MASTER')
  await mem.refreshRollup('2026-10-20', '16.20', 'CHALLENGER')
  check('상향 후 옛 구간 비고 새 구간에 집계', !mem._state.rollups.has(comboKey('2026-10-20', '16.20', 'MASTER')) && mem._state.rollups.get(comboKey('2026-10-20', '16.20', 'CHALLENGER')).totals.boards === 2)
  check('원본이 정리된 패치는 집계를 지우지 않음 (-1)', (await mem.refreshRollup('2026-10-01', '16.18', 'MASTER')) === -1)

  console.log('덱 클러스터 (DB 보드 → stat_comp 행)')
  // 실제 세트18 기물·아이템 이름으로 같은 덱 20판 (캐리 = 딜템 3개 든 카직스)
  const names = new Map([
    [1, 'TFT18_Khazix'], [2, 'TFT18_Hecarim'], [3, 'TFT18_Diana'], [4, 'TFT18_Lillia'], [5, 'TFT18_Camille'], [6, 'TFT18_Alune'],
    [31, 'TFT_Item_InfinityEdge'], [32, 'TFT_Item_Bloodthirster'], [33, 'TFT_Item_LastWhisper'],
    [51, 'TFT18_Elderwood'], [52, 'TFT18_Vanguard'],
  ])
  const deckRaw = Array.from({ length: 20 }, (_, i) => ({
    ...board(`KR_D${Math.floor(i / 8)}`, (i % 8) + 1, [[1, 2, 31, 32, 33], [2, 2], [3, 2], [4, 1], [5, 1], [6, 1]], [[51, 3, 1], [52, 2, 1]]),
    tier_bucket: i < 10 ? 'CHALLENGER' : 'MASTER',
  }))
  const deckBoards = toDeckBoards(deckRaw, (id) => names.get(id))
  check('정수 배열 → 이름 보드', deckBoards[0].units[0].id === 'TFT18_Khazix' && deckBoards[0].units[0].items.length === 3 && deckBoards[0].traits[0].style === 1)
  const rows = compRows(deckBoards, { minGames: 15 })
  check('같은 구성 20판 → 덱 1개', rows.length === 1, JSON.stringify(rows.map((x) => [x.comp_id, x.games])))
  if (rows[0]) {
    const d = rows[0]
    check('판수 · 분모', d.games === 20 && d.total_boards === 20)
    check('등수합 · TOP4 · 1등 = 덱 수치', Math.abs(d.placement_sum / d.games - d.deck.avgPlacement) < 0.01 && d.top4 === Math.round(d.deck.top4Rate * 20) && d.wins === d.deck.placementDist[0])
    check('deck 은 decksData.json 덱 모양', d.deck.id === d.comp_id && Array.isArray(d.deck.units) && d.deck.carryKey && d.core_units.includes('khazix'))
  }
  check('표본 하한 미만 덱은 저장 안 함', compRows(deckBoards.slice(0, 10), { minGames: 15 }).length === 0)

  console.log('서빙 (lib/tftStats — DB 미설정 → JSON 폴백)')
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const fallback = loadStatsLib()
  const shared = require('../lib/statsShared')
  const pf = (q) => shared.parseStatFilter(new URLSearchParams(q))
  check('필터 파싱: 기본 마스터+ · 7일', JSON.stringify(pf('')) === JSON.stringify({ patch: null, tier: 'master', days: 7 }))
  check('필터 파싱: days=0 은 패치 전체 · 잘못된 값은 기본값', pf('days=0').days === 0 && pf('days=5').days === 7 && pf('tier=DIAMOND').tier === 'diamond' && pf('patch=abc').patch === null && pf('patch=16.20').patch === '16.20')
  check('표준오차 2.29/√n', shared.placementMargin(100) === 0.23 && shared.placementMargin(0) === null)
  const fbFilters = await fallback.getMetaFilters()
  const fbUnits = await fallback.getStats('unit', shared.DEFAULT_FILTER)
  const fbDecks = await fallback.getDecks(shared.DEFAULT_FILTER)
  check('필터 목록: json · 패치 없음', fbFilters.source === 'json' && fbFilters.patches.length === 0 && fbFilters.fallbackReason === 'supabase_not_configured')
  check(
    '기물: metaStats.json 폴백 · 표본 필드',
    fbUnits.source === 'json' && fbUnits.filter === null && fbUnits.rows.length > 0 && fbUnits.rows.every((r) => typeof r.lowSample === 'boolean' && r.margin > 0)
  )
  check('덱: decksData.json 폴백', fbDecks.source === 'json' && fbDecks.decks.length > 0 && fbDecks.decks.every((d) => d.lowSample === d.sampleSize < 15))

  // ?unit= 필터는 메모 캐시 객체를 고치면 안 된다 (REVIEW R1)
  const fbCombos = await fallback.getStats('unit_item', shared.DEFAULT_FILTER)
  const comboCount = fbCombos.rows.length
  const someChamp = fbCombos.rows[0] && fbCombos.rows[0].champKey
  const onlyOne = shared.filterStatsByUnit(fbCombos, String(someChamp))
  check(
    'unit 필터: 원본 rows 불변 · 새 객체 반환',
    comboCount > 0 && fbCombos.rows.length === comboCount && onlyOne !== fbCombos && onlyOne.rows !== fbCombos.rows && onlyOne.rows.length > 0 && onlyOne.rows.length < comboCount,
    `${comboCount} → ${fbCombos.rows.length} / ${onlyOne.rows.length}`
  )
  check('unit 필터: 없는 기물은 빈 배열', shared.filterStatsByUnit(fbCombos, 'nope').rows.length === 0 && fbCombos.rows.length === comboCount)

  await sqlChecks()
})()
  .catch((e) => {
    failures++
    console.error(e)
  })
  .finally(() => {
    console.log(failures ? `\n❌ 실패 ${failures}건` : '\n✅ 집계 테스트 통과')
    if (failures) process.exitCode = 1
  })

/** lib/tftStats.ts 를 새로 읽는다 (supabase 설정은 import 시점 env 로 정해지므로 캐시를 비운다) */
function loadStatsLib(fakeClient) {
  require('./_ts')
  const root = path.join(__dirname, '..', 'lib')
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(root) && /(tftStats|supabase[\\/]config)\.ts$/.test(k)) delete require.cache[k]
  }
  const sbPath = require.resolve('@supabase/supabase-js')
  if (fakeClient) {
    const real = require(sbPath)
    require.cache[sbPath] = { id: sbPath, filename: sbPath, loaded: true, exports: { ...real, createClient: () => fakeClient } }
  } else {
    delete require.cache[sbPath]
  }
  return require('../lib/tftStats')
}

/**
 * PGlite 위의 최소 supabase-js 흉내: rpc(fn, 인자) · from(t).select().eq().abortSignal().
 * PostgREST 처럼 date 는 문자열, bigint 는 숫자로 돌려준다.
 */
function fakeSupabase(db, { failRpc = false } = {}) {
  const parsers = { 1082: (v) => v, 20: (v) => Number(v), 1700: (v) => Number(v) }
  const run = (sql, params) =>
    failRpc
      ? Promise.resolve({ data: null, error: { message: 'boom' } })
      : db.query(sql, params, { parsers }).then(
          (r) => ({ data: r.rows, error: null }),
          (e) => ({ data: null, error: { message: e.message } })
        )
  return {
    rpc(fn, args) {
      const keys = Object.keys(args)
      const sql = `select * from ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`
      return { abortSignal: () => run(sql, keys.map((k) => args[k])) }
    },
    from(table) {
      const conds = []
      let cols = '*'
      const b = {
        select(c) {
          cols = c
          return b
        },
        eq(c, v) {
          conds.push([c, v])
          return b
        },
        abortSignal: () =>
          run(`select ${cols} from ${table}${conds.length ? ` where ${conds.map(([c], i) => `${c} = $${i + 1}`).join(' and ')}` : ''}`, conds.map((c) => c[1])),
      }
      return b
    },
  }
}

/** lib/tftStats 를 PGlite 집계에 붙여 응답 모양·수치를 확인한다 */
async function apiChecks(db, mem) {
  console.log('서빙 (lib/tftStats → PGlite 집계)')
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://pglite.test'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  const stats = loadStatsLib(fakeSupabase(db))
  const { queryRollups } = require('./collect/rollup')

  const filters = await stats.getMetaFilters()
  check('필터 목록: db · 최신 패치 16.20 기본', filters.source === 'db' && filters.defaults.patch === '16.20' && filters.patches.length === 2, JSON.stringify(filters.defaults))
  const p = filters.patches.find((x) => x.patch === '16.20')
  check('티어 필터별 판 수 누적 (챌 ≤ 그마+ ≤ 마스터+ ≤ 다이아+)', p.matches.challenger <= p.matches.grandmaster && p.matches.grandmaster <= p.matches.master && p.matches.master <= p.matches.diamond && p.matches.diamond > 0)

  // 날짜에 따라 바뀌지 않게 패치 전체(days=0)로 비교
  const f = { patch: '16.20', tier: 'master', days: 0 }
  const units = await stats.getStats('unit', f)
  const js = queryRollups(mem._state.rollups, (id) => mem.dictName(id), { type: 'unit', patch: '16.20', tierMin: 'MASTER', days: 0 })
  const total = queryRollups(mem._state.rollups, (id) => mem.dictName(id), { type: 'total', patch: '16.20', tierMin: 'MASTER', days: 0 })[0]
  const byKey = new Map(units.rows.map((r) => [r.key, r]))
  const sample = js[0]
  const row = byKey.get(stats.statChampKey(sample.key1))
  check('기물: db · 적용 필터 · 행 수 = 집계', units.source === 'db' && units.filter.patch === '16.20' && units.rows.length === js.length)
  check(
    '기물: 평균등수 · 표본 · 픽률 · ± · 표본 부족',
    row &&
      row.sampleSize === sample.games &&
      row.avgPlacement === Math.round((sample.placement_sum / sample.games) * 100) / 100 &&
      row.pickRate === Math.round((sample.games / total.games) * 1000) / 1000 &&
      row.margin === Math.round((2.29 / Math.sqrt(sample.games)) * 100) / 100 &&
      row.lowSample === sample.games < 30 &&
      units.totalBoards === total.games,
    JSON.stringify(row)
  )
  check('기물: 평균등수 오름차순', units.rows.every((r, i, a) => i === 0 || a[i - 1].avgPlacement <= r.avgPlacement))
  const combos = await stats.getStats('unit_item', f)
  check('기물×아이템: 5판 미만 행 제외 · 키 = 기물|아이템', combos.rows.every((r) => r.sampleSize >= 5 && r.key === `${r.champKey}|${r.itemKey}`) && combos.rows.length > 0)
  const traits = await stats.getStats('trait', { ...f, tier: 'challenger', days: 3 })
  check('시너지: 다른 필터 조합도 db', traits.source === 'db' && traits.filter.tier === 'challenger' && traits.filter.days === 3)
  const unknownPatch = await stats.getStats('item', { ...f, patch: '9.99' })
  check('없는 패치 요청 → 최신 패치', unknownPatch.filter.patch === '16.20')

  // 덱: 실제 decksData.json 덱 1개를 stat_comp 에 넣고 읽기
  const sampleDeck = require('../lib/decksData.json').decks[0]
  const compRow = { comp_id: sampleDeck.id, core_units: sampleDeck.units.map((u) => u.lolchessKey), games: 12, placement_sum: 48, top4: 7, wins: 2, total_boards: 960, deck: { ...sampleDeck, games: 12 } }
  await db.query('select tft_replace_comps($1, $2, $3::jsonb)', ['16.20', 'MASTER', JSON.stringify([compRow])])
  const decks = await stats.getDecks({ patch: '16.20', tier: 'master' })
  check('덱: db · stat_comp.deck → 화면 덱 · 표본 부족(12 < 15)', decks.source === 'db' && decks.decks.length === 1 && decks.decks[0].id === sampleDeck.id && decks.decks[0].lowSample === true && decks.totalBoards === 960)
  check('덱: DB 덱에는 JSON 기물 수치를 붙이지 않음', decks.decks[0].units.every((u) => !u.stat))
  const chDecks = await stats.getDecks({ patch: '16.20', tier: 'challenger' })
  check('덱: 기본 아닌 필터에 덱이 없으면 빈 목록 (db)', chDecks.source === 'db' && chDecks.decks.length === 0)

  // DB 오류 → JSON 폴백
  const broken = loadStatsLib(fakeSupabase(db, { failRpc: true }))
  const fb = await broken.getStats('unit', f)
  check('DB 오류 → JSON 폴백 (db_error)', fb.source === 'json' && fb.fallbackReason === 'db_error' && fb.rows.length > 0)
}

function loadPglite() {
  const candidates = [process.env.PGLITE_PATH, '@electric-sql/pglite'].filter(Boolean)
  for (const c of candidates) {
    try {
      return require(c)
    } catch {
      /* 다음 후보 */
    }
  }
  return null
}

async function sqlChecks() {
  const mod = loadPglite()
  if (!mod) {
    // CI 는 REQUIRE_PGLITE=1 — 실서비스 SQL 이 검증 없이 통과하지 않게 한다
    check('SQL (PGlite) 로드', !process.env.REQUIRE_PGLITE, 'REQUIRE_PGLITE=1 인데 @electric-sql/pglite 를 불러오지 못함 (npm ci 확인)')
    console.log('SQL (PGlite) — 건너뜀: PGlite 없음 (npm install 또는 PGLITE_PATH 로 지정하면 0005·0006 을 실제로 실행해 비교)')
    return
  }
  console.log('SQL (PGlite: 0005 + 0006 실행 · JS 결과와 비교)')
  const db = new mod.PGlite()
  // Supabase 기본 역할·권한 흉내
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant select on tables to anon, authenticated;
    alter default privileges in schema public grant all on tables to service_role;
  `)
  const migrations = path.join(__dirname, '..', 'supabase', 'migrations')
  for (const f of ['0005_tft_stats.sql', '0006_tft_rollups.sql']) await db.exec(fs.readFileSync(path.join(migrations, f), 'utf-8'))
  await db.exec(fs.readFileSync(path.join(migrations, '0006_tft_rollups.sql'), 'utf-8'))
  check('0005 + 0006 실행 · 0006 재실행 안전', true)

  const data = randomData()
  const mem = createMemoryStore()
  const dictIds = [...Array(60).keys()].map((i) => i + 1)
  for (const id of dictIds) {
    await db.query('insert into tft_dict (id, kind, api_id) values ($1, $2, $3)', [id, dictKindOf(id), dictApi(id)])
    mem._state.dict.set(`${dictKindOf(id)}:${dictApi(id)}`, id)
  }
  for (const { match, boards } of data) {
    const ok = await db.query('select tft_ingest_match($1::jsonb, $2::jsonb) as ok', [JSON.stringify(match), JSON.stringify(boards)])
    if (!ok.rows[0].ok) throw new Error(`적재 실패 ${match.match_id}`)
    await mem.ingest(match, boards)
  }

  const refreshAll = async () => {
    const combos = (await db.query('select game_date::text as game_date, patch, tier_bucket from tft_raw_combos()')).rows
    for (const c of combos) {
      await db.query('select tft_refresh_rollup($1::date, $2, $3)', [c.game_date, c.patch, c.tier_bucket])
      await mem.refreshRollup(c.game_date, c.patch, c.tier_bucket)
    }
    return combos.length
  }
  const nCombos = await refreshAll()
  check(`원본 조합 ${nCombos}개 집계`, nCombos > 10)

  // 일별 행 그대로 비교
  const dailyJs = { unit: 0, item: 0, trait: 0, unitItem: 0 }
  for (const r of mem._state.rollups.values()) for (const k of Object.keys(dailyJs)) dailyJs[k] += r[k].length
  const count = async (t) => Number((await db.query(`select count(*)::int as n from ${t}`)).rows[0].n)
  check(
    '일별 행 수 = JS',
    (await count('stat_unit_daily')) === dailyJs.unit &&
      (await count('stat_item_daily')) === dailyJs.item &&
      (await count('stat_trait_daily')) === dailyJs.trait &&
      (await count('stat_unit_item_daily')) === dailyJs.unitItem,
    JSON.stringify(dailyJs)
  )

  const compareAll = async (label) => {
    let mismatches = 0
    let compared = 0
    for (const type of ['unit', 'item', 'trait', 'unit_item', 'total']) {
      for (const patch of ['16.19', '16.20']) {
        for (const tierMin of ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND']) {
          for (const days of [1, 3, 7, 0]) {
            const sql = (
              await db.query('select * from tft_stat_query($1, $2, $3, $4, $5, $6::date)', [type, patch, tierMin, days, 2, '2026-10-20'])
            ).rows
            const js = queryRollups(mem._state.rollups, (id) => mem.dictName(id), { type, patch, tierMin, days, minGames: 2, today: '2026-10-20' })
            const a = JSON.stringify(sortRows(sql))
            const b = JSON.stringify(sortRows(js))
            compared++
            if (a !== b) {
              mismatches++
              if (mismatches <= 2) console.error(`    불일치 ${type} ${patch} ${tierMin} ${days}일\n    SQL ${a.slice(0, 300)}\n    JS  ${b.slice(0, 300)}`)
            }
          }
        }
      }
    }
    check(`${label}: tft_stat_query = JS (${compared}개 필터 조합)`, mismatches === 0, `불일치 ${mismatches}`)
  }
  await compareAll('적재 직후')

  const before = JSON.stringify((await db.query('select * from stat_unit_daily order by 1,2,3,4,5')).rows)
  await refreshAll()
  check('재계산 멱등 (같은 결과)', JSON.stringify((await db.query('select * from stat_unit_daily order by 1,2,3,4,5')).rows) === before)

  // 티어 상향 → 옛 구간·새 구간 다시 계산
  const target = data.find((d) => d.match.tier_bucket === 'MASTER').match
  await db.query('select tft_raise_tier($1::text[], $2)', [[target.match_id], 'CHALLENGER'])
  await mem.raiseTier([target.match_id], 'CHALLENGER')
  for (const t of ['MASTER', 'CHALLENGER']) {
    await db.query('select tft_refresh_rollup($1::date, $2, $3)', [target.game_date, target.patch, t])
    await mem.refreshRollup(target.game_date, target.patch, t)
  }
  await compareAll('티어 상향 후')

  const filters = (await db.query('select patch, tier_bucket, matches::int as matches, first_date::text as first_date, last_date::text as last_date from tft_stat_filters()')).rows
  const jsFilters = rollupFilters(mem._state.rollups)
  const fkey = (rows) => JSON.stringify(rows.map((f) => [f.patch, f.tier_bucket, Number(f.matches), f.first_date, f.last_date]).sort())
  check('tft_stat_filters = JS', fkey(filters) === fkey(jsFilters))

  // 원본 정리 후에도 집계는 남고, 정리된 패치 재계산은 아무것도 하지 않는다
  const oldUnits = Number((await db.query(`select count(*)::int as n from stat_unit_daily where patch = '16.19'`)).rows[0].n)
  await db.query(`delete from tft_matches where patch = '16.19'`)
  const guard = (await db.query(`select tft_refresh_rollup('2026-10-18'::date, '16.19', 'MASTER') as r`)).rows[0].r
  const keptUnits = Number((await db.query(`select count(*)::int as n from stat_unit_daily where patch = '16.19'`)).rows[0].n)
  check('정리된 패치: 집계 보존 (-1 반환)', guard === -1 && keptUnits === oldUnits && oldUnits > 0)

  // 덱 클러스터 교체
  const compRow = { comp_id: 'ladder-a-b', core_units: ['a', 'b'], games: 20, placement_sum: 80, top4: 11, wins: 3, total_boards: 400, deck: { id: 'ladder-a-b' } }
  await db.query('select tft_replace_comps($1, $2, $3::jsonb)', ['16.20', 'MASTER', JSON.stringify([compRow, { ...compRow, comp_id: 'ladder-c-d' }])])
  await db.query('select tft_replace_comps($1, $2, $3::jsonb)', ['16.20', 'MASTER', JSON.stringify([compRow])])
  const comps = (await db.query('select comp_id, games, deck from stat_comp')).rows
  check('stat_comp 교체 (이전 덱 삭제)', comps.length === 1 && comps[0].deck.id === 'ladder-a-b')

  // RLS · 권한: anon 은 집계·조회 RPC 만
  await db.exec('set role anon')
  const anonRead = await db.query(`select count(*)::int as n from stat_unit_daily`)
  const anonQuery = await db.query(`select * from tft_stat_query('unit', '16.20', 'MASTER', 0, 1, '2026-10-20'::date)`)
  const anonBoards = await db.query(`select count(*)::int as n from tft_boards`)
  let refreshDenied = false
  try {
    await db.query(`select tft_refresh_rollup('2026-10-20'::date, '16.20', 'MASTER')`)
  } catch {
    refreshDenied = true
  }
  let writeDenied = false
  try {
    await db.query(`insert into stat_unit_daily values ('2026-10-20', '16.20', 'MASTER', 1, 0, 1, 1, 1, 1)`)
  } catch {
    writeDenied = true
  }
  await db.exec('reset role')
  check('anon: 집계 읽기 · 조회 RPC 가능', anonRead.rows[0].n > 0 && anonQuery.rows.length > 0)
  check('anon: 원본 보드 0행 (RLS)', anonBoards.rows[0].n === 0)
  check('anon: 집계 갱신 RPC · 집계 쓰기 불가', refreshDenied && writeDenied)

  await apiChecks(db, mem)
  await db.close()
}

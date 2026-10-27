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
const { toDeckBoards, compRows, rebuildComps } = require('./collect/decks')
const { buildRows } = require('./collect/builds')

// 테스트 데이터는 수십 판이라 lib/tftStats 의 최소 판 수(기본 500) 미만 → 항상 JSON 폴백이 된다.
// 서빙 검사는 DB 경로를 보려는 것이므로 기준을 끈다 (lib 를 불러오기 전에 설정해야 한다).
process.env.STATS_DB_MIN_MATCHES = '0'

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
  // 덱 수 상한을 넘으면 판 수 많은 덱부터 남긴다 — 많이 하지만 성적 나쁜 덱이 티어표·내 덱 비교에서 빠지지 않게
  {
    const more = new Map([
      ...names,
      [61, 'DA_18_Veigar'], [62, 'DA_18_Ahri'], [63, 'DA_18_Cassiopeia'], [64, 'DA_Fiddlesticks18'], [65, 'DA_Karma18'], [66, 'DA_18_LeBlanc'],
      [71, 'DA_18_Spellweaver'],
    ])
    // 카직스 덱 20판은 전부 7·8등, 주문술사 베이가 덱 8판은 전부 1등
    const popularBad = deckRaw.map((b, i) => ({ ...b, placement: 7 + (i % 2) }))
    const rareGood = Array.from({ length: 8 }, (_, i) => ({
      ...board(`KR_V${i}`, 1, [[61, 2, 31, 32, 33], [62, 1], [63, 1], [64, 1], [65, 1], [66, 1]], [[71, 6, 3]]),
      tier_bucket: 'MASTER',
    }))
    const capBoards = toDeckBoards([...popularBad, ...rareGood], (id) => more.get(id))
    const one = compRows(capBoards, { minGames: 5, maxDecks: 1 })
    check('덱 상한: 판 수 많은 덱을 남긴다 (20판 7·8등 > 8판 1등)', one.length === 1 && one[0].games === 20, JSON.stringify(one.map((x) => [x.comp_id, x.games, x.deck.avgPlacement])))
    const two = compRows(capBoards, { minGames: 5, maxDecks: 2 })
    check('덱 상한 안의 덱은 평균 등수 순', two.length === 2 && two[0].games === 8 && two[0].deck.avgPlacement <= two[1].deck.avgPlacement, JSON.stringify(two.map((x) => [x.comp_id, x.games, x.deck.avgPlacement])))
  }

  console.log('기물 빌드 (보드 → stat_unit_build 행 · 0008)')
  {
    const built = buildRows(deckBoards, { minGames: 5 })
    const kz = built.find((b) => b.unit === 'TFT18_Khazix')
    check(
      '카직스 20판 · 3개 세트 1개 · 정렬 키 · 분모 = 기물 등장 수',
      built.length === 1 && kz && kz.items.join(',') === 'TFT_Item_Bloodthirster,TFT_Item_InfinityEdge,TFT_Item_LastWhisper' && kz.games === 20 && kz.unit_games === 20,
      JSON.stringify(built)
    )
    check('등수합 · TOP4 · 1등', kz && kz.placement_sum === deckRaw.reduce((s, b) => s + b.placement, 0) && kz.top4 === deckRaw.filter((b) => b.placement <= 4).length && kz.wins === deckRaw.filter((b) => b.placement === 1).length)
    const u = (id, items) => ({ id, items })
    const mk = (placement, units) => ({ placement, units })
    const mixed = [
      // 든 순서가 달라도 같은 세트 · 같은 아이템 2개도 세트
      mk(1, [u('A', ['x', 'y', 'z'])]),
      mk(2, [u('A', ['z', 'x', 'y'])]),
      mk(3, [u('A', ['y', 'y', 'x'])]),
      mk(5, [u('A', ['y', 'x', 'y'])]),
      // 아이템 2개는 세트가 아니지만 분모에는 든다
      mk(8, [u('A', ['x', 'y'])]),
      mk(4, [u('A', ['w', 'x', 'y'])]),
    ]
    const rows = buildRows(mixed, { minGames: 1, maxPerUnit: 2 })
    check(
      '순서 무관 · 2개짜리 세트 · 2개 든 기물은 분모만 · 판 수 → 평균등수 순 상위 N',
      rows.length === 2 &&
        rows[0].items.join() === 'x,y,z' && rows[0].games === 2 &&
        rows[1].items.join() === 'x,y,y' && rows[1].games === 2 &&
        rows.every((r) => r.unit_games === 6),
      JSON.stringify(rows.map((r) => [r.items.join(), r.games, r.unit_games]))
    )
    check('표본 하한 미만 세트는 저장 안 함', buildRows(mixed, { minGames: 3 }).length === 0)

    // 덱 클러스터와 같은 보드로 티어 필터마다 저장 · 0008 이 없어도 덱 클러스터는 그대로
    const saved = new Map()
    const warns = []
    // failBuilds: true = 모든 티어 실패 · 'GRANDMASTER' 등 = 그 티어만 실패
    const fakeStore = (failBuilds) => ({
      loadBoardsForPatch: async () => deckRaw,
      dictName: (id) => names.get(id),
      replaceComps: async () => 1,
      replaceBuilds: async (patch, tierMin, r) => {
        if (failBuilds === true || failBuilds === tierMin) throw new Error('relation "stat_unit_build" does not exist')
        saved.set(tierMin, r)
        return r.length
      },
    })
    const quiet = { log: () => {}, warn: (m) => warns.push(m) }
    await rebuildComps(fakeStore(false), '16.20', { log: quiet, minGames: 15 })
    check(
      '덱 클러스터 재빌드가 티어 필터 4개에 빌드 저장 (챌린저 10판 · 마스터+ 20판)',
      saved.size === 4 && saved.get('CHALLENGER')[0]?.games === 10 && saved.get('MASTER')[0]?.games === 20 && saved.get('DIAMOND')[0]?.games === 20,
      JSON.stringify([...saved].map(([t, r]) => [t, r.map((x) => x.games)]))
    )
    const comps = await rebuildComps(fakeStore(true), '16.20', { log: quiet, minGames: 15 })
    check('빌드 저장 실패(0008 미적용)해도 덱 클러스터 결과 · 경고만', comps.MASTER === 1 && warns.some((w) => /0008/.test(w)), JSON.stringify({ comps, warns }))
    saved.clear()
    warns.length = 0
    await rebuildComps(fakeStore('GRANDMASTER'), '16.20', { log: quiet, minGames: 15 })
    check(
      '한 티어(GRANDMASTER)만 실패해도 나머지 3티어는 저장 · 경고에 티어명',
      saved.size === 3 && !saved.has('GRANDMASTER') && ['CHALLENGER', 'MASTER', 'DIAMOND'].every((t) => saved.has(t)) && warns.length === 1 && /\(1\/4 티어\)/.test(warns[0]) && /GRANDMASTER:/.test(warns[0]),
      JSON.stringify({ saved: [...saved.keys()], warns })
    )
  }

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
  const fbBuilds = await fallback.getBuilds(shared.DEFAULT_FILTER)
  check('필터 목록: json · 패치 없음', fbFilters.source === 'json' && fbFilters.patches.length === 0 && fbFilters.fallbackReason === 'supabase_not_configured')
  check('기물 빌드: lib/unitBuilds.json 폴백 (source json)', fbBuilds.source === 'json' && fbBuilds.filter === null && Array.isArray(fbBuilds.rows))
  check(
    '기물: metaStats.json 폴백 · 표본 필드',
    fbUnits.source === 'json' && fbUnits.filter === null && fbUnits.rows.length > 0 && fbUnits.rows.every((r) => typeof r.lowSample === 'boolean' && r.margin > 0)
  )
  check('덱: decksData.json 폴백', fbDecks.source === 'json' && fbDecks.decks.length > 0 && fbDecks.decks.every((d) => d.lowSample === d.sampleSize < 15))
  {
    // JSON 모드 엔티티 페이지: 정적 /deck/[id] 가 있는 덱은 그대로 링크 (REVIEW R8)
    const entity = require('../lib/entityData')
    const { entitySlug } = require('../lib/entitySlug')
    const d0 = fbDecks.decks[0]
    const page = await entity.getEntityPage('champion', entitySlug('champion', d0.units[0].key))
    const jd = page && page.decks.find((d) => d.id === d0.id)
    check('엔티티 페이지(JSON): 덱 링크 유지 · 쿼리 없는 /deck/<id>', jd && jd.linkable === true && jd.fromDb === false && jd.href === `/deck/${d0.id}`, JSON.stringify(jd))
    check('getDeckById: DB 미설정이면 null (JSON 폴백은 페이지가)', (await fallback.getDeckById(d0.id)) === null)
  }

  // ?unit= 필터는 메모 캐시 객체를 고치면 안 된다 (REVIEW R1).
  // 라우트는 filterStatsByUnit 결과만 응답하므로(route.ts 주석) 라우트 회귀는 이 순수 함수 테스트로 고정한다.
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
  // ?unit= 은 슬러그·수집 키·Riot ID 를 같은 기물로 맞춘다 (REVIEW R6)
  const slug = require('../lib/entitySlug').entitySlug('champion', String(someChamp))
  // DA_18_* · DA_* · *18_Base 는 실제 DB 원본 id 형식 (FOLLOWUP F3).
  // 형식은 접두사·꼬리 없는 이름에 붙인다 — 데이터 첫 키가 이미 'Lux18_Base' 여도 'Lux18_Base18_Base' 같은 없는 id 를 만들지 않게.
  const bareChamp = String(someChamp).replace(/^(TFT\d*_|DA_\d*_|DA_)/i, '').replace(/_?Base$/i, '').replace(/\d+$/, '')
  const unitInputs = [slug, String(someChamp), `TFT18_${bareChamp}`, slug.toUpperCase(), `DA_18_${bareChamp}`, `DA_${bareChamp}`, `${bareChamp}18_Base`]
  const variants = unitInputs.map((u) => shared.filterStatsByUnit(fbCombos, u))
  check(
    `unit 필터: ${unitInputs.join(' · ')} 같은 결과 · 응답 unit = 슬러그`,
    variants.every((v) => v.unit === slug && v.success && JSON.stringify(v.rows) === JSON.stringify(variants[0].rows)) && variants[0].rows.length > 0,
    variants.map((v) => `${v.unit}:${v.rows.length}`).join(' ')
  )
  check('unit 필터: 거른 뒤에도 totalBoards · filter 는 그대로', onlyOne.totalBoards === fbCombos.totalBoards && onlyOne.filter === fbCombos.filter)
  const lux = shared.filterStatsByUnit({ ...fbCombos, rows: [{ champKey: 'Lux18_Base', key: 'Lux18_Base|x' }] }, 'lux')
  check('unit 필터: 원본 키 Lux18_Base 도 슬러그 lux 로 찾음', lux.rows.length === 1)

  console.log('헬스 (lib/llmStatus — 공개 응답에서 LLM 오류 본문 제거, FOLLOWUP F2)')
  {
    const ls = require('../lib/llmStatus')
    check('오류 없으면 null', ls.redactLlmError(null, { includeBody: false }) === null)
    ls.recordLlmHttpError({ provider: 'deepseek', model: 'deepseek-flash', status: 400, body: 'org-xyz request-id 123' })
    const err = ls.lastLlmHttpError()
    const pub = ls.redactLlmError(err, { includeBody: false })
    const auth = ls.redactLlmError(err, { includeBody: true })
    check('공개: body 키 없음 · model/status/at 유지', !('body' in pub) && pub.model === 'deepseek-flash' && pub.status === 400 && Boolean(pub.at) && !JSON.stringify(pub).includes('org-xyz'))
    check('인증: body 포함 · 원본 불변', auth.body === 'org-xyz request-id 123' && err.body === 'org-xyz request-id 123')
  }

  // DB 장애 네거티브 캐시 (REVIEW R5): 타임아웃 1회 뒤 FAIL_TTL 동안은 DB 를 기다리지 않고 바로 폴백
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://hang.test'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  process.env.STATS_DB_TIMEOUT_MS = '300'
  let hangCalls = 0
  const hanging = (signal) => {
    hangCalls++
    return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ data: null, error: { message: 'aborted' } })))
  }
  const slow = loadStatsLib({ rpc: () => rpcBuilder(hanging) })
  let t = Date.now()
  const firstFail = await slow.getStats('unit', shared.DEFAULT_FILTER)
  const firstMs = Date.now() - t
  t = Date.now()
  const secondFail = await slow.getStats('unit', shared.DEFAULT_FILTER)
  const secondMs = Date.now() - t
  check(
    'DB 타임아웃 2회: 첫 요청만 대기, 두 번째는 즉시 폴백',
    firstMs >= 250 && secondMs < 50 && hangCalls === 1,
    `${firstMs}ms / ${secondMs}ms · DB 호출 ${hangCalls}회`
  )
  check(
    'DB 장애 폴백 응답 스키마 유지 (source · fallbackReason · filter)',
    [firstFail, secondFail].every((r) => r.source === 'json' && r.fallbackReason === 'db_error' && r.filter === null && r.rows.length > 0)
  )

  // stats 키 자체의 네거티브 캐시 (FOLLOWUP F3): 필터 RPC 는 정상, 통계 RPC 만 멈춤
  let queryCalls = 0
  const filterRows = [{ patch: '16.20', tier_bucket: 'MASTER', matches: 10, first_date: '2026-10-19', last_date: '2026-10-20' }]
  const partial = loadStatsLib({
    rpc: (fn) =>
      rpcBuilder((signal) => {
        if (fn === 'tft_stat_filters') return Promise.resolve({ data: filterRows, error: null })
        queryCalls++
        return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ data: null, error: { message: 'aborted' } })))
      }),
  })
  t = Date.now()
  const qFirst = await partial.getStats('unit', shared.DEFAULT_FILTER)
  const qFirstMs = Date.now() - t
  const callsAfterFirst = queryCalls
  t = Date.now()
  const qSecond = await partial.getStats('unit', shared.DEFAULT_FILTER)
  const qSecondMs = Date.now() - t
  check(
    'stats 키 failMemo: 필터 성공 + 통계 RPC 타임아웃 → 두 번째는 DB 재시도 없이 즉시 폴백',
    (await partial.getMetaFilters()).source === 'db' &&
      qFirstMs >= 250 &&
      qSecondMs < 50 &&
      callsAfterFirst === 2 &&
      queryCalls === 2 &&
      [qFirst, qSecond].every((r) => r.source === 'json' && r.fallbackReason === 'db_error'),
    `${qFirstMs}ms / ${qSecondMs}ms · 통계 RPC ${queryCalls}회`
  )
  await partial.getStats('item', shared.DEFAULT_FILTER)
  check('stats 키 failMemo 는 키 단위 (다른 type 은 DB 재시도)', queryCalls === 4, `통계 RPC ${queryCalls}회`)

  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  delete process.env.STATS_DB_TIMEOUT_MS

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

/** rpc() 빌더 흉내 — order · range 는 무시하고 abortSignal 에서 run 을 부른다 */
function rpcBuilder(run) {
  const b = { order: () => b, range: () => b, abortSignal: run }
  return b
}

/**
 * PGlite 위의 최소 supabase-js 흉내: rpc(fn, 인자).order().range() · from(t).select().eq().abortSignal().
 * PostgREST 처럼 date 는 문자열, bigint 는 숫자로 돌려주고, maxRows 를 주면 한 응답을 그 행 수에서 자른다.
 */
function fakeSupabase(db, { failRpc = false, maxRows = Infinity } = {}) {
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
      const order = []
      let from = 0
      let to = Infinity
      const b = {
        order(c) {
          order.push(c)
          return b
        },
        range(f, t) {
          from = f
          to = t
          return b
        },
        abortSignal: () => {
          const limit = Math.min(to - from + 1, maxRows)
          const sql =
            `select * from ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})` +
            (order.length ? ` order by ${order.join(', ')}` : '') +
            (Number.isFinite(limit) ? ` limit ${limit}` : '') +
            (from ? ` offset ${from}` : '')
          return run(sql, keys.map((k) => args[k]))
        },
      }
      return b
    },
    from(table) {
      const conds = []
      const order = []
      let cols = '*'
      let from = 0
      let to = Infinity
      const b = {
        select(c) {
          cols = c
          return b
        },
        eq(c, v) {
          conds.push([c, v])
          return b
        },
        order(c) {
          order.push(c)
          return b
        },
        range(f, t) {
          from = f
          to = t
          return b
        },
        abortSignal: () => {
          const limit = Math.min(to - from + 1, maxRows)
          const sql =
            `select ${cols} from ${table}${conds.length ? ` where ${conds.map(([c], i) => `${c} = $${i + 1}`).join(' and ')}` : ''}` +
            (order.length ? ` order by ${order.join(', ')}` : '') +
            (Number.isFinite(limit) ? ` limit ${limit}` : '') +
            (from ? ` offset ${from}` : '')
          return run(sql, conds.map((c) => c[1]))
        },
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
  // PostgREST max-rows 로 한 응답이 잘려도 페이지로 끝까지 받는다 (운영에서 1천 행에서 임의로 잘렸다, 2026-10-26)
  {
    process.env.STATS_RPC_PAGE_SIZE = '10'
    const paged = loadStatsLib(fakeSupabase(db, { maxRows: 10 }))
    const all = await paged.getStats('unit_item', f)
    const keys = (res) => res.rows.map((r) => r.key).sort().join(',')
    check(
      '기물×아이템: 응답이 10행에서 잘리는 DB 에서도 페이지로 모든 행 (중복 없음)',
      combos.rows.length > 10 && all.source === 'db' && keys(all) === keys(combos) && new Set(all.rows.map((r) => r.key)).size === all.rows.length,
      `${all.rows.length} / ${combos.rows.length}`
    )
    delete process.env.STATS_RPC_PAGE_SIZE
    // 아래 엔티티 페이지 검사가 require 캐시의 lib/tftStats 를 쓰므로 잘림 없는 클라이언트로 되돌린다
    loadStatsLib(fakeSupabase(db))
  }
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
  // 엔티티 페이지: DB 덱은 /deck/[id]?patch=&tier= 로 링크 — 덱 페이지가 stat_comp 에서 같은 덱을 연다
  // (R8 에서는 링크를 막았지만 UI 스프린트 S1 에서 덱 페이지가 DB 덱을 해석하게 됐다)
  for (const k of Object.keys(require.cache)) if (/entityData\.ts$/.test(k)) delete require.cache[k]
  const entity = require('../lib/entityData')
  const { entitySlug } = require('../lib/entitySlug')
  const champPage = await entity.getEntityPage('champion', entitySlug('champion', decks.decks[0].units[0].key))
  const dbDeck = champPage && champPage.decks.find((d) => d.id === sampleDeck.id)
  check(
    '엔티티 페이지: DB 덱 링크 = /deck/<id>?patch=16.20&tier=master · DB 집계 표시',
    dbDeck && dbDeck.fromDb === true && dbDeck.linkable === true && dbDeck.href === `/deck/${sampleDeck.id}?patch=16.20&tier=master`,
    JSON.stringify(dbDeck)
  )

  // 덱 1개 조회 (UI 스프린트 S1 — /deck/[id] 의 DB 해석)
  const byId = await stats.getDeckById(sampleDeck.id, { patch: '16.20', tier: 'master' })
  check('getDeckById: patch·tier 지정 → 같은 덱 · 패치/티어 반환', byId && byId.deck.id === sampleDeck.id && byId.patch === '16.20' && byId.tierMin === 'master' && byId.deck.sampleSize === 12, JSON.stringify(byId && { id: byId.deck.id, patch: byId.patch, tier: byId.tierMin, n: byId.deck.sampleSize }))
  check('getDeckById: 없는 id → null', (await stats.getDeckById('ladder-nope-nope')) === null)
  // 같은 comp_id 를 이전 패치(16.9 — 문자열로는 16.20 보다 큼)·다른 티어에도 넣는다
  await db.query('select tft_replace_comps($1, $2, $3::jsonb)', ['16.9', 'MASTER', JSON.stringify([{ ...compRow, games: 40, deck: { ...sampleDeck, games: 40 } }])])
  await db.query('select tft_replace_comps($1, $2, $3::jsonb)', ['16.20', 'DIAMOND', JSON.stringify([{ ...compRow, games: 30, deck: { ...sampleDeck, games: 30 } }])])
  const latest = await stats.getDeckById(sampleDeck.id)
  check('getDeckById: patch 없으면 숫자 비교 최신 패치(16.20 > 16.9) · 티어는 마스터+ 우선', latest && latest.patch === '16.20' && latest.tierMin === 'master' && latest.deck.sampleSize === 12, JSON.stringify(latest && { patch: latest.patch, tier: latest.tierMin }))
  const diamond = await stats.getDeckById(sampleDeck.id, { tier: 'diamond' })
  check('getDeckById: tier 지정 → 그 티어 덱', diamond && diamond.tierMin === 'diamond' && diamond.deck.sampleSize === 30)
  const oldPatch = await stats.getDeckById(sampleDeck.id, { patch: '16.9' })
  check('getDeckById: patch 지정 → 그 패치 덱', oldPatch && oldPatch.patch === '16.9' && oldPatch.deck.sampleSize === 40)
  await db.query(`delete from stat_comp where patch = '16.9' or tier_min = 'DIAMOND'`)
  const chDecks = await stats.getDecks({ patch: '16.20', tier: 'challenger' })
  check('덱: 기본 아닌 필터에 덱이 없으면 빈 목록 (db)', chDecks.source === 'db' && chDecks.decks.length === 0)

  // 기물 빌드 (0008): stat_unit_build → 화면 모양. sqlChecks 가 MASTER 에 12판 세트 1개(기물 60판)를 남겼다
  {
    const b = await stats.getBuilds({ patch: '16.20', tier: 'master' })
    const r = b.rows[0]
    check(
      '빌드: db · 기물 키 statChampKey · 평균등수 · 채용률(12/60)',
      b.source === 'db' && b.filter.patch === '16.20' && b.rows.length === 1 && r.champKey === 'ChampA' && r.itemKeys.join() === 'TFT_Item_A,TFT_Item_B,TFT_Item_C' && r.avgPlacement === 3.33 && r.sampleSize === 12 && r.pickRate === 0.2,
      JSON.stringify(b.rows)
    )
    // 한 응답이 10행에서 잘리는 DB 에서도 페이지로 끝까지 (기물 100종 × 10개 = 1천 행 상한 대비)
    const many = Array.from({ length: 25 }, (_, i) => ({
      unit: `TFT18_Champ${String.fromCharCode(65 + i)}`,
      items: ['TFT_Item_A', 'TFT_Item_B', 'TFT_Item_C'],
      games: 10 + i,
      placement_sum: 40,
      top4: 5,
      wins: 1,
      unit_games: 100,
    }))
    await db.query('select tft_replace_builds($1, $2, $3::jsonb)', ['16.20', 'DIAMOND', JSON.stringify(many)])
    process.env.STATS_RPC_PAGE_SIZE = '10'
    const paged = loadStatsLib(fakeSupabase(db, { maxRows: 10 }))
    const all = await paged.getBuilds({ patch: '16.20', tier: 'diamond' })
    delete process.env.STATS_RPC_PAGE_SIZE
    loadStatsLib(fakeSupabase(db))
    check('빌드: 응답이 10행에서 잘려도 25행 모두 · 채용 판 수 순', all.source === 'db' && all.rows.length === 25 && all.rows[0].sampleSize === 34, `${all.rows.length}`)
    const none = await stats.getBuilds({ patch: '16.20', tier: 'grandmaster' })
    check('빌드: 그 필터에 행이 없으면 빈 목록 (db)', none.source === 'db' && none.rows.length === 0)
  }

  // DB 오류 → JSON 폴백
  const broken = loadStatsLib(fakeSupabase(db, { failRpc: true }))
  const fb = await broken.getStats('unit', f)
  check('DB 오류 → JSON 폴백 (db_error)', fb.source === 'json' && fb.fallbackReason === 'db_error' && fb.rows.length > 0)
  check('getDeckById: DB 오류 → null (예외를 밖으로 던지지 않음)', (await broken.getDeckById(sampleDeck.id)) === null)
  // 0008 미적용(표 없음)도 같은 길 — 화면은 출처(json ≠ db)를 보고 DB 통계 옆에 섞지 않는다
  const fbBuilds = await broken.getBuilds({ patch: '16.20', tier: 'master' })
  check('빌드: DB 오류 → JSON 폴백 (source json · db_error)', fbBuilds.source === 'json' && fbBuilds.fallbackReason === 'db_error' && Array.isArray(fbBuilds.rows))
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
  for (const f of ['0005_tft_stats.sql', '0006_tft_rollups.sql', '0008_tft_unit_builds.sql']) await db.exec(fs.readFileSync(path.join(migrations, f), 'utf-8'))
  await db.exec(fs.readFileSync(path.join(migrations, '0006_tft_rollups.sql'), 'utf-8'))
  await db.exec(fs.readFileSync(path.join(migrations, '0008_tft_unit_builds.sql'), 'utf-8'))
  check('0005 + 0006 + 0008 실행 · 0006 · 0008 재실행 안전', true)

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

  // 기물 빌드 교체 (0008) — 같은 패치 × 티어 필터만 바뀌고, 다른 티어는 남는다
  const buildRow = { unit: 'TFT18_ChampA', items: ['TFT_Item_A', 'TFT_Item_B', 'TFT_Item_C'], games: 12, placement_sum: 40, top4: 8, wins: 2, unit_games: 60 }
  const replaceBuilds = (patch, tier, rows) => db.query('select tft_replace_builds($1, $2, $3::jsonb) as n', [patch, tier, JSON.stringify(rows)])
  await replaceBuilds('16.20', 'MASTER', [buildRow, { ...buildRow, items: ['TFT_Item_A', 'TFT_Item_A', 'TFT_Item_B'], games: 6 }])
  await replaceBuilds('16.20', 'CHALLENGER', [{ ...buildRow, games: 5 }])
  const n = (await replaceBuilds('16.20', 'MASTER', [buildRow])).rows[0].n
  const buildsLeft = (await db.query(`select tier_min, items, games from stat_unit_build order by tier_min`)).rows
  check(
    'stat_unit_build 교체 (같은 패치·티어만) · 아이템 배열 그대로',
    n === 1 && buildsLeft.length === 2 && buildsLeft[1].tier_min === 'MASTER' && buildsLeft[1].games === 12 && buildsLeft[1].items.join() === 'TFT_Item_A,TFT_Item_B,TFT_Item_C',
    JSON.stringify(buildsLeft)
  )
  let badBuild = false
  try {
    await replaceBuilds('16.20', 'MASTER', [{ ...buildRow, items: ['TFT_Item_A', 'TFT_Item_B'] }])
  } catch {
    badBuild = true
  }
  check('stat_unit_build: 아이템 3개가 아니면 거부 (교체도 되돌림)', badBuild && (await db.query(`select count(*)::int as n from stat_unit_build where tier_min = 'MASTER'`)).rows[0].n === 1)

  // RLS · 권한: anon 은 집계·조회 RPC 만
  await db.exec('set role anon')
  const anonBuilds = await db.query(`select count(*)::int as n from stat_unit_build`)
  let buildsWriteDenied = false
  try {
    await db.query(`select tft_replace_builds('16.20', 'MASTER', '[]'::jsonb)`)
  } catch {
    buildsWriteDenied = true
  }
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
  check('anon: 기물 빌드 읽기 가능 · 교체 RPC 불가', anonBuilds.rows[0].n === 2 && buildsWriteDenied)

  await apiChecks(db, mem)
  await db.close()
}

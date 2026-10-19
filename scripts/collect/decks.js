/**
 * 덱 클러스터 (Phase B) — DB 원본 보드 → stat_comp.
 *
 * scripts/buildDecksFromBoards.js 의 묶기 규칙(buildDecks)을 그대로 쓰고, 입력만 DB 보드로 바꾼다.
 * 패치 1개를 읽어 티어 필터(챌린저 / 그마+ / 마스터+ / 다이아+)마다 따로 묶는다.
 * 덱 1개 = lib/decksData.json 의 덱 1개와 같은 모양이라 앱이 폴백 JSON 과 같은 코드로 그린다.
 */
const { decodeUnits, decodeTraits } = require('./normalize')
const { TIER_FILTERS } = require('./rollup')
const { buildDecks } = require('../buildDecksFromBoards')

/** 표본 하한은 화면에서 15판으로 표시하므로, 저장은 그보다 조금 낮게 남겨 둔다 (용량 · 표 길이 절충) */
const COMP_MIN_GAMES = Number(process.env.COMP_MIN_GAMES || 8)
const COMP_MAX_DECKS = Number(process.env.COMP_MAX_DECKS || 100)

/**
 * DB 보드(정수 배열) → buildDecks 입력 모양.
 * @param rows [{ placement, level, units, traits, tier_bucket }]
 * @param dictName (id) => api_id
 */
function toDeckBoards(rows, dictName) {
  return rows.map((r) => ({
    placement: r.placement,
    level: r.level,
    tier_bucket: r.tier_bucket,
    units: decodeUnits(r.units || []).map((u) => ({
      id: dictName(u.unit),
      star: u.star,
      items: u.items.map((it) => dictName(it)).filter(Boolean),
    })),
    traits: decodeTraits(r.traits || []).map((t) => ({ id: dictName(t.trait), units: t.units, style: t.tier })),
  }))
}

/** 한 티어 필터의 덱 → tft_replace_comps 행 */
function compRows(boards, opts = {}) {
  const { decks } = buildDecks(boards, { minGames: opts.minGames ?? COMP_MIN_GAMES, maxDecks: opts.maxDecks ?? COMP_MAX_DECKS })
  return decks.map(({ deck, core, placements }) => ({
    comp_id: deck.id,
    core_units: core,
    games: deck.games,
    placement_sum: placements.reduce((s, n, i) => s + n * (i + 1), 0),
    top4: placements.slice(0, 4).reduce((s, n) => s + n, 0),
    wins: placements[0],
    total_boards: boards.length,
    deck,
  }))
}

/**
 * 패치 1개의 덱 클러스터를 다시 만든다.
 * @returns { [tierMin]: 덱 수 }
 */
async function rebuildComps(store, patch, { log = console, ...opts } = {}) {
  const rows = await store.loadBoardsForPatch(patch)
  const boards = toDeckBoards(rows, (id) => store.dictName(id))
  const result = {}
  for (const [tierMin, buckets] of Object.entries(TIER_FILTERS)) {
    const subset = boards.filter((b) => buckets.includes(b.tier_bucket))
    const out = subset.length ? compRows(subset, opts) : []
    await store.replaceComps(patch, tierMin, out)
    result[tierMin] = out.length
  }
  log.log(
    `  덱 클러스터 ${patch}: 보드 ${boards.length} → ${Object.entries(result)
      .map(([t, n]) => `${t} ${n}`)
      .join(' · ')}`
  )
  return result
}

module.exports = { toDeckBoards, compRows, rebuildComps, COMP_MIN_GAMES }

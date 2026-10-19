/**
 * 일별 집계 (Phase B) — supabase/migrations/0006_tft_rollups.sql 의 JS 판.
 *
 *  - 메모리 저장소(드라이런·테스트)가 SQL 대신 쓴다.
 *  - testRollup.js 가 같은 입력으로 SQL(PGlite) 결과와 비교하는 기준값이기도 하다.
 *
 * 수치 규칙 (scripts/buildMetaStats.js 와 같다)
 *   기물      = 보드 위 기물 1개당 1건 · star=0 합계, star=1..4 성급별
 *   기물×아이템 = 기물이 든 아이템 1개당 1건 · 아이템 = 그 합
 *   시너지    = 활성 시너지 1개당 1건 · tier=0 합계, tier=1.. 단계별
 */
const { decodeUnits, decodeTraits } = require('./normalize')

const TIER_FILTERS = {
  CHALLENGER: ['CHALLENGER'],
  GRANDMASTER: ['CHALLENGER', 'GRANDMASTER'],
  MASTER: ['CHALLENGER', 'GRANDMASTER', 'MASTER'],
  DIAMOND: ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND'],
}

/** 'master' → ['CHALLENGER','GRANDMASTER','MASTER'] (모르는 값은 마스터+) */
function tierBuckets(tierMin) {
  return TIER_FILTERS[String(tierMin || 'MASTER').toUpperCase()] || TIER_FILTERS.MASTER
}

const comboKey = (gameDate, patch, tier) => `${gameDate}|${patch}|${tier}`
function parseComboKey(key) {
  const [game_date, patch, tier_bucket] = key.split('|')
  return { game_date, patch, tier_bucket }
}

function bump(map, key, placement, extra) {
  let e = map.get(key)
  if (!e) map.set(key, (e = { ...extra, games: 0, placement_sum: 0, top4: 0, wins: 0 }))
  e.games++
  e.placement_sum += placement
  if (placement <= 4) e.top4++
  if (placement === 1) e.wins++
}

/**
 * 한 조합(game_date, patch, tier_bucket)의 보드들 → 집계 행.
 * @param boards [{ match_id, placement, units: smallint[], traits: smallint[] }]
 */
function rollupBoards(boards) {
  const unit = new Map()
  const unitItem = new Map()
  const item = new Map()
  const trait = new Map()
  for (const b of boards) {
    for (const u of decodeUnits(b.units || [])) {
      bump(unit, `${u.unit}|0`, b.placement, { unit: u.unit, star: 0 })
      bump(unit, `${u.unit}|${u.star}`, b.placement, { unit: u.unit, star: u.star })
      for (const it of u.items) {
        bump(unitItem, `${u.unit}|${it}`, b.placement, { unit: u.unit, item: it })
        bump(item, `${it}`, b.placement, { item: it })
      }
    }
    for (const t of decodeTraits(b.traits || [])) {
      if (!(t.tier > 0)) continue
      bump(trait, `${t.trait}|0`, b.placement, { trait: t.trait, tier: 0 })
      bump(trait, `${t.trait}|${t.tier}`, b.placement, { trait: t.trait, tier: t.tier })
    }
  }
  return {
    totals: { matches: new Set(boards.map((b) => b.match_id)).size, boards: boards.length },
    unit: [...unit.values()],
    item: [...item.values()],
    trait: [...trait.values()],
    unitItem: [...unitItem.values()],
  }
}

/** KST 오늘 'YYYY-MM-DD' */
function kstToday(now = Date.now()) {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' - n일 */
function minusDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/**
 * tft_stat_query 의 JS 판.
 * @param rollups Map<comboKey, rollupBoards 결과>
 * @param dictName (id) => api_id
 * @returns [{ key1, key2, games, placement_sum, top4, wins, extra1, extra2 }]
 */
function queryRollups(rollups, dictName, { type, patch, tierMin = 'MASTER', days = 7, minGames = 1, today } = {}) {
  const tiers = new Set(tierBuckets(tierMin))
  const since = days > 0 ? minusDays(today || kstToday(), days - 1) : '0000-00-00'
  const min = Math.max(minGames || 1, 1)
  const picked = [...rollups.entries()]
    .map(([k, r]) => ({ ...parseComboKey(k), r }))
    .filter((c) => c.patch === patch && tiers.has(c.tier_bucket) && c.game_date >= since)

  if (type === 'total') {
    const boards = picked.reduce((s, c) => s + c.r.totals.boards, 0)
    const matches = picked.reduce((s, c) => s + c.r.totals.matches, 0)
    return [{ key1: null, key2: null, games: boards, placement_sum: null, top4: null, wins: null, extra1: matches, extra2: null }]
  }

  const out = new Map()
  const add = (k, key1, key2, row) => {
    let e = out.get(k)
    if (!e) out.set(k, (e = { key1, key2, games: 0, placement_sum: 0, top4: 0, wins: 0, extra1: null, extra2: null }))
    e.games += row.games
    e.placement_sum += row.placement_sum
    e.top4 += row.top4
    e.wins += row.wins
  }
  const addExtra = (k, field, v) => {
    const e = out.get(k)
    if (e) e[field] = (e[field] || 0) + v
  }

  for (const { r } of picked) {
    if (type === 'unit') {
      for (const row of r.unit) if (row.star === 0) add(row.unit, dictName(row.unit), null, row)
      for (const row of r.unit) {
        if (row.star === 0) continue
        addExtra(row.unit, 'extra1', row.games * row.star)
        if (row.star === 3) addExtra(row.unit, 'extra2', row.games)
      }
    } else if (type === 'item') {
      for (const row of r.item) add(row.item, dictName(row.item), null, row)
    } else if (type === 'trait') {
      for (const row of r.trait) if (row.tier === 0) add(row.trait, dictName(row.trait), null, row)
      for (const row of r.trait) if (row.tier > 0) addExtra(row.trait, 'extra1', row.games * row.tier)
    } else if (type === 'unit_item') {
      for (const row of r.unitItem) add(`${row.unit}|${row.item}`, dictName(row.unit), dictName(row.item), row)
    } else {
      throw new Error(`unknown stat type: ${type}`)
    }
  }
  return [...out.values()].filter((e) => e.games >= min)
}

/** tft_stat_filters 의 JS 판 */
function rollupFilters(rollups) {
  const out = new Map()
  for (const [k, r] of rollups) {
    const { game_date, patch, tier_bucket } = parseComboKey(k)
    const key = `${patch}|${tier_bucket}`
    const e = out.get(key) || { patch, tier_bucket, matches: 0, first_date: game_date, last_date: game_date }
    e.matches += r.totals.matches
    if (game_date < e.first_date) e.first_date = game_date
    if (game_date > e.last_date) e.last_date = game_date
    out.set(key, e)
  }
  return [...out.values()].sort((a, b) => b.last_date.localeCompare(a.last_date) || b.patch.localeCompare(a.patch))
}

module.exports = { TIER_FILTERS, tierBuckets, comboKey, parseComboKey, rollupBoards, queryRollups, rollupFilters, kstToday, minusDays }

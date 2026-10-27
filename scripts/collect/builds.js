/**
 * 기물 빌드 (아이템 3개 세트) — 보드 → stat_unit_build 행 (supabase/migrations/0008).
 *
 * 기물×아이템(stat_unit_item_daily)은 아이템 1개 단위라 "BIS 3개를 함께 들면 몇 등인가"를 답하지 못한다.
 * 기물 × 아이템 3개 조합은 종류가 많아(하루 수만 행) 일별 영구 집계 대신 덱 클러스터와 같이
 * 패치 × 티어 필터 단위로 하루 1회 다시 만든다 (rebuildComps 가 이미 읽은 보드를 그대로 쓴다).
 *
 * 규칙
 *  - 아이템을 정확히 3개 든 기물만 센다 (완성 빌드). 같은 아이템 2개도 그대로 (예: 쇼진 2 + 공허).
 *  - 세트 키 = 아이템 api_id 정렬 — 든 순서와 무관하게 같은 세트.
 *  - unit_games = 이 기물이 보드에 나온 수 (아이템 수 무관) — 채용률 분모. stat_unit_daily star=0 과 같은 규칙.
 *  - 기물마다 판 수 많은 순 상위 maxPerUnit 개, minGames 판 이상만 남긴다 (용량 · 응답 크기).
 * 입력 보드는 toDeckBoards 모양 ({ placement, units: [{ id, items: [api_id] }] }) — 래더 보드 JSON 도 같은 모양이다.
 */
const BUILD_MIN_GAMES = Number(process.env.BUILD_MIN_GAMES || 5)
const BUILD_MAX_PER_UNIT = Number(process.env.BUILD_MAX_PER_UNIT || 10)

function buildRows(boards, opts = {}) {
  const minGames = opts.minGames ?? BUILD_MIN_GAMES
  const maxPerUnit = opts.maxPerUnit ?? BUILD_MAX_PER_UNIT
  const unitGames = new Map()
  const builds = new Map()
  for (const b of boards) {
    for (const u of b.units || []) {
      if (!u.id) continue
      unitGames.set(u.id, (unitGames.get(u.id) || 0) + 1)
      const items = (u.items || []).filter(Boolean)
      if (items.length !== 3) continue
      items.sort()
      const key = `${u.id}|${items.join(',')}`
      let e = builds.get(key)
      if (!e) builds.set(key, (e = { unit: u.id, items, games: 0, placement_sum: 0, top4: 0, wins: 0 }))
      e.games++
      e.placement_sum += b.placement
      if (b.placement <= 4) e.top4++
      if (b.placement === 1) e.wins++
    }
  }
  const byUnit = new Map()
  for (const e of builds.values()) {
    if (e.games < minGames) continue
    if (!byUnit.has(e.unit)) byUnit.set(e.unit, [])
    byUnit.get(e.unit).push(e)
  }
  const out = []
  for (const [unit, list] of [...byUnit.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    // 판 수 → 평균등수 → 키 순 (같은 입력이면 같은 행)
    list.sort((a, b) => b.games - a.games || a.placement_sum / a.games - b.placement_sum / b.games || a.items.join().localeCompare(b.items.join()))
    for (const e of list.slice(0, maxPerUnit)) out.push({ ...e, unit_games: unitGames.get(unit) })
  }
  return out
}

module.exports = { buildRows, BUILD_MIN_GAMES, BUILD_MAX_PER_UNIT }

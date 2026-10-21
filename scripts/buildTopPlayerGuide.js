/**
 * 상위 랭커 보드 → 메타 덱별 "고수 운영" 집계 (lib/topPlayerGuide.json, 선수 식별자 없음)
 *
 * 입력: data/topPlayerBoards.json (scripts/collectTopPlayers.js) + lib/decksData.json
 * - 보드마다 가장 비슷한 메타 덱(기물 슬러그 Jaccard ≥ 0.6 — 런타임 comparisonFacts.mostSimilarDeck 과 같은 기준)에 붙인다.
 * - 덱별: 판 수 · 선수 수 · 평균 등수 · TOP4 · 캐리 아이템 채용률 · 레벨 분포 · 캐리 3성 비율 ·
 *   상위 랭커가 자주 쓴 기물(그 덱 래더 가이드의 핵심 기물 제외)
 * - 최종 보드 통계라 '조합 순서'가 아니라 '최종 보드 채용률'이다.
 *
 * 사용법: node scripts/buildTopPlayerGuide.js
 */
require('./_ts')
const fs = require('fs')
const path = require('path')
const { entitySlug } = require('../lib/entitySlug')
const decksData = require('../lib/decksData.json')
const tftData = require('../lib/tftData.json')

const BOARDS = path.join(__dirname, '..', 'data', 'topPlayerBoards.json')
const OUT = path.join(__dirname, '..', 'lib', 'topPlayerGuide.json')
const SIMILARITY_MIN = 0.6
/** 덱별 집계에 넣을 최소 판 수 (런타임 표시는 lib/topPlayers.ts TOP_MIN_BOARDS) */
const MIN_BOARDS = 3
const r2 = (x) => Math.round(x * 100) / 100
const r3 = (x) => Math.round(x * 1000) / 1000

const itemName = (() => {
  const index = new Map()
  for (const [key, value] of Object.entries(tftData.itemMap || {})) {
    const seg = (key.split('/').pop() || key).toLowerCase()
    if (!index.has(seg)) index.set(seg, value.name)
  }
  return (id) => index.get(String(id).split('/').pop().toLowerCase()) || null
})()
const isComponent = (id) => /component/i.test(String(id))
const slug = (k) => entitySlug('champion', k)

function main() {
  if (!fs.existsSync(BOARDS)) {
    console.error('data/topPlayerBoards.json 이 없습니다. 먼저 node scripts/collectTopPlayers.js 를 실행하세요.')
    process.exitCode = 1
    return
  }
  const data = JSON.parse(fs.readFileSync(BOARDS, 'utf-8'))
  const decks = decksData.decks.map((d) => ({
    d,
    set: new Set(d.units.map((u) => slug(u.matchedKey || u.lolchessKey))),
    carry: d.carryKey ? slug(d.carryKey) : null,
    core: new Set(((d.guide && d.guide.core) || []).map((u) => slug(u.key))),
  }))

  const agg = new Map()
  let matched = 0
  for (const b of data.boards) {
    const mine = new Set(b.units.map((u) => slug(u.id)))
    let best = null
    for (const x of decks) {
      let inter = 0
      for (const s of mine) if (x.set.has(s)) inter++
      const sim = inter / (mine.size + x.set.size - inter || 1)
      if (!best || sim > best.sim) best = { x, sim }
    }
    if (!best || best.sim < SIMILARITY_MIN) continue
    matched++
    const { x } = best
    const a =
      agg.get(x.d.name) ||
      { x, boards: 0, players: new Set(), place: 0, top4: 0, carryThree: 0, carryItems: new Map(), levels: new Map(), units: new Map(), names: new Map() }
    a.boards++
    a.players.add(b.player)
    a.place += b.placement
    if (b.placement <= 4) a.top4++
    a.levels.set(b.level, (a.levels.get(b.level) || 0) + 1)
    for (const u of b.units) {
      const s = slug(u.id)
      a.units.set(s, (a.units.get(s) || 0) + 1)
      if (s === x.carry) {
        if ((u.star || 1) >= 3) a.carryThree++
        for (const it of new Set((u.items || []).filter((i) => !isComponent(i)))) {
          const n = itemName(it)
          if (n) a.carryItems.set(n, (a.carryItems.get(n) || 0) + 1)
        }
      }
    }
    agg.set(x.d.name, a)
  }

  const unitName = new Map()
  for (const d of decksData.decks) for (const u of d.units) unitName.set(slug(u.matchedKey || u.lolchessKey), u.name)

  const out = {}
  for (const [name, a] of agg) {
    if (a.boards < MIN_BOARDS) continue
    const levels = {}
    for (const [lv, n] of a.levels) if (lv) levels[lv] = r3(n / a.boards)
    out[name] = {
      boards: a.boards,
      players: a.players.size,
      avgPlacement: r2(a.place / a.boards),
      top4Rate: r3(a.top4 / a.boards),
      carryThreeStarRate: r3(a.carryThree / a.boards),
      carryItems: [...a.carryItems.entries()]
        .sort((p, q) => q[1] - p[1])
        .slice(0, 5)
        .map(([n, c]) => ({ name: n, rate: r3(c / a.boards) })),
      levels,
      // 그 덱 래더 가이드의 핵심 기물이 아닌데 상위 랭커가 자주(30%+) 쓴 기물
      extraUnits: [...a.units.entries()]
        .filter(([s, c]) => !a.x.core.has(s) && c / a.boards >= 0.3 && unitName.has(s))
        .sort((p, q) => q[1] - p[1])
        .slice(0, 4)
        .map(([s, c]) => ({ name: unitName.get(s), usage: r3(c / a.boards) })),
    }
  }

  const players = new Set(data.boards.map((b) => b.player)).size
  const result = {
    _comment: '챌린저 LP 상위 랭커의 최근 랭크 보드를 메타 덱별로 집계 (선수 식별자 없음). scripts/buildTopPlayerGuide.js 로 생성.',
    generatedAt: new Date().toISOString(),
    sourceUpdatedAt: data.updatedAt || null,
    region: data.region,
    players,
    boards: data.boards.length,
    matchedBoards: matched,
    decks: out,
  }
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n', 'utf-8')
  console.log(`상위 랭커 ${players}명 · 보드 ${data.boards.length} · 메타 덱 매칭 ${matched} (${Math.round((matched / (data.boards.length || 1)) * 100)}%) · 집계 덱 ${Object.keys(out).length}개`)
  const ranked = Object.entries(out).sort((p, q) => q[1].boards - p[1].boards).slice(0, 8)
  for (const [n, s] of ranked) console.log(`  ${n}: ${s.boards}판 · ${s.players}명 · 평균 ${s.avgPlacement}등`)
  console.log(`✅ 저장 → ${path.relative(process.cwd(), OUT)}`)
}

main()

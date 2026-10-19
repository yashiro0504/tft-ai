/**
 * 실제 래더 보드 → 덱 랭킹 (실측)
 *
 * 입력: data/ladderBoards.json (scripts/collectLadderBoards.js)
 * 출력: lib/decksData.preview.json (기본) / lib/decksData.json (--write)
 *
 * 방법
 *  1. 보드마다 "덱 이름표"를 붙인다: 캐리(아이템을 가장 많이 든 기물) + 핵심 시너지(유닛 수가 가장 많은 조합형 시너지)
 *  2. 같은 이름표끼리 묶고, 대표 구성이 거의 같은 묶음은 합친다
 *  3. MIN_GAMES 이상 나온 덱만 남기고, 그 보드들의 실제 등수로 평균/TOP4/1등/분포/픽률을 계산한다
 *  4. 대표 구성 = 그 덱 보드의 절반 이상에서 쓰인 기물 (부족하면 빈도순으로 채움), 캐리 아이템 = 가장 많이 쓴 3개
 *
 * 사용법:
 *  node scripts/buildDecksFromBoards.js            # 미리보기 + 표 출력
 *  node scripts/buildDecksFromBoards.js --write    # lib/decksData.json 교체
 *  MIN_GAMES=40 MAX_DECKS=50 node scripts/buildDecksFromBoards.js
 */
const fs = require('fs')
const path = require('path')

const tftData = require('../lib/tftData.json')
const reference = require('../lib/championTraits.json')
const breakpointData = require('../lib/traitBreakpoints.json')

const WRITE_LIVE = process.argv.includes('--write')
const MIN_GAMES = Number(process.env.MIN_GAMES || 30)
const MAX_DECKS = Number(process.env.MAX_DECKS || 100)
const MAX_UNITS = Number(process.env.MAX_UNITS || 9)
const MERGE_OVERLAP = Number(process.env.MERGE_OVERLAP || 0.75)

const BOARDS_PATH = path.join(__dirname, '..', 'data', 'ladderBoards.json')
const r2 = (x) => Math.round(x * 100) / 100
const r3 = (x) => Math.round(x * 1000) / 1000

/** buildDeckCompsFromStats.js 와 같은 정규화 (소문자 키) */
function norm(id) {
  return String(id || '')
    .replace(/^TFT\d*_/i, '')
    .replace(/^DA_\d*_/i, '')
    .replace(/^DA_/i, '')
    .replace(/^TFTTutorial_/i, '')
    .replace(/_Base$/i, '')
    .replace(/Base$/i, '')
    .replace(/_(AP|AD)$/i, '')
    .replace(/\d+$/i, '')
    .replace(/Small$/i, '') // 작은 나르(GnarSmall) → 나르
    .toLowerCase()
}

/** championTraits.json 에 없는 세트18 기물 한글명 (lib/constants.ts SET18_CHAMPS 와 같은 표기) */
const SET18_NAMES = {
  murkwolf: '어스름늑대',
  krug: '돌거북',
  scuttlecrab: '바위 게',
  brambleback: '덩굴정령',
  sentinel: '감시자',
  sentry: '조약돌',
  pebbles: '조약돌',
  elderdragon: '장로 드래곤',
  cinderling: '불타는 묘목',
  alune: '알룬',
  gromp: '심술두꺼비',
  crimsonraptor: '어미 부리',
  mamabeak: '어미 부리',
}

/** metaStats.json 의 기물 키와 같은 규칙 (scripts/buildMetaStats.js normalizeChampId) */
function statKey(id) {
  return String(id || '')
    .replace(/^TFT\d*_/i, '')
    .replace(/^DA_\d*_/i, '')
    .replace(/^DA_/i, '')
    .replace(/^TFTTutorial_/i, '')
    .replace(/\d+$/i, '')
    .replace(/Small$/i, '')
    .trim()
}

function buildLookup(map) {
  const lookup = new Map()
  for (const [key, value] of Object.entries(map || {})) {
    const k = norm(key)
    if (k && !lookup.has(k)) lookup.set(k, value)
  }
  return lookup
}
const champLookup = buildLookup(tftData.champMap)
const traitLookup = buildLookup(tftData.traitMap)

/** 아이템은 경로 마지막 조각으로 찾는다 (TFTSet18/Set18_Items/DA_EdgeOfNight → DA_EdgeOfNight) */
const itemSegment = (() => {
  const index = new Map()
  for (const [key, value] of Object.entries(tftData.itemMap || {})) {
    const seg = key.split('/').pop() || key
    if (!index.has(seg)) index.set(seg, value)
    if (!index.has(seg.toLowerCase())) index.set(seg.toLowerCase(), value)
  }
  return index
})()

function champInfo(id) {
  const k = norm(id)
  const ref = reference.champions?.[k]
  const meta = champLookup.get(k)
  return {
    key: k,
    name: ref?.name || SET18_NAMES[k] || meta?.name || k,
    cost: ref?.cost ?? null,
    imgUrl:
      ref?.imgUrl ||
      meta?.iconUrl ||
      (SET18_NAMES[k] ? `https://raw.communitydragon.org/latest/game/assets/characters/tft18_${k}/tft18_${k}_square.png` : ''),
    traits: ref?.traits || [],
  }
}

function traitInfo(id) {
  const k = norm(id)
  const ref = reference.traits?.[k]
  const meta = traitLookup.get(k)
  return {
    key: String(id).replace(/^TFT\d*_/i, '').replace(/^DA_\d*_/i, '').replace(/^DA_/i, ''),
    name: ref?.name || meta?.name || k,
    iconUrl: meta?.iconUrl || ref?.iconUrl || '',
  }
}

function itemInfo(id) {
  const meta = itemSegment.get(id) || itemSegment.get(String(id).toLowerCase())
  return { key: id, name: meta?.name || norm(id), iconUrl: meta?.iconUrl || '' }
}

/** 대표 구성 기물들의 시너지로 활성 시너지를 다시 센다 (표시된 기물과 숫자가 항상 맞도록) */
function traitsFromUnits(units) {
  const counts = new Map()
  for (const u of units) for (const t of u.traits || []) counts.set(t, (counts.get(t) || 0) + 1)
  const out = []
  for (const [key, count] of counts) {
    const bp = breakpointData.traits?.[norm(key)]
    if (bp && count < bp.breakpoints[0]) continue
    if (bp && bp.breakpoints.length === 1) continue // 고유 시너지는 덱 구성 요소로 세지 않는다
    const info = traitInfo(key)
    out.push({ key, name: info.name, iconUrl: info.iconUrl, count })
  }
  return out.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, 4)
}

/** 조합형 시너지인가 (고유 시너지 = 단계가 1개뿐) */
function isCompositional(trait) {
  if (trait.max != null) return trait.max > 1
  const bp = breakpointData.traits?.[norm(trait.id)]
  return !bp || bp.breakpoints.length > 1
}

/** 상점에서 사는 실제 기물인가 (소환물·토큰 제외) */
function isRealUnit(k) {
  return Boolean(reference.champions?.[k] || SET18_NAMES[k])
}

/** 보드 → 이름표 (캐리 + 핵심 시너지) */
function labelBoard(board) {
  const units = board.units || []
  if (units.length < 5) return null
  const carry = [...units].sort(
    (a, b) =>
      (b.items?.length || 0) - (a.items?.length || 0) ||
      (champInfo(b.id).cost || 0) - (champInfo(a.id).cost || 0) ||
      (b.star || 0) - (a.star || 0)
  )[0]
  if (!carry || (carry.items?.length || 0) < 2) return null

  const primary = [...(board.traits || [])]
    .filter(isCompositional)
    .sort((a, b) => b.units - a.units || b.style - a.style)[0]
  if (!primary) return null

  return { carry: norm(carry.id), trait: norm(primary.id), carryId: carry.id, traitId: primary.id }
}

function newCluster(label) {
  return {
    label,
    boards: 0,
    placements: Array(8).fill(0),
    unitCount: new Map(), // 기물 → 등장 보드 수
    unitStars: new Map(), // 기물 → 별 합
    unitIds: new Map(), // 기물 → 원본 id
    carryItems: new Map(),
    carryStars: [],
    traitCount: new Map(), // 시너지 → 활성 보드 수
    traitUnits: new Map(), // 시너지 → 유닛 수 합
    traitIds: new Map(),
  }
}

function addBoard(c, board, label) {
  c.boards++
  c.placements[board.placement - 1]++
  const seen = new Set()
  for (const u of board.units) {
    const k = norm(u.id)
    if (!isRealUnit(k)) continue // 소환물(작은 돌거북 등)은 덱 구성에서 뺀다
    if (seen.has(k)) continue
    seen.add(k)
    c.unitCount.set(k, (c.unitCount.get(k) || 0) + 1)
    c.unitStars.set(k, (c.unitStars.get(k) || 0) + (u.star || 1))
    if (!c.unitIds.has(k)) c.unitIds.set(k, u.id)
    if (k === label.carry) {
      c.carryStars.push(u.star || 1)
      for (const it of u.items || []) c.carryItems.set(it, (c.carryItems.get(it) || 0) + 1)
    }
  }
  for (const t of board.traits) {
    const k = norm(t.id)
    c.traitCount.set(k, (c.traitCount.get(k) || 0) + 1)
    c.traitUnits.set(k, (c.traitUnits.get(k) || 0) + t.units)
    if (!c.traitIds.has(k)) c.traitIds.set(k, t.id)
  }
}

/** 대표 구성: 절반 이상에서 쓰인 기물 → 부족하면 빈도순 채움 (최소 7, 최대 MAX_UNITS) */
function coreUnits(c) {
  const ranked = [...c.unitCount.entries()].sort((a, b) => b[1] - a[1])
  const core = ranked.filter(([, n]) => n / c.boards >= 0.5).slice(0, MAX_UNITS)
  for (const entry of ranked) {
    if (core.length >= 7) break
    if (!core.includes(entry)) core.push(entry)
  }
  return core.map(([k]) => k)
}

function mergeInto(a, b) {
  a.boards += b.boards
  for (let i = 0; i < 8; i++) a.placements[i] += b.placements[i]
  for (const field of ['unitCount', 'unitStars', 'carryItems', 'traitCount', 'traitUnits']) {
    for (const [k, v] of b[field]) a[field].set(k, (a[field].get(k) || 0) + v)
  }
  for (const field of ['unitIds', 'traitIds']) for (const [k, v] of b[field]) if (!a[field].has(k)) a[field].set(k, v)
  a.carryStars.push(...b.carryStars)
}

function overlap(a, b) {
  const A = new Set(coreUnits(a))
  const B = new Set(coreUnits(b))
  let shared = 0
  for (const k of A) if (B.has(k)) shared++
  return shared / Math.min(A.size, B.size)
}

function tierFromAvgPlacement(avg) {
  if (avg <= 3.95) return 'S'
  if (avg <= 4.15) return 'A'
  if (avg <= 4.4) return 'B'
  if (avg <= 4.65) return 'C'
  return 'D'
}

function toDeck(c, totalBoards) {
  const avg = c.placements.reduce((s, n, i) => s + n * (i + 1), 0) / c.boards
  const top4 = c.placements.slice(0, 4).reduce((s, n) => s + n, 0) / c.boards
  const win = c.placements[0] / c.boards
  const carryKey = c.label.carry
  const carryStar = c.carryStars.length
    ? [...c.carryStars].sort((a, b) => a - b)[Math.floor(c.carryStars.length / 2)]
    : 2
  const carryItems = [...c.carryItems.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => itemInfo(id))

  const units = coreUnits(c).map((k) => {
    const info = champInfo(c.unitIds.get(k))
    const star = k === carryKey ? carryStar : Math.round(c.unitStars.get(k) / c.unitCount.get(k))
    return {
      lolchessKey: k,
      name: info.name,
      cost: info.cost,
      star,
      index: null,
      imgUrl: info.imgUrl,
      matchedKey: statKey(c.unitIds.get(k)),
      traits: info.traits,
      items: k === carryKey ? carryItems : [],
      /** 이 덱 보드 중 이 기물을 쓴 비율 */
      usage: r3(c.unitCount.get(k) / c.boards),
    }
  })
  // 캐리를 맨 앞으로
  units.sort((a, b) => (b.lolchessKey === carryKey) - (a.lolchessKey === carryKey) || b.usage - a.usage)

  const traits = traitsFromUnits(units)

  const primaryName = traitInfo(c.traitIds.get(c.label.trait) || c.label.trait).name
  const carryName = champInfo(c.unitIds.get(carryKey)).name

  return {
    id: `ladder-${carryKey}-${c.label.trait}`,
    name: `${primaryName} ${carryName}`,
    gold: null,
    unitCost: units.reduce((s, u) => s + (u.cost || 0), 0),
    unitCount: units.length,
    traits,
    units,
    avgPlacement: r2(avg),
    top4Rate: r3(top4),
    winRate: r3(win),
    games: c.boards,
    playRate: r3(c.boards / totalBoards),
    placementDist: c.placements,
    coverage: 1,
    sampleSize: c.boards,
    tier: tierFromAvgPlacement(avg),
    carryKey: statKey(c.unitIds.get(carryKey)),
  }
}

function main() {
  if (!fs.existsSync(BOARDS_PATH)) {
    console.error('data/ladderBoards.json 이 없습니다. 먼저 node scripts/collectLadderBoards.js 를 실행하세요.')
    process.exitCode = 1
    return
  }
  const data = JSON.parse(fs.readFileSync(BOARDS_PATH, 'utf-8'))
  const boards = data.matches.flatMap((m) => m.boards)

  const clusters = new Map()
  let labeled = 0
  for (const b of boards) {
    const label = labelBoard(b)
    if (!label) continue
    labeled++
    const sig = `${label.carry}|${label.trait}`
    if (!clusters.has(sig)) clusters.set(sig, newCluster(label))
    addBoard(clusters.get(sig), b, label)
  }

  // 큰 묶음부터, 대표 구성이 거의 같은 작은 묶음을 흡수
  const sorted = [...clusters.values()].sort((a, b) => b.boards - a.boards)
  const merged = []
  for (const c of sorted) {
    const host = merged.find((m) => m.label.carry === c.label.carry && overlap(m, c) >= MERGE_OVERLAP)
    if (host) mergeInto(host, c)
    else merged.push(c)
  }

  // 대표 구성이 완전히 같은 묶음은 캐리 판별만 다른 같은 덱 → 큰 쪽으로 합친다
  let changed = true
  while (changed) {
    changed = false
    merged.sort((a, b) => b.boards - a.boards)
    outer: for (let i = 0; i < merged.length; i++) {
      const sig = coreUnits(merged[i]).slice().sort().join(',')
      for (let j = i + 1; j < merged.length; j++) {
        if (coreUnits(merged[j]).slice().sort().join(',') === sig) {
          mergeInto(merged[i], merged[j])
          merged.splice(j, 1)
          changed = true
          break outer
        }
      }
    }
  }

  const decks = merged
    .filter((c) => c.boards >= MIN_GAMES)
    .map((c) => toDeck(c, boards.length))
    .sort((a, b) => a.avgPlacement - b.avgPlacement)
    .slice(0, MAX_DECKS)

  const out = {
    version: 2,
    generatedAt: new Date().toISOString(),
    source: 'riot-ladder-boards',
    sourceUrl: null,
    patch: `set${data.set}`,
    region: data.region,
    matchCount: data.matches.length,
    boardCount: boards.length,
    labeledBoards: labeled,
    minGames: MIN_GAMES,
    deckCount: decks.length,
    unitMatchRate: 1,
    decks,
  }

  const outPath = path.join(__dirname, '..', 'lib', WRITE_LIVE ? 'decksData.json' : 'decksData.preview.json')
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8')

  const covered = decks.reduce((s, d) => s + d.games, 0)
  console.log(`판 ${data.matches.length} · 보드 ${boards.length} · 이름표 ${labeled} · 묶음 ${clusters.size} → 합친 뒤 ${merged.length} → ${MIN_GAMES}판 이상 덱 ${decks.length}개`)
  console.log(`덱 랭킹이 설명하는 보드: ${covered} (${Math.round((covered / boards.length) * 100)}%)`)
  console.log(`저장 → ${outPath}\n`)
  console.log('순위 | 덱 | 판수 | 픽률 | 평균 | TOP4 | 1등 | 구성')
  decks.forEach((d, i) => {
    console.log(
      `${String(i + 1).padStart(2)} | ${d.name} | ${d.games} | ${(d.playRate * 100).toFixed(1)}% | ${d.avgPlacement} | ${Math.round(d.top4Rate * 100)}% | ${Math.round(d.winRate * 100)}% | ${d.units.map((u) => u.name).join(', ')}`
    )
  })
}

main()

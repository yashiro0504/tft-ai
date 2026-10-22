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
 *  5. 시너지 최대 단계(breakpoint max)를 넘는 기물은 flex 로 표시하고 시너지 count 에서 제외한다
 *  6. 덱 가이드(guide): 핵심·유동 기물(채용률), 캐리 아이템 채용률과 들었을 때 평균 등수, 레벨 분포, 개방성
 *     — 최종 보드 통계라 '조합 순서'가 아니라 '최종 보드 채용률'이다
 *  7. 패치 분리(JSON 경로): 보드에 패치를 붙이고(공식 패치 노트 게시 시각 기준, lib/patchNotes),
 *     현재 패치 보드만으로 MIN_GAMES 를 넘는 덱은 현재 패치만, 못 넘는 덱은 직전 패치를 합쳐 만든다.
 *     guide.patch = { counts: 패치별 판 수, mixed } 로 기준을 남긴다. (DB 경로는 이미 패치별로 묶여 들어온다)
 *
 * 사용법:
 *  node scripts/buildDecksFromBoards.js            # 미리보기 + 표 출력
 *  node scripts/buildDecksFromBoards.js --write    # lib/decksData.json 교체
 *  MIN_GAMES=40 MAX_DECKS=50 node scripts/buildDecksFromBoards.js
 */
const fs = require('fs')
const path = require('path')

require('./_ts')
const { findChampion, findItem, findTrait, normalizeTftId } = require('../lib/gameData')

const WRITE_LIVE = process.argv.includes('--write')
const MIN_GAMES = Number(process.env.MIN_GAMES || 30)
const MAX_DECKS = Number(process.env.MAX_DECKS || 100)
const MAX_UNITS = Number(process.env.MAX_UNITS || 9)
const MERGE_OVERLAP = Number(process.env.MERGE_OVERLAP || 0.75)
/** 덱 가이드: 핵심 기물 채용률 하한 · 유동 기물 채용률 범위 · 표본 하한 · 개수 상한 */
const GUIDE_CORE_USAGE = 0.8
const GUIDE_FLEX_USAGE = 0.2
const GUIDE_MIN_N = 10
const GUIDE_MAX_FLEX = 6
const GUIDE_MAX_ITEMS = 5

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

/** 기물 정보 (게임 기준 DB). 시너지 키는 Riot apiName 의 세트 접두사·꼬리를 뗀 이름 (DA_18_Blackthorn → Blackthorn) */
function champInfo(id) {
  const k = norm(id)
  const c = findChampion(id)
  return {
    key: k,
    name: c?.name || k,
    cost: c?.cost ?? null,
    imgUrl: c?.icon || '',
    traits: c ? c.traits.map(normalizeTftId) : [],
  }
}

function traitInfo(id) {
  const t = findTrait(id)
  return {
    key: String(id).replace(/^TFT\d*_/i, '').replace(/^DA_\d*_/i, '').replace(/^DA_/i, ''),
    name: t?.name || norm(id),
    iconUrl: t?.icon || '',
  }
}

function itemInfo(id) {
  const it = findItem(id)
  return { key: id, name: it?.name || norm(id), iconUrl: it?.icon || '' }
}

/** 시너지 단계 인원 (단계가 없는 특수 시너지·모르는 시너지는 null) */
function traitBreakpoints(key) {
  const bps = findTrait(key)?.breakpoints
  return bps?.length ? bps : null
}

/** 대표 구성 기물들의 시너지로 활성 시너지를 다시 센다 (표시된 기물과 숫자가 항상 맞도록) */
function traitsFromUnits(units) {
  const counts = new Map()
  for (const u of units) for (const t of u.traits || []) counts.set(t, (counts.get(t) || 0) + 1)
  const out = []
  for (const [key, count] of counts) {
    const bp = traitBreakpoints(key)
    if (bp && count < bp[0]) continue
    if (bp && bp.length === 1) continue // 고유 시너지는 덱 구성 요소로 세지 않는다
    if (!bp && count < 2) continue // 단계 데이터가 없는 1명짜리 시너지(고유 시너지)도 뺀다
    const info = traitInfo(key)
    out.push({ key, name: info.name, iconUrl: info.iconUrl, count })
  }
  return out.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, 4)
}

/** 조합형 시너지인가 (고유 시너지 = 단계가 1개뿐) */
function isCompositional(trait) {
  if (trait.max != null) return trait.max > 1
  const bp = traitBreakpoints(trait.id)
  return !bp || bp.length > 1
}

/**
 * 아이템 역할: 딜템(damage) / 탱템(tank) / 애매(hybrid) / 기타(조합 재료·상징·유물 등)
 * 메인 딜러는 "딜템을 가장 많이 든 기물"로 판별한다. (탱커도 아이템 3개를 들기 때문)
 */
const TANK_ITEMS = new Set([
  'gargoylestoneplate', 'warmogsarmor', 'protectorsvow', 'spiritvisage', 'adaptivehelm', 'sunfirecape',
  'steadfastheart', 'dragonsclaw', 'evenshroud', 'bramblevest', 'redemption', 'ionicspark',
])
const HYBRID_ITEMS = new Set(['crownguard', 'titansresolve', 'steraksgage', 'thiefsgloves'])

function itemBase(id) {
  return String(id || '')
    .split('/')
    .pop()
    .replace(/^TFT\d*_Item_/i, '')
    .replace(/^DA_\d*_?/i, '')
    .replace(/Radiant$/i, '')
    .toLowerCase()
}

function itemRole(id) {
  const base = itemBase(id)
  if (/^component_|emblem|^artifact_|tactician/.test(base)) return 'other'
  if (TANK_ITEMS.has(base)) return 'tank'
  if (HYBRID_ITEMS.has(base)) return 'hybrid'
  return 'damage'
}

/** 완성 아이템인가 (조합 재료 제외) */
function isCompletedItem(id) {
  return !/^component_/.test(itemBase(id))
}

function damageScore(unit) {
  let score = 0
  for (const it of unit.items || []) {
    const role = itemRole(it)
    if (role === 'damage') score += 1
    else if (role === 'hybrid') score += 0.4
  }
  return score
}

const median = (arr) => {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** 상점에서 사는 실제 기물인가 (소환물·토큰 제외) */
function isRealUnit(k) {
  return Boolean(findChampion(k))
}

/** 보드 → 이름표 (캐리 + 핵심 시너지) */
function labelBoard(board) {
  const units = (board.units || []).filter((u) => isRealUnit(norm(u.id)))
  if (units.length < 5) return null
  // 메인 딜러: 딜템을 가장 많이 든 기물 → 동점이면 코스트·별 순. 딜템이 거의 없으면 아이템 수로.
  const holders = units.filter((u) => (u.items || []).filter(isCompletedItem).length >= 2)
  if (!holders.length) return null
  const byDamage = [...holders].sort(
    (a, b) =>
      damageScore(b) - damageScore(a) ||
      (champInfo(b.id).cost || 0) - (champInfo(a.id).cost || 0) ||
      (b.star || 0) - (a.star || 0)
  )
  const carry =
    damageScore(byDamage[0]) >= 1
      ? byDamage[0]
      : [...holders].sort((a, b) => (b.items?.length || 0) - (a.items?.length || 0))[0]

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
    unitItems: new Map(), // 기물 → (아이템 → 횟수)
    unitHolders: new Map(), // 기물 → 완성 아이템 2개 이상 든 보드 수
    sizes: [], // 보드별 실제 기물 수
    levels: [], // 보드별 레벨
    traitCount: new Map(), // 시너지 → 활성 보드 수
    traitUnits: new Map(), // 시너지 → 유닛 수 합
    traitIds: new Map(),
    unitPlace: new Map(), // 기물 → 등수 합 (기물을 쓴 보드)
    carryItemPlace: new Map(), // 캐리 아이템 → 등수 합 (그 아이템을 든 보드)
    carryItemBoards: new Map(), // 캐리 아이템 → 든 보드 수 (같은 아이템 2개도 1번)
    carryThree: 0, // 캐리 3성 보드 수
    patchCounts: new Map(), // 패치 → 보드 수 (board.patch 가 있을 때만)
  }
}

function addBoard(c, board, label) {
  c.boards++
  if (board.patch) c.patchCounts.set(board.patch, (c.patchCounts.get(board.patch) || 0) + 1)
  c.placements[board.placement - 1]++
  c.levels.push(board.level || 0)
  const seen = new Set()
  for (const u of board.units) {
    const k = norm(u.id)
    if (!isRealUnit(k)) continue // 소환물(작은 돌거북 등)은 덱 구성에서 뺀다
    if (seen.has(k)) continue
    seen.add(k)
    const done = (u.items || []).filter(isCompletedItem)
    if (done.length >= 2) c.unitHolders.set(k, (c.unitHolders.get(k) || 0) + 1)
    if (done.length) {
      const m = c.unitItems.get(k) || new Map()
      for (const it of done) m.set(it, (m.get(it) || 0) + 1)
      c.unitItems.set(k, m)
    }
    c.unitCount.set(k, (c.unitCount.get(k) || 0) + 1)
    c.unitPlace.set(k, (c.unitPlace.get(k) || 0) + board.placement)
    c.unitStars.set(k, (c.unitStars.get(k) || 0) + (u.star || 1))
    if (!c.unitIds.has(k)) c.unitIds.set(k, u.id)
    if (k === label.carry) {
      c.carryStars.push(u.star || 1)
      if ((u.star || 1) >= 3) c.carryThree++
      for (const it of u.items || []) c.carryItems.set(it, (c.carryItems.get(it) || 0) + 1)
      // 같은 아이템 2개는 한 번만 센다 (그 아이템을 든 보드의 등수)
      for (const it of new Set((u.items || []).filter(isCompletedItem))) {
        c.carryItemPlace.set(it, (c.carryItemPlace.get(it) || 0) + board.placement)
        c.carryItemBoards.set(it, (c.carryItemBoards.get(it) || 0) + 1)
      }
    }
  }
  for (const t of board.traits) {
    const k = norm(t.id)
    c.traitCount.set(k, (c.traitCount.get(k) || 0) + 1)
    c.traitUnits.set(k, (c.traitUnits.get(k) || 0) + t.units)
    if (!c.traitIds.has(k)) c.traitIds.set(k, t.id)
  }
  c.sizes.push(seen.size)
}

/**
 * 대표 구성: 이 덱 보드들의 실제 기물 수(중앙값, 보통 레벨과 같음)만큼 많이 쓰인 기물 순으로.
 * 8~9렙 덱이면 8~9개가 된다. 메인 딜러는 항상 포함.
 */
function coreSize(c) {
  return Math.min(Math.max(median(c.sizes) || 8, 6), MAX_UNITS)
}

function coreUnits(c) {
  const ranked = [...c.unitCount.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  const core = ranked.slice(0, coreSize(c))
  if (!core.includes(c.label.carry) && c.unitCount.has(c.label.carry)) core[core.length - 1] = c.label.carry
  return core
}

/**
 * 대표 구성 중 시너지 최대 단계(breakpoint max)를 넘는 기물 = 플렉스(선택).
 * 예: 전쟁기계는 최대 6단계라, 채용률이 높아도 7번째 전쟁기계는 플렉스로 표시하고
 * 시너지 count 에서는 제외한다. 캐리는 항상 코어로 둔다.
 */
function flexKeys(c) {
  const core = coreUnits(c)
  const carry = c.label.carry
  const ordered = [carry, ...core.filter((k) => k !== carry)].filter((k) => core.includes(k))
  const counts = new Map()
  const flex = new Set()

  for (const k of ordered) {
    const traits = (champInfo(c.unitIds.get(k)).traits || []).map(norm)
    const over = traits.some((t) => {
      const bp = traitBreakpoints(t)
      return bp != null && (counts.get(t) || 0) + 1 > bp[bp.length - 1]
    })
    if (over) {
      flex.add(k)
      continue
    }
    for (const t of traits) counts.set(t, (counts.get(t) || 0) + 1)
  }
  return flex
}

function mergeInto(a, b) {
  a.boards += b.boards
  for (let i = 0; i < 8; i++) a.placements[i] += b.placements[i]
  for (const field of ['unitCount', 'unitStars', 'carryItems', 'traitCount', 'traitUnits', 'unitHolders', 'unitPlace', 'carryItemPlace', 'carryItemBoards', 'patchCounts']) {
    for (const [k, v] of b[field]) a[field].set(k, (a[field].get(k) || 0) + v)
  }
  for (const field of ['unitIds', 'traitIds']) for (const [k, v] of b[field]) if (!a[field].has(k)) a[field].set(k, v)
  for (const [k, m] of b.unitItems) {
    const target = a.unitItems.get(k) || new Map()
    for (const [it, n] of m) target.set(it, (target.get(it) || 0) + n)
    a.unitItems.set(k, target)
  }
  a.carryStars.push(...b.carryStars)
  a.carryThree += b.carryThree
  a.sizes.push(...b.sizes)
  a.levels.push(...b.levels)
}

function overlap(a, b) {
  const A = new Set(coreUnits(a))
  const B = new Set(coreUnits(b))
  let shared = 0
  for (const k of A) if (B.has(k)) shared++
  return shared / Math.min(A.size, B.size)
}

/**
 * 덱 가이드 (래더 최종 보드 통계). key 는 덱 units 와 같은 statKey (런타임 entitySlug 매칭용).
 * - core: 채용률 80%+ 기물 / flex: 20~80% 기물 (대표 구성 밖 포함) + 썼을 때 평균 등수
 * - carryItems: 캐리가 든 완성 아이템의 채용률(보드 비율)과 그 아이템을 들었을 때 평균 등수 (표본 10판+)
 * - levels: 레벨 → 보드 비율 / carryThreeStarRate: 캐리 3성 보드 비율
 * - openness.flexSlots = 대표 구성 칸 수 − 핵심 기물 수 (sharedCarryDecks 는 buildDecks 에서 채운다)
 */
function deckGuide(c) {
  const usage = (k) => c.unitCount.get(k) / c.boards
  const unitEntry = (k) => ({
    key: statKey(c.unitIds.get(k)),
    name: champInfo(c.unitIds.get(k)).name,
    usage: r3(usage(k)),
    avgPlacement: r2(c.unitPlace.get(k) / c.unitCount.get(k)),
  })
  const ranked = [...c.unitCount.keys()].sort((a, b) => usage(b) - usage(a))
  const core = ranked.filter((k) => usage(k) >= GUIDE_CORE_USAGE)
  const flex = ranked
    .filter((k) => usage(k) >= GUIDE_FLEX_USAGE && usage(k) < GUIDE_CORE_USAGE && c.unitCount.get(k) >= GUIDE_MIN_N)
    .slice(0, GUIDE_MAX_FLEX)
  const carryItems = [...c.carryItemPlace.keys()]
    .map((id) => ({ id, n: c.carryItemBoards.get(id), place: c.carryItemPlace.get(id) }))
    .filter((x) => x.n >= GUIDE_MIN_N && itemInfo(x.id).iconUrl)
    .sort((a, b) => b.n - a.n)
    .slice(0, GUIDE_MAX_ITEMS)
    .map((x) => ({ key: x.id, name: itemInfo(x.id).name, rate: r3(x.n / c.boards), avgPlacement: r2(x.place / x.n) }))
  const levels = {}
  for (const lv of c.levels) if (lv) levels[lv] = (levels[lv] || 0) + 1
  for (const lv of Object.keys(levels)) levels[lv] = r3(levels[lv] / c.boards)
  return {
    boards: c.boards,
    core: core.map(unitEntry),
    flex: flex.map(unitEntry),
    carryItems,
    levels,
    carryThreeStarRate: r3(c.carryThree / c.boards),
    openness: { coreCount: core.length, flexSlots: Math.max(coreSize(c) - core.length, 0), sharedCarryDecks: 0 },
    // 이 덱 통계가 어느 패치 보드로 만들어졌는가 (패치 정보가 없는 입력이면 생략)
    ...(c.patchCounts.size
      ? {
          patch: {
            counts: Object.fromEntries([...c.patchCounts.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))),
            mixed: c.patchCounts.size > 1,
          },
        }
      : {}),
  }
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
  /** 이 기물이 가장 많이 든 완성 아이템 3개 (아이콘 있는 것만) */
  const topItems = (k) =>
    [...(c.unitItems.get(k) || new Map()).entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => itemInfo(id))
      .filter((it) => it.iconUrl)
      .slice(0, 3)
  /** 아이템을 주로 드는 기물 (메인 딜러 + 탱커 등): 이 기물이 나온 보드의 40% 이상에서 완성 아이템 2개+ */
  const holdsItems = (k) => k === carryKey || (c.unitHolders.get(k) || 0) / (c.unitCount.get(k) || 1) >= 0.4

  const flex = flexKeys(c)
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
      items: holdsItems(k) ? topItems(k) : [],
      /** 시너지 최대 단계를 넘는 선택 기물 (시너지 count 에서는 제외) */
      flex: flex.has(k),
      /** 이 덱 보드 중 이 기물을 쓴 비율 */
      usage: r3(c.unitCount.get(k) / c.boards),
    }
  })
  // 캐리 → 코어 → 플렉스 순, 같은 순위는 채용률 순
  units.sort(
    (a, b) =>
      (b.lolchessKey === carryKey) - (a.lolchessKey === carryKey) ||
      Number(a.flex) - Number(b.flex) ||
      b.usage - a.usage
  )

  const traits = traitsFromUnits(units.filter((unit) => !unit.flex))

  const primaryName = traitInfo(c.traitIds.get(c.label.trait) || c.label.trait).name
  const carryName = champInfo(c.unitIds.get(carryKey)).name

  return {
    id: `ladder-${carryKey}-${c.label.trait}`,
    name: `${primaryName} ${carryName}`,
    gold: null,
    unitCost: units.reduce((s, u) => s + (u.cost || 0), 0),
    unitCount: units.length,
    /** 이 덱 보드들의 레벨 중앙값 */
    level: median(c.levels),
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
    guide: deckGuide(c),
  }
}

/**
 * 보드 목록 → 덱 랭킹. JSON 수집본(main)과 DB 원본(scripts/collect/decks.js)이 같이 쓴다.
 * @param boards [{ placement, level, units: [{ id, star, items: [id] }], traits: [{ id, units, style, max? }] }]
 * @param opts { minGames, maxDecks }
 */
function buildDecks(boards, { minGames = MIN_GAMES, maxDecks = MAX_DECKS } = {}) {
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
    if (host) {
      if (process.env.DEBUG_MERGE) console.log(`merge(overlap) ${host.label.carry}|${host.label.trait} <- ${c.label.carry}|${c.label.trait} (${c.boards})`)
      mergeInto(host, c)
    }
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
          if (process.env.DEBUG_MERGE) console.log(`merge(same core) ${merged[i].label.carry}|${merged[i].label.trait} <- ${merged[j].label.carry}|${merged[j].label.trait} (${merged[j].boards})`)
          mergeInto(merged[i], merged[j])
          merged.splice(j, 1)
          changed = true
          break outer
        }
      }
    }
  }

  const decks = merged
    .filter((c) => c.boards >= minGames)
    .map((c) => ({ deck: toDeck(c, boards.length), core: coreUnits(c), placements: c.placements }))
    .sort((a, b) => a.deck.avgPlacement - b.deck.avgPlacement)
    .slice(0, maxDecks)
  setSharedCarry(decks.map((d) => d.deck))

  return { decks, labeled, clusterCount: clusters.size, mergedCount: merged.length }
}

/** 개방성: 같은 캐리를 쓰는 다른 메타 덱 수 (경합·전환 여지) */
function setSharedCarry(decks) {
  for (const d of decks) d.guide.openness.sharedCarryDecks = decks.filter((o) => o !== d && o.carryKey === d.carryKey).length
}

/**
 * 패치 분리: 현재 패치만으로 만든 덱(current)이 minGames 이상이면 그것을, 아니면 현재+직전 패치로 만든 덱(mixed)을 쓴다.
 * 현재 패치에만 있는 새 덱도 minGames 이상이면 넣는다. 결과는 평균 등수 순, 개방성(같은 캐리 덱 수)은 다시 센다.
 */
function choosePatchDecks(currentDecks, mixedDecks, minGames = MIN_GAMES) {
  const byId = new Map(currentDecks.map((d) => [d.id, d]))
  const chosen = mixedDecks.map((m) => {
    const cur = byId.get(m.id)
    return cur && cur.games >= minGames ? cur : m
  })
  const ids = new Set(chosen.map((d) => d.id))
  for (const d of currentDecks) if (!ids.has(d.id) && d.games >= minGames) chosen.push(d)
  chosen.sort((a, b) => a.avgPlacement - b.avgPlacement)
  setSharedCarry(chosen)
  return chosen
}

/**
 * 완전히 같은 8유닛 조합은 한 덱만 남긴다 (표본 큰 쪽 유지).
 *
 * buildDecks 는 "핵심 유닛"만 비교해 합치므로, 캐리 판별만 다른 동일 조합이 남을 수 있다.
 * checkDecks.js 의 유닛 조합 중복 검사와 동일한 signature(lolchessKey 정렬) 를 쓴다.
 */
function dedupeByUnits(decks) {
  const best = new Map()
  for (const d of decks) {
    const sig = (d.units || []).map((u) => u.lolchessKey).sort().join(',')
    const prev = best.get(sig)
    if (!prev) {
      best.set(sig, d)
      continue
    }
    const keepNew = (d.games || 0) > (prev.games || 0)
    if (process.env.DEBUG_MERGE) console.log(`drop(same 8 units) ${keepNew ? prev.name : d.name}`)
    if (keepNew) best.set(sig, d)
  }
  return [...best.values()]
}

function main() {
  if (!fs.existsSync(BOARDS_PATH)) {
    console.error('data/ladderBoards.json 이 없습니다. 먼저 node scripts/collectLadderBoards.js 를 실행하세요.')
    process.exitCode = 1
    return
  }
  const data = JSON.parse(fs.readFileSync(BOARDS_PATH, 'utf-8'))
  // 패치 태깅: 공식 패치 노트 게시 시각 기준 (lib/patchNotes.ts — TS 라 여기서만 로드, DB 경로는 영향 없음)
  require('./_ts')
  const { getPatchNotes, patchAt } = require('../lib/patchNotes')
  const notes = getPatchNotes()
  const current = notes[notes.length - 1]?.patch
  const previous = notes[notes.length - 2]?.patch
  const allBoards = data.matches.flatMap((m) => {
    const patch = patchAt(m.datetime)?.patch
    return m.boards.map((b) => ({ ...b, patch }))
  })
  let decks
  let boards
  let labeled
  let clusterCount
  let mergedCount
  if (current) {
    const currentBoards = allBoards.filter((b) => b.patch === current)
    boards = allBoards.filter((b) => b.patch === current || b.patch === previous)
    const builtCurrent = buildDecks(currentBoards)
    const builtMixed = buildDecks(boards)
    decks = dedupeByUnits(choosePatchDecks(builtCurrent.decks.map((d) => d.deck), builtMixed.decks.map((d) => d.deck)))
      .sort((a, b) => a.avgPlacement - b.avgPlacement)
      .slice(0, MAX_DECKS)
    setSharedCarry(decks)
    ;({ labeled, clusterCount, mergedCount } = builtMixed)
    console.log(`패치: 현재 ${current} ${currentBoards.length}보드 · 직전 ${previous ?? '-'} ${boards.length - currentBoards.length}보드 · 제외(더 이전) ${allBoards.length - boards.length}보드`)
  } else {
    // 패치 노트가 없으면 예전처럼 전체 보드
    boards = allBoards
    const built = buildDecks(boards)
    decks = dedupeByUnits(built.decks.map((d) => d.deck))
    ;({ labeled, clusterCount, mergedCount } = built)
  }
  const built = { clusterCount, mergedCount }

  const out = {
    version: 2,
    /** 이 파일을 빌드한 시각 (데이터 수집일이 아니다) */
    generatedAt: new Date().toISOString(),
    /** 원본 래더 보드의 수집 시각 (data/ladderBoards.json updatedAt) — 화면·sitemap 의 '갱신'은 이 값을 쓴다 */
    sourceUpdatedAt: data.updatedAt || null,
    source: 'riot-ladder-boards',
    sourceUrl: null,
    patch: `set${data.set}`,
    region: data.region,
    matchCount: data.matches.length,
    boardCount: boards.length,
    /** 패치 분리 기준 (공식 패치 노트 기준 현재·직전 패치) */
    currentPatch: current || null,
    previousPatch: previous || null,
    labeledBoards: labeled,
    minGames: MIN_GAMES,
    deckCount: decks.length,
    unitMatchRate: 1,
    decks,
  }

  const outPath = path.join(__dirname, '..', 'lib', WRITE_LIVE ? 'decksData.json' : 'decksData.preview.json')
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8')

  const covered = decks.reduce((s, d) => s + d.games, 0)
  console.log(`판 ${data.matches.length} · 보드 ${boards.length} · 이름표 ${labeled} · 묶음 ${built.clusterCount} → 합친 뒤 ${built.mergedCount} → ${MIN_GAMES}판 이상 덱 ${decks.length}개`)
  console.log(`덱 랭킹이 설명하는 보드: ${covered} (${Math.round((covered / boards.length) * 100)}%)`)
  console.log(`저장 → ${outPath}
`)
  console.log('순위 | 덱 | 판수 | 픽률 | 평균 | TOP4 | 1등 | 구성')
  decks.forEach((d, i) => {
    console.log(
      `${String(i + 1).padStart(2)} | ${d.name} | ${d.games} | ${(d.playRate * 100).toFixed(1)}% | ${d.avgPlacement} | ${Math.round(d.top4Rate * 100)}% | ${Math.round(d.winRate * 100)}% | ${d.units.map((u) => u.name).join(', ')}`
    )
  })
}

if (require.main === module) main()

module.exports = { labelBoard, damageScore, itemRole, buildDecks, choosePatchDecks }

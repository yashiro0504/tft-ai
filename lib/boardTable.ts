import { championSlots, championTraitsOf, traitBreakpointsOf, traitNameOf } from './gameFacts'
import { GAME_CHAMPIONS, GAME_ITEMS, championTraitNames, findChampion } from './gameData'
import { unitTraitCounts } from './traitAnchors'
import type { SlimMatchData, SlimMatchUnit } from './types'

/**
 * 보드 표 (2026-10-30 지시문 1) — 기물과 시너지의 관계를 코드가 계산해 프롬프트에 넣고, 리포트 검증에도 같은 표를 쓴다.
 *
 * LLM 이 기물의 시너지를 추측하면 "세트처럼 핵심 시너지와 무관한 1성 기물은 빼서"(세트 = 개화 + 싸움꾼, 빼면 개화 3 → 2로 꺼짐)
 * 같은 조언이 나온다. 표에 있는 관계만 쓰게 한다.
 *
 * - 시너지 인원은 Riot 응답 traits[].num_units(SlimMatchTrait.count, 상징 포함)를 기준으로 한다.
 * - 기물별 기본 시너지는 정적 데이터(lib/gameData, Community Dragon 패치별)에서, 상징 아이템("X 상징")은 그 기물에 X 1명을 더한다.
 * - 정적 데이터 합과 Riot 인원의 차이는 상징으로 설명하고, 그래도 남으면 '그 밖의 출처'(증강 등)로 적는다.
 * - "N단계"는 몇 번째 단계다 (lib/summarize "주문술사(4)[2단계]"와 같은 뜻).
 */

export interface BoardTableUnit {
  name: string
  cost: number | null
  star: number
  /** 정적 데이터의 기본 시너지 */
  baseTraits: string[]
  items: string[]
  /** 상징 아이템으로 얻은 시너지 */
  emblemTraits: string[]
}

export interface BoardTableTrait {
  name: string
  /** Riot 인원 (상징 포함) */
  count: number
  /** 지금 단계 번호 (0 = 꺼짐) */
  stage: number
  /** 지금 단계 인원 (0 = 꺼짐) */
  active: number
  /** 다음 단계까지 필요한 인원 (최고 단계면 null) */
  toNext: number | null
  breakpoints: number[]
  /** 이 시너지에 인원을 더하는 기물 */
  contributors: { name: string; count: number; emblem: boolean }[]
  /** 기물·상징으로 설명되지 않는 인원 (증강 등) */
  other: number
  /** 최고 단계 번호 (= 단계 목록 길이) */
  maxTier: number
  /** 세트 전체에서 이 시너지를 가진 기물 수 (형태 변형 기물은 본체 하나로) */
  setUnits: number
  /** 조합으로 만들 수 있는 상징이 있는가 */
  emblem: boolean
}

/* ───────────── 시너지 정적 정보 (2026-11-02 지시문 2-1) ───────────── */

export interface TraitStatic {
  name: string
  breakpoints: number[]
  maxTier: number
  /** 이 시너지를 가진 기물 이름 (형태 변형은 본체 이름 하나로 — 럭스(원시) → 럭스) */
  units: string[]
  emblem: boolean
  /** 상징 조합식 (재료 한글명 2개) */
  emblemRecipe: string[]
}

const staticCache = new Map<string, TraitStatic | null>()

/** 시너지의 단계 목록·최고 단계·세트 기물·상징 — 정적 데이터(lib/gameData)에서. 모르는 시너지면 null */
export function traitStatic(idOrName: string): TraitStatic | null {
  const name = traitNameOf(idOrName) ?? idOrName
  if (staticCache.has(name)) return staticCache.get(name) as TraitStatic | null
  const breakpoints = traitBreakpointsOf(name)
  if (!breakpoints.length) {
    staticCache.set(name, null)
    return null
  }
  const byBase = new Map<string, string>()
  for (const c of GAME_CHAMPIONS) {
    if (!championTraitNames(c).includes(name)) continue
    const base = c.variantOf ? GAME_CHAMPIONS.find((x) => x.apiName === c.variantOf) : c
    byBase.set(base?.apiName ?? c.apiName, base?.name ?? c.name.replace(/\s*\(.*\)$/, ''))
  }
  const emblemItem = GAME_ITEMS.find((i) => i.kind === 'emblem' && i.name === `${name}${EMBLEM_SUFFIX}` && i.recipe.length === 2)
  const emblemRecipe = emblemItem ? emblemItem.recipe.map((id) => GAME_ITEMS.find((x) => x.apiName === id)?.name ?? id) : []
  const out = { name, breakpoints, maxTier: breakpoints.length, units: [...new Set(byBase.values())], emblem: Boolean(emblemItem), emblemRecipe }
  staticCache.set(name, out)
  return out
}

/** 단계 번호 (0 = 꺼짐) */
export function tierOf(bps: number[], count: number): number {
  return bps.filter((b) => b <= count).length
}

export interface BoardTableRemoval {
  name: string
  /** 빼면 꺼지는 시너지 */
  off: string[]
  /** 빼면 단계가 내려가는 시너지 (from → to 단계 번호) */
  down: { trait: string; from: number; to: number }[]
}

export interface BoardTable {
  units: BoardTableUnit[]
  traits: BoardTableTrait[]
  removal: BoardTableRemoval[]
}

const EMBLEM_SUFFIX = ' 상징'

function stageOf(bps: number[], count: number): { stage: number; active: number } {
  let stage = 0
  let active = 0
  bps.forEach((b, i) => {
    if (count >= b) {
      stage = i + 1
      active = b
    }
  })
  return { stage, active }
}

function baseTraitsOf(u: SlimMatchUnit): string[] {
  const t = championTraitsOf(u.id)
  return t.length ? t : championTraitsOf(u.name)
}

function emblemTraitsOf(u: SlimMatchUnit): string[] {
  const base = new Set(baseTraitsOf(u))
  return (u.items || [])
    .map((it) => (it.endsWith(EMBLEM_SUFFIX) ? traitNameOf(it.slice(0, -EMBLEM_SUFFIX.length)) : null))
    .filter((t): t is string => Boolean(t) && !base.has(t as string))
}

export function buildBoardTable(m: Pick<SlimMatchData, 'units' | 'traits'>): BoardTable {
  const units: BoardTableUnit[] = (m.units || []).map((u) => ({
    name: u.name,
    cost: u.rarity ?? findChampion(u.id)?.cost ?? null,
    star: u.tier || 1,
    baseTraits: baseTraitsOf(u),
    items: u.items || [],
    emblemTraits: emblemTraitsOf(u),
  }))
  const perUnit = (m.units || []).map((u) => ({ u, c: unitTraitCounts(u), emblems: new Set(emblemTraitsOf(u)) }))
  const traits: BoardTableTrait[] = (m.traits || [])
    .map((t) => {
      const name = traitNameOf(t.name) ?? t.name
      const bps = traitBreakpointsOf(name)
      const count = t.count || 0
      const { stage, active } = stageOf(bps, count)
      const next = bps.find((b) => b > count)
      const contributors = perUnit
        .filter((x) => x.c.get(name))
        .map((x) => ({ name: x.u.name, count: x.c.get(name) || 0, emblem: x.emblems.has(name) }))
      const explained = contributors.reduce((s, x) => s + x.count, 0)
      const st = traitStatic(name)
      return {
        name,
        count,
        stage,
        active,
        toNext: next != null ? next - count : null,
        breakpoints: bps,
        contributors,
        other: Math.max(0, count - explained),
        maxTier: bps.length,
        setUnits: st?.units.length ?? 0,
        emblem: Boolean(st?.emblem),
      }
    })
    .sort((a, b) => b.stage - a.stage || b.count - a.count)
  const removal: BoardTableRemoval[] = perUnit.map(({ u, c }) => {
    const off: string[] = []
    const down: BoardTableRemoval['down'] = []
    for (const t of traits) {
      const n = c.get(t.name) || 0
      if (!n || !t.stage) continue
      const after = stageOf(t.breakpoints, t.count - n).stage
      if (after === 0) off.push(t.name)
      else if (after < t.stage) down.push({ trait: t.name, from: t.stage, to: after })
    }
    return { name: u.name, off, down }
  })
  return { units, traits, removal }
}

/** 기물(이름)이 이 시너지를 갖는가 — 기본 시너지 또는 상징. 보드에 없는 기물은 정적 데이터만 본다 */
export function unitHasTrait(table: BoardTable | null, unitName: string, trait: string): boolean | null {
  const u = table?.units.find((x) => x.name === unitName)
  if (u) return u.baseTraits.includes(trait) || u.emblemTraits.includes(trait)
  const base = championTraitsOf(unitName)
  return base.length ? base.includes(trait) : null
}

/** 기물을 빼면 꺼지거나 내려가는 시너지 이름 (1명짜리 고유 시너지 제외) */
export function removalLosses(table: BoardTable, unitName: string, { includeUnique = false } = {}): string[] {
  const r = table.removal.find((x) => x.name === unitName)
  if (!r) return []
  const multi = (t: string) => includeUnique || (table.traits.find((x) => x.name === t)?.breakpoints[0] ?? 1) > 1
  return [...r.off, ...r.down.map((d) => d.trait)].filter(multi)
}

/** 프롬프트 블록 — [보드 표] */
export function boardTableFacts(m: Pick<SlimMatchData, 'units' | 'traits'>): string {
  const t = buildBoardTable(m)
  if (!t.units.length) return ''
  const unitLine = (u: BoardTableUnit) => {
    const traits = [...u.baseTraits, ...u.emblemTraits.map((x) => `${x}(상징)`)].join('·') || '시너지 정보 없음'
    return `- ${u.name} ${u.cost ?? '?'}코 ${u.star}성 · 시너지 ${traits} · 아이템 ${u.items.length ? u.items.join('·') : '없음'}`
  }
  const traitLine = (x: BoardTableTrait) => {
    const who = x.contributors.map((c) => `${c.name}${c.emblem ? '(상징)' : ''}${c.count > 1 ? `(${c.count}명분)` : ''}`).join('·')
    const other = x.other ? ` · 그 밖의 출처 ${x.other}명` : ''
    const stage = x.stage ? `${x.stage}단계(${x.active}명)` : '꺼짐'
    const next = x.toNext != null ? `다음 단계까지 ${x.toNext}명` : '최고 단계'
    // 단계 목록·최고 단계·세트 기물 수 (2026-11-02 지시문 2-1) — "원시 6명 3단계"처럼 없는 단계를 목표로 쓰지 않게
    const tiers = x.breakpoints.length ? ` · 단계 목록 ${x.breakpoints.join('/')}명(최고 ${x.maxTier}단계)` : ''
    const recipe = traitStatic(x.name)?.emblemRecipe ?? []
    const pool = x.setUnits ? ` · 세트 기물 ${x.setUnits}개${x.emblem ? ` + 상징(${recipe.join(' + ')}, 1개 = +1명)` : ''}` : ''
    return `- ${x.name} ${x.count}명 · ${stage} · ${next}${tiers}${pool} · 기여 기물 ${who || '없음'}${other}`
  }
  const removalLine = (r: BoardTableRemoval) => {
    const parts = [...r.off.map((x) => `${x} 꺼짐`), ...r.down.map((d) => `${d.trait} ${d.from}→${d.to}단계`)]
    return `- ${r.name} 빼면: ${parts.length ? parts.join(', ') : '켜진 시너지 변화 없음'}`
  }
  return [
    '[보드 표 — 코드 산출. 기물과 시너지의 관계(어떤 기물이 어떤 시너지인지, 빼면 어떻게 되는지)는 이 표에 있는 내용만 써라. 목표 단계·인원은 그 시너지의 단계 목록에 있는 값만 써라]',
    '기물:',
    ...t.units.map(unitLine),
    '시너지 (인원은 Riot 집계·상징 포함):',
    ...t.traits.filter((x) => x.count > 0).map(traitLine),
    '이 기물을 빼면:',
    ...t.removal.map(removalLine),
  ].join('\n')
}

/* ───────────── 단계 시뮬레이션 (2026-11-02 지시문 2-3·3-5) ───────────── */

export interface BoardSimOps {
  /** 빼는 기물 (보드에 있는 이름) */
  remove?: string[]
  /** 넣는 기물 (세트 기물 이름 — 정적 데이터의 시너지를 더한다) */
  addUnits?: string[]
  /** 시너지 인원만 더하기 (상징 1개 = 그 시너지 +1명) */
  addTraits?: Record<string, number>
}

export interface BoardSimResult {
  counts: Map<string, number>
  tiers: Map<string, number>
  stageSum: number
  /** 보드 칸 수 (장로 드래곤 2칸) — 레벨과 비교한다 */
  slots: number
}

/** 단계 합 (켜진 시너지마다 단계 번호의 합 · 1명 고유 시너지 포함) */
export function stageSumOf(table: BoardTable): number {
  return table.traits.reduce((s, t) => s + t.stage, 0)
}

/** 조언을 적용한 뒤의 시너지 인원·단계·단계 합. 인원은 Riot 집계(상징 포함)에서 출발해 기물·상징 몫을 더하고 뺀다 */
export function simulateBoard(table: BoardTable, ops: BoardSimOps): BoardSimResult {
  const counts = new Map(table.traits.map((t) => [t.name, t.count]))
  let slots = table.units.reduce((s, u) => s + Math.max(1, championSlots(u.name)), 0)
  const bump = (trait: string, n: number) => counts.set(trait, Math.max(0, (counts.get(trait) || 0) + n))
  for (const name of ops.remove || []) {
    const u = table.units.find((x) => x.name === name)
    if (!u) continue
    slots -= Math.max(1, championSlots(name))
    for (const t of table.traits) {
      const c = t.contributors.find((x) => x.name === name)
      if (c) bump(t.name, -c.count)
    }
  }
  for (const name of ops.addUnits || []) {
    slots += Math.max(1, championSlots(name))
    for (const t of championTraitsOf(name)) bump(t, 1)
  }
  for (const [t, n] of Object.entries(ops.addTraits || {})) bump(traitNameOf(t) ?? t, n)
  const tiers = new Map<string, number>()
  let stageSum = 0
  for (const [t, n] of counts) {
    const tier = tierOf(traitBreakpointsOf(t), n)
    tiers.set(t, tier)
    stageSum += tier
  }
  return { counts, tiers, stageSum, slots }
}

/** 보드에 없는 세트 기물 중 이 시너지를 가진 기물 (형태 변형 본체 제외 — 럭스는 화신 기물이라 따로 고르지 않는다) */
export function addableUnitsFor(table: BoardTable, trait: string): string[] {
  const st = traitStatic(trait)
  if (!st) return []
  const onBoard = new Set(table.units.map((u) => u.name))
  return st.units.filter((n) => !onBoard.has(n) && championTraitsOf(n).includes(st.name))
}

/**
 * 기물 하나를 빼고(선택) 이 시너지들 중 하나의 기물(또는 상징)을 넣었을 때 가장 높은 단계 합 — "럭스 대신 원시 또는 선봉대 기물로 교체해 단계 합 8 이상" 확인용.
 * 넣을 기물의 다른 시너지까지 계산해 가장 유리한 경우를 고른다 (그래도 약속보다 낮으면 조언이 틀렸다).
 */
export function bestStageSumAfterSwap(table: BoardTable, remove: string | null, traits: string[]): { stageSum: number; via: string | null } {
  let best = { stageSum: -1, via: null as string | null }
  const base: BoardSimOps = remove ? { remove: [remove] } : {}
  for (const t of traits) {
    for (const u of addableUnitsFor(table, t)) {
      const r = simulateBoard(table, { ...base, addUnits: [u] })
      if (r.stageSum > best.stageSum) best = { stageSum: r.stageSum, via: u }
    }
    if (traitStatic(t)?.emblem) {
      const r = simulateBoard(table, { ...base, addTraits: { [t]: 1 } })
      if (r.stageSum > best.stageSum) best = { stageSum: r.stageSum, via: `${traitNameOf(t) ?? t}${EMBLEM_SUFFIX}` }
    }
  }
  if (best.stageSum < 0) best = { stageSum: simulateBoard(table, base).stageSum, via: null }
  return best
}

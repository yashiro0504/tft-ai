import { championTraitsOf, traitBreakpointsOf, traitNameOf } from './gameFacts'
import { findChampion } from './gameData'
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
      return { name, count, stage, active, toNext: next != null ? next - count : null, breakpoints: bps, contributors, other: Math.max(0, count - explained) }
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
    return `- ${x.name} ${x.count}명 · ${stage} · ${next} · 기여 기물 ${who || '없음'}${other}`
  }
  const removalLine = (r: BoardTableRemoval) => {
    const parts = [...r.off.map((x) => `${x} 꺼짐`), ...r.down.map((d) => `${d.trait} ${d.from}→${d.to}단계`)]
    return `- ${r.name} 빼면: ${parts.length ? parts.join(', ') : '켜진 시너지 변화 없음'}`
  }
  return [
    '[보드 표 — 코드 산출. 기물과 시너지의 관계(어떤 기물이 어떤 시너지인지, 빼면 어떻게 되는지)는 이 표에 있는 내용만 써라]',
    '기물:',
    ...t.units.map(unitLine),
    '시너지 (인원은 Riot 집계·상징 포함):',
    ...t.traits.filter((x) => x.count > 0).map(traitLine),
    '이 기물을 빼면:',
    ...t.removal.map(removalLine),
  ].join('\n')
}

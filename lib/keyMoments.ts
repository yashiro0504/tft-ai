import breakpointData from './traitBreakpoints.json'
import { entitySlug } from './entitySlug'
import { boardCarry } from './deckType'
import { mostSimilarOpponent } from './comparisonFacts'
import type { SlimMatchData, SlimMatchUnit } from './types'

/**
 * 핵심 장면 — 최종 보드에서 코드가 콕 집을 수 있는 구체적 사실 (단일 경기).
 * 강의가 "완성도가 낮다" 같은 카테고리 일반론에 머물지 않도록, LLM 에는 이 장면들을 설명하게 한다.
 * 모두 최종 보드 기준 사실이다 — 라운드 타이밍(언제 레벨업/리롤)은 데이터에 없으니 만들지 않는다.
 */
export interface KeyMoment {
  kind: 'sameComp' | 'duplicateCopies' | 'itemsOnWeak' | 'carryOneStar' | 'emptySlots' | 'nearBreakpoint'
  /** 짧은 제목 (예: "같은 구성 2등과의 성급 차이") */
  title: string
  /** 수치를 담은 사실 한 줄 — 프롬프트·화면에 그대로 쓴다 */
  fact: string
}

export const KEY_MOMENTS_MAX = 3
/** 1성 기물에 든 완성 아이템이 이 이상이면 장면으로 본다 (여러 판 습관도 같은 기준) */
export const ITEMS_ON_WEAK_MIN = 3

const BREAKPOINTS: Record<string, number[]> = Object.fromEntries(
  Object.values((breakpointData as { traits: Record<string, { name: string; breakpoints: number[] }> }).traits).map(
    (t) => [t.name, t.breakpoints]
  )
)

const slug = (u: SlimMatchUnit) => entitySlug('champion', u.id) || u.name
const isRadiant = (item: string) => item.startsWith('찬란한')

/* ───────── 측정 (장면·여러 판 습관 공용, lib/habits) ───────── */

const twoPlus = (units: SlimMatchUnit[]) => units.filter((u) => (u.tier || 1) >= 2).length

/** 나보다 높은 등수의 같은 구성 상대와 비교해 성급이 낮은 코어 기물 · 2성 수 (차이가 없으면 null) */
export function sameCompGap(m: SlimMatchData) {
  const hit = mostSimilarOpponent(m)
  if (!hit || hit.opponent.placement >= m.placement) return null
  const behind = hit.shared.filter((s) => s.mine < s.theirs)
  const mine2 = twoPlus(m.units)
  const theirs2 = twoPlus(hit.opponent.units)
  if (!behind.length && theirs2 <= mine2) return null
  return { opponent: hit.opponent, shared: hit.shared.length, behind, mine2, theirs2 }
}

/** 최종 보드에 같은 기물 1성을 2장 이상 올린 묶음 */
export function duplicateGroups(m: SlimMatchData): { name: string; count: number }[] {
  const groups = new Map<string, SlimMatchUnit[]>()
  for (const u of m.units.filter((u) => (u.tier || 1) === 1)) groups.set(slug(u), [...(groups.get(slug(u)) || []), u])
  return [...groups.values()].filter((g) => g.length >= 2).map((g) => ({ name: g[0].name, count: g.length }))
}

/** 1성 기물에 든 아이템 (찬란한 아이템 포함) */
export function weakItems(m: SlimMatchData) {
  const units = m.units.filter((u) => (u.tier || 1) === 1 && (u.items?.length || 0) > 0)
  return {
    units,
    count: units.reduce((s, u) => s + u.items.length, 0),
    total: m.units.reduce((s, u) => s + (u.items?.length || 0), 0),
    radiant: units.flatMap((u) => u.items.filter(isRadiant).map((item) => ({ item, unit: u.name }))),
  }
}

/** 아이템 2개+ 든 캐리가 1성이면 그 기물 */
export function oneStarCarry(m: SlimMatchData): SlimMatchUnit | null {
  const carry = boardCarry(m.units)
  return carry && (carry.tier || 1) === 1 && (carry.items?.length || 0) >= 2 ? carry : null
}

export function emptySlotCount(m: SlimMatchData): number {
  return Math.max(0, (m.level || 0) - m.units.length)
}

/** 다음 단계까지 1명 남은 시너지 (1명짜리 고유 시너지 제외) */
export function nearBreakpoints(m: SlimMatchData): { trait: string; count: number; next: number }[] {
  return (m.traits || []).flatMap((t) => {
    const bps = BREAKPOINTS[t.name] || []
    const next = bps.find((b) => b > (t.count || 0))
    return next && next - (t.count || 0) === 1 && (bps[0] ?? 1) > 1 ? [{ trait: t.name, count: t.count || 0, next }] : []
  })
}

/* ───────── 단일 경기 장면 ───────── */

function sameComp(m: SlimMatchData): KeyMoment | null {
  const g = sameCompGap(m)
  if (!g) return null
  const stars = g.behind.length ? `${g.behind.map((s) => `${s.name} ${s.mine}★ vs ${s.theirs}★`).join(', ')} · ` : ''
  return {
    kind: 'sameComp',
    title: `같은 구성 ${g.opponent.placement}등과의 성급 차이`,
    fact: `같은 코어 기물 ${g.shared}개를 쓴 ${g.opponent.placement}등(Lv.${g.opponent.level})과 비교: ${stars}2성 이상 ${g.mine2}개 vs ${g.theirs2}개 (나 ${m.placement}등)`,
  }
}

function duplicateCopies(m: SlimMatchData): KeyMoment | null {
  const dups = duplicateGroups(m)
  if (!dups.length) return null
  return {
    kind: 'duplicateCopies',
    title: '같은 기물 1성을 여러 장 올림',
    // 증강 등으로 생긴 복제일 수 있어 판단은 붙이지 않는다 (사실만)
    fact: `${dups.map((g) => `${g.name} 1성 ${g.count}장`).join(', ')}을 최종 보드에 동시에 올림 (각각 ${dups.map((g) => 3 - g.count).join('·')}장 더 모이면 2성)`,
  }
}

function itemsOnWeak(m: SlimMatchData): KeyMoment | null {
  const w = weakItems(m)
  if (w.count < ITEMS_ON_WEAK_MIN && !w.radiant.length) return null
  return {
    kind: 'itemsOnWeak',
    title: '좋은 아이템이 1성 기물에',
    fact: `아이템 ${w.total}개 중 ${w.count}개가 1성 기물(${w.units.map((u) => `${u.name} ${u.items.length}개`).join(', ')})에 들어감${
      w.radiant.length ? ` · 그중 찬란한 아이템 ${w.radiant.length}개: ${w.radiant.map((r) => `${r.item}(${r.unit})`).join(', ')}` : ''
    }`,
  }
}

function carryOneStar(m: SlimMatchData): KeyMoment | null {
  const carry = oneStarCarry(m)
  if (!carry) return null
  return {
    kind: 'carryOneStar',
    title: '캐리가 1성',
    fact: `아이템 ${carry.items.length}개를 든 캐리 ${carry.name}(${carry.rarity}코스트)이 최종 보드에서 1성`,
  }
}

function emptySlots(m: SlimMatchData): KeyMoment | null {
  const empty = emptySlotCount(m)
  if (empty <= 0) return null
  return { kind: 'emptySlots', title: '보드 빈칸', fact: `Lv.${m.level} 인데 최종 보드 기물 ${m.units.length}개 — ${empty}칸 비움` }
}

function nearBreakpoint(m: SlimMatchData): KeyMoment | null {
  const near = nearBreakpoints(m)
  if (!near.length) return null
  return {
    kind: 'nearBreakpoint',
    title: '1명 모자란 시너지',
    fact: `다음 단계까지 1명 남은 시너지: ${near.map((n) => `${n.trait} ${n.count}명 → ${n.next}명`).join(', ')}`,
  }
}

/** 단일 경기의 핵심 장면 (우선순위 순, 최대 KEY_MOMENTS_MAX 개). 해당 없으면 빈 배열. */
export function keyMoments(m: SlimMatchData): KeyMoment[] {
  if (!m?.units?.length) return []
  return [sameComp, duplicateCopies, itemsOnWeak, carryOneStar, emptySlots, nearBreakpoint]
    .map((f) => f(m))
    .filter((x): x is KeyMoment => Boolean(x))
    .slice(0, KEY_MOMENTS_MAX)
}

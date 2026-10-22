import { traitBreakpointMap } from './gameFacts'
import { entitySlug } from './entitySlug'
import { boardCarry } from './deckType'
import { mostSimilarOpponent } from './similarOpponent'
import { slotsUsed } from './boardSlots'
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
/** 1성 저코스트 기물에 든 완성 아이템이 이 이상이면 장면으로 본다 (여러 판 습관도 같은 기준) */
export const ITEMS_ON_WEAK_MIN = 3
/**
 * '약한 1성'으로 보는 코스트 상한. 4·5코스트 1성은 후반에 BIS 를 몰아주는 게 정상 운영이라
 * (예: 1등 판의 1성 장로 드래곤 무한의 대검·최후의 속삭임) 아이템이 "1성에 묶였다"고 보지 않는다.
 */
export const WEAK_MAX_COST = 3
const isWeakOneStar = (u: SlimMatchUnit) => (u.tier || 1) === 1 && (u.rarity || 1) <= WEAK_MAX_COST

const BREAKPOINTS: Record<string, number[]> = traitBreakpointMap()

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

/** 1성 저코스트(1~3코) 기물에 든 아이템 (찬란한 아이템 포함) */
export function weakItems(m: SlimMatchData) {
  const units = m.units.filter((u) => isWeakOneStar(u) && (u.items?.length || 0) > 0)
  return {
    units,
    count: units.reduce((s, u) => s + u.items.length, 0),
    total: m.units.reduce((s, u) => s + (u.items?.length || 0), 0),
    radiant: units.flatMap((u) => u.items.filter(isRadiant).map((item) => ({ item, unit: u.name }))),
  }
}

/** 아이템 2개+ 든 캐리가 1성 저코스트(1~3코)면 그 기물 (4·5코 1성 캐리는 후반 정상 운영) */
export function oneStarCarry(m: SlimMatchData): SlimMatchUnit | null {
  const carry = boardCarry(m.units)
  return carry && isWeakOneStar(carry) && (carry.items?.length || 0) >= 2 ? carry : null
}

/** 레벨만큼의 칸 중 비운 칸 (장로 드래곤처럼 2칸 차지하는 기물 반영 — lib/boardSlots) */
export function emptySlotCount(m: SlimMatchData): number {
  return Math.max(0, (m.level || 0) - slotsUsed(m.units))
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
    title: '아이템이 1성 저코스트 기물에',
    fact: `아이템 ${w.total}개 중 ${w.count}개가 1성 1~3코스트 기물(${w.units.map((u) => `${u.name} ${u.items.length}개`).join(', ')})에 들어감${
      w.radiant.length ? ` · 그중 찬란한 아이템 ${w.radiant.length}개: ${w.radiant.map((r) => `${r.item}(${r.unit})`).join(', ')}` : ''
    }`,
  }
}

function carryOneStar(m: SlimMatchData): KeyMoment | null {
  const carry = oneStarCarry(m)
  if (!carry) return null
  return {
    kind: 'carryOneStar',
    title: '저코스트 캐리가 1성',
    // 기물 이름 받침에 따라 이/가가 갈리므로 조사 없이 쓴다
    fact: `아이템 ${carry.items.length}개를 든 캐리 ${carry.name}(${carry.rarity}코스트) — 최종 보드에서 1성`,
  }
}

function emptySlots(m: SlimMatchData): KeyMoment | null {
  const empty = emptySlotCount(m)
  if (empty <= 0) return null
  return { kind: 'emptySlots', title: '보드 빈칸', fact: `Lv.${m.level} = 보드 ${m.level}칸 중 ${slotsUsed(m.units)}칸 사용 — ${empty}칸 비움` }
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

/**
 * 상위권 판의 이긴 요인 — 최종 보드에서 코드가 확인한 강점 (단일 경기, 순방 판에만 쓴다).
 * 1등 판 강의가 "문제점 나열"이 되지 않도록, 장면(다듬을 점)보다 먼저 프롬프트에 준다.
 */
export function winFactors(m: SlimMatchData): string[] {
  const out: string[] = []
  const threes = m.units.filter((u) => (u.tier || 1) >= 3)
  if (threes.length) out.push(`3성 ${threes.length}개: ${threes.map((u) => `${u.name}(${u.rarity}코)`).join(', ')}`)
  const deep = (m.traits || []).filter((t) => (t.tier || 0) >= 2).sort((a, b) => (b.tier || 0) - (a.tier || 0) || (b.count || 0) - (a.count || 0))
  if (deep.length) out.push(`높은 단계 시너지: ${deep.map((t) => `${t.name} ${t.count}명(${t.tier}단계)`).join(', ')}`)
  const lobby = (m.lobbyParticipants || []).filter((p) => !p.isUser)
  if (lobby.length) {
    const lobbyTwo = lobby.reduce((s, p) => s + twoPlus(p.units), 0) / lobby.length
    out.push(`2성 이상 ${twoPlus(m.units)}개 (로비 평균 ${Math.round(lobbyTwo * 10) / 10}개) · 최종 레벨 ${m.level}`)
  }
  const contest = m.contestedInfo
  if (contest?.level) out.push(`로비 경합 ${contest.level} (강도 ${contest.contestScore}/100)`)
  return out
}

/** 해당하는 장면 전부 (우선순위 순, 개수 제한 없음) — 규칙 검증(scripts/checkSceneRules)용 */
export function allKeyMoments(m: SlimMatchData): KeyMoment[] {
  if (!m?.units?.length) return []
  return [sameComp, duplicateCopies, itemsOnWeak, carryOneStar, emptySlots, nearBreakpoint]
    .map((f) => f(m))
    .filter((x): x is KeyMoment => Boolean(x))
}

/** 단일 경기의 핵심 장면 (우선순위 순, 최대 KEY_MOMENTS_MAX 개). 해당 없으면 빈 배열. */
export function keyMoments(m: SlimMatchData): KeyMoment[] {
  return allKeyMoments(m).slice(0, KEY_MOMENTS_MAX)
}

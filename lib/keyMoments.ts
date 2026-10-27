import { traitBreakpointMap } from './gameFacts'
import { entitySlug } from './entitySlug'
import { boardCarry } from './deckType'
import { mostSimilarOpponent } from './similarOpponent'
import { isCoreUnit } from './contest'
import { slotsUsed } from './boardSlots'
import { traitAnchors, unitTraitCounts } from './traitAnchors'
import { CARRY_STAR_ODDS_MIN, levelRange, oddsWindow } from './shopOdds'
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
 * '약한 1성'으로 보는 코스트 상한 (아이템이 1성 기물에 든 장면). 4·5코스트 1성은 후반에 BIS 를 몰아주는 게 정상 운영이라
 * (예: 1등 판의 1성 장로 드래곤 무한의 대검·최후의 속삭임) 아이템이 "1성에 묶였다"고 보지 않는다.
 * 캐리 1성 장면은 코스트가 아니라 레벨별 상점 확률로 판단한다 (oneStarCarry · lib/shopOdds).
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

/**
 * 아이템 2개+ 든 캐리가 1성인데, 최종 레벨까지 그 코스트가 상점에 CARRY_STAR_ODDS_MIN% 이상 나온 레벨을 지났으면 그 기물.
 * Set 18 표로 1코스트는 항상 · 3코스트는 Lv.7부터 · 4코스트는 Lv.8부터 해당하고, 5코스트는 Lv.10 까지 해당 없다(정상 운영).
 */
export function oneStarCarry(m: SlimMatchData): SlimMatchUnit | null {
  const carry = boardCarry(m.units)
  if (!carry || (carry.tier || 1) !== 1 || (carry.items?.length || 0) < 2) return null
  return oddsWindow(carry.rarity || 1, m.level) ? carry : null
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

const levelOf = (bps: number[], n: number) => bps.filter((b) => b <= n).length

export interface FillSwap {
  /** 바꿀 1성 기물 */
  name: string
  /** 빼면 내려가는 시너지 (예: "싸움꾼 꺼짐", "달빛 2→1단계"). 비면 공짜 자리 */
  cost: string[]
}

/**
 * 시너지에 1명을 더할 자리 — 빈칸 수와, 바꿀 수 있는 1성 기물(빼면 잃는 것 포함).
 * 제외: 그 시너지에 이미 속한 기물(타릭을 다른 선봉대로 바꿔도 선봉대는 그대로다) · 핵심 시너지를 받치는 기물(lib/traitAnchors).
 * 대부분의 자리는 공짜가 아니라 맞바꿈이다(세트를 빼면 싸움꾼 2가 꺼진다) — 잃는 것을 함께 적어 LLM 이 맞바꿈으로 말하게 한다.
 * 2026-10-23 1등 판에서 "타릭 자리에 선봉대를", "벤치에 남겨둘 것"처럼 채울 수 없는 자리를 권한 오진단을 막는다.
 */
export function fillSpots(m: SlimMatchData, trait: string): { empty: number; swaps: FillSwap[] } {
  const counts = new Map((m.traits || []).map((t) => [t.name, t.count || 0]))
  const anchored = new Set(traitAnchors(m).flatMap((a) => a.units.map((u) => u.name)))
  const seen = new Set<string>()
  const swaps: FillSwap[] = []
  for (const u of m.units || []) {
    if ((u.tier || 1) !== 1 || anchored.has(u.name) || seen.has(u.name)) continue
    const c = unitTraitCounts(u)
    if (c.get(trait)) continue
    seen.add(u.name)
    const cost: string[] = []
    for (const [name, n] of c) {
      const total = counts.get(name)
      const bps = BREAKPOINTS[name] || []
      if (total === undefined) continue
      const before = levelOf(bps, total)
      const after = levelOf(bps, total - n)
      if (after < before) cost.push(after === 0 ? `${name} 꺼짐` : `${name} ${before}→${after}단계`)
    }
    swaps.push({ name: u.name, cost })
  }
  // 공짜 자리부터
  swaps.sort((a, b) => a.cost.length - b.cost.length)
  return { empty: emptySlotCount(m), swaps }
}

/** 1명 모자란 시너지 중 채울 자리가 있는 것만 (자리가 없으면 다음 판 행동으로 바꿀 수 없다) */
export function fillableNearBreakpoints(m: SlimMatchData) {
  return nearBreakpoints(m)
    .map((n) => ({ ...n, spot: fillSpots(m, n.trait) }))
    .filter((n) => n.spot.empty > 0 || n.spot.swaps.length > 0)
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
  const window = carry && oddsWindow(carry.rarity || 1, m.level)
  if (!carry || !window) return null
  return {
    kind: 'carryOneStar',
    title: '캐리가 1성',
    // 기물 이름 받침에 따라 이/가가 갈리므로 조사 없이 쓴다. 상점 확률 구간을 붙여 "올릴 수 있던 코스트"임을 밝힌다
    fact: `아이템 ${carry.items.length}개를 든 캐리 ${carry.name}(${carry.rarity}코스트) — 최종 보드(Lv.${m.level})에서 1성 · ${
      carry.rarity || 1
    }코스트가 상점에 ${CARRY_STAR_ODDS_MIN}% 이상 나오는 레벨(${levelRange(window)})을 지남`,
  }
}

function emptySlots(m: SlimMatchData): KeyMoment | null {
  const empty = emptySlotCount(m)
  if (empty <= 0) return null
  return { kind: 'emptySlots', title: '보드 빈칸', fact: `Lv.${m.level} = 보드 ${m.level}칸 중 ${slotsUsed(m.units)}칸 사용 — ${empty}칸 비움` }
}

// '1명 모자란 시너지'는 단일 경기 장면에서 뺐다 (2026-10-22 정답셋 0/19 맞음 · 래더 보드 같은 레벨 비교 등수 차이 없음).
// 8·9레벨 밸류 덱은 시너지 하나 더 켜는 것보다 5코스트 하나를 더 쓰는 게 낫다. 여러 판 습관(lib/habits)은
// 등수 손해와 같이 나타날 때만(requireHarm) 보이므로 그대로 둔다.
// 다시 장면으로 쓴다면 fillableNearBreakpoints(채울 수 있는 자리 · 빼면 잃는 시너지)로만 말할 것 — 2026-10-23 제보 오진단.

/** 리롤 캐리 = 1~3코스트 3성 캐리. 로비 경합은 이 덱에서만 등수를 가른다 (정답셋: 4·5코 2성 캐리 판의 경합 요인은 모두 틀림) */
export const REROLL_CARRY_MAX_COST = 3

/**
 * 리롤 캐리의 경합 — 같은 기물을 코어(2성+ 또는 아이템 보유)로 쓴 상대 수.
 * 로비 전체 겹침(lib/contest 경합 강도)이 아니라 캐리 하나만 본다: 범용 기물·5코스트 겹침은 판을 가르지 않는다.
 */
export function rerollCarryContest(m: SlimMatchData): { carry: SlimMatchUnit; opponents: number } | null {
  const carry = boardCarry(m.units)
  if (!carry || (carry.tier || 1) < 3 || (carry.rarity || 1) > REROLL_CARRY_MAX_COST) return null
  const key = slug(carry)
  const opponents = (m.lobbyParticipants || []).filter(
    (p) => !p.isUser && (p.units || []).some((u) => slug(u) === key && isCoreUnit(u))
  ).length
  return { carry, opponents }
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
  const contest = rerollCarryContest(m)
  if (contest) {
    const { carry, opponents } = contest
    // 캐리 한 기물의 겹침이다 — 로비 경합 등급(빈집·보통·경합·심각, 경기 카드)과 다른 지표라 등급 이름을 쓰지 않는다.
    // 예전엔 "로비 경합 빈집"이라 써서 카드는 "경합 보통", 리포트는 "빈집"으로 갈렸다 (2026-10-27)
    out.push(`리롤 캐리 겹침: ${carry.name}(${carry.rarity}코 3성)를 코어로 쓴 상대 ${opponents}명`)
  }
  return out
}

/** 해당하는 장면 전부 (우선순위 순, 개수 제한 없음) — 규칙 검증(scripts/checkSceneRules)용 */
export function allKeyMoments(m: SlimMatchData): KeyMoment[] {
  if (!m?.units?.length) return []
  return [sameComp, duplicateCopies, itemsOnWeak, carryOneStar, emptySlots]
    .map((f) => f(m))
    .filter((x): x is KeyMoment => Boolean(x))
}

/** 단일 경기의 핵심 장면 (우선순위 순, 최대 KEY_MOMENTS_MAX 개). 해당 없으면 빈 배열. */
export function keyMoments(m: SlimMatchData): KeyMoment[] {
  return allKeyMoments(m).slice(0, KEY_MOMENTS_MAX)
}

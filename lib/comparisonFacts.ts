import { entitySlug } from './entitySlug'
import { boardCarry, summarizeDeckTypes } from './deckType'
import { scoringSample } from './quality'
import { bestBuildable, componentPool, isCraftable } from './itemRecipes'
import { isCoreUnit } from './contest'
import { boardValue } from './boardValue'
import type { DeckGuide, LobbyParticipant, SlimMatchData, SlimMatchTrait, SlimMatchUnit } from './types'

/**
 * [비교 사실] 블록 — 모델이 계산하지 않아도 되는 비교 수치를 코드가 만든다 (AI-EVAL A2).
 * 모두 서술 통계이며 인과가 아니다. 값이 없거나 유한하지 않은 줄은 생략한다.
 *
 * - single: 로비 1등(내가 1등이면 2등) · 로비 평균(나 제외)과 레벨·3성·시너지 단계 합·아이템 수·보드 가치 비교,
 *           가장 유사한 메타 덱(기물 슬러그 Jaccard ≥ 0.6) 평균등수와 이 경기 등수 + 운영도, BIS 일치율
 * - multi:  경기 간 요약(레벨·3성·아이템 평균과 범위) + 메타 덱 운영도 집계 + 전체 BIS 일치율
 *
 * 메타 덱 운영도: "메타 덱을 탔을 때 그 덱이 원래 내는 성적만큼 굴렸는가" (내 등수 − 메타 덱 평균등수).
 * 점수(metaScore·6축)에는 넣지 않는다. 한 판 등수 편차가 커서 ±1등 안쪽은 '평균 수준'으로 본다.
 *
 * 로비 메타 덱 · 빈집 메타 덱 후보 (single 만): 로비 7명의 최종 보드를 메타 덱으로 분류하고,
 * 아무도 타지 않은 메타 덱 중 내 캐리 아이템의 '재료'로 그 덱 캐리 핵심템을 조합할 수 있었던 덱을 최대 2개 보여 준다.
 * (보드 전체 아이템을 재료로 풀면 거의 모든 덱이 조합 가능해져 의미가 없다 — 실제 픽스처 38판 중 34판)
 * 최종 보드 기준 사후 비교라 "갔어야 했다"가 아니라 후보 사실이다 (피봇 시점·상점 기물 공급은 데이터에 없다).
 *
 * 덱 가이드 (single 만): 내 덱(유사 메타 덱)의 래더 실측 가이드와 내 보드 비교 — 핵심 기물 보유, 내 유동 기물,
 * 캐리 아이템(최종 보드 채용률 순 — 조합 순서 아님), 레벨 분포, 개방성.
 */

/** unit_item 통계 행 (lib/statsShared MetaComboRanking 의 필요한 필드) */
export interface ComboFact {
  champKey: string
  itemName: string
  avgPlacement: number
  sampleSize: number
}

/** 메타 덱 (MetaDeckRanking 의 필요한 필드) */
export interface DeckFact {
  name: string
  avgPlacement: number | null
  sampleSize: number
  units: { key: string; name?: string; cost?: number | null; star?: number; flex?: boolean; items?: { name: string }[] }[]
  /** 대표 캐리 기물 key (없으면 아이템 최다 기물) */
  carryKey?: string | null
  /** 래더 실측 덱 가이드 */
  guide?: DeckGuide
}

export const DECK_SIMILARITY_MIN = 0.6
/** BIS 후보로 쓸 기물×아이템 표본 하한 (MIN_SAMPLE.unit_item) */
export const BIS_MIN_SAMPLE = 20
/** 메타 덱 평균이 이보다 적은 표본이면 "참고용" */
const DECK_REFERENCE_SAMPLE = 30
/** 운영도 판정 여유: 메타 평균과 이 등수 이상 차이 나야 잘/못 굴림 */
export const META_EXECUTION_MARGIN = 1
/** 메타 덱 기물 중 내 보드에 없는 기물을 최대 몇 개 보여 줄까 */
export const MISSING_CORE_MAX = 3
/** 빈집 후보: 최대 개수 · 메타 평균등수 상한 · 내 재료로 조합 가능해야 하는 캐리 핵심템 최소 개수 */
export const OPEN_DECK_MAX = 2
export const OPEN_DECK_MAX_AVG = 4.5
export const OPEN_DECK_MIN_BUILDABLE = 2
/** 개방성 등급: 유동 칸(대표 구성 − 핵심 기물) 이 이하면 낮음 / 이 이상이면 높음 (래더 59개 덱 분포 기준 대략 15% / 37%) */
export const OPENNESS_LOW_MAX = 1
export const OPENNESS_HIGH_MIN = 5

interface BoardStats {
  level: number
  units: number
  threeStars: number
  traitTierSum: number
  items: number
  /** 보드 가치(G) — lib/boardValue */
  value: number
}

function boardStats(b: { level: number; units: SlimMatchUnit[]; traits: SlimMatchTrait[] }): BoardStats {
  return {
    level: b.level,
    units: b.units.length,
    threeStars: b.units.filter((u) => u.tier === 3).length,
    traitTierSum: b.traits.filter((t) => t.tier > 0).reduce((s, t) => s + t.tier, 0),
    items: b.units.reduce((s, u) => s + (u.items?.length || 0), 0),
    value: boardValue(b.units),
  }
}

const fin = (x: number) => Number.isFinite(x)
const r1 = (x: number) => Math.round(x * 10) / 10
const r2 = (x: number) => Math.round(x * 100) / 100
const signed = (x: number, digits = 1) => {
  const v = digits === 2 ? r2(x) : r1(x)
  return `${v > 0 ? '+' : ''}${v}`
}

/** "레벨 -2 (7 vs 9) · 3성 0 vs 4 · 시너지 단계 합 7 vs 9 · 아이템 13 vs 12" */
function compareLine(me: BoardStats, other: BoardStats, digits = 0): string {
  const f = (x: number) => (digits ? r1(x) : x)
  const parts = [
    fin(other.level) ? `레벨 ${signed(me.level - other.level)} (${me.level} vs ${f(other.level)})` : '',
    fin(other.units) ? `기물 수 ${me.units} vs ${f(other.units)}` : '',
    fin(other.threeStars) ? `3성 ${me.threeStars} vs ${f(other.threeStars)}` : '',
    fin(other.traitTierSum) ? `시너지 단계 합 ${me.traitTierSum} vs ${f(other.traitTierSum)}` : '',
    fin(other.items) ? `아이템 ${me.items} vs ${f(other.items)}` : '',
    fin(other.value) ? `보드 가치 ${me.value}G vs ${f(other.value)}G` : '',
  ]
  return parts.filter(Boolean).join(' · ')
}

function lobbyLines(m: SlimMatchData): string[] {
  const lobby = (m.lobbyParticipants || []).filter((p) => !p.isUser)
  if (!lobby.length) return []
  const me = boardStats(m)
  const out: string[] = []
  const targetPlacement = m.placement === 1 ? 2 : 1
  const top = lobby.find((p: LobbyParticipant) => p.placement === targetPlacement)
  if (top) out.push(`- 로비 ${targetPlacement}등과 비교: ${compareLine(me, boardStats(top))}`)
  const stats = lobby.map(boardStats)
  const avg = (k: keyof BoardStats) => stats.reduce((s, x) => s + x[k], 0) / stats.length
  const mean: BoardStats = { level: avg('level'), units: avg('units'), threeStars: avg('threeStars'), traitTierSum: avg('traitTierSum'), items: avg('items'), value: avg('value') }
  out.push(`- 로비 평균(나 제외 ${stats.length}명)과 비교: ${compareLine(me, mean, 1)}`)
  return out
}

function slugSet(keys: string[]): Set<string> {
  return new Set(keys.map((k) => entitySlug('champion', k)).filter(Boolean))
}

/** 가장 유사한 메타 덱 (Jaccard ≥ DECK_SIMILARITY_MIN). 로비 상대 보드에도 쓴다 */
export function mostSimilarDeck(
  m: { units: SlimMatchUnit[] },
  decks: DeckFact[]
): { deck: DeckFact; similarity: number } | null {
  const mine = slugSet(m.units.map((u) => u.id))
  if (!mine.size) return null
  let best: { deck: DeckFact; similarity: number } | null = null
  for (const d of decks) {
    const theirs = slugSet(d.units.map((u) => u.key))
    let inter = 0
    for (const s of mine) if (theirs.has(s)) inter++
    const union = mine.size + theirs.size - inter
    const sim = union ? inter / union : 0
    if (!best || sim > best.similarity) best = { deck: d, similarity: sim }
  }
  return best && best.similarity >= DECK_SIMILARITY_MIN ? best : null
}

export type MetaExecutionVerdict = 'better' | 'even' | 'worse'

const VERDICT_LABEL: Record<MetaExecutionVerdict, string> = {
  better: '메타 평균보다 잘 굴림',
  even: '메타 평균 수준',
  worse: '메타 평균보다 못 굴림',
}

export interface MetaExecution {
  deck: DeckFact
  similarity: number
  /** 내 등수 − 메타 덱 평균등수 (음수 = 메타 평균보다 잘함) */
  delta: number
  verdict: MetaExecutionVerdict
  /** 메타 덱 표본이 DECK_REFERENCE_SAMPLE 이상인가 (집계 평균에는 이것만 쓴다) */
  reliable: boolean
  /** 메타 덱 기물 중 내 보드에 없는 기물 (선택 기물 제외, 코스트 높은 순, 최대 MISSING_CORE_MAX) */
  missingCore: string[]
}

/** 한 경기의 메타 덱 운영도. 유사 메타 덱이 없거나 평균등수가 없으면 null */
export function metaExecution(m: SlimMatchData, decks: DeckFact[]): MetaExecution | null {
  const hit = mostSimilarDeck(m, decks)
  if (!hit || hit.deck.avgPlacement == null || !fin(hit.deck.avgPlacement)) return null
  const d = hit.deck
  const delta = m.placement - (d.avgPlacement as number)
  const verdict: MetaExecutionVerdict =
    delta <= -META_EXECUTION_MARGIN ? 'better' : delta >= META_EXECUTION_MARGIN ? 'worse' : 'even'
  const mine = slugSet(m.units.map((u) => u.id))
  const missingCore = d.units
    .filter((u) => !u.flex && !mine.has(entitySlug('champion', u.key)))
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
    .slice(0, MISSING_CORE_MAX)
    .map((u) => u.name || u.key)
  return { deck: d, similarity: hit.similarity, delta, verdict, reliable: d.sampleSize >= DECK_REFERENCE_SAMPLE, missingCore }
}

function deckLine(m: SlimMatchData, decks: DeckFact[]): string | null {
  const ex = metaExecution(m, decks)
  if (!ex) return null
  const d = ex.deck
  const ref = ex.reliable ? '' : ' · 표본이 적어 참고용'
  const missing = ex.missingCore.length ? ` · 메타 덱 기물 중 내 보드에 없음: ${ex.missingCore.join(', ')}` : ''
  // 메타 덱 기준 보드 가치: 코스트·성급이 모두 있는 덱만 (표준 보드 = 덱 데이터의 성급)
  const priced = d.units.length > 0 && d.units.every((u) => u.cost != null && u.star != null)
  const value = priced
    ? ` · 보드 가치 ${boardValue(m.units)}G vs 메타 덱 ${boardValue(d.units.map((u) => ({ rarity: u.cost, tier: u.star })))}G`
    : ''
  return `- 가장 유사한 메타 덱: ${d.name} (유사도 ${r2(ex.similarity).toFixed(2)}, 표본 ${d.sampleSize}판${ref}) · 메타 평균 ${(
    d.avgPlacement as number
  ).toFixed(2)}등 vs 이 경기 ${m.placement}등 (${signed(ex.delta, 2)}) · 운영도: ${VERDICT_LABEL[ex.verdict]}${missing}${value}`
}

/** 로비 상대(나 제외)가 탄 메타 덱 — 최종 보드 기준 */
export function lobbyDecks(m: SlimMatchData, decks: DeckFact[]): { placement: number; deck: DeckFact | null }[] {
  return (m.lobbyParticipants || [])
    .filter((p) => !p.isUser)
    .sort((a, b) => a.placement - b.placement)
    .map((p) => ({ placement: p.placement, deck: mostSimilarDeck(p, decks)?.deck ?? null }))
}

function lobbyDeckLine(m: SlimMatchData, decks: DeckFact[]): string | null {
  const lobby = lobbyDecks(m, decks)
  if (!lobby.length || !decks.length) return null
  const hits = lobby.filter((x) => x.deck)
  const mine = mostSimilarDeck(m, decks)?.deck
  const parts = [
    ...(mine ? [`나(${m.placement}등) ${mine.name}`] : []),
    ...hits.map((x) => `${x.placement}등 ${x.deck!.name}`),
  ]
  // 아무도 메타 덱과 매칭되지 않으면 정보가 없으므로 줄을 생략한다
  if (!parts.length) return null
  const rest = lobby.length - hits.length
  const tail = rest ? `${parts.length ? ' · ' : ''}나머지 ${rest}명은 메타 덱과 유사도 ${DECK_SIMILARITY_MIN} 미만` : ''
  return `- 로비 메타 덱(최종 보드 기준): ${parts.join(' · ')}${tail}`
}

/** 메타 덱의 캐리 = carryKey, 없으면 아이템 최다 기물 */
function deckCarry(d: DeckFact): DeckFact['units'][number] | undefined {
  return (
    d.units.find((u) => d.carryKey && u.key === d.carryKey) ??
    [...d.units].sort((a, b) => (b.items?.length ?? 0) - (a.items?.length ?? 0))[0]
  )
}

export interface OpenDeckCandidate {
  deck: DeckFact
  carryName: string
  /** 캐리 핵심템 중 조합법이 있는 것 */
  coreItems: string[]
  /** 그중 내 캐리 아이템의 재료로 동시에 조합 가능한 것 */
  buildable: string[]
  /** 재료를 제공한 내 캐리 */
  myCarry: string
}

/**
 * 빈집 메타 덱 후보: 로비 누구도 타지 않았고(덱 매칭 없음 + 그 덱 캐리를 코어로 든 상대 없음 — contest.isCoreUnit),
 * 내 덱도 내 덱의 변형도 아니며
 * (그 덱 캐리가 내 보드에 없음), 표본이 충분하고 메타 평균이 OPEN_DECK_MAX_AVG 이하이고, 그 덱 캐리 핵심템을
 * 내 캐리(아이템 최다 기물) 아이템의 재료로 OPEN_DECK_MIN_BUILDABLE 개 이상 조합할 수 있는 덱.
 * 조합 가능 수 많은 순 → 메타 평균 좋은 순.
 */
export function openDeckCandidates(m: SlimMatchData, decks: DeckFact[]): OpenDeckCandidate[] {
  const opponents = (m.lobbyParticipants || []).filter((p) => !p.isUser)
  if (!opponents.length) return []
  const taken = new Set(lobbyDecks(m, decks).flatMap((x) => (x.deck ? [x.deck.name] : [])))
  const mine = mostSimilarDeck(m, decks)?.deck
  if (mine) taken.add(mine.name)
  // 상대가 코어(contestConfig: 2성+ 또는 아이템 보유)로 든 기물 — 덱 매칭이 안 돼도 그 기물이 캐리인 덱은 빈집이 아니다
  const oppCore = slugSet(opponents.flatMap((p) => p.units.filter(isCoreUnit).map((u) => u.id)))
  const mySlugs = slugSet(m.units.map((u) => u.id))
  const myCarry = boardCarry(m.units)
  if (!myCarry?.items?.length) return []
  const pool = componentPool(myCarry.items)
  const out: OpenDeckCandidate[] = []
  for (const d of decks) {
    if (taken.has(d.name) || d.sampleSize < DECK_REFERENCE_SAMPLE) continue
    if (d.avgPlacement == null || !fin(d.avgPlacement) || d.avgPlacement > OPEN_DECK_MAX_AVG) continue
    const carry = deckCarry(d)
    if (!carry) continue
    const carrySlug = entitySlug('champion', carry.key)
    if (mySlugs.has(carrySlug)) continue
    if (oppCore.has(carrySlug)) continue
    const coreItems = (carry.items || []).map((i) => i.name).filter(isCraftable)
    const buildable = bestBuildable(coreItems, pool)
    if (buildable.length < OPEN_DECK_MIN_BUILDABLE) continue
    out.push({ deck: d, carryName: carry.name || carry.key, coreItems, buildable, myCarry: myCarry.name })
  }
  return out
    .sort((a, b) => b.buildable.length - a.buildable.length || (a.deck.avgPlacement as number) - (b.deck.avgPlacement as number))
    .slice(0, OPEN_DECK_MAX)
}

function openDeckLines(m: SlimMatchData, decks: DeckFact[]): string[] {
  return openDeckCandidates(m, decks).map(
    (c) =>
      `- 빈집 메타 덱 후보(사후 비교): ${c.deck.name} · 로비 0명 · 메타 평균 ${(c.deck.avgPlacement as number).toFixed(
        2
      )}등(표본 ${c.deck.sampleSize}판) · 캐리 ${c.carryName} 핵심템 ${c.buildable.length}/${c.coreItems.length}을 내 캐리(${c.myCarry}) 아이템 재료로 조합 가능(${c.buildable.join(', ')})`
  )
}

export function opennessLabel(flexSlots: number): '낮음' | '보통' | '높음' {
  return flexSlots <= OPENNESS_LOW_MAX ? '낮음' : flexSlots >= OPENNESS_HIGH_MIN ? '높음' : '보통'
}

const pct = (x: number) => Math.round(x * 100)

/** 내 덱(유사 메타 덱)의 래더 가이드와 내 보드 비교 — 가이드가 있는 래더 덱만 */
function guideLines(m: SlimMatchData, decks: DeckFact[]): string[] {
  const hit = mostSimilarDeck(m, decks)
  const g = hit?.deck.guide
  if (!hit || !g) return []
  const d = hit.deck
  const mine = slugSet(m.units.map((u) => u.id))
  const has = (key: string) => mine.has(entitySlug('champion', key))
  const out: string[] = []

  const missing = g.core.filter((u) => !has(u.key))
  const flexUsed = g.flex.filter((u) => has(u.key))
  out.push(
    // 핵심 = 채용 80%+ (scripts/buildDecksFromBoards.js GUIDE_CORE_USAGE). 유동 채용률은 내림해 80%로 보이지 않게 한다
    `- 덱 가이드 기물(래더 ${g.boards}판, ${d.name}): 핵심 기물(채용 80%+) ${g.core.length}개 중 ${g.core.length - missing.length}개 보유${
      missing.length ? ` (없음: ${missing.map((u) => u.name).join(', ')})` : ''
    }${
      flexUsed.length
        ? ` · 내 유동 기물: ${flexUsed.map((u) => `${u.name}(채용 ${Math.floor(u.usage * 100)}%, 썼을 때 평균 ${u.avgPlacement.toFixed(2)}등)`).join(', ')}`
        : ''
    }`
  )

  if (g.carryItems.length) {
    // 내 캐리: 메타 덱 캐리 기물이 내 보드에 있으면 그 기물, 없으면 아이템 최다 기물
    const carrySlug = d.carryKey ? entitySlug('champion', d.carryKey) : ''
    const myCarry = m.units.find((u) => carrySlug && entitySlug('champion', u.id) === carrySlug) ?? boardCarry(m.units)
    const names = new Set(g.carryItems.map((i) => i.name))
    const myItems = myCarry?.items ?? []
    const matched = myItems.filter((n) => names.has(n)).length
    out.push(
      `- 덱 가이드 캐리 아이템(최종 보드 채용률 순, 조합 순서 아님): ${g.carryItems
        .map((i) => `${i.name} ${pct(i.rate)}%(평균 ${i.avgPlacement.toFixed(2)}등)`)
        .join(' · ')}${myCarry && myItems.length ? ` — 내 ${myCarry.name} 아이템 ${matched}/${myItems.length}개가 이 목록에 있음` : ''}`
    )
  }

  const levels = Object.entries(g.levels)
    .filter(([, r]) => r >= 0.05)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([lv, r]) => `${lv} ${pct(r)}%`)
  const o = g.openness
  out.push(
    `- 덱 가이드 운영: 레벨 분포 ${levels.join(' · ')} (나 Lv.${m.level}) · 캐리 3성 ${pct(g.carryThreeStarRate)}% · 개방성 ${opennessLabel(
      o.flexSlots
    )} (유동 칸 ${o.flexSlots}, 같은 캐리 메타 덱 ${o.sharedCarryDecks}개)`
  )
  return out
}

/** 종합: 메타 덱을 탄 판 수 + 표본 충분한 판의 평균 등수 차이와 판정 분포 */
function metaExecutionLine(matches: SlimMatchData[], decks: DeckFact[]): string | null {
  const hits = matches.map((m) => metaExecution(m, decks)).filter((x): x is MetaExecution => x !== null)
  if (!hits.length) return null
  const reliable = hits.filter((h) => h.reliable)
  const weak = hits.length - reliable.length
  const head = `- 메타 덱 운영도: 메타 덱 ${hits.length}/${matches.length}판`
  const tail = weak ? ` · 표본 적은 덱 ${weak}판은 참고용(평균 제외)` : ''
  if (!reliable.length) return `${head}${tail}`
  const mean = reliable.reduce((s, h) => s + h.delta, 0) / reliable.length
  const count = (v: MetaExecutionVerdict) => reliable.filter((h) => h.verdict === v).length
  return `${head} · 표본 충분 ${reliable.length}판 평균 ${signed(mean, 2)}등 (잘 굴림 ${count('better')} · 평균 수준 ${count(
    'even'
  )} · 못 굴림 ${count('worse')})${tail}`
}

/** 기물 슬러그 → BIS 아이템 이름 상위 3개 (표본 ≥ 20, 평균등수 오름차순) */
export function bisBySlug(combos: ComboFact[]): Map<string, string[]> {
  const by = new Map<string, ComboFact[]>()
  for (const c of combos) {
    if (c.sampleSize < BIS_MIN_SAMPLE || !fin(c.avgPlacement)) continue
    const slug = entitySlug('champion', c.champKey)
    if (!by.has(slug)) by.set(slug, [])
    by.get(slug)!.push(c)
  }
  const out = new Map<string, string[]>()
  for (const [slug, list] of by) out.set(slug, [...list].sort((a, b) => a.avgPlacement - b.avgPlacement).slice(0, 3).map((c) => c.itemName))
  return out
}

interface BisResult {
  matched: number
  slots: number
  /** 아이템을 가장 많이 든 기물(캐리)의 대조 */
  carry: { name: string; matched: number; items: { name: string; ok: boolean }[]; bis: string[] } | null
}

export function bisMatch(units: SlimMatchUnit[], bis: Map<string, string[]>): BisResult {
  let matched = 0
  let slots = 0
  let carry: BisResult['carry'] = null
  let carryTier = 0
  for (const u of units) {
    const list = bis.get(entitySlug('champion', u.id))
    if (!list || !u.items?.length) continue
    const items = u.items.map((name) => ({ name, ok: list.includes(name) }))
    const hit = items.filter((x) => x.ok).length
    matched += hit
    slots += items.length
    // 캐리 = 아이템을 가장 많이 든 기물 (같으면 성급 높은 쪽)
    if (!carry || items.length > carry.items.length || (items.length === carry.items.length && u.tier > carryTier)) {
      carry = { name: u.name, matched: hit, items, bis: list }
      carryTier = u.tier
    }
  }
  return { matched, slots, carry }
}

function bisLine(units: SlimMatchUnit[], bis: Map<string, string[]>, scope: string, withCarry: boolean): string | null {
  const res = bisMatch(units, bis)
  if (!res.slots) return null
  const pct = Math.round((res.matched / res.slots) * 100)
  const carry = withCarry && res.carry
    ? `${res.carry.name} ${res.carry.matched}/${res.carry.items.length} (${res.carry.items.map((x) => `${x.name} ${x.ok ? '✓' : '✗'}`).join(', ')}) · `
    : ''
  return `- BIS 일치율: ${carry}${scope} ${res.matched}/${res.slots} (${pct}%) — BIS 통계가 있는 기물의 아이템 기준, 상위 3개(표본 ${BIS_MIN_SAMPLE}판 이상)`
}

function multiLines(matches: SlimMatchData[]): string[] {
  const stats = matches.map(boardStats)
  const span = (k: keyof BoardStats) => {
    const xs = stats.map((s) => s[k])
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    return `${r1(mean)} (${Math.min(...xs)}~${Math.max(...xs)})`
  }
  return [
    `- 경기 간 요약(${matches.length}경기): 등수 ${matches.map((m) => m.placement).join('·')} · 레벨 평균 ${span('level')} · 3성 평균 ${span('threeStars')} · 아이템 평균 ${span('items')} · 보드 가치 평균 ${span('value')}G`,
  ]
}

export function buildComparisonFacts({
  matches,
  mode,
  combos,
  decks,
}: {
  matches: SlimMatchData[]
  mode: 'single' | 'multi'
  combos: ComboFact[]
  decks: DeckFact[]
}): string {
  if (!matches.length) return ''
  const bis = bisBySlug(combos)
  const lines: string[] = []
  if (mode === 'single') {
    const m = matches[0]
    // 덱 유형: 최종 보드의 3성 개수·코스트·레벨로 코드가 판정 (리롤형이면 템포 해석이 달라진다)
    lines.push(`- 덱 유형: ${summarizeDeckTypes([m]).line}`)
    lines.push(...lobbyLines(m))
    const dl = deckLine(m, decks)
    if (dl) lines.push(dl)
    lines.push(...guideLines(m, decks))
    const ll = lobbyDeckLine(m, decks)
    if (ll) lines.push(ll)
    lines.push(...openDeckLines(m, decks))
    const bl = bisLine(m.units, bis, '보드 전체', true)
    if (bl) lines.push(bl)
  } else {
    // 강의 계획(buildCoachingPlan)과 같은 표본 — 초반 종료 판 제외 — 으로 세어야 프롬프트 안 숫자가 일치한다.
    const { sample } = scoringSample(matches)
    lines.push(`- 덱 유형: ${summarizeDeckTypes(sample).line}`)
    lines.push(...multiLines(matches))
    const ml = metaExecutionLine(sample, decks)
    if (ml) lines.push(ml)
    const bl = bisLine(
      matches.flatMap((m) => m.units),
      bis,
      `${matches.length}경기 전체`,
      // 여러 판의 기물이 섞이므로 캐리 한 명 대조는 생략
      false
    )
    if (bl) lines.push(bl)
  }
  const clean = lines.filter((l) => !/NaN|Infinity/.test(l))
  if (!clean.length) return ''
  return ['[비교 사실 — 코드 산출, 서술 통계 (원인이 아니다)]', ...clean].join('\n')
}

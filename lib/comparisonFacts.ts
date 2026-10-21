import { entitySlug } from './entitySlug'
import { summarizeDeckTypes } from './deckType'
import { scoringSample } from './quality'
import type { LobbyParticipant, SlimMatchData, SlimMatchTrait, SlimMatchUnit } from './types'

/**
 * [비교 사실] 블록 — 모델이 계산하지 않아도 되는 비교 수치를 코드가 만든다 (AI-EVAL A2).
 * 모두 서술 통계이며 인과가 아니다. 값이 없거나 유한하지 않은 줄은 생략한다.
 *
 * - single: 로비 1등(내가 1등이면 2등) · 로비 평균(나 제외)과 레벨·3성·시너지 단계 합·아이템 수 비교,
 *           가장 유사한 메타 덱(기물 슬러그 Jaccard ≥ 0.6) 평균등수와 이 경기 등수 + 운영도, BIS 일치율
 * - multi:  경기 간 요약(레벨·3성·아이템 평균과 범위) + 메타 덱 운영도 집계 + 전체 BIS 일치율
 *
 * 메타 덱 운영도: "메타 덱을 탔을 때 그 덱이 원래 내는 성적만큼 굴렸는가" (내 등수 − 메타 덱 평균등수).
 * 점수(metaScore·6축)에는 넣지 않는다. 한 판 등수 편차가 커서 ±1등 안쪽은 '평균 수준'으로 본다.
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
  units: { key: string; name?: string; cost?: number | null; flex?: boolean }[]
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

interface BoardStats {
  level: number
  units: number
  threeStars: number
  traitTierSum: number
  items: number
}

function boardStats(b: { level: number; units: SlimMatchUnit[]; traits: SlimMatchTrait[] }): BoardStats {
  return {
    level: b.level,
    units: b.units.length,
    threeStars: b.units.filter((u) => u.tier === 3).length,
    traitTierSum: b.traits.filter((t) => t.tier > 0).reduce((s, t) => s + t.tier, 0),
    items: b.units.reduce((s, u) => s + (u.items?.length || 0), 0),
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
  const mean: BoardStats = { level: avg('level'), units: avg('units'), threeStars: avg('threeStars'), traitTierSum: avg('traitTierSum'), items: avg('items') }
  out.push(`- 로비 평균(나 제외 ${stats.length}명)과 비교: ${compareLine(me, mean, 1)}`)
  return out
}

function slugSet(keys: string[]): Set<string> {
  return new Set(keys.map((k) => entitySlug('champion', k)).filter(Boolean))
}

/** 가장 유사한 메타 덱 (Jaccard ≥ DECK_SIMILARITY_MIN) */
export function mostSimilarDeck(m: SlimMatchData, decks: DeckFact[]): { deck: DeckFact; similarity: number } | null {
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
  return `- 가장 유사한 메타 덱: ${d.name} (유사도 ${r2(ex.similarity).toFixed(2)}, 표본 ${d.sampleSize}판${ref}) · 메타 평균 ${(
    d.avgPlacement as number
  ).toFixed(2)}등 vs 이 경기 ${m.placement}등 (${signed(ex.delta, 2)}) · 운영도: ${VERDICT_LABEL[ex.verdict]}${missing}`
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
    `- 경기 간 요약(${matches.length}경기): 등수 ${matches.map((m) => m.placement).join('·')} · 레벨 평균 ${span('level')} · 3성 평균 ${span('threeStars')} · 아이템 평균 ${span('items')}`,
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

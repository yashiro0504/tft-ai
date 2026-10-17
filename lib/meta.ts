import metaStatsData from './metaStats.json'
import type { AugmentAnalysis, AugmentMetaDetail } from './types'

/**
 * 증강 메타 통계 조회/분석 (메타 데이터 파이프라인).
 *
 * 데이터 출처:
 *  - lib/metaStats.json (scripts/buildMetaStats.js 로 Riot 매치 표본을 집계해 생성)
 *  - 현재 파일은 sample=true 인 '샘플(검증 전)' 데이터입니다.
 *    sample=true 인 동안 UI/LLM 모두 "실측 통계로 단정 금지"로 처리합니다.
 */

interface AugmentStat {
  avgPlacement: number
  top4Rate?: number
  pickRate?: number
  sampleSize?: number
}

const AUGMENTS = (metaStatsData.augments || {}) as Record<string, AugmentStat>
const BASELINE =
  typeof metaStatsData.baselineAvgPlacement === 'number' ? metaStatsData.baselineAvgPlacement : 4.5

/** 평균 등수 → 티어 (낮을수록 좋음) */
export function tierFromAvgPlacement(avg: number): string {
  if (avg <= 3.95) return 'S'
  if (avg <= 4.15) return 'A'
  if (avg <= 4.4) return 'B'
  if (avg <= 4.65) return 'C'
  return 'D'
}

export interface MetaInfo {
  patch?: string
  source?: string
  sample: boolean
  baselineAvgPlacement: number
  augmentCount: number
}

export function getMetaInfo(): MetaInfo {
  return {
    patch: metaStatsData.patch,
    source: metaStatsData.source,
    sample: Boolean(metaStatsData.sample),
    baselineAvgPlacement: BASELINE,
    augmentCount: Object.keys(AUGMENTS).length,
  }
}

export function getAugmentStat(name: string): (AugmentStat & { tier: string }) | null {
  const stat = AUGMENTS[name]
  if (!stat) return null
  return { ...stat, tier: tierFromAvgPlacement(stat.avgPlacement) }
}

export function hasMetaStats(): boolean {
  return Object.keys(AUGMENTS).length > 0
}

/**
 * 한 경기의 증강 선택을 메타 통계와 대조해 분석한다.
 * 메타가 없으면 hasMeta=false (LLM은 단정 금지).
 */
export function analyzeAugments(augmentNames: string[]): AugmentAnalysis {
  const details: AugmentMetaDetail[] = (augmentNames || []).map((name) => {
    const stat = getAugmentStat(name)
    if (!stat) return { name }
    return {
      name,
      avgPlacement: stat.avgPlacement,
      top4Rate: stat.top4Rate,
      pickRate: stat.pickRate,
      sampleSize: stat.sampleSize,
      tier: stat.tier,
      deltaVsBaseline: Math.round((BASELINE - stat.avgPlacement) * 100) / 100,
    }
  })

  const known = details.filter((d) => typeof d.avgPlacement === 'number')
  const hasMeta = known.length > 0

  let augmentScore: number | undefined
  if (hasMeta) {
    const avg = known.reduce((s, d) => s + (d.avgPlacement as number), 0) / known.length
    // baseline 4.5 기준: 3.5 -> ~90, 4.5 -> 50, 5.5 -> ~10
    augmentScore = Math.round(Math.min(Math.max(50 + (BASELINE - avg) * 40, 0), 100))
  }

  return {
    hasMeta,
    sample: Boolean(metaStatsData.sample),
    patch: metaStatsData.patch,
    source: metaStatsData.source,
    baselineAvgPlacement: BASELINE,
    details,
    augmentScore,
  }
}

/* ------------------------------------------------------------------ */
/* v2 메타 섹션 (챔피언/시너지/아이템/조합) — Phase 4 메타 랭킹 UI용     */
/* ------------------------------------------------------------------ */

interface RawChampStat {
  avgPlacement: number
  top4Rate?: number
  sampleSize: number
  avgTier?: number
  threeStarRate?: number
  prevRank?: number
  rankDelta?: number
  avgDelta?: number
}

interface RawTraitStat {
  avgPlacement: number
  top4Rate?: number
  sampleSize: number
  avgTier?: number
  prevRank?: number
  rankDelta?: number
  avgDelta?: number
}

interface RawItemStat {
  avgPlacement: number
  top4Rate?: number
  sampleSize: number
  prevRank?: number
  rankDelta?: number
  avgDelta?: number
}

const statsAny = metaStatsData as unknown as Record<string, unknown>
const CHAMPS = (statsAny.champions || {}) as Record<string, RawChampStat>
const TRAITS = (statsAny.traits || {}) as Record<string, RawTraitStat>
const ITEMS = (statsAny.items || {}) as Record<string, RawItemStat>
const COMBOS = (statsAny.combos || {}) as Record<string, RawItemStat>

/** 실측 수집된 기물/시너지/아이템/조합 통계가 하나라도 있는가 */
export function hasCompMetaStats(): boolean {
  return (
    Object.keys(CHAMPS).length > 0 ||
    Object.keys(TRAITS).length > 0 ||
    Object.keys(ITEMS).length > 0 ||
    Object.keys(COMBOS).length > 0
  )
}

export interface MetaSectionInfo {
  patch?: string
  source?: string
  generatedAt?: string
  prevGeneratedAt?: string
  sample: boolean
  hasMeta: boolean
}

/** 메타 섹션 기본 정보 (패치/출처/수집 여부) */
export function getMetaSectionInfo(): MetaSectionInfo {
  return {
    patch: typeof statsAny.patch === 'string' ? statsAny.patch : undefined,
    source: typeof statsAny.source === 'string' ? statsAny.source : undefined,
    generatedAt: typeof statsAny.generatedAt === 'string' ? statsAny.generatedAt : undefined,
    prevGeneratedAt:
      typeof statsAny.prevGeneratedAt === 'string' ? statsAny.prevGeneratedAt : undefined,
    sample: Boolean(metaStatsData.sample),
    hasMeta: hasCompMetaStats(),
  }
}

export interface ChampRankingStat {
  key: string
  avgPlacement: number
  top4Rate?: number
  sampleSize: number
  avgTier?: number
  threeStarRate?: number
  prevRank?: number
  rankDelta?: number
  avgDelta?: number
}

export interface TraitRankingStat {
  key: string
  avgPlacement: number
  top4Rate?: number
  sampleSize: number
  avgTier?: number
  prevRank?: number
  rankDelta?: number
  avgDelta?: number
}

export interface ItemRankingStat {
  key: string
  avgPlacement: number
  top4Rate?: number
  sampleSize: number
  prevRank?: number
  rankDelta?: number
  avgDelta?: number
}

/** 평균등수 오름차순(낮을수록 1위)으로 정렬된 기물 랭킹 */
export function getChampionRankings(): ChampRankingStat[] {
  return Object.entries(CHAMPS)
    .filter(([, s]) => typeof s?.avgPlacement === 'number')
    .map(([key, s]) => ({
      key,
      avgPlacement: s.avgPlacement,
      top4Rate: s.top4Rate,
      sampleSize: s.sampleSize,
      avgTier: s.avgTier,
      threeStarRate: s.threeStarRate,
      prevRank: s.prevRank,
      rankDelta: s.rankDelta,
      avgDelta: s.avgDelta,
    }))
    .sort((a, b) => a.avgPlacement - b.avgPlacement)
}

/** 평균등수 오름차순으로 정렬된 시너지 랭킹 (활성 시너지만, 개수는 minGames 하한) */
export function getTraitRankings(minGames = 1): TraitRankingStat[] {
  return Object.entries(TRAITS)
    .filter(([, s]) => typeof s?.avgPlacement === 'number' && (s.sampleSize || 0) >= minGames)
    .map(([key, s]) => ({
      key,
      avgPlacement: s.avgPlacement,
      top4Rate: s.top4Rate,
      sampleSize: s.sampleSize,
      avgTier: s.avgTier,
      prevRank: s.prevRank,
      rankDelta: s.rankDelta,
      avgDelta: s.avgDelta,
    }))
    .sort((a, b) => a.avgPlacement - b.avgPlacement)
}

/** 평균등수 오름차순으로 정렬된 아이템 랭킹 */
export function getItemRankings(): ItemRankingStat[] {
  return Object.entries(ITEMS)
    .filter(([, s]) => typeof s?.avgPlacement === 'number')
    .map(([key, s]) => ({
      key,
      avgPlacement: s.avgPlacement,
      top4Rate: s.top4Rate,
      sampleSize: s.sampleSize,
      prevRank: s.prevRank,
      rankDelta: s.rankDelta,
      avgDelta: s.avgDelta,
    }))
    .sort((a, b) => a.avgPlacement - b.avgPlacement)
}

/** 평균등수 오름차순으로 정렬된 챔피언+아이템 조합(BIS 근거) 랭킹 */
export function getComboRankings(minGames = 3): ItemRankingStat[] {
  return Object.entries(COMBOS)
    .filter(([, s]) => typeof s?.avgPlacement === 'number' && (s.sampleSize || 0) >= minGames)
    .map(([key, s]) => ({
      key,
      avgPlacement: s.avgPlacement,
      top4Rate: s.top4Rate,
      sampleSize: s.sampleSize,
    }))
    .sort((a, b) => a.avgPlacement - b.avgPlacement)
}

export interface CompSetItem {
  /** 원본 조합 키 (`기물|아이템`) */
  key: string
  itemKey: string
  avgPlacement: number
  top4Rate: number
  sampleSize: number
}

export interface CompSetStat {
  champKey: string
  avgPlacement: number
  top4Rate: number
  sampleSize: number
  avgTier?: number
  threeStarRate?: number
  prevRank?: number
  rankDelta?: number
  avgDelta?: number
  /** BIS 아이템 세트 (성적 순) */
  items: CompSetItem[]
}

/**
 * 기물별 BIS 조합 세트 — 메타 "조합" 뷰의 원천 데이터.
 *
 * COMBOS(`기물|아이템`)를 기물 기준으로 묶어, 표본이 충분한 아이템 중
 * 평균등수가 가장 낮은(강한) 순으로 최대 maxItems 개를 뽑는다.
 * 기물 자체 성적(CHAMPS)을 기준으로 정렬해 "조합 티어"로 사용한다.
 */
export function getCompSets(maxItems = 3, minGames = 3): CompSetStat[] {
  const byChamp = new Map<string, CompSetItem[]>()

  for (const [key, s] of Object.entries(COMBOS)) {
    if (typeof s?.avgPlacement !== 'number') continue
    if ((s.sampleSize || 0) < minGames) continue
    const sep = key.indexOf('|')
    if (sep <= 0) continue
    const champKey = key.slice(0, sep)
    const itemKey = key.slice(sep + 1)
    if (!itemKey) continue

    const list = byChamp.get(champKey) || []
    list.push({
      key,
      itemKey,
      avgPlacement: s.avgPlacement,
      top4Rate: s.top4Rate ?? 0,
      sampleSize: s.sampleSize || 0,
    })
    byChamp.set(champKey, list)
  }

  const comps: CompSetStat[] = []
  for (const [champKey, list] of byChamp) {
    const champ = CHAMPS[champKey]
    if (!champ || typeof champ.avgPlacement !== 'number') continue
    const items = [...list].sort((a, b) => a.avgPlacement - b.avgPlacement).slice(0, maxItems)
    comps.push({
      champKey,
      avgPlacement: champ.avgPlacement,
      top4Rate: champ.top4Rate ?? 0,
      sampleSize: champ.sampleSize || 0,
      avgTier: champ.avgTier,
      threeStarRate: champ.threeStarRate,
      prevRank: champ.prevRank,
      rankDelta: champ.rankDelta,
      avgDelta: champ.avgDelta,
      items,
    })
  }

  return comps.sort((a, b) => a.avgPlacement - b.avgPlacement)
}

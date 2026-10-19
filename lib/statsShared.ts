import type {
  MetaChampRanking,
  MetaComboRanking,
  MetaCompRanking,
  MetaDeckRanking,
  MetaItemRanking,
  MetaTraitRanking,
} from './types'

/**
 * 데이터 플랫폼 v2 (Phase B) — 필터·표본 규칙. 서버(API·AI 프롬프트)와 클라이언트(메타 대시보드)가 같이 쓴다.
 * 설계: docs/DATA-PLATFORM.md §6-2
 */

/** 티어 필터 = 그 구간 이상 누적 (master = 마스터+그마+챌) */
export type TierFilter = 'challenger' | 'grandmaster' | 'master' | 'diamond'
/** 최근 N일 (KST 오늘 포함), 0 = 패치 전체 */
export type DaysFilter = 3 | 7 | 0

export const TIER_FILTER_OPTIONS: { id: TierFilter; label: string }[] = [
  { id: 'challenger', label: '챌린저' },
  { id: 'grandmaster', label: '그마+' },
  { id: 'master', label: '마스터+' },
  { id: 'diamond', label: '다이아+' },
]

export const DAYS_FILTER_OPTIONS: { id: DaysFilter; label: string }[] = [
  { id: 3, label: '3일' },
  { id: 7, label: '7일' },
  { id: 0, label: '패치 전체' },
]

export const DEFAULT_TIER: TierFilter = 'master'
export const DEFAULT_DAYS: DaysFilter = 7

/** 티어 필터 → DB tier_bucket 목록 */
export const TIER_BUCKETS: Record<TierFilter, string[]> = {
  challenger: ['CHALLENGER'],
  grandmaster: ['CHALLENGER', 'GRANDMASTER'],
  master: ['CHALLENGER', 'GRANDMASTER', 'MASTER'],
  diamond: ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND'],
}

export type StatType = 'unit' | 'item' | 'trait' | 'unit_item'
export const STAT_TYPES: StatType[] = ['unit', 'item', 'trait', 'unit_item']

/** 표본 하한: 이보다 적으면 "표본 부족" (회색) */
export const MIN_SAMPLE = { unit: 30, item: 30, trait: 30, unit_item: 20, deck: 15 } as const

/** 등수 1~8 균등분포의 표준편차 √(63/12) ≈ 2.29 */
export const PLACEMENT_SD = 2.29

/** 평균등수 표준오차 ≈ 2.29 / √n (n 이 0 이면 null) */
export function placementMargin(n: number): number | null {
  return n > 0 ? Math.round((PLACEMENT_SD / Math.sqrt(n)) * 100) / 100 : null
}

export interface StatFilter {
  /** null = 최신 패치 */
  patch: string | null
  tier: TierFilter
  days: DaysFilter
}

export const DEFAULT_FILTER: StatFilter = { patch: null, tier: DEFAULT_TIER, days: DEFAULT_DAYS }

const PATCH_RE = /^\d{1,2}\.\d{1,2}$/

/** 쿼리스트링 → 필터 (모르는 값은 기본값) */
export function parseStatFilter(params: URLSearchParams): StatFilter {
  const patch = params.get('patch')
  const tier = (params.get('tier') || '').toLowerCase()
  // days 가 없으면 기본 7일 (Number(null) = 0 = 패치 전체 로 읽히지 않게)
  const rawDays = params.get('days')
  const days = rawDays == null || rawDays === '' ? DEFAULT_DAYS : Number(rawDays)
  return {
    patch: patch && PATCH_RE.test(patch) ? patch : null,
    tier: TIER_FILTER_OPTIONS.some((t) => t.id === tier) ? (tier as TierFilter) : DEFAULT_TIER,
    days: days === 3 || days === 7 || days === 0 ? (days as DaysFilter) : DEFAULT_DAYS,
  }
}

export function filterQuery(f: StatFilter): string {
  const q = new URLSearchParams()
  if (f.patch) q.set('patch', f.patch)
  q.set('tier', f.tier)
  q.set('days', String(f.days))
  return q.toString()
}

export function filterLabel(f: { patch?: string | null; tier: TierFilter; days: DaysFilter }): string {
  const tier = TIER_FILTER_OPTIONS.find((t) => t.id === f.tier)?.label ?? f.tier
  const days = DAYS_FILTER_OPTIONS.find((d) => d.id === f.days)?.label ?? `${f.days}일`
  return [f.patch ? `패치 ${f.patch}` : null, tier, days === '패치 전체' ? days : `최근 ${days}`].filter(Boolean).join(' · ')
}

/** 응답 출처: db = Supabase 집계, json = 빌드 타임 JSON 폴백 (필터 미적용) */
export type StatSource = 'db' | 'json'

/** 표본 표시용 공통 필드 (DB·JSON 모두 채운다) */
export interface SampleFields {
  /** 평균등수 ± (2.29/√n) */
  margin?: number | null
  /** 표본 하한 미만 */
  lowSample?: boolean
  winRate?: number
  /** 필터 안 전체 보드 대비 등장 비율 */
  pickRate?: number
}

export type StatRow =
  | (MetaChampRanking & SampleFields)
  | (MetaItemRanking & SampleFields)
  | (MetaTraitRanking & SampleFields)
  | (MetaComboRanking & SampleFields)

export interface StatsResponse<T = StatRow> {
  success: boolean
  source: StatSource
  type: StatType
  /** 실제로 적용된 필터 (json 폴백이면 null) */
  filter: (StatFilter & { patch: string }) | null
  /** 폴백 JSON 의 패치 라벨 (예: set18) */
  patch?: string
  totalBoards?: number
  totalMatches?: number
  minSample: number
  rows: T[]
  /** db 를 쓰지 못한 이유 (운영 확인용) */
  fallbackReason?: string
  error?: string
}

export interface DecksResponse {
  success: boolean
  source: StatSource
  filter: (Omit<StatFilter, 'days'> & { patch: string }) | null
  patch?: string
  totalBoards?: number
  updatedAt?: string
  minSample: number
  decks: (MetaDeckRanking & SampleFields)[]
  fallbackReason?: string
  error?: string
}

export interface MetaFilterPatch {
  patch: string
  firstDate: string
  lastDate: string
  /** 티어 필터별 누적 판 수 (패치 전체) */
  matches: Record<TierFilter, number>
}

export interface MetaFiltersResponse {
  success: boolean
  source: StatSource
  patches: MetaFilterPatch[]
  tiers: typeof TIER_FILTER_OPTIONS
  days: typeof DAYS_FILTER_OPTIONS
  defaults: { patch: string | null; tier: TierFilter; days: DaysFilter }
  minSample: typeof MIN_SAMPLE
  fallbackReason?: string
}

/** 표본 필드 채우기 */
export function withSample<T extends { sampleSize: number }>(row: T, min: number): T & SampleFields {
  return { ...row, margin: placementMargin(row.sampleSize), lowSample: row.sampleSize < min }
}

/**
 * 기물별 BIS 아이템 세트 (lib/meta.ts getCompSets 와 같은 규칙) — 필터 응답에서 클라이언트가 만든다.
 * 기물×아이템 중 표본 minGames 이상에서 평균등수 낮은 순 maxItems 개.
 */
export function buildCompSets(
  champions: MetaChampRanking[],
  combos: MetaComboRanking[],
  maxItems = 3,
  minGames: number = MIN_SAMPLE.unit_item
): MetaCompRanking[] {
  const byChamp = new Map<string, MetaComboRanking[]>()
  for (const c of combos) {
    if (c.sampleSize < minGames) continue
    const list = byChamp.get(c.champKey) || []
    list.push(c)
    byChamp.set(c.champKey, list)
  }
  const out: MetaCompRanking[] = []
  for (const champ of champions) {
    const list = byChamp.get(champ.key)
    if (!list?.length) continue
    out.push({
      key: champ.key,
      name: champ.name,
      imgUrl: champ.imgUrl,
      cost: champ.cost,
      avgPlacement: champ.avgPlacement,
      top4Rate: champ.top4Rate,
      sampleSize: champ.sampleSize,
      avgTier: champ.avgTier,
      threeStarRate: champ.threeStarRate,
      items: [...list]
        .sort((a, b) => a.avgPlacement - b.avgPlacement)
        .slice(0, maxItems)
        .map((c) => ({
          key: c.key,
          name: c.itemName,
          iconUrl: c.itemIconUrl,
          avgPlacement: c.avgPlacement,
          top4Rate: c.top4Rate,
          sampleSize: c.sampleSize,
        })),
    })
  }
  return out.sort((a, b) => a.avgPlacement - b.avgPlacement)
}

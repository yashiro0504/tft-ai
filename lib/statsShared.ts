import type {
  MetaBuildRanking,
  MetaBuildStat,
  MetaChampRanking,
  MetaComboRanking,
  MetaCompRanking,
  MetaDeckRanking,
  MetaItemRanking,
  MetaTraitRanking,
} from './types'
import { entitySlug } from './entitySlug'

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

/** 등수 1~8 균등분포의 표준편차 √(63/12) ≈ 2.29 */
export const PLACEMENT_SD = 2.29

/** 평균등수 오차(±2.29/√n)가 이보다 크면 "표본 부족" — 30판이 ±0.42 */
export const MAX_PLACEMENT_MARGIN = 0.42
const STAT_MIN_GAMES = Math.ceil((PLACEMENT_SD / MAX_PLACEMENT_MARGIN) ** 2)

/**
 * 표본 하한: 이보다 적으면 "표본 부족" (회색 · 상대 티어 제외 · 정렬 맨 아래).
 * 덱·기물·시너지·아이템은 같은 오차 기준(STAT_MIN_GAMES = 30판). 덱만 15판이던 것을 맞췄다 (15판은 ±0.59).
 * unit_item 은 화면 표가 아니라 BIS 후보 아이템을 고르는 하한이다.
 */
export const MIN_SAMPLE = {
  unit: STAT_MIN_GAMES,
  item: STAT_MIN_GAMES,
  trait: STAT_MIN_GAMES,
  deck: STAT_MIN_GAMES,
  unit_item: 20,
} as const

/** 기물×아이템 수치를 그대로 믿을 하한 — 다른 표와 같은 30판(±0.42). BIS 후보(unit_item 20판)부터 이 미만은 '참고용' */
export const BIS_RELIABLE_SAMPLE = MIN_SAMPLE.item

/**
 * BIS·'많이 드는' 목록 정렬: 채용 판 수 많은 순, 같으면 평균등수 낮은 순 (AI BIS 일치율 lib/comparisonFacts bisBySlug 와 같은 규칙).
 * 평균등수 순으로 고르면 표본 작은 비주류 조합이 위로 온다 (buildCompSets 설명 참고).
 */
export function byPickCount(a: { sampleSize: number; avgPlacement: number }, b: { sampleSize: number; avgPlacement: number }): number {
  return b.sampleSize - a.sampleSize || a.avgPlacement - b.avgPlacement
}

/** 집계 기물 키: scripts/buildMetaStats.js normalizeChampId 와 같은 규칙 (metaStats.json 기물 키 · DB api_id → 같은 키) */
export function statChampKey(id: string): string {
  return String(id || '')
    .replace(/^TFT\d*_/i, '')
    .replace(/^DA_\d*_/i, '')
    .replace(/^DA_/i, '')
    .replace(/^TFTTutorial_/i, '')
    .replace(/\d+$/i, '')
    .replace(/Small$/i, '')
    .trim()
}

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
  /** 필터 안 전체 보드 (unit 으로 걸러도 거르기 전 분모) */
  totalBoards?: number
  totalMatches?: number
  minSample: number
  /** type=unit_item&unit= 으로 거른 기물 슬러그 */
  unit?: string
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

/** 기물 빌드(아이템 3개 세트) — 덱처럼 패치 × 티어 필터 단위 하루 1회 집계라 기간 필터가 없다 */
export interface BuildsResponse {
  success: boolean
  source: StatSource
  filter: (Omit<StatFilter, 'days'> & { patch: string }) | null
  updatedAt?: string
  rows: MetaBuildRanking[]
  fallbackReason?: string
  error?: string
}

/**
 * 빌드 세트를 통계 옆에 써도 되는지 — 출처가 같고, DB 경로면 패치까지 같아야 한다.
 * JSON 경로는 metaStats.json(patch 라벨 set18)과 unitBuilds.json(패치 16.x)의 라벨 체계가 달라
 * 직접 비교하지 않는다(둘 다 같은 collect-ladder 실행 산출물).
 */
export function buildsCompatible(
  stats: Pick<StatsResponse, 'source' | 'filter'>,
  builds: BuildsResponse | null
): builds is BuildsResponse {
  if (!builds || builds.source !== stats.source) return false
  if (stats.source !== 'db') return true
  const a = stats.filter?.patch ?? null
  const b = builds.filter?.patch ?? null
  return Boolean(a && b && a === b)
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

/**
 * 기물×아이템 응답을 한 기물로 거른다. 원본(메모 캐시가 들고 있는 객체)은 건드리지 않고 새 객체를 돌려준다.
 * unit 은 화면 슬러그('ahri')·수집 키('Ahri', 'Lux18_Base')·Riot ID('TFT18_Ahri') 모두 같은 기물로 맞춘다.
 * totalBoards 는 거르기 전 분모(필터 안 전체 보드) 그대로다.
 */
export function filterStatsByUnit<T extends StatRow>(res: StatsResponse<T>, unit: string): StatsResponse<T> {
  const u = entitySlug('champion', unit)
  return { ...res, unit: u, rows: res.rows.filter((r) => 'champKey' in r && entitySlug('champion', r.champKey) === u) }
}

/** 표본 필드 채우기 */
export function withSample<T extends { sampleSize: number }>(row: T, min: number): T & SampleFields {
  return { ...row, margin: placementMargin(row.sampleSize), lowSample: row.sampleSize < min }
}

/**
 * 기물별 BIS 아이템 세트 — 메타 BIS 탭·기물 모달. 필터 응답(클라이언트)과 빌드 타임 JSON(lib/metaPayload)이 같이 쓴다.
 * 기물×아이템 중 표본 minGames 이상에서 채용 판 수 많은 순(같으면 평균등수 낮은 순) maxItems 개 —
 * AI BIS 일치율(lib/comparisonFacts bisBySlug)과 같은 규칙이다. 평균등수 순으로 고르면 표본 작은 비주류 아이템이 올라와
 * 주류 빌드가 빠진다 (2026-10-27 럭스: 적응형 투구 31판 2.71등이 쇼진의 창 135판·채용 35%를 밀어냄).
 * 수치는 아이템 1개 단위(이 기물이 그 아이템을 든 판)다 — 3개를 함께 든 판의 성적은 집계에 없다.
 */
export function buildCompSets(
  champions: MetaChampRanking[],
  combos: MetaComboRanking[],
  /** 기물 빌드(lib/unitBuilds). 없거나 비었으면 builds·bisSet 을 붙이지 않는다 — '함께 든 판 적음'으로 잘못 보이지 않게 */
  builds?: MetaBuildRanking[],
  maxItems = 3,
  minGames: number = MIN_SAMPLE.unit_item
): MetaCompRanking[] {
  const byChamp = new Map<string, MetaComboRanking[]>()
  /** 기물|아이템 → 든 판 수 (하한 없이 — 세트 안 아이템 순서용) */
  const itemGames = new Map<string, number>()
  for (const c of combos) {
    itemGames.set(`${c.champKey}|${c.itemKey}`, c.sampleSize)
    if (c.sampleSize < minGames) continue
    const list = byChamp.get(c.champKey) || []
    list.push(c)
    byChamp.set(c.champKey, list)
  }
  const buildsByChamp = builds?.length ? new Map<string, MetaBuildRanking[]>() : null
  if (buildsByChamp) {
    for (const b of builds ?? []) {
      const list = buildsByChamp.get(b.champKey) || []
      list.push(b)
      buildsByChamp.set(b.champKey, list)
    }
  }
  const out: MetaCompRanking[] = []
  for (const champ of champions) {
    const list = byChamp.get(champ.key)
    if (!list?.length) continue
    const top = [...list].sort(byPickCount).slice(0, maxItems)
    const champBuilds = buildsByChamp ? [...(buildsByChamp.get(champ.key) ?? [])].sort(byPickCount) : null
    // 세트 안 아이템은 이 기물에서 많이 드는 아이템부터 (키는 정렬돼 있어 순서가 뜻이 없다)
    const toStat = (b: MetaBuildRanking): MetaBuildStat => ({
      key: b.key,
      items: b.items
        .map((it, i) => ({ it, n: itemGames.get(`${champ.key}|${b.itemKeys[i]}`) ?? 0 }))
        .sort((x, y) => y.n - x.n)
        .map((x) => x.it),
      avgPlacement: b.avgPlacement,
      top4Rate: b.top4Rate,
      sampleSize: b.sampleSize,
      pickRate: b.pickRate,
    })
    const bisKey = top.length === 3 ? top.map((c) => c.itemKey).sort().join(',') : null
    const bisSet = champBuilds && bisKey ? champBuilds.find((b) => b.itemKeys.join(',') === bisKey) : undefined
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
      prevRank: champ.prevRank,
      rankDelta: champ.rankDelta,
      avgDelta: champ.avgDelta,
      items: top.map((c) => ({
        key: c.key,
        name: c.itemName,
        iconUrl: c.itemIconUrl,
        avgPlacement: c.avgPlacement,
        top4Rate: c.top4Rate,
        sampleSize: c.sampleSize,
        // 같은 아이템 2개를 든 기물은 2번 세므로(scripts/collect/rollup.js) 100% 를 넘지 않게 자른다
        pickRate: champ.sampleSize > 0 ? Math.min(1, c.sampleSize / champ.sampleSize) : 0,
      })),
      ...(champBuilds
        ? { builds: champBuilds.slice(0, 3).map(toStat), ...(bisKey ? { bisSet: bisSet ? toStat(bisSet) : null } : {}) }
        : {}),
    })
  }
  return out.sort((a, b) => a.avgPlacement - b.avgPlacement)
}

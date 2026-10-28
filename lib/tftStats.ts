import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './supabase/config'
import { getChampionCost, translateChampion, translateItem, translateTrait } from './constants'
import { buildMetaPayload, toMetaDeck } from './metaPayload'
import { deckViewsFromRaw, getDeckViews, type DeckView } from './decks'
import { JSON_BUILDS_INFO, jsonBuildRankings, toBuildRankings, type UnitBuildRow } from './unitBuilds'
import { elapsedMs, errorFields, incrMetric, logEvent } from './observability'
import { cacheGet, cacheSet } from './cache'
import type { MetaChampRanking, MetaComboRanking, MetaItemRanking, MetaTraitRanking } from './types'
import {
  DAYS_FILTER_OPTIONS,
  DEFAULT_DAYS,
  DEFAULT_TIER,
  MIN_SAMPLE,
  STAT_TYPES,
  TIER_BUCKETS,
  TIER_FILTER_OPTIONS,
  placementMargin,
  statChampKey,
  withSample,
  type BuildsResponse,
  type DecksResponse,
  type MetaFilterPatch,
  type MetaFiltersResponse,
  type StatFilter,
  type StatRow,
  type StatSource,
  type StatType,
  type StatsResponse,
  type TierFilter,
} from './statsShared'

/**
 * 데이터 플랫폼 v2 (Phase B) — Supabase 일별 집계 읽기 (서버 전용).
 *
 * 읽는 것: supabase/migrations/0006_tft_rollups.sql 의 공개 RPC(tft_stat_query · tft_stat_filters)와 stat_comp.
 * anon 키로 읽는다 (집계는 공개 select, 원본 보드는 RLS 로 막혀 있다).
 *
 * DB 가 설정되지 않았거나(로컬·CI), 0006 이 아직 적용되지 않았거나, 집계가 비었거나, 느리면
 * 기존 빌드 타임 JSON(lib/metaStats.json · lib/decksData.json)으로 폴백한다. 응답의 source 로 구분한다.
 */

const DB_TIMEOUT_MS = (() => {
  const n = Number(process.env.STATS_DB_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : 3000
})()
/** 웜 인스턴스 메모 (CDN s-maxage=600 앞단) */
const MEMO_TTL_MS = 5 * 60_000
/** 기물×아이템은 행이 많아(기물 × 아이템) 이보다 적은 조합은 응답에서 뺀다 */
const UNIT_ITEM_MIN_ROWS = 5
/**
 * 최신 패치의 기본 티어(마스터+) 판 수가 이보다 적으면 DB 대신 빌드 타임 JSON 을 쓴다.
 * 2026-10-22 수집 시작 직후 23판으로 메타·AI 비교 통계가 바뀌었다 (워윅 3판 평균 3.0등이 1위).
 * JSON 은 래더 약 1천 판 — 수집기 시간당 최대 200판이면 몇 시간 뒤 자동으로 DB 로 넘어간다.
 */
const DB_MIN_MATCHES = (() => {
  const n = Number(process.env.STATS_DB_MIN_MATCHES)
  return Number.isFinite(n) && n >= 0 ? n : 500
})()

let client: SupabaseClient | null | undefined
function db(): SupabaseClient | null {
  if (client === undefined) {
    client =
      isSupabaseConfigured() && process.env.TFT_STATS_SOURCE !== 'json'
        ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
        : null
  }
  return client
}

const memo = new Map<string, { value: unknown; expiresAt: number }>()
/** DB 장애 네거티브 캐시: 키 → 다시 DB 를 시도해도 되는 시각 (값은 저장하지 않는다) */
const failMemo = new Map<string, number>()
/** DB 장애 중 요청마다 DB_TIMEOUT_MS 를 기다리지 않게 이 시간 동안은 바로 폴백한다 */
const FAIL_TTL_MS = 20_000

/**
 * db 응답만 MEMO_TTL_MS 캐시한다. DB 오류(db_error)면 실패 시각만 남겨 FAIL_TTL_MS 동안 fallback 을 바로 돌려주고,
 * 그 뒤 첫 요청에서 다시 DB 를 시도한다.
 */
async function memoized<T extends { source: StatSource; fallbackReason?: string }>(
  key: string,
  fn: () => Promise<T>,
  fallback: (reason: string) => T
): Promise<T> {
  const hit = memo.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.value as T
  const retryAt = failMemo.get(key)
  if (retryAt && retryAt > Date.now()) {
    incrMetric('stats.fallback_cooldown')
    return fallback('db_error')
  }
  const value = await fn()
  if (value.source === 'db') {
    memo.set(key, { value, expiresAt: Date.now() + MEMO_TTL_MS })
    failMemo.delete(key)
  } else if (value.fallbackReason === 'db_error') {
    failMemo.set(key, Date.now() + FAIL_TTL_MS)
  }
  return value
}

class NoDbError extends Error {}

async function withTimeout<T>(run: (signal: AbortSignal) => PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), DB_TIMEOUT_MS)
  try {
    const { data, error } = await run(ctrl.signal)
    if (error) throw new Error(error.message)
    return data as T
  } finally {
    clearTimeout(timer)
  }
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const c = db()
  if (!c) throw new NoDbError('supabase_not_configured')
  return (await withTimeout<T[]>((signal) => c.rpc(fn, args).abortSignal(signal))) ?? []
}

/**
 * PostgREST 는 한 응답을 max-rows(Supabase 기본 1000)에서 자른다. tft_stat_query 는 정렬이 없어서
 * 기물×아이템(1천 행 이상)이 임의의 1천 행만 왔다 (2026-10-26). 키 순으로 정렬해 끝까지 페이지로 받는다.
 * 페이지 크기는 max-rows 이하여야 "덜 왔다 = 마지막 페이지" 판정이 맞다.
 */
const RPC_PAGE_SIZE = (() => {
  const n = Number(process.env.STATS_RPC_PAGE_SIZE)
  return Number.isInteger(n) && n > 0 ? n : 1000
})()
const RPC_MAX_PAGES = 20

async function rpcAll<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const c = db()
  if (!c) throw new NoDbError('supabase_not_configured')
  const out: T[] = []
  for (let page = 0; page < RPC_MAX_PAGES; page++) {
    const from = page * RPC_PAGE_SIZE
    const rows =
      (await withTimeout<T[]>((signal) =>
        c.rpc(fn, args).order('key1').order('key2').range(from, from + RPC_PAGE_SIZE - 1).abortSignal(signal)
      )) ?? []
    out.push(...rows)
    if (rows.length < RPC_PAGE_SIZE) return out
  }
  logEvent('warn', 'stats_rpc_page_cap', { fn, rows: out.length })
  return out
}

function fallbackReason(err: unknown): string {
  if (err instanceof NoDbError) return err.message
  return 'db_error'
}

const r2 = (x: number) => Math.round(x * 100) / 100
const r3 = (x: number) => Math.round(x * 1000) / 1000

/** 기물 키 정규화 — 빌드 집계(lib/unitBuilds)도 같이 써서 lib/statsShared 로 옮겼다 (예전 import 경로 유지) */
export { statChampKey }

/* ------------------------------------------------------------------ */
/* 필터 목록                                                            */
/* ------------------------------------------------------------------ */

interface FilterRow {
  patch: string
  tier_bucket: string
  matches: number | string
  first_date: string
  last_date: string
}

const jsonFilters = (reason: string): MetaFiltersResponse => ({
  success: true,
  source: 'json',
  patches: [],
  tiers: TIER_FILTER_OPTIONS,
  days: DAYS_FILTER_OPTIONS,
  defaults: { patch: null, tier: DEFAULT_TIER, days: DEFAULT_DAYS },
  minSample: MIN_SAMPLE,
  fallbackReason: reason,
})

/** 사용 가능한 패치(최신순) · 티어 필터별 판 수 */
export async function getMetaFilters(): Promise<MetaFiltersResponse> {
  return memoized(
    'filters',
    async () => {
      try {
        const rows = await rpc<FilterRow>('tft_stat_filters', {})
        const byPatch = new Map<string, MetaFilterPatch>()
        for (const r of rows) {
          const p =
            byPatch.get(r.patch) ||
            ({
              patch: r.patch,
              firstDate: r.first_date,
              lastDate: r.last_date,
              matches: { challenger: 0, grandmaster: 0, master: 0, diamond: 0 },
            } satisfies MetaFilterPatch)
          if (r.first_date < p.firstDate) p.firstDate = r.first_date
          if (r.last_date > p.lastDate) p.lastDate = r.last_date
          for (const t of TIER_FILTER_OPTIONS) {
            if (TIER_BUCKETS[t.id].includes(r.tier_bucket)) p.matches[t.id] += Number(r.matches) || 0
          }
          byPatch.set(r.patch, p)
        }
        const patches = [...byPatch.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.patch.localeCompare(a.patch))
        if (!patches.length) return jsonFilters('empty')
        if ((patches[0].matches[DEFAULT_TIER] || 0) < DB_MIN_MATCHES) return jsonFilters('small_sample')
        return {
          success: true,
          source: 'db',
          patches,
          tiers: TIER_FILTER_OPTIONS,
          days: DAYS_FILTER_OPTIONS,
          defaults: { patch: patches[0].patch, tier: DEFAULT_TIER, days: DEFAULT_DAYS },
          minSample: MIN_SAMPLE,
        } satisfies MetaFiltersResponse
      } catch (err) {
        const reason = fallbackReason(err)
        if (reason === 'db_error') logEvent('warn', 'stats_filters_db_failed', errorFields(err))
        return jsonFilters(reason)
      }
    },
    jsonFilters
  )
}

/** 요청 패치가 집계에 없으면 최신 패치 */
function resolvePatch(filters: MetaFiltersResponse, patch: string | null): string | null {
  if (patch && filters.patches.some((p) => p.patch === patch)) return patch
  return filters.patches[0]?.patch ?? null
}

/* ------------------------------------------------------------------ */
/* 기물 · 아이템 · 시너지 · 기물×아이템                                    */
/* ------------------------------------------------------------------ */

interface QueryRow {
  key1: string | null
  key2: string | null
  games: number | string | null
  placement_sum: number | string | null
  top4: number | string | null
  wins: number | string | null
  extra1: number | string | null
  extra2: number | string | null
}

interface Acc {
  games: number
  placementSum: number
  top4: number
  wins: number
  extra1: number
  extra2: number
}

/** 같은 화면 키로 합친다 (예: TFT18_Gnar · TFT18_GnarSmall → Gnar) */
function accumulate(rows: QueryRow[], keyOf: (r: QueryRow) => string | null): Map<string, Acc> {
  const out = new Map<string, Acc>()
  for (const r of rows) {
    const key = keyOf(r)
    if (!key) continue
    const e = out.get(key) || { games: 0, placementSum: 0, top4: 0, wins: 0, extra1: 0, extra2: 0 }
    e.games += Number(r.games) || 0
    e.placementSum += Number(r.placement_sum) || 0
    e.top4 += Number(r.top4) || 0
    e.wins += Number(r.wins) || 0
    e.extra1 += Number(r.extra1) || 0
    e.extra2 += Number(r.extra2) || 0
    out.set(key, e)
  }
  return out
}

function baseFields(a: Acc, totalBoards: number, min: number) {
  return {
    avgPlacement: r2(a.placementSum / a.games),
    top4Rate: r3(a.top4 / a.games),
    sampleSize: a.games,
    winRate: r3(a.wins / a.games),
    pickRate: totalBoards > 0 ? r3(a.games / totalBoards) : undefined,
    margin: placementMargin(a.games),
    lowSample: a.games < min,
  }
}

function mapRows(type: StatType, rows: QueryRow[], totalBoards: number): StatRow[] {
  const min = MIN_SAMPLE[type]
  const byAvg = (a: { avgPlacement: number }, b: { avgPlacement: number }) => a.avgPlacement - b.avgPlacement
  if (type === 'unit') {
    return [...accumulate(rows, (r) => (r.key1 ? statChampKey(r.key1) : null)).entries()]
      .filter(([, a]) => a.games > 0)
      .map(([key, a]): MetaChampRanking & ReturnType<typeof baseFields> => {
        const t = translateChampion(key)
        return {
          key,
          name: t.name,
          imgUrl: t.imgUrl,
          cost: getChampionCost(key),
          ...baseFields(a, totalBoards, min),
          avgTier: r2(a.extra1 / a.games),
          threeStarRate: r3(a.extra2 / a.games),
        }
      })
      .sort(byAvg)
  }
  if (type === 'trait') {
    return [...accumulate(rows, (r) => r.key1).entries()]
      .filter(([, a]) => a.games > 0)
      .map(([key, a]): MetaTraitRanking & ReturnType<typeof baseFields> => {
        const t = translateTrait(key)
        return { key, name: t.name, iconUrl: t.iconUrl, ...baseFields(a, totalBoards, min), avgTier: r2(a.extra1 / a.games) }
      })
      .sort(byAvg)
  }
  if (type === 'item') {
    return [...accumulate(rows, (r) => r.key1).entries()]
      .filter(([, a]) => a.games > 0)
      .map(([key, a]): MetaItemRanking & ReturnType<typeof baseFields> => {
        const t = translateItem(key)
        return { key, name: t.name, iconUrl: t.iconUrl, ...baseFields(a, totalBoards, min) }
      })
      .sort(byAvg)
  }
  return [...accumulate(rows, (r) => (r.key1 && r.key2 ? `${statChampKey(r.key1)}|${r.key2}` : null)).entries()]
    .filter(([, a]) => a.games > 0)
    .map(([key, a]): MetaComboRanking & ReturnType<typeof baseFields> => {
      const sep = key.indexOf('|')
      const champKey = key.slice(0, sep)
      const itemKey = key.slice(sep + 1)
      const c = translateChampion(champKey)
      const it = translateItem(itemKey)
      return {
        key,
        champKey,
        itemKey,
        champName: c.name,
        champImgUrl: c.imgUrl,
        itemName: it.name,
        itemIconUrl: it.iconUrl,
        ...baseFields(a, totalBoards, min),
      }
    })
    .sort(byAvg)
}

/** JSON 폴백 (필터 미적용, 기존 /api/tft/meta 와 같은 수치) */
function jsonStats(type: StatType, reason: string): StatsResponse {
  const p = buildMetaPayload()
  const min = MIN_SAMPLE[type]
  const rows: StatRow[] =
    type === 'unit'
      ? p.champions.map((r) => withSample(r, min))
      : type === 'item'
        ? p.items.map((r) => withSample(r, min))
        : type === 'trait'
          ? p.traits.map((r) => withSample(r, min))
          : p.combos.map((r) => withSample(r, min))
  return { success: true, source: 'json', type, filter: null, patch: p.patch, minSample: min, rows, fallbackReason: reason }
}

export function isStatType(v: string | null): v is StatType {
  return STAT_TYPES.includes(v as StatType)
}

const tierArg = (t: TierFilter) => t.toUpperCase()

/**
 * 기물·아이템·시너지·기물×아이템 통계 (필터 적용).
 * 집계가 없거나 DB 를 쓸 수 없으면 JSON 폴백.
 */
export async function getStats(type: StatType, filter: StatFilter): Promise<StatsResponse> {
  const filters = await getMetaFilters()
  if (filters.source !== 'db') return jsonStats(type, filters.fallbackReason || 'no_db')
  const patch = resolvePatch(filters, filter.patch)
  if (!patch) return jsonStats(type, 'empty')
  const applied = { patch, tier: filter.tier, days: filter.days }
  return memoized(
    `stats:${type}:${patch}:${filter.tier}:${filter.days}`,
    async () => {
      const startedAt = Date.now()
      try {
        const args = {
          p_patch: patch,
          p_tier_min: tierArg(filter.tier),
          p_days: filter.days,
          p_min_games: type === 'unit_item' ? UNIT_ITEM_MIN_ROWS : 1,
        }
        const [rows, total] = await Promise.all([
          rpcAll<QueryRow>('tft_stat_query', { p_type: type, ...args }),
          rpc<QueryRow>('tft_stat_query', { p_type: 'total', ...args }),
        ])
        const totalBoards = Number(total[0]?.games) || 0
        incrMetric('stats.db')
        logEvent('info', 'stats_db', { type, patch, tier: filter.tier, days: filter.days, rows: rows.length, ms: elapsedMs(startedAt) })
        return {
          success: true,
          source: 'db',
          type,
          filter: applied,
          totalBoards,
          totalMatches: Number(total[0]?.extra1) || 0,
          minSample: MIN_SAMPLE[type],
          rows: mapRows(type, rows, totalBoards),
        } satisfies StatsResponse
      } catch (err) {
        incrMetric('stats.fallback')
        logEvent('warn', 'stats_db_failed', { type, ms: elapsedMs(startedAt), ...errorFields(err) })
        return jsonStats(type, fallbackReason(err))
      }
    },
    (reason) => jsonStats(type, reason)
  )
}

/* ------------------------------------------------------------------ */
/* 덱                                                                  */
/* ------------------------------------------------------------------ */

function jsonDecks(reason: string, withGuide = false): DecksResponse {
  const p = buildMetaPayload()
  // 공개 payload 덱에는 guide 가 없다 → AI 경로는 덱 뷰에서 guide 포함으로 다시 만든다
  const decks = withGuide ? getDeckViews().map((d) => toMetaDeck(d, { withGuide: true })) : p.decks
  return {
    success: true,
    source: 'json',
    filter: null,
    patch: p.patch,
    // 빌드 시각이 아니라 원본 래더 보드 수집 시각
    updatedAt: p.deckMeta?.sourceUpdatedAt,
    totalMatches: p.deckMeta?.matchCount,
    minSample: MIN_SAMPLE.deck,
    decks: decks.map((d) => withSample(d, MIN_SAMPLE.deck)),
    fallbackReason: reason,
  }
}

interface CompRow {
  deck: unknown
  total_boards: number
  updated_at: string
}

/**
 * 덱 티어표 (패치 × 티어 필터, 기간 없음 — 수집기가 하루 1회 패치 전체로 묶는다).
 * 기본 필터(마스터+)에 덱이 하나도 없으면(첫 덱 잡 전) JSON 폴백, 다른 필터는 빈 목록을 그대로 돌려준다.
 * opts.withGuide: 래더 덱 가이드 포함 (AI 프롬프트 전용 — 공개 응답에는 넣지 않는다)
 */
export async function getDecks(
  filter: Pick<StatFilter, 'patch' | 'tier'>,
  opts: { withGuide?: boolean } = {}
): Promise<DecksResponse> {
  const withGuide = Boolean(opts.withGuide)
  const fallback = (reason: string) => jsonDecks(reason, withGuide)
  const filters = await getMetaFilters()
  if (filters.source !== 'db') return fallback(filters.fallbackReason || 'no_db')
  const patch = resolvePatch(filters, filter.patch)
  const c = db()
  if (!patch || !c) return fallback('empty')
  return memoized(
    `decks:${patch}:${filter.tier}${withGuide ? ':guide' : ''}`,
    async () => {
      try {
        const rows = await withTimeout<CompRow[]>((signal) =>
          c.from('stat_comp').select('deck, total_boards, updated_at').eq('patch', patch).eq('tier_min', tierArg(filter.tier)).abortSignal(signal)
        )
        if (!rows?.length && filter.tier === DEFAULT_TIER) return fallback('empty')
        const decks = deckViewsFromRaw((rows ?? []).map((r) => r.deck))
          .map((d) => toMetaDeck(d, { withGuide }))
          .map((d) => withSample(d, MIN_SAMPLE.deck))
        const updatedAt = (rows ?? []).reduce<string | undefined>((m, r) => (!m || r.updated_at > m ? r.updated_at : m), undefined)
        return {
          success: true,
          source: 'db',
          filter: { patch, tier: filter.tier },
          totalBoards: rows?.[0]?.total_boards,
          totalMatches: filters.patches.find((p) => p.patch === patch)?.matches[filter.tier],
          updatedAt,
          minSample: MIN_SAMPLE.deck,
          decks,
        } satisfies DecksResponse
      } catch (err) {
        logEvent('warn', 'decks_db_failed', errorFields(err))
        return fallback(fallbackReason(err))
      }
    },
    fallback
  )
}

/** 메타 덱 스냅샷 공유 캐시 (Redis L2) — 인스턴스마다 DB·폴백 결과가 달라 두 화면 값이 갈리지 않게 */
const SNAPSHOT_KEY = 'meta-deck-snapshot:v2'
const SNAPSHOT_TTL_MS = 5 * 60_000
const SNAPSHOT_FALLBACK_TTL_MS = 60_000

/**
 * 메타 랭킹 덱 탭 첫 화면(app/meta)과 내 덱 성적표(lib/deckReport)가 같이 쓰는 스냅샷 — 기본 필터(최신 패치 · 기본 티어).
 * 2026-10-28: 성적표는 DB 집계(10.27), 메타 페이지는 래더 JSON(10.28 09:29)을 보여 같은 덱 평균이 달랐다.
 * 두 화면 모두 이 함수만 부르고, 결과는 인스턴스 간 공유 캐시에 두어 갱신 시 같이 바뀐다.
 */
export async function getMetaDeckSnapshot(): Promise<DecksResponse> {
  const cached = await cacheGet<DecksResponse>(SNAPSHOT_KEY)
  if (cached?.decks?.length) return cached
  const filters = await getMetaFilters()
  const res = await getDecks({ patch: filters.source === 'db' ? filters.defaults.patch : null, tier: filters.defaults?.tier ?? DEFAULT_TIER })
  if (res.decks?.length) await cacheSet(SNAPSHOT_KEY, res, res.source === 'db' ? SNAPSHOT_TTL_MS : SNAPSHOT_FALLBACK_TTL_MS)
  return res
}

/* ------------------------------------------------------------------ */
/* 기물 빌드 (아이템 3개 세트 — 메타 BIS 탭)                             */
/* ------------------------------------------------------------------ */

function jsonBuilds(reason: string): BuildsResponse {
  return { success: true, source: 'json', filter: null, updatedAt: JSON_BUILDS_INFO.updatedAt, rows: jsonBuildRankings(), fallbackReason: reason }
}

/**
 * 기물 빌드 — 수집기가 덱 클러스터와 같이 하루 1회 패치 × 티어 필터별로 만든 stat_unit_build (기간 필터 없음).
 * DB 를 쓸 수 없거나 0008 이 아직 적용되지 않았으면 JSON(lib/unitBuilds.json). 화면은 통계와 출처가 같을 때만 쓴다
 * (DB 기물×아이템 옆에 래더 스냅샷 세트를 섞지 않게).
 */
export async function getBuilds(filter: Pick<StatFilter, 'patch' | 'tier'>): Promise<BuildsResponse> {
  const filters = await getMetaFilters()
  if (filters.source !== 'db') return jsonBuilds(filters.fallbackReason || 'no_db')
  const patch = resolvePatch(filters, filter.patch)
  const c = db()
  if (!patch || !c) return jsonBuilds('empty')
  return memoized(
    `builds:${patch}:${filter.tier}`,
    async () => {
      try {
        // 기물 100종 × 상위 10개면 PostgREST 한 응답 상한(1천 행)에 걸린다 — rpcAll 처럼 페이지로 끝까지
        const rows: (UnitBuildRow & { updated_at: string })[] = []
        for (let page = 0; page < RPC_MAX_PAGES; page++) {
          const from = page * RPC_PAGE_SIZE
          const got =
            (await withTimeout<(UnitBuildRow & { updated_at: string })[]>((signal) =>
              c
                .from('stat_unit_build')
                .select('unit, items, games, placement_sum, top4, wins, unit_games, updated_at')
                .eq('patch', patch)
                .eq('tier_min', tierArg(filter.tier))
                .order('unit')
                .order('items')
                .range(from, from + RPC_PAGE_SIZE - 1)
                .abortSignal(signal)
            )) ?? []
          rows.push(...got)
          if (got.length < RPC_PAGE_SIZE) break
        }
        const updatedAt = rows.reduce<string | undefined>((m, r) => (!m || r.updated_at > m ? r.updated_at : m), undefined)
        return {
          success: true,
          source: 'db',
          filter: { patch, tier: filter.tier },
          updatedAt,
          rows: toBuildRankings(rows),
        } satisfies BuildsResponse
      } catch (err) {
        logEvent('warn', 'builds_db_failed', errorFields(err))
        return jsonBuilds(fallbackReason(err))
      }
    },
    jsonBuilds
  )
}

/* ------------------------------------------------------------------ */
/* 덱 1개 (/deck/[id] — DB 집계 덱)                                     */
/* ------------------------------------------------------------------ */

export interface ResolvedDeck {
  deck: DeckView
  patch: string
  tierMin: TierFilter
  updatedAt?: string
}

interface DeckRow {
  deck: unknown
  patch: string
  tier_min: string
  updated_at: string
}

/** 패치 내림차순: '16.20' > '16.9' (문자열 비교 금지). 숫자.숫자가 아니면 뒤로 */
function comparePatchDesc(a: string, b: string): number {
  const pa = /^(\d+)\.(\d+)$/.exec(a)
  const pb = /^(\d+)\.(\d+)$/.exec(b)
  if (pa && pb) return Number(pb[1]) - Number(pa[1]) || Number(pb[2]) - Number(pa[2])
  if (pa) return -1
  if (pb) return 1
  return b.localeCompare(a)
}

/** 같은 패치에 여러 티어 필터가 있으면: 요청 티어 → 마스터+(대시보드 기본) → 그마+ → 챌린저 → 다이아+ */
const DECK_TIER_PREFERENCE: TierFilter[] = ['master', 'grandmaster', 'challenger', 'diamond']

/**
 * stat_comp 에서 comp_id 로 덱 1개. patch 가 없으면 최신 패치(숫자 비교).
 * DB 미설정·없음·오류(타임아웃·RLS·형식)는 null — JSON 덱 폴백은 호출하는 페이지가 정한다.
 */
export async function getDeckById(id: string, opts: { patch?: string | null; tier?: TierFilter | null } = {}): Promise<ResolvedDeck | null> {
  const c = db()
  if (!c || !id) return null
  try {
    const rows = await withTimeout<DeckRow[]>((signal) => {
      let q = c.from('stat_comp').select('deck, patch, tier_min, updated_at').eq('comp_id', id)
      if (opts.patch) q = q.eq('patch', opts.patch)
      if (opts.tier) q = q.eq('tier_min', tierArg(opts.tier))
      return q.abortSignal(signal)
    })
    if (!rows?.length) return null
    const latest = [...new Set(rows.map((r) => r.patch))].sort(comparePatchDesc)[0]
    const order = opts.tier ? [opts.tier, ...DECK_TIER_PREFERENCE] : DECK_TIER_PREFERENCE
    const rank = (r: DeckRow) => {
      const i = order.indexOf(String(r.tier_min).toLowerCase() as TierFilter)
      return i < 0 ? order.length : i
    }
    const row = rows
      .filter((r) => r.patch === latest)
      .sort((a, b) => rank(a) - rank(b) || (b.updated_at > a.updated_at ? 1 : b.updated_at < a.updated_at ? -1 : 0))[0]
    const deck = deckViewsFromRaw([row.deck])[0]
    if (!deck) return null
    return { deck, patch: row.patch, tierMin: String(row.tier_min).toLowerCase() as TierFilter, updatedAt: row.updated_at }
  } catch (err) {
    logEvent('warn', 'deck_by_id_failed', { id, ...errorFields(err) })
    return null
  }
}

/** 테스트용: 메모·클라이언트 초기화 */
export function __resetStatsForTest() {
  memo.clear()
  failMemo.clear()
  client = undefined
}

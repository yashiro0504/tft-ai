'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, RefreshCw, Search } from 'lucide-react'
import type {
  MetaBuildStat,
  MetaChampRanking,
  MetaComboRanking,
  MetaCompRanking,
  MetaDeckRanking,
  MetaItemRanking,
  MetaTraitRanking,
  TftMetaResponse,
} from '@/lib/types'
import {
  BIS_RELIABLE_SAMPLE,
  DAYS_FILTER_OPTIONS,
  MIN_SAMPLE,
  TIER_FILTER_OPTIONS,
  buildCompSets,
  buildsCompatible,
  filterLabel,
  filterQuery,
  placementMargin,
  type BuildsResponse,
  type DecksResponse,
  type MetaFiltersResponse,
  type StatFilter,
  type StatsResponse,
} from '@/lib/statsShared'
import { DetailModal } from './MetaDetailModal'
import { EvidenceChip, PlacementStrip, TraitHex, UnitHover, traitLevelFromCount } from './LabUI'
import { ShareButton } from './ShareButton'
import { MetaUrlSync } from './MetaUrlSync'
import { track } from '@/lib/analytics'
import { JSON_LADDER_SCOPE_DETAIL, metaMatchesLabel, metaScopeLabel, snapshotFailed, snapshotTime } from '@/lib/deckReportShared'
import {
  ITEM_CLASSES,
  ITEM_CLASS_LABEL,
  classifyItem,
  type ItemClass,
  type ModalTarget,
  type Tier,
  adjustedPlacement,
  assignSampleTiers,
  DECK_TIER_MIN_SAMPLE,
  DECK_TIER_PRIOR_GAMES,
  DECK_TIER_RULE,
  DECK_TIER_RULE_SHORT,
  tierClass,
  tierRank,
} from './metaShared'
import '../rank/rank.css'
import '../rank/tabs.css'

type TabId = 'decks' | 'comps' | 'champions' | 'traits' | 'items'

const TAB_IDS: readonly TabId[] = ['decks', 'comps', 'champions', 'traits', 'items']

const TABS: { id: TabId; label: string }[] = [
  { id: 'decks', label: '덱' },
  { id: 'comps', label: 'BIS' },
  { id: 'champions', label: '기물' },
  { id: 'traits', label: '시너지' },
  { id: 'items', label: '아이템' },
]

const TIERS: ('전체' | Tier)[] = ['전체', 'S', 'A', 'B', 'C', 'D']
const COSTS = [1, 2, 3, 4, 5] as const
type CostFilter = 'all' | (typeof COSTS)[number]
/** 기물 행이 있는 탭 — 코스트 필터를 보여 주고 티어를 같은 코스트끼리 매긴다 */
const isUnitTab = (t: TabId) => t === 'champions' || t === 'comps'
const SORT_LABEL: Record<'avg' | 'top4' | 'sample', string> = {
  avg: '평균등수',
  top4: 'TOP4',
  sample: '표본',
}
type SortKey = keyof typeof SORT_LABEL
/** BIS 탭은 아이템 칸이 주인공 — 기물 수치는 기준값(평균·판수)만 두고 TOP4 는 뺀다 */
const BIS_SORT_LABEL: Partial<Record<SortKey, string>> = { avg: '기물 평균', sample: '기물 판수' }

/** 수집 시각은 서버(UTC)·클라이언트(KST) 렌더 결과가 같아야 하므로 KST 고정 */
const DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function fmtDate(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const parts = DATE_FMT.formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
  return `${get('year')}.${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`
}

/** 모바일에서는 덱 상세를 바텀시트로 띄운다. */
function isMobileViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches
}

interface Row {
  key: string
  name: string
  img?: string
  cost?: number
  avg: number
  top4: number
  sample: number
  /** 표본 하한 미만은 '-' (상대 티어에서 제외) */
  tier: Tier | '-'
  /** 표본 하한 미만 → 회색 + "표본 부족" */
  low: boolean
  /** 하한은 넘었지만 덱 티어 하한(DECK_TIER_MIN_SAMPLE=50판) 미만 → 티어 없이 '참고용' 그룹 */
  reference?: boolean
  /** 덱 보정 평균등수 (티어 기준 — 평균등수 툴팁) */
  adj?: number
  third?: number
  bis?: MetaCompRanking['items']
  /** BIS 3개를 함께 든 세트 (undefined = 빌드 집계 없음, null = 그 세트가 드묾) */
  bisSet?: MetaCompRanking['bisSet']
  deck?: MetaDeckRanking
  delta?: number
}

/** 탭별 표본 하한 (docs/DATA-PLATFORM.md §6-2) */
const TAB_MIN_SAMPLE: Record<TabId, number> = {
  decks: MIN_SAMPLE.deck,
  comps: MIN_SAMPLE.unit,
  champions: MIN_SAMPLE.unit,
  traits: MIN_SAMPLE.trait,
  items: MIN_SAMPLE.item,
}

/**
 * 표본 충분한 행끼리만 상대 티어 (추정 평균등수 기준 — metaShared.assignSampleTiers).
 * 기물은 코스트별로 나눠 매긴다: 5코는 오래 살아남은 보드에만 올라와 평균등수가 낮게 나와서, 한 줄로 매기면 S티어가 5코로만 찬다.
 */
function tiersFor(
  rows: { avgPlacement: number; sampleSize: number; cost?: number }[],
  min: number,
  byCost = false,
  deck = false
): (Tier | '-')[] {
  return assignSampleTiers(
    rows.map((r) => ({ avg: r.avgPlacement, sample: r.sampleSize, group: byCost ? r.cost ?? 0 : undefined })),
    min,
    { deck }
  )
}

/** 필터 응답 4종 → 대시보드 섹션 (덱 제외) */
type Sections = Pick<TftMetaResponse, 'champions' | 'traits' | 'items' | 'combos' | 'comps'>

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const json = await res.json()
  if (!res.ok || json?.success === false) throw new Error(json?.error || '통계를 불러오지 못했습니다.')
  return json as T
}

export function MetaDashboard({
  onOpenCoach,
  initialData,
  showTitle = false,
  deferSections = false,
  filters,
  initialDecksSource,
  syncUrl = false,
}: {
  onOpenCoach?: () => void
  initialData?: TftMetaResponse
  showTitle?: boolean
  deferSections?: boolean
  /** /api/tft/meta/filters 결과 (SSR). source='db' 일 때만 패치·티어·기간 필터를 보여 준다 */
  filters?: MetaFiltersResponse
  /** initialData.decks 가 DB 덱(기본 필터)인가 */
  initialDecksSource?: 'db' | 'json'
  /** 필터·탭을 URL 쿼리와 동기화 (/meta 전용 — 홈의 ?tab=meta 와 겹치지 않게 다른 화면은 끈다) */
  syncUrl?: boolean
}) {
  const [data, setData] = useState<TftMetaResponse | null>(initialData ?? null)
  const [loading, setLoading] = useState(!initialData)
  // 전체(기물·아이템·조합 탭) 응답을 받았는가 — 홈 메타 탭은 덱 요약부터 받고 다른 탭을 열 때 전체를 받는다 (2026-10-30 지시문 3)
  const [loadedAll, setLoadedAll] = useState(Boolean(initialData) && !deferSections)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('decks')
  const [tier, setTier] = useState<'전체' | Tier>('전체')
  const [sort, setSort] = useState<SortKey>('avg')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [itemClass, setItemClass] = useState<ItemClass>('all')
  const [cost, setCost] = useState<CostFilter>('all')
  const [modal, setModal] = useState<ModalTarget | null>(null)

  // ---- 필터 (DB 집계가 있을 때만) ----
  const dbMode = filters?.source === 'db'
  const [filter, setFilter] = useState<StatFilter>(() => ({
    patch: filters?.defaults.patch ?? null,
    tier: filters?.defaults.tier ?? 'master',
    days: filters?.defaults.days ?? 7,
  }))
  /** 마지막 응답 출처 — DB 를 기대했는데 json 이면 필터 미적용 스냅샷 */
  const [served, setServed] = useState<{ decks?: DecksResponse['source']; stats?: StatsResponse['source']; totalMatches?: number }>(
    { decks: initialDecksSource }
  )
  const deckKey = (f: StatFilter) => `${f.patch}|${f.tier}`
  const loadedRef = useRef<{ decks: string | null; sections: string | null }>({
    decks: initialDecksSource === 'db' ? deckKey(filter) : null,
    sections: null,
  })
  const loadSeq = useRef(0)

  /** 필터 적용 로딩: 덱 탭은 /api/tft/decks, 나머지 탭은 /api/tft/stats 4종을 한 번에 받아 같이 쓴다 */
  const loadFiltered = async (target: TabId, f: StatFilter, force = false) => {
    const isDecks = target === 'decks'
    const key = isDecks ? deckKey(f) : filterQuery(f)
    if (!force && (isDecks ? loadedRef.current.decks : loadedRef.current.sections) === key) return
    const seq = ++loadSeq.current
    setLoading(true)
    setError(null)
    try {
      const q = filterQuery(f)
      if (isDecks) {
        const json = await fetchJson<DecksResponse>(`/api/tft/decks?${q}`)
        if (seq !== loadSeq.current) return
        setData((prev) => (prev ? { ...prev, decks: json.decks } : prev))
        setServed((s) => ({ ...s, decks: json.source }))
        loadedRef.current.decks = key
      } else {
        // 기물 빌드(3개 세트)는 없어도 표는 그린다 — 실패하면 '3개 함께' 줄만 빠진다
        // 빌드는 기간 필터가 없다 — days 를 넘기면 같은 데이터가 기간별로 CDN 캐시 3벌이 된다
        const buildsQuery = new URLSearchParams()
        if (f.patch) buildsQuery.set('patch', f.patch)
        buildsQuery.set('tier', f.tier)
        const buildsReq = fetchJson<BuildsResponse>(`/api/tft/builds?${buildsQuery}`).catch(() => null)
        const [unit, item, trait, unitItem] = await Promise.all(
          (['unit', 'item', 'trait', 'unit_item'] as const).map((t) => fetchJson<StatsResponse>(`/api/tft/stats?type=${t}&${q}`))
        )
        const builds = await buildsReq
        if (seq !== loadSeq.current) return
        const champions = unit.rows as MetaChampRanking[]
        const combos = unitItem.rows as MetaComboRanking[]
        const sections: Sections = {
          champions,
          items: item.rows as MetaItemRanking[],
          traits: trait.rows as MetaTraitRanking[],
          combos,
          // 세트는 기물×아이템과 출처가 같고 패치가 같을 때만 (DB 통계 옆에 래더 스냅샷 세트나 다른 패치 세트를 섞지 않는다 — 패치 전환 직후 캐시 어긋남)
          comps: buildCompSets(champions, combos, buildsCompatible(unitItem, builds) ? builds.rows : undefined),
        }
        setData((prev) => (prev ? { ...prev, ...sections } : prev))
        setServed((s) => ({ ...s, stats: unit.source, totalMatches: unit.totalMatches }))
        loadedRef.current.sections = key
        setLoadedAll(true)
      }
    } catch (e) {
      if (seq === loadSeq.current) setError(e instanceof Error ? e.message : '네트워크 오류')
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }

  /** 탭 전환 공통 처리 (탭 클릭 · URL 진입) */
  const switchTab = (next: TabId) => {
    setTab(next)
    setSelectedId(null)
    setDetailOpen(false)
    setModal(null)
  }

  // 덱 탭 밖의 탭(기물·아이템·조합)은 처음 열 때 전체 데이터를 받는다 — /meta 는 덱만 SSR, 홈은 덱 요약부터 받는다
  useEffect(() => {
    if (!dbMode && tab !== 'decks' && !loadedAll && !loading) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbMode, tab, loadedAll, loading])

  /** URL(공유 링크 · 새로고침) 에서 읽은 필터·탭 적용 — 데이터 로딩은 아래 effect 가 loadedRef 로 1회만 */
  const applyUrlState = (next: { filter: StatFilter; tab: TabId }) => {
    setFilter(next.filter)
    if (next.tab !== tab) switchTab(next.tab)
  }

  useEffect(() => {
    if (dbMode) void loadFiltered(tab, filter)
    // loadFiltered 는 ref 로 중복 요청을 막는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbMode, tab, filter])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/tft/meta', { cache: 'no-store' })
      const json: TftMetaResponse = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || '메타 데이터를 불러오지 못했습니다.')
      setData(json)
      setLoadedAll(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '네트워크 오류')
    } finally {
      setLoading(false)
    }
  }

  /**
   * 첫 화면 (initialData 없음 — 홈 메타 탭): 덱 요약(view=summary)으로 목록을 먼저 그리고, 덱 상세(아이템)는 view=decks 로 이어 받는다.
   * 전체 응답(약 1.07MB)을 기다리는 동안 "전체 0 · 0개 · 덱을 선택하세요"가 보이던 문제 (2026-10-30 지시문 3).
   */
  const loadInitial = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/tft/meta?view=summary')
      const json: TftMetaResponse = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || '메타 데이터를 불러오지 못했습니다.')
      setData((prev) => prev ?? json)
    } catch (e) {
      setError(e instanceof Error ? e.message : '네트워크 오류')
      setLoading(false)
      return
    }
    setLoading(false)
    try {
      const res = await fetch('/api/tft/meta?view=decks')
      const json: TftMetaResponse = await res.json()
      if (!res.ok || !json.success) return
      // 그사이 전체 응답을 받았으면 그대로 둔다
      setData((prev) => (prev?.view === 'summary' ? { ...prev, decks: json.decks, view: 'decks' } : prev))
    } catch {
      /* 상세는 다음 탭 전환·새로고침 때 다시 받는다 */
    }
  }

  useEffect(() => {
    if (!initialData) void loadInitial()
    // initialData 는 /meta 페이지에서 주입된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 모바일 바텀시트: 열려 있으면 스크롤을 잠그고, 데스크톱 폭으로 커지면 닫는다.
  useEffect(() => {
    if (!detailOpen) return
    const onResize = () => {
      if (!isMobileViewport()) setDetailOpen(false)
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('resize', onResize)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('resize', onResize)
    }
  }, [detailOpen])

  const rowsAll = useMemo<Row[]>(() => {
    if (!data) return []
    const min = TAB_MIN_SAMPLE[tab]
    if (tab === 'decks') {
      // 덱 티어는 보정 평균등수 고정 구간 (metaShared.deckTier · 설명 DECK_TIER_RULE) — 50판 미만은 '-' 참고용
      const tiers = tiersFor(data.decks.map((d) => ({ avgPlacement: d.avgPlacement ?? 9, sampleSize: d.sampleSize })), min, false, true)
      return data.decks.map((d, i) => ({
        key: d.id,
        name: d.name,
        avg: d.avgPlacement ?? 9,
        top4: d.top4Rate ?? 0,
        sample: d.sampleSize,
        tier: tiers[i],
        low: d.sampleSize < min,
        reference: d.sampleSize >= min && tiers[i] === '-',
        adj: adjustedPlacement(d.avgPlacement ?? 9, d.sampleSize),
        deck: d,
      }))
    }
    if (tab === 'comps') {
      const src: MetaCompRanking[] = data.comps ?? []
      const tiers = tiersFor(src, min, true)
      return src.map((c, i) => ({
        key: c.key,
        name: c.name,
        img: c.imgUrl,
        cost: c.cost,
        avg: c.avgPlacement,
        top4: c.top4Rate,
        sample: c.sampleSize,
        tier: tiers[i],
        low: c.sampleSize < min,
        third: c.threeStarRate,
        bis: (c.items ?? []).slice(0, 3),
        bisSet: c.bisSet,
        delta: c.avgDelta,
      }))
    }
    if (tab === 'champions') {
      const src: MetaChampRanking[] = data.champions ?? []
      const tiers = tiersFor(src, min, true)
      return src.map((c, i) => ({
        key: c.key,
        name: c.name,
        img: c.imgUrl,
        cost: c.cost,
        avg: c.avgPlacement,
        top4: c.top4Rate,
        sample: c.sampleSize,
        tier: tiers[i],
        low: c.sampleSize < min,
        third: c.threeStarRate,
        delta: c.avgDelta,
      }))
    }
    if (tab === 'traits') {
      const src: MetaTraitRanking[] = data.traits ?? []
      const tiers = tiersFor(src, min)
      return src.map((t, i) => ({
        key: t.key,
        name: t.name,
        img: t.iconUrl,
        avg: t.avgPlacement,
        top4: t.top4Rate,
        sample: t.sampleSize,
        tier: tiers[i],
        low: t.sampleSize < min,
        delta: t.avgDelta,
      }))
    }
    const src: MetaItemRanking[] = data.items ?? []
    const tiers = tiersFor(src, min)
    return src.map((it, i) => ({
      key: it.key,
      name: it.name,
      img: it.iconUrl,
      avg: it.avgPlacement,
      top4: it.top4Rate,
      sample: it.sampleSize,
      tier: tiers[i],
      low: it.sampleSize < min,
      delta: it.avgDelta,
    }))
  }, [data, tab])

  /** BIS 탭엔 TOP4 열이 없다 — 다른 탭에서 TOP4 로 정렬하다 넘어오면 평균 순 */
  const sortBy: SortKey = tab === 'comps' && !BIS_SORT_LABEL[sort] ? 'avg' : sort
  const sortKeys = (Object.keys(SORT_LABEL) as SortKey[]).filter((k) => tab !== 'comps' || BIS_SORT_LABEL[k])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = rowsAll.filter((r) => {
      const tierOk = tier === '전체' || r.tier === tier
      // BIS 탭은 아이템 이름으로도 찾는다 (예: 쇼진의 창을 BIS 로 드는 기물)
      const qOk = !q || r.name.toLowerCase().includes(q) || (r.bis ?? []).some((b) => b.name.toLowerCase().includes(q))
      const classOk = tab !== 'items' || itemClass === 'all' || classifyItem(r.key) === itemClass
      const costOk = !isUnitTab(tab) || cost === 'all' || r.cost === cost
      return tierOk && qOk && classOk && costOk
    })
    return [...filtered].sort((a, b) => {
      // 표본 부족은 평균등수·TOP4 정렬에서 맨 아래로 (우연히 좋은 수치가 위로 오지 않게)
      if (sortBy !== 'sample' && a.low !== b.low) return Number(a.low) - Number(b.low)
      if (sortBy === 'top4') return b.top4 - a.top4
      if (sortBy === 'sample') return b.sample - a.sample
      // 평균등수: 티어(표본 수를 반영한 순위)로 묶고 같은 티어 안에서 평균등수 순
      return tierRank(a.tier) - tierRank(b.tier) || a.avg - b.avg
    })
  }, [rowsAll, tier, sortBy, query, tab, itemClass, cost])

  // 상세 카드의 티어는 표와 같은 상대 티어를 쓴다 (원본 덱 데이터의 tier 와 다를 수 있음)
  const selectedTier = useMemo(
    () => (tab === 'decks' ? (rows.find((r) => r.key === selectedId) || rows[0])?.tier ?? null : null),
    [rows, selectedId, tab],
  )

  const selected = useMemo(
    () => (tab === 'decks' ? rows.find((r) => r.key === selectedId)?.deck || rows[0]?.deck || null : null),
    [rows, selectedId, tab],
  )

  const countOf = (t: '전체' | Tier) => (t === '전체' ? rowsAll.length : rowsAll.filter((r) => r.tier === t).length)
  const minSample = TAB_MIN_SAMPLE[tab]
  const appliedPatch = filter.patch ?? filters?.defaults.patch ?? null
  const fellBack = dbMode && (tab === 'decks' ? served.decks === 'json' : served.stats === 'json')
  const tierMatches = dbMode ? filters?.patches.find((p) => p.patch === appliedPatch)?.matches[filter.tier] : undefined
  /** 덱 스냅샷 출처 (/meta SSR · /api/tft/meta 모두 lib/metaSnapshot — 덱 성적표 출처 줄과 같은 값) */
  const snapMeta = data?.decksMeta
  /** 패치 표기 — 덱 스냅샷 패치(16.21)를 우선한다. JSON 래더 패치 문자열('set18')을 그대로 보이지 않게 (2026-10-30 지시문 5-1) */
  const snapPatch = snapMeta?.patch && /^\d/.test(snapMeta.patch) ? snapMeta.patch : null
  const shownPatch = snapPatch ?? (data?.patch && /^\d/.test(data.patch) ? data.patch : undefined)
  /** 첫 응답 전(또는 탭 데이터를 받는 중)에는 숫자 0 대신 스켈레톤 — 표 스켈레톤과 같은 조건 */
  const pending = !data || (loading && !rowsAll.length)
  /** 덱 탭이 아직 서버 스냅샷(기본 필터)을 보여 주는 중 — 수집 범위 칩을 배지·덱 성적표와 같은 문구로 */
  const showingSnapshot =
    tab === 'decks' &&
    !!snapMeta &&
    (served.decks === undefined || served.decks === snapMeta.source) &&
    (!dbMode || (filter.patch ?? filters?.defaults.patch ?? null) === (filters?.defaults.patch ?? null) && filter.tier === (filters?.defaults.tier ?? 'master'))

  const colClass = tab === 'comps' ? 'cols-bis' : tab === 'champions' ? 'cols-champ' : 'cols-stat'

  return (
    <>
      {syncUrl ? (
        // useSearchParams 는 이 경계 안에서만 — /meta 정적 HTML 에 SSR 덱 표가 그대로 남는다
        <Suspense fallback={null}>
          <MetaUrlSync
            filter={filter}
            tab={tab}
            tabs={TAB_IDS}
            defaultTab="decks"
            latestPatch={filters?.defaults.patch ?? null}
            patches={filters?.patches.map((p) => p.patch) ?? []}
            syncFilter={dbMode}
            onApply={applyUrlState}
          />
        </Suspense>
      ) : null}
      <div className={`rk-shell ${tab === 'decks' ? '' : 'no-detail'}`}>
        <main className="rk-main">
          <header className="rk-head">
            {showTitle ? <h1>시즌 18 메타 랭킹</h1> : null}
            <div className="rk-evidence">
              {!data ? (
                // 첫 응답 전: '패치 정보 없음 · 덱 0개' 대신 스켈레톤 (2026-10-29 지시문 5 — 빈 상태는 성공 응답이 0개일 때만)
                <span className="contents" role="status" aria-label="메타 데이터를 불러오는 중">
                  <span className="rk-skel-chip" aria-hidden />
                  <span className="rk-skel-chip" aria-hidden />
                  <span className="rk-skel-chip" aria-hidden />
                </span>
              ) : showingSnapshot && snapMeta ? (
                <>
                  <EvidenceChip
                    title={`${snapMeta.source === 'json' ? `수집 범위: ${JSON_LADDER_SCOPE_DETAIL} · ` : ''}덱 표에 들어간 판 수${snapshotFailed(snapMeta) ? ' — DB 집계를 불러오지 못해 래더 표본을 보여 줍니다' : ' (덱 성적표의 메타 평균과 같은 스냅샷)'}`}
                  >
                    {[metaScopeLabel(snapMeta), metaMatchesLabel(snapMeta)].filter(Boolean).join(' · ')}
                  </EvidenceChip>
                  {snapMeta.patch && /^\d/.test(snapMeta.patch) ? <EvidenceChip>패치 {snapMeta.patch}</EvidenceChip> : null}
                  {snapshotTime(snapMeta.updatedAt) ? <EvidenceChip>{snapshotTime(snapMeta.updatedAt)} 갱신</EvidenceChip> : null}
                  {snapshotFailed(snapMeta) ? <EvidenceChip title="덱 성적표도 이 상태에서는 각자 갱신 시각만 보여 줍니다">DB 집계 실패 · 래더 표본</EvidenceChip> : null}
                </>
              ) : dbMode && !fellBack ? (
                <>
                  <EvidenceChip title="수집 범위: KR 랭크 판 누적 집계 (매시간 수집 · 덱은 하루 몇 번 다시 묶음)">
                    KR · {filterLabel(tab === 'decks' ? { ...filter, patch: appliedPatch, days: 0 } : { ...filter, patch: appliedPatch })}
                  </EvidenceChip>
                  {tab !== 'decks' && served.totalMatches != null ? (
                    <EvidenceChip title="이 필터에 들어간 판 수">{served.totalMatches.toLocaleString()}판</EvidenceChip>
                  ) : tierMatches != null ? (
                    <EvidenceChip title="이 패치 · 티어 필터의 누적 판 수">{tierMatches.toLocaleString()}판</EvidenceChip>
                  ) : null}
                </>
              ) : (
                <>
                  <EvidenceChip title={`수집 범위: ${JSON_LADDER_SCOPE_DETAIL}`}>
                    {[metaScopeLabel({ source: 'json' }), metaMatchesLabel({ matches: snapMeta?.matches })].filter(Boolean).join(' · ')}
                  </EvidenceChip>
                  <EvidenceChip>{shownPatch ? `패치 ${shownPatch}` : '패치 정보 없음'}</EvidenceChip>
                  {data?.generatedAt ? <EvidenceChip>수집 {fmtDate(data.generatedAt)}</EvidenceChip> : null}
                  {fellBack ? (
                    <EvidenceChip title="DB 집계를 불러오지 못해 빌드 시점 스냅샷을 보여 줍니다">필터 미적용 스냅샷</EvidenceChip>
                  ) : null}
                </>
              )}
              {data ? (
                <EvidenceChip>
                  덱 {data.decks.length}개{loadedAll || (data.champions ?? []).length ? ` · 기물 ${(data.champions ?? []).length}종` : ''}
                </EvidenceChip>
              ) : null}
              {!data ? null : tab === 'decks' ? (
                <EvidenceChip title={DECK_TIER_RULE}>{DECK_TIER_RULE_SHORT}</EvidenceChip>
              ) : (
                <EvidenceChip title="절대 기준이 아니라 표 안 상대 순위 (표본 부족 제외). 표본이 적을수록 평균등수를 4.5등 쪽으로 당긴 추정값으로 매겨, 판수 적은 행이 운으로 위에 오지 않게 합니다. 값이 같거나 경계에서 차이가 오차보다 훨씬 작으면 같은 티어입니다">
                  {isUnitTab(tab) ? '티어 = 같은 코스트 안 상대 순위' : '티어 = 표 안 상대 순위'} · 표본 수 반영
                </EvidenceChip>
              )}
              <EvidenceChip title={`평균등수 ± 는 표준오차 2.29/√n. ${minSample}판 미만(±${placementMargin(minSample)?.toFixed(2)} 초과)은 표본 부족으로 회색 표시`}>
                ± 표준오차 · {minSample}판 미만 표본 부족
              </EvidenceChip>
              {tab === 'comps' ? (
                <EvidenceChip
                  title={`기물마다 그 아이템을 든 판이 ${MIN_SAMPLE.unit_item}판 이상인 아이템 중 가장 많이 든 3개 (AI 리포트 BIS 일치율과 같은 기준). 평균등수 = 이 기물이 그 아이템을 든 판의 평균, 채용 = 이 기물이 나온 판 중 그 아이템을 든 비율 (아이템 1개 단위). 셋을 함께 든 판은 이름 아래 '3개 함께' — 덱 탭과 같은 기준(패치 단위, 하루 1회 집계)이라 기간 필터와 무관합니다. ${BIS_RELIABLE_SAMPLE}판 미만은 참고용`}
                >
                  BIS = 채용 상위 3 · 아이템 1개 단위
                </EvidenceChip>
              ) : null}
            </div>
          </header>

          {dbMode && filters ? (
            <div className="rk-toolbar rk-filterbar" role="group" aria-label="통계 필터">
              <label className="rk-select">
                <span>패치</span>
                <select
                  value={appliedPatch ?? ''}
                  onChange={(e) => setFilter((f) => ({ ...f, patch: e.target.value || null }))}
                  aria-label="패치"
                >
                  {filters.patches.map((p, i) => (
                    <option key={p.patch} value={p.patch}>
                      {p.patch}
                      {i === 0 ? ' (최신)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <div className="rk-chips" role="group" aria-label="티어">
                {TIER_FILTER_OPTIONS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`rk-chip ${filter.tier === t.id ? 'on' : ''}`}
                    aria-pressed={filter.tier === t.id}
                    onClick={() => setFilter((f) => ({ ...f, tier: t.id }))}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="rk-chips" role="group" aria-label="기간">
                {DAYS_FILTER_OPTIONS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={`rk-chip ${filter.days === d.id ? 'on' : ''}`}
                    aria-pressed={filter.days === d.id}
                    disabled={tab === 'decks'}
                    title={tab === 'decks' ? '덱은 패치 전체 기준으로 하루 1회 묶습니다' : undefined}
                    onClick={() => setFilter((f) => ({ ...f, days: d.id }))}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="rk-toolbar">
            <div className="rk-tabs" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`rk-tab ${tab === t.id ? 'on' : ''}`}
                  onClick={() => {
                    if (tab !== t.id) track('tab_view', { tab: t.id, surface: 'meta' })
                    switchTab(t.id)
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {tab === 'items' && !pending ? (
              <div className="rk-chips" role="group" aria-label="아이템 분류">
                {ITEM_CLASSES.map((c) => {
                  const items = data?.items ?? []
                  const count = c === 'all' ? items.length : items.filter((it) => classifyItem(it.key) === c).length
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`rk-chip ${itemClass === c ? 'on' : ''}`}
                      aria-pressed={itemClass === c}
                      onClick={() => setItemClass(c)}
                    >
                      {ITEM_CLASS_LABEL[c]} <span>{count}</span>
                    </button>
                  )
                })}
              </div>
            ) : null}
            {isUnitTab(tab) && !pending ? (
              <div className="rk-chips" role="group" aria-label="기물 코스트">
                {(['all', ...COSTS] as CostFilter[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`rk-chip ${cost === c ? 'on' : ''}`}
                    aria-pressed={cost === c}
                    onClick={() => setCost(c)}
                  >
                    {c === 'all' ? '전체' : `${c}코`} <span>{c === 'all' ? rowsAll.length : rowsAll.filter((r) => r.cost === c).length}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="rk-chips" role="group" aria-label="상대 티어">
              {pending ? (
                <span className="contents" aria-hidden>
                  <span className="rk-skel-chip" />
                  <span className="rk-skel-chip" />
                </span>
              ) : null}
              {pending ? null : TIERS.filter((t) => t === '전체' || countOf(t) > 0).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`rk-chip ${tier === t ? 'on' : ''}`}
                  aria-pressed={tier === t}
                  onClick={() => setTier(t)}
                >
                  {t} <span>{countOf(t)}</span>
                </button>
              ))}
            </div>
            <label className="rk-search">
              <Search className="h-3.5 w-3.5" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tab === 'comps' ? '기물·아이템 이름 검색' : '덱·기물 이름 검색'}
                aria-label="검색"
              />
            </label>
            {pending ? <span className="rk-skel-chip" aria-hidden /> : <span className="rk-sorted">{rows.length}개</span>}
            <button
              type="button"
              className="rk-refresh"
              onClick={() => void (dbMode ? loadFiltered(tab, filter, true) : load())}
              disabled={loading}
              aria-label="새로고침"
              title="새로고침"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {error ? (
            <div className="rk-error">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
              <button type="button" onClick={() => void (dbMode ? loadFiltered(tab, filter, true) : load())}>다시 시도</button>
            </div>
          ) : null}

          {!data && error ? null : !data || (loading && !rowsAll.length) ? (
            <div className="rk-skeleton">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="rk-skel-row" />
              ))}
            </div>
          ) : (
            <>
              <div className={`rk-thead ${colClass}`}>
                <span>#</span>
                <span>티어</span>
                {tab === 'decks' ? (
                  <span className="rk-comp is-deck rk-comp-head">
                    <span>덱</span>
                    <span>구성</span>
                  </span>
                ) : (
                  <span>{tab === 'comps' ? '기물' : '이름'}</span>
                )}
                {tab === 'comps' ? (
                  <span className="rk-bishead" title="이 기물이 그 아이템을 든 판의 평균등수 · 이 기물이 나온 판 중 그 아이템을 든 비율 (아이템 1개 단위)">
                    BIS 아이템 <small>채용 상위 3 · 든 판 평균등수 · 채용률</small>
                  </span>
                ) : null}
                {tab === 'champions' ? <span className="num">3성률</span> : null}
                {sortKeys.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`num rk-sort ${sortBy === k ? 'on' : ''}`}
                    aria-pressed={sortBy === k}
                    onClick={() => setSort(k)}
                  >
                    {(tab === 'comps' && BIS_SORT_LABEL[k]) || SORT_LABEL[k]}
                  </button>
                ))}
              </div>
              {rows.map((r, i) => (
                <Fragment key={r.key}>
                {tab === 'decks' && sortBy === 'avg' && r.tier === '-' && (i === 0 || rows[i - 1].tier !== '-') ? (
                  <div className="rk-group-label" role="presentation">
                    참고용 · {DECK_TIER_MIN_SAMPLE}판 미만 (티어 없음 · 티어별 개수에서 제외)
                  </div>
                ) : null}
                <button
                  type="button"
                  className={`rk-row ${colClass} ${selected && r.deck && selected.id === r.deck.id ? 'sel' : ''} ${r.low ? 'is-low' : ''}`}
                  title={r.low ? `표본 부족 (${minSample}판 미만) — 수치 변동이 큽니다` : undefined}
                  // 덱 행: "협곡야수 장로 드래곤, S티어, 평균 3.52등, 155판" (읽기 도구가 행 안 그림·숫자를 하나씩 읽지 않게)
                  aria-label={
                    tab === 'decks'
                      ? `${r.name}, ${r.tier === '-' ? '표본 부족' : `${r.tier}티어`}, 평균 ${r.avg.toFixed(2)}등, ${r.sample.toLocaleString()}판${
                          r.low || r.reference ? ', 참고용' : ''
                        }`
                      : undefined
                  }
                  onClick={() => {
                    if (tab === 'decks') {
                      setSelectedId(r.key)
                      if (isMobileViewport()) setDetailOpen(true)
                    } else if (tab === 'items') setModal({ type: 'item', key: r.key })
                    else if (tab === 'traits') setModal({ type: 'trait', key: r.key })
                    else setModal({ type: 'champion', key: r.key })
                  }}
                >
                  <span className="rk-rank">{String(i + 1).padStart(2, '0')}</span>
                  <span className={tierClass(r.tier)}>{r.tier}</span>
                  <span className={`rk-comp ${r.deck ? 'is-deck' : ''}`}>
                    <span className="rk-name-cell">
                      {r.img ? (
                        <span className="rk-icon">
                          <img src={r.img} alt={r.name} loading="lazy" />
                        </span>
                      ) : null}
                      <span className="rk-name">{r.name}</span>
                      {r.cost ? <span className="rk-cost">{r.cost}코</span> : null}
                      {r.low || r.reference ? (
                        <span
                          className="rk-cost"
                          title={r.reference ? `${DECK_TIER_MIN_SAMPLE}판 미만 — 오차가 커 티어 없이 참고용입니다` : undefined}
                        >
                          참고용
                        </span>
                      ) : null}
                    </span>
                    {/* 휴대폰은 TOP4·표본 열을 숨기므로 이름 아래 한 줄로 (rank/tabs.css .rk-msub) */}
                    <span className="rk-msub">
                      TOP4 {Math.round(r.top4 * 100)}% · {r.sample.toLocaleString()}판
                    </span>
                    {r.bisSet !== undefined ? <BisSetLine set={r.bisSet} names={(r.bis ?? []).map((b) => b.name)} /> : null}
                    {r.deck ? (
                      <span className="rk-traitrow">
                        {[...r.deck.traits]
                          .map((t) => ({ t, ...traitLevelFromCount(t.key, t.count) }))
                          .filter((x) => x.level > 0)
                          .sort((a, b) => b.level - a.level || b.t.count - a.t.count)
                          .slice(0, 4)
                          .map(({ t, level, max }) => (
                            <TraitHex key={t.key} name={t.name} count={t.count} level={level} max={max} iconUrl={t.iconUrl} compact />
                          ))}
                      </span>
                    ) : null}
                    {r.deck ? (
                      <span className="rk-units">
                        {r.deck.units.map((u) => (
                          <UnitHover key={`${r.key}-${u.key}-${u.index}`} unit={u}>
                            <span
                              className={`rk-unit c${u.cost ?? 1}${u.flex ? ' is-flex' : ''}`}
                              title={u.flex ? '플렉스(선택) — 시너지 최대 단계 초과' : undefined}
                            >
                              {/* 덱 행의 기물 그림은 옆에 이름이 없다 — alt 가 기물 이름 (읽기 도구·이미지 미표시용) */}
                              <img src={u.imgUrl} alt={`${u.name}${u.star >= 2 ? ` ${u.star}성` : ''}`} loading="lazy" />
                              <em>{u.star >= 2 ? `★${u.star}` : ''}</em>
                            </span>
                          </UnitHover>
                        ))}
                      </span>
                    ) : null}
                  </span>
                  {tab === 'comps' ? (
                    <span className="rk-bisset">
                      {(r.bis ?? []).map((b) => {
                        const low = b.sampleSize < BIS_RELIABLE_SAMPLE
                        const pick = Math.round(b.pickRate * 100)
                        return (
                          <span
                            key={b.key}
                            className={`rk-bisitem ${low ? 'is-low' : ''}`}
                            title={`${b.name} — 든 ${b.sampleSize.toLocaleString()}판 평균 ${b.avgPlacement.toFixed(2)}등 · 채용 ${pick}%${
                              low ? ` · ${BIS_RELIABLE_SAMPLE}판 미만 참고용` : ''
                            }`}
                          >
                            <span className="rk-icon">
                              <img src={b.iconUrl} alt={b.name} loading="lazy" />
                            </span>
                            {/* 휴대폰은 이름을 화면에서 숨기고(읽기 도구용으로만 남김) 평균등수·채용 두 줄 (rank/tabs.css) */}
                            <span className="rk-bisbody">
                              <span className="rk-bisname">{b.name}</span>
                              <span className="rk-bisstat">
                                <b>{b.avgPlacement.toFixed(2)}등</b>
                                <span className="rk-bispick">
                                  <i> · </i>채용 {pick}%
                                </span>
                                <span className="rk-bisn"> · {b.sampleSize.toLocaleString()}판</span>
                                {low ? <span className="rk-bislow">참고용</span> : null}
                              </span>
                            </span>
                          </span>
                        )
                      })}
                    </span>
                  ) : null}
                  {tab === 'champions' ? (
                    <span className="rk-num dim">{r.third != null ? `${Math.round(r.third * 100)}%` : '-'}</span>
                  ) : null}
                  <span className="rk-num">
                    <span title={r.adj != null ? `보정 평균등수 ${r.adj.toFixed(2)} (티어 기준 · ${DECK_TIER_PRIOR_GAMES}판만큼 4.5등을 섞은 값)` : undefined}>
                      {r.avg ? r.avg.toFixed(2) : '-'}
                      {r.avg && r.sample ? <small className="rk-pm">±{placementMargin(r.sample)?.toFixed(2)}</small> : null}
                    </span>
                    <i className="rk-bar">
                      <i style={{ width: `${Math.max(4, Math.min(100, ((5.0 - r.avg) / 1.2) * 100))}%` }} />
                    </i>
                  </span>
                  {tab !== 'comps' ? <span className="rk-num">{Math.round(r.top4 * 100)}%</span> : null}
                  <span className="rk-num dim">
                    {r.sample.toLocaleString()}
                    {r.low ? (
                      <small className="rk-sub rk-low">표본 부족</small>
                    ) : r.deck?.playRate != null ? (
                      <small className="rk-sub">픽률 {(r.deck.playRate * 100).toFixed(1)}%</small>
                    ) : null}
                  </span>
                </button>
                </Fragment>
              ))}
              {!rows.length && !loading ? (
                <p className="rk-empty">{rowsAll.length ? '조건에 맞는 항목이 없습니다. 필터를 초기화해 보세요.' : '이 조건으로 집계된 항목이 아직 없습니다.'}</p>
              ) : null}
            </>
          )}
        </main>

        {tab === 'decks' ? (
          <>
            {detailOpen ? (
              <button
                type="button"
                className="rk-sheet-backdrop"
                aria-label="덱 상세 닫기"
                onClick={() => setDetailOpen(false)}
              />
            ) : null}
            <aside className={`rk-detail ${detailOpen ? 'open' : ''}`} aria-label="덱 상세">
              <div className="rk-sheet-grab" aria-hidden="true" />
              <button
                type="button"
                className="rk-sheet-close"
                aria-label="덱 상세 닫기"
                onClick={() => setDetailOpen(false)}
              >
                ×
              </button>
              {!data || data.view === 'summary' ? (
                // 덱 상세(아이템)는 view=decks 로 이어 받는다 — 그동안 "덱을 선택하세요" 대신 스켈레톤
                <div className="rk-skeleton" role="status" aria-label="덱 상세를 불러오는 중">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="rk-skel-row" />
                  ))}
                </div>
              ) : selected ? (
                <DeckDetail
                  deck={selected}
                  tier={selectedTier ?? selected.tier}
                  patch={dbMode && !fellBack ? appliedPatch ?? undefined : shownPatch}
                  deckQuery={dbMode && !fellBack && appliedPatch ? `?patch=${appliedPatch}&tier=${filter.tier}` : ''}
                />
              ) : (
                <p className="rk-empty">덱을 선택하세요.</p>
              )}
            </aside>
          </>
        ) : null}

        {modal && data ? <DetailModal data={data} target={modal} onClose={() => setModal(null)} /> : null}
      </div>
    </>
  )
}

/**
 * BIS 행 이름 아래 "3개 함께" 한 줄 — BIS 3개를 한 기물이 함께 든 판의 평균등수 (lib/unitBuilds, 패치 단위).
 * 아이템 칸 수치는 아이템 1개 단위라, 셋을 같이 들 때 성적은 여기서만 본다.
 */
function BisSetLine({ set, names }: { set: MetaBuildStat | null; names: string[] }) {
  const what = `${names.join(' + ')} 를 한 기물이 함께 든 판 · 덱 탭과 같은 기준(패치 단위, 하루 1회 집계)`
  if (!set) {
    return (
      <span className="rk-bisline is-low" title={`${what} — 5판 미만이거나 이 기물의 많이 든 세트 10개 밖`}>
        3개 함께 든 판 적음
      </span>
    )
  }
  const n = set.sampleSize
  if (n < MIN_SAMPLE.unit_item) {
    return (
      <span className="rk-bisline is-low" title={`${what} — ${MIN_SAMPLE.unit_item}판 미만이라 평균등수는 표시하지 않습니다`}>
        3개 함께 {n.toLocaleString()}판 · 표본 부족
      </span>
    )
  }
  const low = n < BIS_RELIABLE_SAMPLE
  return (
    <span
      className={`rk-bisline ${low ? 'is-low' : ''}`}
      title={`${what} — 평균 ${set.avgPlacement.toFixed(2)}등 ±${placementMargin(n)?.toFixed(2)} · TOP4 ${Math.round(set.top4Rate * 100)}% · 기물의 ${Math.round(
        set.pickRate * 100
      )}%${low ? ` · ${BIS_RELIABLE_SAMPLE}판 미만 참고용` : ''}`}
    >
      3개 함께 <b>{set.avgPlacement.toFixed(2)}등</b> · {n.toLocaleString()}판{low ? ' · 참고용' : ''}
    </span>
  )
}

function DeckDetail({
  deck,
  tier,
  patch,
  deckQuery = '',
}: {
  deck: MetaDeckRanking
  tier: string
  patch?: string
  /** DB 덱이면 ?patch=&tier= — 덱 페이지가 같은 집계 덱(stat_comp)을 연다 */
  deckQuery?: string
}) {
  const carry = deck.units.find((u) => u.key === deck.carryKey) || deck.units[0]
  // 아이템을 드는 기물 (메인 딜러를 맨 앞으로)
  const holders = deck.units
    .filter((u) => u.items.length > 0)
    .sort((a, b) => Number(b.key === carry?.key) - Number(a.key === carry?.key))
  return (
    <div>
      <div className="rk-dhead">
        <span className={tierClass(tier)}>{(tier || '-').toUpperCase()}</span>
        <h2>{deck.name}</h2>
      </div>
      <p className="rk-dmeta">
        {deck.level ? (
          <>
            {deck.level}레벨 덱
            <span className="rk-sep">·</span>
          </>
        ) : null}
        {deck.gold != null ? `${deck.gold}g` : `${deck.unitCost}코`}
        <span className="rk-sep">·</span>
        기물 {deck.units.length}
      </p>

      {/* 근거 칩: 이 수치를 믿을 수 있는 이유 */}
      <div className="rk-evidence">
        {deck.games != null ? (
          <>
            <EvidenceChip title="이 덱으로 분류된 실제 래더 보드 수">래더 실측 {deck.games.toLocaleString()}판</EvidenceChip>
            {deck.playRate != null ? (
              <EvidenceChip title="수집한 전체 보드 중 이 덱 비율">픽률 {(deck.playRate * 100).toFixed(1)}%</EvidenceChip>
            ) : null}
          </>
        ) : (
          <>
            <EvidenceChip title="이 덱 기물들의 실측 매치 표본 수">표본 {deck.sampleSize.toLocaleString()}판</EvidenceChip>
            <EvidenceChip title="덱 기물 중 실측 통계가 있는 비율">실측 커버리지 {Math.round((deck.coverage || 0) * 100)}%</EvidenceChip>
          </>
        )}
        {patch ? <EvidenceChip>패치 {patch}</EvidenceChip> : null}
        {deck.sampleSize < MIN_SAMPLE.deck ? (
          <EvidenceChip title={`${MIN_SAMPLE.deck}판 미만이라 수치 변동이 큽니다`}>표본 부족</EvidenceChip>
        ) : null}
      </div>

      <div className="rk-dactions">
        <Link
          href={`/deck/${deck.id}${deckQuery}`}
          className="rk-dlink"
          onClick={() => track('deck_open', { surface: 'meta_deck_row' })}
        >
          덱 페이지
        </Link>
        <ShareButton path={`/deck/${deck.id}${deckQuery}`} label="공유" surface="meta_deck_row" />
      </div>

      <div className="rk-kpis">
        <div>
          <span>평균등수</span>
          <b>
            {deck.avgPlacement != null ? deck.avgPlacement.toFixed(2) : '-'}
            {deck.avgPlacement != null && deck.sampleSize ? (
              <small className="rk-pm">±{placementMargin(deck.sampleSize)?.toFixed(2)}</small>
            ) : null}
          </b>
        </div>
        <div>
          <span>TOP4</span>
          <b>{deck.top4Rate != null ? `${Math.round(deck.top4Rate * 100)}%` : '-'}</b>
        </div>
        <div>
          <span>{deck.games != null ? '1등' : '표본'}</span>
          <b>
            {deck.games != null && deck.winRate != null
              ? `${Math.round(deck.winRate * 100)}%`
              : deck.sampleSize.toLocaleString()}
          </b>
        </div>
        <div>
          <span>{deck.games != null ? '판수' : '시너지'}</span>
          <b>{deck.games != null ? deck.games.toLocaleString() : deck.traits.length}</b>
        </div>
      </div>

      {deck.placementDist ? (
        <>
          <p className="rk-label">등수 분포</p>
          <div className="rk-dist">
            <PlacementStrip counts={deck.placementDist} />
          </div>
        </>
      ) : null}

      <p className="rk-label">구성</p>
      <div className="rk-board">
        {deck.units.slice(0, 8).map((u) => (
          <UnitHover key={`b-${u.key}-${u.index}`} unit={u}>
            <div
              className={`rk-cell c${u.cost ?? 1}${u.flex ? ' is-flex' : ''}`}
              title={u.flex ? '플렉스(선택) — 시너지 최대 단계 초과' : undefined}
            >
              <img src={u.imgUrl} alt={u.name} loading="lazy" />
              <em>{u.star >= 2 ? `★${u.star}` : ''}</em>
            </div>
          </UnitHover>
        ))}
      </div>

      <p className="rk-label">시너지</p>
      <div className="rk-hexes">
        {deck.traits
          .map((t) => ({ t, ...traitLevelFromCount(t.key, t.count) }))
          .sort((a, b) => b.level - a.level || b.t.count - a.t.count)
          .map(({ t, level, max }) => (
            <TraitHex key={t.key} name={t.name} count={t.count} level={level} max={max} iconUrl={t.iconUrl} />
          ))}
      </div>

      {holders.length ? (
        <>
          <p className="rk-label">아이템 구성</p>
          <div className="rk-builds">
            {holders.map((u) => (
              <div key={`it-${u.key}-${u.index}`} className="rk-build">
                <img className="rk-build-unit" src={u.imgUrl} alt={u.name} loading="lazy" />
                <div className="rk-build-body">
                  <span className="rk-build-name">
                    {u.name}
                    {u.key === carry?.key ? <em>메인 딜러</em> : null}
                  </span>
                  <span className="rk-build-items">
                    {u.items.map((it) => (
                      <span key={it.key} className="rk-build-item" title={it.name}>
                        <img src={it.iconUrl} alt={it.name} loading="lazy" />
                        {it.name}
                      </span>
                    ))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

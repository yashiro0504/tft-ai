'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, RefreshCw, Search } from 'lucide-react'
import type {
  MetaChampRanking,
  MetaComboRanking,
  MetaCompRanking,
  MetaDeckRanking,
  MetaItemRanking,
  MetaTraitRanking,
  TftMetaResponse,
} from '@/lib/types'
import {
  DAYS_FILTER_OPTIONS,
  MIN_SAMPLE,
  TIER_FILTER_OPTIONS,
  buildCompSets,
  filterLabel,
  filterQuery,
  placementMargin,
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
import {
  ITEM_CLASSES,
  ITEM_CLASS_LABEL,
  classifyItem,
  type ItemClass,
  type ModalTarget,
  type Tier,
  assignTiers,
  tierClass,
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
const SORT_LABEL: Record<'avg' | 'top4' | 'sample', string> = {
  avg: '평균등수',
  top4: 'TOP4',
  sample: '표본',
}
type SortKey = keyof typeof SORT_LABEL

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
  third?: number
  bis?: { key: string; name: string; iconUrl: string }[]
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

/** 표본 충분한 행끼리만 상대 티어를 매긴다 */
function tiersFor(avgs: number[], samples: number[], min: number): (Tier | '-')[] {
  const okIdx = avgs.map((_, i) => i).filter((i) => samples[i] >= min)
  const tiers = assignTiers(okIdx.map((i) => avgs[i]))
  const out: (Tier | '-')[] = avgs.map(() => '-')
  okIdx.forEach((i, k) => {
    out[i] = tiers[k]
  })
  return out
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
  const [loadedAll, setLoadedAll] = useState(!deferSections)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('decks')
  const [tier, setTier] = useState<'전체' | Tier>('전체')
  const [sort, setSort] = useState<SortKey>('avg')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [itemClass, setItemClass] = useState<ItemClass>('all')
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
        const [unit, item, trait, unitItem] = await Promise.all(
          (['unit', 'item', 'trait', 'unit_item'] as const).map((t) => fetchJson<StatsResponse>(`/api/tft/stats?type=${t}&${q}`))
        )
        if (seq !== loadSeq.current) return
        const champions = unit.rows as MetaChampRanking[]
        const combos = unitItem.rows as MetaComboRanking[]
        const sections: Sections = {
          champions,
          items: item.rows as MetaItemRanking[],
          traits: trait.rows as MetaTraitRanking[],
          combos,
          comps: buildCompSets(champions, combos),
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
    // /meta 는 덱 데이터만 SSR 되므로, 다른 탭 첫 진입 시 전체 데이터를 지연 로딩한다.
    if (!dbMode && deferSections && !loadedAll && !loading && next !== 'decks') void load()
  }

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

  useEffect(() => {
    if (!initialData) void load()
    // initialData 는 /meta 정적 페이지에서 주입된다.
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
      const tiers = tiersFor(data.decks.map((d) => d.avgPlacement ?? 9), data.decks.map((d) => d.sampleSize), min)
      return data.decks.map((d, i) => ({
        key: d.id,
        name: d.name,
        avg: d.avgPlacement ?? 9,
        top4: d.top4Rate ?? 0,
        sample: d.sampleSize,
        tier: tiers[i],
        low: d.sampleSize < min,
        deck: d,
      }))
    }
    if (tab === 'comps') {
      const src: MetaCompRanking[] = data.comps ?? []
      const tiers = tiersFor(src.map((c) => c.avgPlacement), src.map((c) => c.sampleSize), min)
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
        delta: c.avgDelta,
      }))
    }
    if (tab === 'champions') {
      const src: MetaChampRanking[] = data.champions ?? []
      const tiers = tiersFor(src.map((c) => c.avgPlacement), src.map((c) => c.sampleSize), min)
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
      const tiers = tiersFor(src.map((t) => t.avgPlacement), src.map((t) => t.sampleSize), min)
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
    const tiers = tiersFor(src.map((it) => it.avgPlacement), src.map((it) => it.sampleSize), min)
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

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = rowsAll.filter((r) => {
      const tierOk = tier === '전체' || r.tier === tier
      const qOk = !q || r.name.toLowerCase().includes(q)
      const classOk = tab !== 'items' || itemClass === 'all' || classifyItem(r.key) === itemClass
      return tierOk && qOk && classOk
    })
    return [...filtered].sort((a, b) => {
      // 표본 부족은 평균등수·TOP4 정렬에서 맨 아래로 (우연히 좋은 수치가 위로 오지 않게)
      if (sort !== 'sample' && a.low !== b.low) return Number(a.low) - Number(b.low)
      if (sort === 'top4') return b.top4 - a.top4
      if (sort === 'sample') return b.sample - a.sample
      return a.avg - b.avg
    })
  }, [rowsAll, tier, sort, query, tab, itemClass])

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
              {dbMode && !fellBack ? (
                <>
                  <EvidenceChip title="KR 랭크 판 누적 집계 (매시간 갱신)">
                    {filterLabel(tab === 'decks' ? { ...filter, patch: appliedPatch, days: 0 } : { ...filter, patch: appliedPatch })}
                  </EvidenceChip>
                  {tab !== 'decks' && served.totalMatches != null ? (
                    <EvidenceChip title="이 필터에 들어간 판 수">{served.totalMatches.toLocaleString()}판</EvidenceChip>
                  ) : tierMatches != null ? (
                    <EvidenceChip title="이 패치 · 티어 필터의 누적 판 수">{tierMatches.toLocaleString()}판</EvidenceChip>
                  ) : null}
                </>
              ) : (
                <>
                  <EvidenceChip>{data?.patch ? `패치 ${data.patch}` : '패치 정보 없음'}</EvidenceChip>
                  {data?.generatedAt ? <EvidenceChip>수집 {fmtDate(data.generatedAt)}</EvidenceChip> : null}
                  {fellBack ? (
                    <EvidenceChip title="DB 집계를 불러오지 못해 빌드 시점 스냅샷을 보여 줍니다">필터 미적용 스냅샷</EvidenceChip>
                  ) : null}
                </>
              )}
              <EvidenceChip>
                덱 {(data?.decks ?? []).length}개 · 기물 {(data?.champions ?? []).length}종
              </EvidenceChip>
              <EvidenceChip title="절대 기준이 아니라 현재 표 안에서의 상대 순위 (표본 부족 제외)">티어 = 표 안 상대 순위</EvidenceChip>
              <EvidenceChip title={`평균등수 ± 는 표준오차 2.29/√n. ${minSample}판 미만은 표본 부족으로 회색 표시`}>
                ± 표준오차 · {minSample}판 미만 표본 부족
              </EvidenceChip>
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
            {tab === 'items' ? (
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
            <div className="rk-chips" role="group" aria-label="상대 티어">
              {TIERS.filter((t) => t === '전체' || countOf(t) > 0).map((t) => (
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
                placeholder="덱·기물 이름 검색"
                aria-label="검색"
              />
            </label>
            <span className="rk-sorted">{rows.length}개</span>
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

          {loading && !rowsAll.length ? (
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
                  <span>이름</span>
                )}
                {tab === 'comps' ? <span className="rk-bis">BIS</span> : null}
                {tab === 'champions' ? <span className="num">3성률</span> : null}
                {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`num rk-sort ${sort === k ? 'on' : ''}`}
                    aria-pressed={sort === k}
                    onClick={() => setSort(k)}
                  >
                    {SORT_LABEL[k]}
                  </button>
                ))}
              </div>
              {rows.map((r, i) => (
                <button
                  key={r.key}
                  type="button"
                  className={`rk-row ${colClass} ${selected && r.deck && selected.id === r.deck.id ? 'sel' : ''} ${r.low ? 'is-low' : ''}`}
                  title={r.low ? `표본 부족 (${minSample}판 미만) — 수치 변동이 큽니다` : undefined}
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
                          <img src={r.img} alt="" loading="lazy" />
                        </span>
                      ) : null}
                      <span className="rk-name">{r.name}</span>
                      {r.cost ? <span className="rk-cost">{r.cost}코</span> : null}
                    </span>
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
                              <img src={u.imgUrl} alt="" loading="lazy" />
                              <em>{u.star >= 2 ? `★${u.star}` : ''}</em>
                            </span>
                          </UnitHover>
                        ))}
                      </span>
                    ) : null}
                  </span>
                  {tab === 'comps' ? (
                    <span className="rk-bis">
                      {(r.bis ?? []).map((b) => (
                        <span key={b.key} className="rk-icon">
                          <img src={b.iconUrl} alt={b.name} loading="lazy" />
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {tab === 'champions' ? (
                    <span className="rk-num dim">{r.third != null ? `${Math.round(r.third * 100)}%` : '-'}</span>
                  ) : null}
                  <span className="rk-num">
                    <span>
                      {r.avg ? r.avg.toFixed(2) : '-'}
                      {r.avg && r.sample ? <small className="rk-pm">±{placementMargin(r.sample)?.toFixed(2)}</small> : null}
                    </span>
                    <i className="rk-bar">
                      <i style={{ width: `${Math.max(4, Math.min(100, ((5.0 - r.avg) / 1.2) * 100))}%` }} />
                    </i>
                  </span>
                  <span className="rk-num">{Math.round(r.top4 * 100)}%</span>
                  <span className="rk-num dim">
                    {r.sample.toLocaleString()}
                    {r.low ? (
                      <small className="rk-sub rk-low">표본 부족</small>
                    ) : r.deck?.playRate != null ? (
                      <small className="rk-sub">픽률 {(r.deck.playRate * 100).toFixed(1)}%</small>
                    ) : null}
                  </span>
                </button>
              ))}
              {!rows.length && !loading ? <p className="rk-empty">조건에 맞는 항목이 없습니다. 필터를 초기화해 보세요.</p> : null}
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
              {selected ? (
                <DeckDetail
                  deck={selected}
                  tier={selectedTier ?? selected.tier}
                  patch={dbMode && !fellBack ? appliedPatch ?? undefined : data?.patch}
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
                <img className="rk-build-unit" src={u.imgUrl} alt="" loading="lazy" />
                <div className="rk-build-body">
                  <span className="rk-build-name">
                    {u.name}
                    {u.key === carry?.key ? <em>메인 딜러</em> : null}
                  </span>
                  <span className="rk-build-items">
                    {u.items.map((it) => (
                      <span key={it.key} className="rk-build-item" title={it.name}>
                        <img src={it.iconUrl} alt="" loading="lazy" />
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

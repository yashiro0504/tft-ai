'use client'

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, RefreshCw, Search } from 'lucide-react'
import type {
  MetaChampRanking,
  MetaCompRanking,
  MetaDeckRanking,
  MetaItemRanking,
  MetaTraitRanking,
  TftMetaResponse,
} from '@/lib/types'
import '../rank/rank.css'
import '../rank/tabs.css'

type TabId = 'decks' | 'comps' | 'champions' | 'traits' | 'items'

const TABS: { id: TabId; label: string }[] = [
  { id: 'decks', label: '덱' },
  { id: 'comps', label: 'BIS' },
  { id: 'champions', label: '기물' },
  { id: 'traits', label: '시너지' },
  { id: 'items', label: '아이템' },
]

type Tier = 'S' | 'A' | 'B' | 'C' | 'D'
const TIERS: ('전체' | Tier)[] = ['전체', 'S', 'A', 'B', 'C', 'D']
const SORT_LABEL: Record<'avg' | 'top4' | 'sample', string> = {
  avg: '평균등수',
  top4: 'TOP4',
  sample: '표본',
}
type SortKey = keyof typeof SORT_LABEL

/** 평균등수 분포 기준 상대 티어 (절대 임계값 대신 상위 퍼센타일) */
function assignTiers(avgs: number[]): Tier[] {
  const order = avgs.map((a, i) => ({ a, i })).sort((x, y) => x.a - y.a)
  const out: Tier[] = new Array(avgs.length).fill('D')
  const total = order.length || 1
  order.forEach((it, idx) => {
    const p = idx / total
    out[it.i] = p < 0.1 ? 'S' : p < 0.3 ? 'A' : p < 0.6 ? 'B' : p < 0.85 ? 'C' : 'D'
  })
  return out
}

function tierClass(tier: string) {
  const t = (tier || '').toUpperCase()
  return ['S', 'A', 'B', 'C', 'D'].includes(t) ? `rk-tier rk-t${t}` : 'rk-tier rk-tC'
}

function fmtDate(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

interface Row {
  key: string
  name: string
  img?: string
  cost?: number
  avg: number
  top4: number
  sample: number
  tier: Tier
  third?: number
  bis?: { key: string; name: string; iconUrl: string }[]
  deck?: MetaDeckRanking
  delta?: number
}

export function MetaDashboard({
  onOpenCoach,
  initialData,
}: {
  onOpenCoach?: () => void
  initialData?: TftMetaResponse
}) {
  const [data, setData] = useState<TftMetaResponse | null>(initialData ?? null)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('decks')
  const [tier, setTier] = useState<'전체' | Tier>('전체')
  const [sort, setSort] = useState<SortKey>('avg')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/tft/meta', { cache: 'no-store' })
      const json: TftMetaResponse = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || '메타 데이터를 불러오지 못했습니다.')
      setData(json)
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

  const rowsAll = useMemo<Row[]>(() => {
    if (!data) return []
    if (tab === 'decks') {
      const tiers = assignTiers(data.decks.map((d) => d.avgPlacement ?? 9))
      return data.decks.map((d, i) => ({
        key: d.id,
        name: d.name,
        avg: d.avgPlacement ?? 9,
        top4: d.top4Rate ?? 0,
        sample: d.sampleSize,
        tier: tiers[i],
        deck: d,
      }))
    }
    if (tab === 'comps') {
      const src: MetaCompRanking[] = data.comps ?? []
      const tiers = assignTiers(src.map((c) => c.avgPlacement))
      return src.map((c, i) => ({
        key: c.key,
        name: c.name,
        img: c.imgUrl,
        cost: c.cost,
        avg: c.avgPlacement,
        top4: c.top4Rate,
        sample: c.sampleSize,
        tier: tiers[i],
        third: c.threeStarRate,
        bis: (c.items ?? []).slice(0, 3),
        delta: c.avgDelta,
      }))
    }
    if (tab === 'champions') {
      const src: MetaChampRanking[] = data.champions ?? []
      const tiers = assignTiers(src.map((c) => c.avgPlacement))
      return src.map((c, i) => ({
        key: c.key,
        name: c.name,
        img: c.imgUrl,
        cost: c.cost,
        avg: c.avgPlacement,
        top4: c.top4Rate,
        sample: c.sampleSize,
        tier: tiers[i],
        third: c.threeStarRate,
        delta: c.avgDelta,
      }))
    }
    if (tab === 'traits') {
      const src: MetaTraitRanking[] = data.traits ?? []
      const tiers = assignTiers(src.map((t) => t.avgPlacement))
      return src.map((t, i) => ({
        key: t.key,
        name: t.name,
        img: t.iconUrl,
        avg: t.avgPlacement,
        top4: t.top4Rate,
        sample: t.sampleSize,
        tier: tiers[i],
        delta: t.avgDelta,
      }))
    }
    const src: MetaItemRanking[] = data.items ?? []
    const tiers = assignTiers(src.map((it) => it.avgPlacement))
    return src.map((it, i) => ({
      key: it.key,
      name: it.name,
      img: it.iconUrl,
      avg: it.avgPlacement,
      top4: it.top4Rate,
      sample: it.sampleSize,
      tier: tiers[i],
      delta: it.avgDelta,
    }))
  }, [data, tab])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = rowsAll.filter((r) => {
      const tierOk = tier === '전체' || r.tier === tier
      const qOk = !q || r.name.toLowerCase().includes(q)
      return tierOk && qOk
    })
    return [...filtered].sort((a, b) => {
      if (sort === 'top4') return b.top4 - a.top4
      if (sort === 'sample') return b.sample - a.sample
      return a.avg - b.avg
    })
  }, [rowsAll, tier, sort, query])

  const selected = useMemo(
    () => (tab === 'decks' ? rows.find((r) => r.key === selectedId)?.deck || rows[0]?.deck || null : null),
    [rows, selectedId, tab],
  )

  const totalSample = useMemo(() => (data?.decks ?? []).reduce((s, d) => s + (d.sampleSize || 0), 0), [data])
  const countOf = (t: '전체' | Tier) => (t === '전체' ? rowsAll.length : rowsAll.filter((r) => r.tier === t).length)

  const colClass = tab === 'comps' ? 'cols-bis' : tab === 'champions' ? 'cols-champ' : 'cols-stat'

  return (
    <>
      <div className={`rk-shell ${tab === 'decks' ? '' : 'no-detail'}`}>
        <aside className="rk-rail">
          <div className="rk-group">
            <p className="rk-label">티어</p>
            {TIERS.filter((t) => t === '전체' || countOf(t) > 0).map((t) => (
              <button
                key={t}
                type="button"
                className={`rk-filter ${tier === t ? 'on' : ''}`}
                onClick={() => setTier(t)}
              >
                <span>{t}</span>
                <span className="rk-count">{countOf(t)}</span>
              </button>
            ))}
          </div>
          <div className="rk-group">
            <p className="rk-label">정렬</p>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
              <button
                key={k}
                type="button"
                className={`rk-filter ${sort === k ? 'on' : ''}`}
                onClick={() => setSort(k)}
              >
                <span>{SORT_LABEL[k]}</span>
              </button>
            ))}
          </div>
          <button type="button" className="rk-refresh" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5" /> 새로고침
          </button>
        </aside>

        <main className="rk-main">
          <header className="rk-head">
            <h1>시즌 18 메타 랭킹</h1>
            <p>
              {data?.patch ? `패치 ${data.patch}` : '패치 정보 없음'}
              <span className="rk-sep">/</span>
              표본 {totalSample.toLocaleString()}판
              <span className="rk-sep">/</span>
              덱 {(data?.decks ?? []).length}개
              {data?.generatedAt ? (
                <>
                  <span className="rk-sep">/</span>
                  수집 {fmtDate(data.generatedAt)}
                </>
              ) : null}
            </p>
          </header>

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
                    setTab(t.id)
                    setSelectedId(null)
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <label className="rk-search">
              <Search className="h-3.5 w-3.5" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="이름 검색"
                aria-label="검색"
              />
            </label>
            <span className="rk-sorted">{rows.length}개 표시 중</span>
            {onOpenCoach ? (
              <button type="button" className="rk-tab" onClick={onOpenCoach}>
                AI 코치
              </button>
            ) : null}
          </div>

          {error ? (
            <div className="rk-error">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
              <button type="button" onClick={() => void load()}>다시 시도</button>
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
                <span>이름</span>
                {tab === 'comps' ? <span>BIS</span> : null}
                {tab === 'champions' ? <span className="num">3성률</span> : null}
                <span className="num">평균등수</span>
                <span className="num">TOP4</span>
                <span className="num">표본</span>
              </div>
              {rows.map((r, i) => (
                <button
                  key={r.key}
                  type="button"
                  className={`rk-row ${colClass} ${selected && r.deck && selected.id === r.deck.id ? 'sel' : ''}`}
                  onClick={() => (tab === 'decks' ? setSelectedId(r.key) : null)}
                >
                  <span className="rk-rank">{String(i + 1).padStart(2, '0')}</span>
                  <span className={tierClass(r.tier)}>{r.tier}</span>
                  <span className="rk-comp">
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
                      <span className="rk-units">
                        {r.deck.units.slice(0, 7).map((u) => (
                          <span key={`${r.key}-${u.key}-${u.index}`} className={`rk-unit c${u.cost ?? 1}`}>
                            <img src={u.imgUrl} alt="" loading="lazy" />
                            <em>{u.star >= 2 ? `★${u.star}` : ''}</em>
                          </span>
                        ))}
                        {r.deck.units.length > 7 ? <span className="rk-more">+{r.deck.units.length - 7}</span> : null}
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
                    {r.avg ? r.avg.toFixed(2) : '-'}
                    <i className="rk-bar">
                      <i style={{ width: `${Math.max(4, Math.min(100, ((5.0 - r.avg) / 1.2) * 100))}%` }} />
                    </i>
                  </span>
                  <span className="rk-num">{Math.round(r.top4 * 100)}%</span>
                  <span className="rk-num dim">{r.sample.toLocaleString()}</span>
                </button>
              ))}
              {!rows.length && !loading ? <p className="rk-empty">조건에 맞는 항목이 없습니다. 필터를 초기화해 보세요.</p> : null}
            </>
          )}
        </main>

        {tab === 'decks' ? (
          <aside className="rk-detail">
            {selected ? <DeckDetail deck={selected} /> : <p className="rk-empty">덱을 선택하세요.</p>}
          </aside>
        ) : null}
      </div>
    </>
  )
}

function DeckDetail({ deck }: { deck: MetaDeckRanking }) {
  const carry = deck.units.find((u) => u.key === deck.carryKey) || deck.units[0]
  return (
    <div>
      <div className="rk-dhead">
        <span className={tierClass(deck.tier)}>{(deck.tier || '-').toUpperCase()}</span>
        <h2>{deck.name}</h2>
      </div>
      <p className="rk-dmeta">
        {deck.gold != null ? `${deck.gold}g` : `${deck.unitCost}코`}
        <span className="rk-sep">·</span>
        기물 {deck.units.length}
        <span className="rk-sep">·</span>
        커버리지 {Math.round((deck.coverage || 0) * 100)}%
      </p>

      <div className="rk-kpis">
        <div>
          <span>평균등수</span>
          <b>{deck.avgPlacement != null ? deck.avgPlacement.toFixed(2) : '-'}</b>
        </div>
        <div>
          <span>TOP4</span>
          <b>{deck.top4Rate != null ? `${Math.round(deck.top4Rate * 100)}%` : '-'}</b>
        </div>
        <div>
          <span>표본</span>
          <b>{deck.sampleSize.toLocaleString()}</b>
        </div>
        <div>
          <span>시너지</span>
          <b>{deck.traits.length}</b>
        </div>
      </div>

      <p className="rk-label">보드</p>
      <div className="rk-board">
        {deck.units.slice(0, 8).map((u) => (
          <div key={`b-${u.key}-${u.index}`} className={`rk-cell c${u.cost ?? 1}`}>
            <img src={u.imgUrl} alt={u.name} loading="lazy" />
            <em>{u.star >= 2 ? `★${u.star}` : ''}</em>
          </div>
        ))}
      </div>

      <p className="rk-label">시너지</p>
      <div className="rk-traits">
        {deck.traits.map((t) => (
          <span key={t.key}>
            {t.name} <b>{t.count}</b>
          </span>
        ))}
      </div>

      {carry ? (
        <>
          <p className="rk-label">핵심 캐리 아이템</p>
          <div className="rk-items">
            <span className="rk-item-name">{carry.name}</span>
            <span className="rk-item-list">
              {carry.items.length ? carry.items.map((it) => <span key={it.key}>{it.name}</span>) : <em>데이터 없음</em>}
            </span>
          </div>
        </>
      ) : null}
    </div>
  )
}

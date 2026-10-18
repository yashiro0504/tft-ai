'use client'

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, RefreshCw, Search } from 'lucide-react'
import type { MetaDeckRanking, TftMetaResponse } from '@/lib/types'
import { SiteHeader } from '../components/SiteHeader'
import './rank.css'

const TIERS = ['전체', 'S', 'A', 'B', 'C', 'D'] as const
type TierFilter = (typeof TIERS)[number]
type SortKey = 'avg' | 'top4' | 'sample'

const SORT_LABEL: Record<SortKey, string> = {
  avg: '평균등수',
  top4: 'TOP4',
  sample: '표본',
}

function fmtDate(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function tierClass(tier: string) {
  const t = (tier || '').toUpperCase()
  return ['S', 'A', 'B', 'C', 'D'].includes(t) ? `rk-tier rk-t${t}` : 'rk-tier rk-tC'
}

export default function RankPage() {
  const router = useRouter()
  const [data, setData] = useState<TftMetaResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tier, setTier] = useState<TierFilter>('전체')
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
    void load()
  }, [])

  const decks = data?.decks ?? []

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = decks.filter((d) => {
      const tierOk = tier === '전체' || (d.tier || '').toUpperCase() === tier
      const qOk =
        !q ||
        d.name.toLowerCase().includes(q) ||
        d.units.some((u) => u.name.toLowerCase().includes(q)) ||
        d.traits.some((t) => t.name.toLowerCase().includes(q))
      return tierOk && qOk
    })
    return [...filtered].sort((a, b) => {
      if (sort === 'top4') return (b.top4Rate ?? 0) - (a.top4Rate ?? 0)
      if (sort === 'sample') return b.sampleSize - a.sampleSize
      return (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9)
    })
  }, [decks, tier, sort, query])

  const selected = useMemo(
    () => rows.find((d) => d.id === selectedId) || rows[0] || null,
    [rows, selectedId],
  )

  const totalSample = useMemo(() => decks.reduce((sum, d) => sum + (d.sampleSize || 0), 0), [decks])
  const tierCount = (t: string) => decks.filter((d) => (d.tier || '').toUpperCase() === t).length

  return (
    <>
      <SiteHeader active="meta" onChange={(tab) => router.push(tab === 'coach' ? '/?tab=coach' : '/')} />
      <div className="rk-shell">
        <aside className="rk-rail">
          <div className="rk-group">
            <p className="rk-label">티어</p>
            {TIERS.filter((t) => t === '전체' || tierCount(t) > 0).map((t) => (
              <button
                key={t}
                type="button"
                className={`rk-filter ${tier === t ? 'on' : ''}`}
                onClick={() => setTier(t)}
              >
                <span>{t}</span>
                <span className="rk-count">{t === '전체' ? decks.length : tierCount(t)}</span>
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
              덱 {decks.length}개
              {data?.generatedAt ? (
                <>
                  <span className="rk-sep">/</span>
                  수집 {fmtDate(data.generatedAt)}
                </>
              ) : null}
            </p>
          </header>

          <div className="rk-toolbar">
            <label className="rk-search">
              <Search className="h-3.5 w-3.5" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="덱, 기물, 시너지 검색"
                aria-label="검색"
              />
            </label>
            <span className="rk-sorted">{rows.length}개 표시 중</span>
          </div>

          {error ? (
            <div className="rk-error">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
              <button type="button" onClick={() => void load()}>다시 시도</button>
            </div>
          ) : null}

          {loading && !decks.length ? (
            <div className="rk-skeleton">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="rk-skel-row" />
              ))}
            </div>
          ) : (
            <>
              <div className="rk-thead">
                <span>#</span>
                <span>티어</span>
                <span>덱 / 구성</span>
                <span className="num">평균등수</span>
                <span className="num">TOP4</span>
                <span className="num">표본</span>
              </div>
              {rows.map((deck, i) => (
                <button
                  key={deck.id}
                  type="button"
                  className={`rk-row ${selected && selected.id === deck.id ? 'sel' : ''}`}
                  onClick={() => setSelectedId(deck.id)}
                >
                  <span className="rk-rank">{String(i + 1).padStart(2, '0')}</span>
                  <span className={tierClass(deck.tier)}>{(deck.tier || '-').toUpperCase()}</span>
                  <span className="rk-comp">
                    <span className="rk-name">{deck.name}</span>
                    <span className="rk-units">
                      {deck.units.slice(0, 7).map((u) => (
                        <span key={`${deck.id}-${u.key}-${u.index}`} className={`rk-unit c${u.cost ?? 1}`}>
                          <img src={u.imgUrl} alt="" loading="lazy" />
                          <em>{u.star >= 2 ? `★${u.star}` : ''}</em>
                        </span>
                      ))}
                      {deck.units.length > 7 ? <span className="rk-more">+{deck.units.length - 7}</span> : null}
                    </span>
                  </span>
                  <span className="rk-num">
                    {deck.avgPlacement != null ? deck.avgPlacement.toFixed(2) : '-'}
                    <i className="rk-bar">
                      <i
                        style={{
                          width:
                            deck.avgPlacement != null
                              ? `${Math.max(4, Math.min(100, ((5.0 - deck.avgPlacement) / 1.2) * 100))}%`
                              : '0%',
                        }}
                      />
                    </i>
                  </span>
                  <span className="rk-num">{deck.top4Rate != null ? `${Math.round(deck.top4Rate * 100)}%` : '-'}</span>
                  <span className="rk-num dim">{deck.sampleSize.toLocaleString()}</span>
                </button>
              ))}
              {!rows.length && !loading ? <p className="rk-empty">조건에 맞는 덱이 없습니다. 필터를 초기화해 보세요.</p> : null}
            </>
          )}
        </main>

        <aside className="rk-detail">
          {selected ? <DeckDetail deck={selected} /> : <p className="rk-empty">덱을 선택하세요.</p>}
        </aside>
      </div>
      <footer className="rk-footer">
        <span>출처 Riot 실측 매치 표본</span>
        <span>TFT LAB is not endorsed by Riot Games</span>
      </footer>
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

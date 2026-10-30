import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { deckHeadline, deckSnapshotLabel, resolveDeckPage, type DeckPageData } from '@/lib/deckPage'
import { SimpleHeader } from '@/app/components/SimpleHeader'
import { SiteFooter } from '@/app/components/SiteFooter'
import { ShareButton } from '@/app/components/ShareButton'
import { DeckViewTracker } from '@/app/components/DeckViewTracker'
import { SITE_URL } from '@/lib/site'
import { entityHref } from '@/lib/entitySlug'
import { TIER_FILTER_OPTIONS, type TierFilter } from '@/lib/statsShared'
import type { MetaDeckRanking } from '@/lib/types'
import '../../rank/rank.css'
import '../deck.css'

export const revalidate = 300

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const PATCH_RE = /^\d{1,2}\.\d{1,2}$/

/** ?patch=&tier= 검증 (모르는 값은 무시) */
function parseDeckQuery(sp: Record<string, string | string[] | undefined>): { patch: string | null; tier: TierFilter | null } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const patch = one(sp.patch)
  const tier = one(sp.tier).toLowerCase()
  return {
    patch: PATCH_RE.test(patch) ? patch : null,
    tier: TIER_FILTER_OPTIONS.some((t) => t.id === tier) ? (tier as TierFilter) : null,
  }
}

/**
 * 덱 해석 (metadata 와 본문이 요청 안에서 같은 결과를 쓴다) — lib/deckPage.
 * 기본은 메타 랭킹과 같은 스냅샷 하나, 스냅샷에 없는 id 는 404 (래더 JSON 폴백 삭제 · 2026-10-30 2차 지시문 1).
 */
const resolveDeck = cache((id: string, patch: string | null, tier: TierFilter | null) => resolveDeckPage(id, { patch, tier }))

/** 필터 덱은 해석된 패치·티어를 쿼리에 실어 공유해도 같은 덱이 열리게 한다 */
function deckPath(id: string, r: DeckPageData): string {
  return r.query ? `/deck/${id}?patch=${r.query.patch}&tier=${r.query.tier}` : `/deck/${id}`
}

function pct(value: number | null | undefined) {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '-'
}

function avg(value: number | null | undefined) {
  return typeof value === 'number' ? value.toFixed(2) : '-'
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: SearchParams
}): Promise<Metadata> {
  const { id } = await params
  const q = parseDeckQuery(await searchParams)
  const resolved = await resolveDeck(id, q.patch, q.tier)

  if (!resolved) {
    return { title: '덱을 찾을 수 없습니다', robots: { index: false, follow: false } }
  }
  const { deck } = resolved
  const canonical = `${SITE_URL}${deckPath(id, resolved)}`

  // 본문·OG 이미지와 같은 스냅샷 값 (deckHeadline 하나로 만든다)
  const title = `${deck.name} 덱 — ${deckHeadline(deck)}`
  const description = `TFT ${deckSnapshotLabel(resolved)} ${deck.name} 덱. ${deckHeadline(deck)}, 표본 ${deck.sampleSize.toLocaleString()}판. 유닛·아이템·시너지 구성을 확인하세요.`

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: 'article',
      siteName: 'TFT LAB',
      locale: 'ko_KR',
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function DeckPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params
  const q = parseDeckQuery(await searchParams)
  const resolved = await resolveDeck(id, q.patch, q.tier)
  if (!resolved) notFound()
  const { deck } = resolved
  const tier = (deck.tier || 'C').toUpperCase()
  const flexCount = deck.units.filter((unit) => unit.flex).length

  // 보드 좌표(index)가 충분하면 4×7 그리드에 배치하고, 아니면 순서대로 채운다.
  const boardSize = 28
  const indexed = deck.units.filter(
    (unit) => typeof unit.index === 'number' && unit.index >= 0 && unit.index < boardSize
  )
  const useIndex = indexed.length >= 4
  const cells: (MetaDeckRanking['units'][number] | null)[] = Array.from({ length: boardSize }, () => null)

  if (useIndex) {
    for (const unit of indexed) cells[unit.index as number] = unit
  } else {
    deck.units.slice(0, boardSize).forEach((unit, index) => {
      cells[index] = unit
    })
  }

  return (
    <div className="min-h-screen bg-app text-ink">
      <SimpleHeader active="meta" />
      <DeckViewTracker deckId={deck.id} />

      <div className="rk-shell rk-deck">
        <main className="rk-deck-main">
          <nav className="rk-deck-crumb">
            <Link href="/rank">메타 랭킹</Link>
            <span>/</span>
            <span>덱</span>
          </nav>

          <header className="rk-deck-hero">
            <div className="rk-deck-title">
              <span className={`rk-tier rk-t${tier}`}>{tier}</span>
              <h1>{deck.name}</h1>
            </div>
            <p className="rk-deck-meta">
              {deckSnapshotLabel(resolved)}
              <span className="rk-sep">/</span>
              평균 <b>{avg(deck.avgPlacement)}</b>등
              <span className="rk-sep">/</span>
              TOP4 <b>{pct(deck.top4Rate)}</b>
              <span className="rk-sep">/</span>
              표본 <b>{deck.sampleSize.toLocaleString()}</b>판
              <span className="rk-sep">/</span>
              {deck.units.length}유닛 · {deck.unitCost}코
              {flexCount ? ` (플렉스 ${flexCount})` : ''}
            </p>
            <div className="rk-deck-actions">
              <ShareButton path={deckPath(deck.id, resolved)} label="덱 링크 복사" surface="deck_page" />
              <Link href="/rank" className="rk-deck-link">
                랭킹으로 돌아가기
              </Link>
            </div>
          </header>

          <section>
            <p className="rk-label">{useIndex ? '보드' : '구성'}</p>
            {useIndex ? (
              <div className="rk-deck-board">
                {cells.map((unit, index) => (
                  <div
                    key={unit ? `${unit.key}-${index}` : `empty-${index}`}
                    className={`rk-deck-cell${unit ? ` c${unit.cost ?? 1}${unit.flex ? ' is-flex' : ''}` : ' empty'}`}
                    title={unit?.flex ? '플렉스(선택) — 시너지 최대 단계 초과' : undefined}
                  >
                    {unit ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={unit.imgUrl} alt={unit.name} loading="lazy" />
                        {unit.star >= 2 ? <em>{`★${unit.star}`}</em> : null}
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rk-deck-comp">
                {deck.units.map((unit) => (
                  <div
                    key={`${unit.key}-${unit.index ?? 'x'}`}
                    className={`rk-deck-comp-unit${unit.flex ? ' is-flex' : ''}`}
                  >
                    <div className={`rk-deck-comp-icon c${unit.cost ?? 1}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={unit.imgUrl} alt={unit.name} loading="lazy" />
                      {unit.star >= 2 ? <em>{`★${unit.star}`}</em> : null}
                    </div>
                    <span>{unit.name}</span>
                    {unit.flex ? <em className="rk-deck-flex-label">플렉스</em> : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <p className="rk-label">유닛</p>
            <div className="rk-deck-units">
              {deck.units.map((unit) => (
                <div
                  key={`${unit.key}-${unit.index ?? 'x'}`}
                  className={`rk-deck-unit${unit.flex ? ' is-flex' : ''}`}
                >
                  <div className={`rk-deck-unit-icon c${unit.cost ?? 1}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={unit.imgUrl} alt={unit.name} loading="lazy" />
                    {unit.star >= 2 ? <em>{`★${unit.star}`}</em> : null}
                  </div>
                  <div className="rk-deck-unit-body">
                    <div className="rk-deck-unit-name">
                      <Link href={entityHref('champion', unit.key)} className="rk-deck-unit-link">
                        <b>{unit.name}</b>
                      </Link>
                      <span>{unit.cost != null ? `${unit.cost}코` : '코스트 ?'}</span>
                      {unit.flex ? <span className="rk-deck-flex-badge">플렉스</span> : null}
                    </div>
                    {unit.items.length ? (
                      <div className="rk-deck-items">
                        {unit.items.map((item) => (
                          <Link key={item.key} href={entityHref('item', item.key)} title={item.name}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={item.iconUrl} alt={item.name} loading="lazy" />
                          </Link>
                        ))}
                      </div>
                    ) : null}
                    {unit.stat ? (
                      <p className="rk-deck-stat">
                        {avg(unit.stat.avgPlacement)}등 · TOP4 {pct(unit.stat.top4Rate)} ·{' '}
                        {unit.stat.sampleSize.toLocaleString()}판
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <p className="rk-label">시너지</p>
            <div className="rk-traits">
              {deck.traits.map((trait) => (
                <Link key={trait.key} href={entityHref('trait', trait.key)} className="rk-deck-trait-link">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={trait.iconUrl} alt="" loading="lazy" />
                  {trait.name} <b>{trait.count}</b>
                </Link>
              ))}
            </div>
          </section>
        </main>
      </div>

      <SiteFooter />
    </div>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getDeckMetaInfo, getDeckViews, type DeckView } from '@/lib/decks'
import { SimpleHeader } from '@/app/components/SimpleHeader'
import { SiteFooter } from '@/app/components/SiteFooter'
import { ShareButton } from '@/app/components/ShareButton'
import { DeckViewTracker } from '@/app/components/DeckViewTracker'
import { SITE_URL } from '@/lib/site'
import '../../rank/rank.css'
import '../deck.css'

export const revalidate = 300

/** 빌드 타임 덱 목록을 정적 파라미터로 사용 (데이터 갱신 시 재배포/ISR). */
export function generateStaticParams() {
  return getDeckViews().map((deck) => ({ id: deck.id }))
}

const getDeck = cache((id: string): DeckView | null => {
  return getDeckViews().find((deck) => deck.id === id) ?? null
})

function pct(value: number | null | undefined) {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '-'
}

function avg(value: number | null | undefined) {
  return typeof value === 'number' ? value.toFixed(2) : '-'
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const deck = getDeck(id)
  const canonical = `${SITE_URL}/deck/${id}`

  if (!deck) {
    return { title: '덱을 찾을 수 없습니다', robots: { index: false, follow: false } }
  }

  const title = `${deck.name} 덱 — 평균 ${avg(deck.avgPlacement)}위 · TOP4 ${pct(deck.top4Rate)}`
  const description = `TFT 시즌 18 ${deck.name} 덱. 평균 ${avg(deck.avgPlacement)}위, 순방률 ${pct(deck.top4Rate)}, 표본 ${deck.sampleSize.toLocaleString()}판. 유닛·아이템·시너지 구성을 확인하세요.`

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

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const deck = getDeck(id)
  if (!deck) notFound()

  const meta = getDeckMetaInfo()
  const tier = (deck.tier || 'C').toUpperCase()

  // 보드 좌표(index)가 충분하면 4×7 그리드에 배치하고, 아니면 순서대로 채운다.
  const boardSize = 28
  const indexed = deck.units.filter(
    (unit) => typeof unit.index === 'number' && unit.index >= 0 && unit.index < boardSize
  )
  const useIndex = indexed.length >= 4
  const cells: (DeckView['units'][number] | null)[] = Array.from({ length: boardSize }, () => null)

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
              {meta.patch ? `패치 ${meta.patch}` : '패치 정보 없음'}
              <span className="rk-sep">/</span>
              평균 <b>{avg(deck.avgPlacement)}</b>위
              <span className="rk-sep">/</span>
              TOP4 <b>{pct(deck.top4Rate)}</b>
              <span className="rk-sep">/</span>
              표본 <b>{deck.sampleSize.toLocaleString()}</b>판
              <span className="rk-sep">/</span>
              {deck.units.length}유닛 · {deck.unitCost}코
            </p>
            <div className="rk-deck-actions">
              <ShareButton path={`/deck/${deck.id}`} label="덱 링크 복사" surface="deck_page" />
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
                    key={unit ? `${unit.lolchessKey}-${index}` : `empty-${index}`}
                    className={`rk-deck-cell${unit ? ` c${unit.cost ?? 1}` : ' empty'}`}
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
                  <div key={`${unit.lolchessKey}-${unit.index ?? 'x'}`} className="rk-deck-comp-unit">
                    <div className={`rk-deck-comp-icon c${unit.cost ?? 1}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={unit.imgUrl} alt={unit.name} loading="lazy" />
                      {unit.star >= 2 ? <em>{`★${unit.star}`}</em> : null}
                    </div>
                    <span>{unit.name}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <p className="rk-label">유닛</p>
            <div className="rk-deck-units">
              {deck.units.map((unit) => (
                <div key={`${unit.lolchessKey}-${unit.index ?? 'x'}`} className="rk-deck-unit">
                  <div className={`rk-deck-unit-icon c${unit.cost ?? 1}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={unit.imgUrl} alt={unit.name} loading="lazy" />
                    {unit.star >= 2 ? <em>{`★${unit.star}`}</em> : null}
                  </div>
                  <div className="rk-deck-unit-body">
                    <div className="rk-deck-unit-name">
                      <b>{unit.name}</b>
                      <span>{unit.cost != null ? `${unit.cost}코` : '코스트 ?'}</span>
                    </div>
                    {unit.items.length ? (
                      <div className="rk-deck-items">
                        {unit.items.map((item) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={item.key} src={item.iconUrl} alt={item.name} title={item.name} loading="lazy" />
                        ))}
                      </div>
                    ) : null}
                    {unit.stat ? (
                      <p className="rk-deck-stat">
                        {avg(unit.stat.avgPlacement)}위 · TOP4 {pct(unit.stat.top4Rate)} ·{' '}
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
                <span key={trait.key}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={trait.iconUrl} alt="" loading="lazy" />
                  {trait.name} <b>{trait.count}</b>
                </span>
              ))}
            </div>
          </section>
        </main>
      </div>

      <SiteFooter />
    </div>
  )
}

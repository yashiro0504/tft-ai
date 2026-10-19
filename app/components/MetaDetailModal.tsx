'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { useEffect, type ReactNode } from 'react'
import { entityHref } from '@/lib/entitySlug'
import type { TftMetaResponse } from '@/lib/types'
import { ITEM_CLASS_LABEL, classifyItem, normKey, tierClass, type ModalTarget } from './metaShared'

function fmtAvg(value?: number | null) {
  return typeof value === 'number' ? value.toFixed(2) : '-'
}

function fmtPct(value?: number | null) {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '-'
}

/** 기물/아이템/시너지 상세 모달 */
export function DetailModal({
  data,
  target,
  onClose,
}: {
  data: TftMetaResponse
  target: ModalTarget
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  let title = ''
  let badge = ''
  let body: ReactNode = null

  if (target.type === 'champion') {
    const champ =
      (data.champions ?? []).find((c) => c.key === target.key) ||
      (data.comps ?? []).find((c) => c.key === target.key)
    const bis = (data.combos ?? [])
      .filter((c) => c.champKey === target.key || normKey(c.champKey) === normKey(target.key))
      .sort((a, b) => a.avgPlacement - b.avgPlacement)
      .slice(0, 3)
    const decks = (data.decks ?? [])
      .filter((d) => d.units.some((u) => normKey(u.key) === normKey(target.key)))
      .slice(0, 3)

    title = champ?.name || target.key
    badge = champ?.cost ? `${champ.cost}코` : ''

    body = (
      <>
        <div className="rk-mstats">
          <div><span>평균등수</span><b>{fmtAvg(champ?.avgPlacement)}</b></div>
          <div><span>TOP4</span><b>{fmtPct(champ?.top4Rate)}</b></div>
          <div><span>표본</span><b>{champ ? champ.sampleSize.toLocaleString() : '-'}</b></div>
          <div><span>3성률</span><b>{fmtPct(champ?.threeStarRate)}</b></div>
        </div>

        <p className="rk-label">BIS 아이템</p>
        {bis.length ? (
          <div className="rk-mitems">
            {bis.map((item) => (
              <div key={item.key} className="rk-mrow">
                <img src={item.itemIconUrl} alt="" loading="lazy" />
                <span className="rk-mname">{item.itemName}</span>
                <span className="rk-mval">{fmtAvg(item.avgPlacement)}위 · {item.sampleSize.toLocaleString()}판</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="rk-mempty">BIS 조합 표본이 없습니다.</p>
        )}

        <p className="rk-label">이 기물이 포함된 덱</p>
        {decks.length ? (
          <div className="rk-mdecks">
            {decks.map((deck) => (
              <div key={deck.id} className="rk-mrow">
                <span className={tierClass(deck.tier || 'C')}>{deck.tier || '-'}</span>
                <span className="rk-mname">{deck.name}</span>
                <span className="rk-mval">{fmtAvg(deck.avgPlacement)}위</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="rk-mempty">포함된 덱이 없습니다.</p>
        )}
      </>
    )
  } else if (target.type === 'item') {
    const item = (data.items ?? []).find((i) => i.key === target.key)
    const users = (data.combos ?? [])
      .filter((c) => normKey(c.itemKey) === normKey(target.key))
      .sort((a, b) => a.avgPlacement - b.avgPlacement)
      .slice(0, 5)
    const decks = (data.decks ?? [])
      .filter((d) =>
        d.units.some((u) => (u.items ?? []).some((it) => normKey(it.key) === normKey(target.key)))
      )
      .slice(0, 3)

    title = item?.name || target.key
    badge = ITEM_CLASS_LABEL[classifyItem(target.key)]

    body = (
      <>
        <div className="rk-mstats">
          <div><span>평균등수</span><b>{fmtAvg(item?.avgPlacement)}</b></div>
          <div><span>TOP4</span><b>{fmtPct(item?.top4Rate)}</b></div>
          <div><span>표본</span><b>{item ? item.sampleSize.toLocaleString() : '-'}</b></div>
          <div><span>분류</span><b>{badge}</b></div>
        </div>

        <p className="rk-label">이 아이템을 쓰는 기물</p>
        {users.length ? (
          <div className="rk-musers">
            {users.map((row) => (
              <div key={row.key} className="rk-mrow">
                <img src={row.champImgUrl} alt="" loading="lazy" />
                <span className="rk-mname">{row.champName}</span>
                <span className="rk-mval">{fmtAvg(row.avgPlacement)}위 · {row.sampleSize.toLocaleString()}판</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="rk-mempty">BIS 조합 표본이 없습니다.</p>
        )}

        <p className="rk-label">이 아이템이 포함된 덱</p>
        {decks.length ? (
          <div className="rk-mdecks">
            {decks.map((deck) => (
              <div key={deck.id} className="rk-mrow">
                <span className={tierClass(deck.tier || 'C')}>{deck.tier || '-'}</span>
                <span className="rk-mname">{deck.name}</span>
                <span className="rk-mval">{fmtAvg(deck.avgPlacement)}위</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="rk-mempty">포함된 덱이 없습니다.</p>
        )}
      </>
    )
  } else {
    const trait = (data.traits ?? []).find((t) => t.key === target.key)
    const decks = (data.decks ?? [])
      .filter((d) => d.traits.some((t) => normKey(t.key) === normKey(target.key)))
      .slice(0, 5)

    title = trait?.name || target.key
    badge = '시너지'

    body = (
      <>
        <div className="rk-mstats">
          <div><span>평균등수</span><b>{fmtAvg(trait?.avgPlacement)}</b></div>
          <div><span>TOP4</span><b>{fmtPct(trait?.top4Rate)}</b></div>
          <div><span>표본</span><b>{trait ? trait.sampleSize.toLocaleString() : '-'}</b></div>
          <div><span>평균 단계</span><b>{trait?.avgTier ?? '-'}</b></div>
        </div>

        <p className="rk-label">이 시너지를 쓰는 덱</p>
        {decks.length ? (
          <div className="rk-mdecks">
            {decks.map((deck) => (
              <div key={deck.id} className="rk-mrow">
                <span className={tierClass(deck.tier || 'C')}>{deck.tier || '-'}</span>
                <span className="rk-mname">{deck.name}</span>
                <span className="rk-mval">{fmtAvg(deck.avgPlacement)}위</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="rk-mempty">포함된 덱이 없습니다.</p>
        )}
      </>
    )
  }

  return (
    <div className="rk-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="rk-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="rk-modal-x" onClick={onClose} aria-label="닫기">
          ×
        </button>
        <h2>
          {title}
          {badge ? <span className="rk-mcat">{badge}</span> : null}
        </h2>
        {body}
        <Link href={entityHref(target.type, target.key)} className="rk-modal-more">
          {title} 상세 페이지 보기 →
        </Link>
      </div>
    </div>
  )
}

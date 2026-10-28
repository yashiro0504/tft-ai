'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { useEffect, type ReactNode } from 'react'
import { entityHref } from '@/lib/entitySlug'
import { BIS_RELIABLE_SAMPLE, MIN_SAMPLE, byPickCount } from '@/lib/statsShared'
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
    // BIS 탭 행과 같은 아이템 (lib/statsShared buildCompSets — 채용 상위 3, 든 판 20판 이상) · 많이 든 3개 세트
    const comp = (data.comps ?? []).find((c) => c.key === target.key || normKey(c.key) === normKey(target.key))
    const bis = comp?.items ?? []
    const builds = comp?.builds
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

        <p className="rk-label">BIS 아이템 · 채용 상위 3</p>
        {bis.length ? (
          <>
            <div className="rk-mitems">
              {bis.map((item) => {
                const low = item.sampleSize < BIS_RELIABLE_SAMPLE
                return (
                  <div key={item.key} className={`rk-mrow ${low ? 'is-low' : ''}`}>
                    <img src={item.iconUrl} alt={item.name} loading="lazy" />
                    <span className="rk-mname">{item.name}</span>
                    <span className="rk-mval">
                      {fmtAvg(item.avgPlacement)}등 · 채용 {fmtPct(item.pickRate)} · {item.sampleSize.toLocaleString()}판
                      {low ? ' · 참고용' : ''}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="rk-mnote">이 기물이 그 아이템을 든 판의 평균등수 · 기물 판수 대비 채용률 (3개를 함께 든 판이 아닌 아이템 1개 단위)</p>
          </>
        ) : (
          <p className="rk-mempty">BIS 후보가 없습니다 (같은 아이템을 든 판 {MIN_SAMPLE.unit_item}판 이상).</p>
        )}

        {/* 빌드 집계가 없으면(0008 미적용·JSON 미생성) 섹션째 뺀다 */}
        {builds ? (
          <>
            <p className="rk-label">많이 쓰는 세트 · 아이템 3개</p>
            {builds.length ? (
              <>
                <div className="rk-mitems">
                  {builds.map((b) => {
                    const low = b.sampleSize < BIS_RELIABLE_SAMPLE
                    const names = b.items.map((it) => it.name).join(' + ')
                    return (
                      <div key={b.key} className={`rk-mrow ${low ? 'is-low' : ''}`} title={names}>
                        <span className="rk-mset">
                          {b.items.map((it, i) => (
                            // 같은 아이템 2개(예: 쇼진 2 + 공허)도 있어 순서로 키를 둔다
                            <img key={`${it.key}-${i}`} src={it.iconUrl} alt={it.name} loading="lazy" />
                          ))}
                        </span>
                        <span className="rk-mname">{names}</span>
                        <span className="rk-mval">
                          {fmtAvg(b.avgPlacement)}등 · 채용 {fmtPct(b.pickRate)} · {b.sampleSize.toLocaleString()}판
                          {low ? ' · 참고용' : ''}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <p className="rk-mnote">한 기물이 3개를 함께 든 판 · 덱 탭과 같은 기준(패치 단위, 하루 1회 집계)</p>
              </>
            ) : (
              <p className="rk-mempty">5판 이상 나온 3개 세트가 없습니다.</p>
            )}
          </>
        ) : null}

        <p className="rk-label">이 기물이 포함된 덱</p>
        {decks.length ? (
          <div className="rk-mdecks">
            {decks.map((deck) => (
              <div key={deck.id} className="rk-mrow">
                <span className={tierClass(deck.tier || 'C')}>{deck.tier || '-'}</span>
                <span className="rk-mname">{deck.name}</span>
                <span className="rk-mval">{fmtAvg(deck.avgPlacement)}등</span>
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
    // BIS 탭과 같은 규칙: 이 아이템을 든 판 20판 이상 중 채용 판 수 순 (평균등수 순이면 5판짜리 조합이 1위로 왔다)
    const users = (data.combos ?? [])
      .filter((c) => normKey(c.itemKey) === normKey(target.key) && c.sampleSize >= MIN_SAMPLE.unit_item)
      .sort(byPickCount)
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

        <p className="rk-label">이 아이템을 많이 드는 기물 · 채용 순</p>
        {users.length ? (
          <div className="rk-musers">
            {users.map((row) => {
              const low = row.sampleSize < BIS_RELIABLE_SAMPLE
              return (
                <div key={row.key} className={`rk-mrow ${low ? 'is-low' : ''}`}>
                  <img src={row.champImgUrl} alt={row.champName} loading="lazy" />
                  <span className="rk-mname">{row.champName}</span>
                  <span className="rk-mval">
                    {fmtAvg(row.avgPlacement)}등 · {row.sampleSize.toLocaleString()}판{low ? ' · 참고용' : ''}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="rk-mempty">이 아이템을 {MIN_SAMPLE.unit_item}판 이상 든 기물이 없습니다.</p>
        )}

        <p className="rk-label">이 아이템이 포함된 덱</p>
        {decks.length ? (
          <div className="rk-mdecks">
            {decks.map((deck) => (
              <div key={deck.id} className="rk-mrow">
                <span className={tierClass(deck.tier || 'C')}>{deck.tier || '-'}</span>
                <span className="rk-mname">{deck.name}</span>
                <span className="rk-mval">{fmtAvg(deck.avgPlacement)}등</span>
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
                <span className="rk-mval">{fmtAvg(deck.avgPlacement)}등</span>
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

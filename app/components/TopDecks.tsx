'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { MetaDeckRanking, TftMetaResponse } from '@/lib/types'
import { MIN_SAMPLE } from '@/lib/statsShared'
import { assignSampleTiers, tierClass, tierRank, type Tier } from './metaShared'
import { TraitHex, UnitHover, traitLevelFromCount } from './LabUI'
import '../rank/rank.css'

const COST_BORDER: Record<number, string> = {
  1: 'border-cost-1',
  2: 'border-cost-2',
  3: 'border-cost-3',
  4: 'border-cost-4',
  5: 'border-cost-5',
}

/**
 * 첫 화면의 "지금 메타 상위 덱" (티어 → 평균 등수 순 4개, 표본 부족 덱 제외).
 * 메타 랭킹과 같은 /api/tft/meta 응답과 같은 덱 티어(보정 평균등수 고정 구간, 50판 미만 제외)를 쓴다.
 */
export function TopDecks({ onOpenMeta }: { onOpenMeta: () => void }) {
  const [decks, setDecks] = useState<(MetaDeckRanking & { tier: Tier | '-' })[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/tft/meta?view=decks')
      .then((res) => res.json() as Promise<TftMetaResponse>)
      .then((data) => {
        if (cancelled || !data?.decks?.length) return
        const tiers = assignSampleTiers(
          data.decks.map((d) => ({ avg: d.avgPlacement ?? 9, sample: d.sampleSize })),
          MIN_SAMPLE.deck,
          { deck: true }
        )
        const ranked = data.decks
          .map((d, i) => ({ ...d, tier: tiers[i] }))
          .filter((d) => d.avgPlacement != null && d.tier !== '-')
          .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9))
          .slice(0, 4)
        setDecks(ranked)
      })
      .catch(() => {
        /* 첫 화면 보조 섹션: 실패하면 조용히 숨긴다 */
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!decks?.length) return null

  return (
    <section aria-labelledby="top-decks-title">
      <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="top-decks-title" className="text-xl font-bold text-ink">
          지금 메타 상위 덱
        </h2>
        <span className="text-sm text-subtle">실측 매치 표본 · 티어(표본 수 반영) 순</span>
        <button
          type="button"
          onClick={onOpenMeta}
          className="ml-auto cursor-pointer text-sm font-semibold text-accent hover:underline"
        >
          전체 랭킹 보기 →
        </button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
        {decks.map((d) => {
          const traits = d.traits
            .map((t) => ({ t, ...traitLevelFromCount(t.key, t.count) }))
            .filter((x) => x.level > 0)
            .sort((a, b) => b.level - a.level || b.t.count - a.t.count)
            .slice(0, 3)
          return (
            <Link
              key={d.id}
              href={`/deck/${d.id}`}
              className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-panel p-4 transition hover:border-accent"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className={tierClass(d.tier)}>{d.tier}</span>
                <h3 className="truncate text-base font-semibold text-ink">{d.name}</h3>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {traits.map(({ t, level, max }) => (
                  <TraitHex key={t.key} name={t.name} count={t.count} level={level} max={max} iconUrl={t.iconUrl} />
                ))}
              </div>
              <div className="grid grid-cols-8 gap-1">
                {d.units.slice(0, 8).map((u) => (
                  <UnitHover key={`${u.key}-${u.index}`} unit={u}>
                    <span
                      className={`relative block aspect-square w-full overflow-hidden rounded-chip border-2 bg-sunken ${
                        COST_BORDER[u.cost ?? 1] ?? COST_BORDER[1]
                      } ${u.flex ? 'opacity-60 outline outline-1 outline-dashed outline-accent' : ''}`}
                      title={u.flex ? '플렉스(선택) — 시너지 최대 단계 초과' : undefined}
                    >
                      <img src={u.imgUrl} alt={u.name} loading="lazy" className="h-full w-full object-cover" />
                      {u.flex ? (
                        <em className="absolute right-0.5 top-0.5 text-[9px] font-bold not-italic text-accent">F</em>
                      ) : null}
                    </span>
                  </UnitHover>
                ))}
              </div>
              <div className="mt-auto grid grid-cols-3 gap-2 border-t border-sunken pt-3">
                <div>
                  <div className="text-xs text-subtle">평균 등수</div>
                  <div className="text-lg font-bold text-ink">{d.avgPlacement?.toFixed(2) ?? '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-subtle">TOP4</div>
                  <div className="text-lg font-bold text-ink">
                    {d.top4Rate != null ? `${Math.round(d.top4Rate * 100)}%` : '-'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-subtle">표본</div>
                  <div className="text-lg font-bold text-ink">{d.sampleSize.toLocaleString()}</div>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

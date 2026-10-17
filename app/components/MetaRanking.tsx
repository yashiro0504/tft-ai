'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertCircle,
  Bot,
  CalendarDays,
  Crown,
  Info,
  Layers,
  Link2,
  Package,
  RefreshCw,
  Search,
  Swords,
} from 'lucide-react'
import type {
  MetaChampRanking,
  MetaCompRanking,
  MetaDeckRanking,
  MetaItemRanking,
  MetaTraitRanking,
  TftMetaResponse,
} from '@/lib/types'

type MetaTab = 'decks' | 'comps' | 'champions' | 'traits' | 'items'

const TABS: { id: MetaTab; label: string; icon: typeof Crown }[] = [
  { id: 'decks', label: '덱', icon: Layers },
  { id: 'comps', label: 'BIS', icon: Swords },
  { id: 'champions', label: '기물', icon: Crown },
  { id: 'traits', label: '시너지', icon: Link2 },
  { id: 'items', label: '아이템', icon: Package },
]

type ItemClass = 'all' | 'normal' | 'radiant' | 'artifact' | 'emblem' | 'special'

const ITEM_CLASSES: { id: ItemClass; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'normal', label: '일반' },
  { id: 'radiant', label: '찬란한' },
  { id: 'artifact', label: '유물' },
  { id: 'emblem', label: '상징' },
  { id: 'special', label: '특수' },
]

function itemClassOf(row: { name: string; key: string }): Exclude<ItemClass, 'all'> {
  if (row.key.includes('Artifact')) return 'artifact'
  if (row.name.startsWith('찬란한')) return 'radiant'
  if (row.name.endsWith('상징') || row.key.includes('Emblem')) return 'emblem'
  if (row.name.startsWith('전략가의') || row.name.startsWith('행운의')) return 'special'
  return 'normal'
}

const TIER_ORDER = ['S', 'A', 'B', 'C', 'D'] as const
type Tier = (typeof TIER_ORDER)[number]

function tierOf(avg: number): Tier {
  if (avg <= 3.6) return 'S'
  if (avg <= 4.0) return 'A'
  if (avg <= 4.4) return 'B'
  if (avg <= 4.7) return 'C'
  return 'D'
}

const TIER_STYLE: Record<Tier, { text: string; bg: string; border: string; bar: string; ring: string }> = {
  S: {
    text: 'text-amber-300',
    bg: 'bg-amber-400/[0.07]',
    border: 'border-amber-400/20',
    bar: 'from-amber-400 to-orange-400',
    ring: 'from-amber-400 to-orange-500',
  },
  A: {
    text: 'text-emerald-300',
    bg: 'bg-emerald-400/[0.07]',
    border: 'border-emerald-400/20',
    bar: 'from-emerald-400 to-teal-400',
    ring: 'from-emerald-400 to-teal-500',
  },
  B: {
    text: 'text-sky-300',
    bg: 'bg-sky-400/[0.07]',
    border: 'border-sky-400/20',
    bar: 'from-sky-400 to-blue-400',
    ring: 'from-sky-400 to-blue-500',
  },
  C: {
    text: 'text-muted',
    bg: 'bg-slate-400/[0.06]',
    border: 'border-slate-400/15',
    bar: 'from-slate-400 to-slate-500',
    ring: 'from-slate-400 to-slate-600',
  },
  D: {
    text: 'text-rose-300',
    bg: 'bg-rose-400/[0.07]',
    border: 'border-rose-400/20',
    bar: 'from-rose-400 to-pink-400',
    ring: 'from-rose-400 to-pink-500',
  },
}

function filterRows<T>(rows: T[], q: string, pick: (row: T) => string): T[] {
  if (!q) return rows
  return rows.filter((row) => pick(row).toLowerCase().includes(q))
}

function sortMeta<
  T extends {
    avgPlacement: number
    sampleSize: number
    top4Rate: number
    threeStarRate?: number
    cost?: number
  }
>(list: T[], sortBy: 'avg' | 'sample' | 'threeStar' | 'top4' | 'cost'): T[] {
  return [...list].sort((a, b) => {
    if (sortBy === 'sample') return b.sampleSize - a.sampleSize
    if (sortBy === 'top4') return b.top4Rate - a.top4Rate
    if (sortBy === 'cost') return (b.cost ?? 0) - (a.cost ?? 0)
    if (sortBy === 'threeStar') return (b.threeStarRate ?? 0) - (a.threeStarRate ?? 0)
    return a.avgPlacement - b.avgPlacement
  })
}

function StatBar({ rate, tier }: { rate: number; tier: Tier }) {
  const pct = Math.round(Math.min(Math.max(rate, 0), 1) * 100)
  return (
    <div className="w-full">
      <div className="h-1.5 rounded-full bg-elev/5 overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${TIER_STYLE[tier].bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[11px] font-mono text-muted">
        <span>TOP4</span>
        <span className="text-muted">{pct}%</span>
      </div>
    </div>
  )
}

function TierRail({ tier, count }: { tier: Tier; count: number }) {
  const s = TIER_STYLE[tier]
  return (
    <div className={`flex w-12 md:w-14 shrink-0 flex-col items-center gap-0.5 border-r py-3 ${s.border} ${s.bg}`}>
      <span className={`text-2xl md:text-3xl font-black leading-none ${s.text}`}>{tier}</span>
      <span className="text-[11px] font-mono text-muted">{count}</span>
    </div>
  )
}

function AvgPill({ avg }: { avg: number }) {
  const t = tierOf(avg)
  return (
    <div className="shrink-0 text-right">
      <p className={`text-[15px] font-black font-mono leading-none ${TIER_STYLE[t].text}`}>{avg.toFixed(2)}</p>
      <p className="mt-0.5 text-[11px] text-muted">평균등수</p>
    </div>
  )
}

function DeltaBadge({ delta, avgDelta }: { delta?: number | null; avgDelta?: number | null }) {
  if (typeof delta !== 'number' || delta === 0) return null
  const up = delta > 0
  const avgText =
    typeof avgDelta === 'number' && avgDelta !== 0
      ? ` · 평균등수 ${avgDelta > 0 ? '-' : '+'}${Math.abs(avgDelta)}`
      : ''
  return (
    <span
      title={`이전 수집 대비 ${up ? '순위 상승' : '순위 하락'} ${Math.abs(delta)}계단${avgText}`}
      className={`inline-flex shrink-0 items-center rounded px-1 py-0.5 text-[10px] font-black ${
        up ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
      }`}
    >
      {up ? '▲' : '▼'}
      {Math.abs(delta)}
    </span>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded-full border px-2 py-0.5 text-[11px] font-bold transition ${
        active
          ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-300'
          : 'border-line/10 bg-elev/5 text-muted hover:text-ink-soft'
      }`}
    >
      {children}
    </button>
  )
}

function ChampRow({
  r,
  onSelect,
}: {
  r: MetaChampRanking
  onSelect: (r: MetaChampRanking) => void
}) {
  const t = tierOf(r.avgPlacement)
  return (
    <div
      role="button"
      tabIndex={0}
      title={`${r.name} 상세 보기`}
      onClick={() => onSelect(r)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(r)
        }
      }}
      className="cursor-pointer px-3 py-3 transition-colors hover:bg-elev/5 focus:outline-none focus-visible:bg-elev/5"
    >
      <div className="flex items-center gap-3">
      <div className={`h-10 w-10 shrink-0 rounded-xl bg-gradient-to-br p-[1.5px] ${TIER_STYLE[t].ring}`}>
        {r.imgUrl ? (
          <img
            src={r.imgUrl}
            alt={r.name}
            className="h-full w-full rounded-[10px] bg-sunken/70 object-cover"
            onError={(e) => {
              ;(e.target as HTMLElement).style.display = 'none'
            }}
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-[14px] font-extrabold text-ink">{r.name}</p>
          <DeltaBadge delta={r.rankDelta} avgDelta={r.avgDelta} />
        </div>
        <p className="truncate text-[12px] text-muted">
          {r.cost ? <span className="text-subtle">{r.cost}코 · </span> : null}
          평균 {r.avgTier.toFixed(1)}성
          {r.threeStarRate > 0 ? (
            <span className="text-muted"> · 3성 {Math.round(r.threeStarRate * 100)}%</span>
          ) : null}
          <span className="text-subtle"> · {r.sampleSize}판</span>
        </p>
      </div>
      <div className="hidden w-24 shrink-0 sm:block">
        <StatBar rate={r.top4Rate} tier={t} />
      </div>
      <div className="w-14 shrink-0 sm:w-16">
        <AvgPill avg={r.avgPlacement} />
      </div>
      </div>
      {/* 모바일: TOP4 바를 행 하단에 (카드 리스트) */}
      <div className="mt-1.5 pl-[52px] sm:hidden">
        <StatBar rate={r.top4Rate} tier={t} />
      </div>
    </div>
  )
}

const MEDAL = [
  'from-amber-300 to-yellow-500',
  'from-slate-200 to-slate-400',
  'from-amber-600 to-orange-700',
]

function Podium({ rows, title }: { rows: MetaChampRanking[]; title?: string }) {
  const top = rows.slice(0, 3)
  if (top.length === 0) return null
  return (
    <div className="space-y-1.5">
      {title ? (
        <div className="flex items-center justify-between px-0.5">
          <h2 className="text-[13px] font-black text-ink">{title}</h2>
          <span className="text-[11px] text-muted">평균등수 기준</span>
        </div>
      ) : null}
      <div className="grid gap-2.5 sm:grid-cols-3">
      {top.map((r, i) => (
        <div
          key={r.key}
          className={`group relative overflow-hidden rounded-2xl border border-line/10 bg-gradient-to-br from-elev/10 to-transparent p-3.5 transition hover:border-line/10 ${
            i === 1 ? 'order-first sm:order-none' : ''
          }`}
        >
          <div
            className={`pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-gradient-to-br ${MEDAL[i]} opacity-20 blur-2xl`}
          />
          <div className="relative flex items-center gap-3">
            <div className={`relative h-14 w-14 shrink-0 rounded-2xl bg-gradient-to-br p-[2px] ${MEDAL[i]}`}>
              {r.imgUrl ? (
                <img
                  src={r.imgUrl}
                  alt={r.name}
                  className="h-full w-full rounded-[14px] bg-sunken/70 object-cover"
                  onError={(e) => {
                    ;(e.target as HTMLElement).style.display = 'none'
                  }}
                />
              ) : null}
              <span className="absolute -bottom-1.5 -left-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line/10 bg-sunken/70 text-[11px] font-black text-ink">
                {i + 1}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">
                Rank {i + 1}
              </p>
              <p className="truncate text-sm font-black text-ink">{r.name}</p>
              <p className="text-[12px] text-muted">
                평균{' '}
                <span className="font-mono font-bold text-ink">{r.avgPlacement.toFixed(2)}</span>
                {' · '}TOP4{' '}
                <span className="font-mono font-bold text-emerald-300">
                  {Math.round(r.top4Rate * 100)}%
                </span>
              </p>
            </div>
          </div>
          <div className="relative mt-2.5 h-1 overflow-hidden rounded-full bg-elev/5">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${MEDAL[i]}`}
              style={{ width: `${Math.round(r.top4Rate * 100)}%` }}
            />
          </div>
        </div>
      ))}
      </div>
    </div>
  )
}

const TONE: Record<'cyan' | 'amber' | 'violet' | 'emerald', string> = {
  cyan: 'from-cyan-500/30 to-blue-500/10 text-cyan-300 border-cyan-400/20',
  amber: 'from-amber-500/30 to-orange-500/10 text-amber-300 border-amber-400/20',
  violet: 'from-violet-500/30 to-indigo-500/10 text-violet-300 border-violet-400/20',
  emerald: 'from-emerald-500/30 to-teal-500/10 text-emerald-300 border-emerald-400/20',
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Crown
  label: string
  value: string | number
  sub?: string
  tone: 'cyan' | 'amber' | 'violet' | 'emerald'
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line/10 bg-elev/5 p-3.5">
      <div className="absolute -right-8 -top-8 h-20 w-20 rounded-full bg-cyan-500/10 blur-2xl" />
      <div className="relative flex items-center gap-2">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-xl border bg-gradient-to-br ${TONE[tone]}`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <p className="text-[12px] font-bold tracking-wide text-muted">{label}</p>
      </div>
      <p className="relative mt-2 text-xl font-black leading-none text-ink font-mono">{value}</p>
      {sub ? <p className="relative mt-1 text-[11px] text-muted">{sub}</p> : null}
    </div>
  )
}

function TraitCard({ r }: { r: MetaTraitRanking }) {
  const t = tierOf(r.avgPlacement)
  return (
    <div className="rounded-xl border border-line/10 bg-elev/5 p-3 transition hover:border-line/10 hover:bg-elev/5">
      <div className="flex items-center gap-3">
      {r.iconUrl ? (
        <img
          src={r.iconUrl}
          alt={r.name}
          className="h-10 w-10 shrink-0 rounded-lg border border-white/5 bg-sunken/70 object-contain p-1"
          onError={(e) => {
            ;(e.target as HTMLElement).style.display = 'none'
          }}
        />
      ) : (
        <span className="h-10 w-10 shrink-0 rounded-lg bg-slate-800" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`text-[11px] font-black ${TIER_STYLE[t].text}`}>{t}</span>
          <p className="truncate text-[14px] font-extrabold text-ink">{r.name}</p>
          <DeltaBadge delta={r.rankDelta} avgDelta={r.avgDelta} />
        </div>
        <p className="text-[12px] text-muted">
          {r.sampleSize}판 · 평균 {r.avgTier.toFixed(1)}단계
        </p>
      </div>
      <div className="hidden w-20 shrink-0 sm:block">
        <StatBar rate={r.top4Rate} tier={t} />
      </div>
      <AvgPill avg={r.avgPlacement} />
      </div>
      <div className="mt-2 pl-12 sm:hidden">
        <StatBar rate={r.top4Rate} tier={t} />
      </div>
    </div>
  )
}

function ItemCard({
  r,
  onSelect,
}: {
  r: MetaItemRanking
  onSelect: (r: MetaItemRanking) => void
}) {
  const t = tierOf(r.avgPlacement)
  return (
    <div
      role="button"
      tabIndex={0}
      title={`${r.name} 상세 보기`}
      onClick={() => onSelect(r)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(r)
        }
      }}
      className="cursor-pointer rounded-xl border border-line/10 bg-elev/5 p-3 transition hover:border-line/10 hover:bg-elev/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/60"
    >
      <div className="flex items-center gap-3">
      {r.iconUrl ? (
        <img
          src={r.iconUrl}
          alt={r.name}
          className="h-10 w-10 shrink-0 rounded-lg border border-amber-500/20 bg-sunken/70 object-cover"
          onError={(e) => {
            ;(e.target as HTMLElement).style.display = 'none'
          }}
        />
      ) : (
        <span className="h-10 w-10 shrink-0 rounded-lg bg-slate-800" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`text-[11px] font-black ${TIER_STYLE[t].text}`}>{t}</span>
          <p className="truncate text-[14px] font-extrabold text-ink">{r.name}</p>
          <DeltaBadge delta={r.rankDelta} avgDelta={r.avgDelta} />
        </div>
        <p className="text-[12px] text-muted">{r.sampleSize}판 표본</p>
      </div>
      <div className="hidden w-20 shrink-0 sm:block">
        <StatBar rate={r.top4Rate} tier={t} />
      </div>
      <AvgPill avg={r.avgPlacement} />
      </div>
      <div className="mt-2 pl-12 sm:hidden">
        <StatBar rate={r.top4Rate} tier={t} />
      </div>
    </div>
  )
}

/** 메타 조합 카드 — 기물 + BIS 아이템 세트 */
function CompCard({
  r,
  onSelect,
}: {
  r: MetaCompRanking
  onSelect: (r: MetaCompRanking) => void
}) {
  const t = tierOf(r.avgPlacement)
  return (
    <div
      role="button"
      tabIndex={0}
      title={`${r.name} 조합 상세 보기`}
      onClick={() => onSelect(r)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(r)
        }
      }}
      className="cursor-pointer rounded-2xl border border-line/10 bg-gradient-to-br from-elev/10 to-transparent p-3.5 transition hover:border-line/20 hover:bg-elev/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/60"
    >
      <div className="flex items-center gap-3">
        <div
          className={`h-12 w-12 shrink-0 rounded-xl bg-gradient-to-br p-[1.5px] ${TIER_STYLE[t].ring}`}
        >
          {r.imgUrl ? (
            <img
              src={r.imgUrl}
              alt={r.name}
              className="h-full w-full rounded-[10px] bg-sunken/70 object-cover"
              onError={(e) => {
                ;(e.target as HTMLElement).style.display = 'none'
              }}
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`text-[11px] font-black ${TIER_STYLE[t].text}`}>{t}</span>
            <p className="truncate text-[15px] font-extrabold text-ink">{r.name}</p>
            <DeltaBadge delta={r.rankDelta} avgDelta={r.avgDelta} />
          </div>
          <p className="truncate text-[12px] text-muted">
            {r.cost ? <span className="text-subtle">{r.cost}코 · </span> : null}
            {r.sampleSize}판 · TOP4 {Math.round(r.top4Rate * 100)}%
          </p>
        </div>
        <AvgPill avg={r.avgPlacement} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-subtle">BIS</span>
        {r.items.length === 0 ? (
          <span className="text-[11px] text-muted">아이템 표본 부족</span>
        ) : null}
        {r.items.map((it) => (
          <span
            key={it.key}
            title={`${it.name} · 평균 ${it.avgPlacement.toFixed(2)} (${it.sampleSize}판)`}
            className="inline-flex max-w-[9.5rem] items-center gap-1 rounded-lg border border-line/10 bg-elev/5 py-1 pl-1 pr-1.5"
          >
            {it.iconUrl ? (
              <img
                src={it.iconUrl}
                alt={it.name}
                className="h-5 w-5 shrink-0 rounded border border-amber-500/20 object-cover"
                onError={(e) => {
                  ;(e.target as HTMLElement).style.display = 'none'
                }}
              />
            ) : null}
            <span className="truncate text-[11px] font-bold text-ink-soft">{it.name}</span>
          </span>
        ))}
      </div>

      <div className="mt-2.5">
        <StatBar rate={r.top4Rate} tier={t} />
      </div>
    </div>
  )
}

/** 유닛 코스트별 테두리 색 */
const COST_BORDER: Record<number, string> = {
  1: 'border-slate-500/50',
  2: 'border-emerald-500/50',
  3: 'border-sky-500/50',
  4: 'border-violet-500/60',
  5: 'border-amber-400/70',
}

/** 메타 덱 카드 — 실제 보드 구성(유닛·성급·아이템·시너지) */
function DeckCard({
  r,
  onSelectUnit,
}: {
  r: MetaDeckRanking
  onSelectUnit: (key: string) => void
}) {
  const tier = (r.tier === '-' ? 'C' : r.tier) as Tier
  const s = TIER_STYLE[tier]
  return (
    <div className="rounded-2xl border border-line/10 bg-gradient-to-br from-elev/10 to-transparent p-3.5 transition hover:border-line/20 hover:bg-elev/10">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`rounded border px-1 py-0.5 text-[10px] font-black leading-none ${s.text} ${s.border} ${s.bg}`}
            >
              {r.tier}
            </span>
            <p className="truncate text-[15px] font-extrabold text-ink">{r.name}</p>
          </div>
          <p className="mt-1 truncate text-[11px] text-muted">
            {r.units.length}유닛 · {r.unitCost}코
            {r.gold ? ` · ${r.gold}골드` : ''} · 실측 커버리지 {Math.round(r.coverage * 100)}%
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`font-mono text-lg font-black leading-none ${r.avgPlacement != null ? s.text : 'text-muted'}`}>
            {r.avgPlacement != null ? r.avgPlacement.toFixed(2) : '—'}
          </p>
          <p className="mt-1 text-[10px] text-muted">
            {r.sampleSize > 0 ? `${r.sampleSize.toLocaleString()}판` : '표본 없음'}
          </p>
        </div>
      </div>

      {/* 보드 구성 */}
      <div className="mt-3 flex flex-wrap gap-2">
        {r.units.map((u) => {
          const carry = r.carryKey === u.key
          return (
            <button
              key={`${u.key}-${u.name}`}
              type="button"
              onClick={() => onSelectUnit(u.key)}
              title={`${u.name} ${u.star}성${u.stat ? ` · 평균 ${u.stat.avgPlacement.toFixed(2)}` : ''}${
                u.items.length ? ` · ${u.items.map((i) => i.name).join(', ')}` : ''
              }`}
              className="w-[52px] shrink-0 cursor-pointer text-center"
            >
              <div className="relative mx-auto h-12 w-12">
                <img
                  src={u.imgUrl}
                  alt={u.name}
                  className={`h-12 w-12 rounded-lg border-2 bg-sunken/70 object-cover ${
                    carry ? 'border-amber-400/80' : COST_BORDER[u.cost || 1] || 'border-line/20'
                  }`}
                  onError={(e) => {
                    ;(e.target as HTMLElement).style.display = 'none'
                  }}
                />
                <span className="absolute -right-1 -top-1 rounded bg-panel/95 px-0.5 text-[9px] font-black leading-tight text-amber-300">
                  {u.star}★
                </span>
                {u.items.length > 0 ? (
                  <div className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 gap-0.5">
                    {u.items.map((it) => (
                      <img
                        key={it.key}
                        src={it.iconUrl}
                        alt={it.name}
                        className="h-3.5 w-3.5 rounded-sm border border-black/50 bg-sunken object-cover"
                        onError={(e) => {
                          ;(e.target as HTMLElement).style.display = 'none'
                        }}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
              <p className="mt-2 truncate text-[10px] font-bold text-ink-soft">{u.name}</p>
            </button>
          )
        })}
      </div>

      {/* 시너지 */}
      {r.traits.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {r.traits.map((t) => (
            <span
              key={t.key}
              className="inline-flex items-center gap-0.5 rounded-full border border-line/10 bg-elev/5 py-0.5 pl-0.5 pr-1.5 text-[10px] font-bold text-muted"
            >
              {t.iconUrl ? (
                <img
                  src={t.iconUrl}
                  alt={t.name}
                  className="h-3.5 w-3.5 object-contain"
                  onError={(e) => {
                    ;(e.target as HTMLElement).style.display = 'none'
                  }}
                />
              ) : null}
              <span className="text-ink-soft">{t.name}</span>
              <span className="text-cyan-300">{t.count}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line/10 bg-elev/5 px-2.5 py-2">
      <p className="text-[11px] font-bold text-muted">{label}</p>
      <p className="mt-0.5 font-mono text-base font-black text-ink">{value}</p>
    </div>
  )
}

/** 모바일 하단 탭 네비게이션 (데스크톱에서는 숨김) */
function MobileBottomNav({
  tab,
  onTab,
  onOpenCoach,
}: {
  tab: MetaTab
  onTab: (t: MetaTab) => void
  onOpenCoach?: () => void
}) {
  return (
    <nav
      aria-label="메타 랭킹 탭"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line/10 bg-app/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.5)] backdrop-blur-xl md:hidden"
    >
      <div className="mx-auto flex max-w-6xl items-stretch">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTab(t.id)}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 cursor-pointer flex-col items-center gap-1 px-1 pb-1.5 pt-2 transition ${
                active ? 'text-cyan-300' : 'text-muted'
              }`}
            >
              <Icon className={`h-5 w-5 ${active ? 'text-cyan-300' : 'text-subtle'}`} />
              <span className="text-[10px] font-bold leading-none">{t.label}</span>
              <span
                className={`h-0.5 w-6 rounded-full transition ${active ? 'bg-cyan-400' : 'bg-transparent'}`}
              />
            </button>
          )
        })}
        {onOpenCoach ? (
          <button
            type="button"
            onClick={onOpenCoach}
            className="flex flex-1 cursor-pointer flex-col items-center gap-1 px-1 pb-1.5 pt-2 text-muted transition"
          >
            <Bot className="h-5 w-5 text-subtle" />
            <span className="text-[10px] font-bold leading-none">AI 코치</span>
            <span className="h-0.5 w-6 rounded-full bg-transparent" />
          </button>
        ) : null}
      </div>
    </nav>
  )
}

/** 기물/아이템 상세 드로어 (행 클릭 시 우측 패널) */
function DetailDrawer({
  selected,
  data,
  onClose,
}: {
  selected: { type: 'champion' | 'item'; key: string } | null
  data: TftMetaResponse | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, onClose])

  if (!selected || !data) return null

  const isChamp = selected.type === 'champion'
  const champ = isChamp ? data.champions.find((c) => c.key === selected.key) : undefined
  const item = !isChamp ? data.items.find((i) => i.key === selected.key) : undefined
  if (!champ && !item) return null

  const name = champ?.name ?? item?.name ?? selected.key
  const iconUrl = champ?.imgUrl ?? item?.iconUrl
  const avg = champ?.avgPlacement ?? item?.avgPlacement ?? 0
  const top4 = champ?.top4Rate ?? item?.top4Rate ?? 0
  const sample = champ?.sampleSize ?? item?.sampleSize ?? 0
  const t = tierOf(avg)

  const related = (isChamp
    ? data.combos.filter((c) => c.champKey === selected.key)
    : data.combos.filter((c) => c.itemKey === selected.key)
  )
    .slice()
    .sort((a, b) => a.avgPlacement - b.avgPlacement)
    .slice(0, 6)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${name} 상세`}
        className="relative h-full w-full max-w-[420px] overflow-y-auto border-l border-line/10 bg-panel/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            {iconUrl ? (
              <img
                src={iconUrl}
                alt={name}
                className="h-14 w-14 shrink-0 rounded-xl border border-line/10 bg-sunken/70 object-cover"
                onError={(e) => {
                  ;(e.target as HTMLElement).style.display = 'none'
                }}
              />
            ) : null}
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted">
                {isChamp ? '기물 상세' : '아이템 상세'}
              </p>
              <h3 className="truncate text-lg font-black text-ink">{name}</h3>
              <div className="flex items-center gap-1.5">
                <p className={`text-xs font-black ${TIER_STYLE[t].text}`}>{t} 티어</p>
                <DeltaBadge
                  delta={champ?.rankDelta ?? item?.rankDelta}
                  avgDelta={champ?.avgDelta ?? item?.avgDelta}
                />
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="shrink-0 cursor-pointer rounded-lg border border-line/10 px-2.5 py-1 text-xs font-bold text-muted transition hover:bg-elev/5"
          >
            닫기
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <StatBox label="평균등수" value={avg.toFixed(2)} />
          <StatBox label="TOP4" value={`${Math.round(top4 * 100)}%`} />
          <StatBox label="표본" value={`${sample}판`} />
        </div>

        {champ ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <StatBox label="평균 성급" value={`${champ.avgTier.toFixed(1)}성`} />
            <StatBox label="3성 달성률" value={`${Math.round(champ.threeStarRate * 100)}%`} />
          </div>
        ) : null}

        <div className="mt-4">
          <StatBar rate={top4} tier={t} />
        </div>

        <div className="mt-5">
          <p className="text-sm font-black text-ink">
            {isChamp ? 'BIS 조합 (아이템별 성적)' : '이 아이템을 쓰는 기물'}
          </p>
          <div className="mt-2 space-y-1.5">
            {related.length === 0 && (
              <p className="rounded-lg border border-line/10 bg-elev/5 px-3 py-3 text-xs text-muted">
                표본이 부족해 조합 데이터가 없습니다.
              </p>
            )}
            {related.map((c) => (
              <div
                key={c.key}
                className="flex items-center gap-2 rounded-lg border border-line/10 bg-elev/5 px-2.5 py-2"
              >
                {!isChamp && c.champImgUrl ? (
                  <img
                    src={c.champImgUrl}
                    alt={c.champName}
                    className="h-7 w-7 shrink-0 rounded-md border border-line/10 bg-sunken/70 object-cover"
                    onError={(e) => {
                      ;(e.target as HTMLElement).style.display = 'none'
                    }}
                  />
                ) : null}
                {c.itemIconUrl ? (
                  <img
                    src={c.itemIconUrl}
                    alt={c.itemName}
                    className="h-7 w-7 shrink-0 rounded-md border border-amber-500/20 bg-sunken/70 object-cover"
                    onError={(e) => {
                      ;(e.target as HTMLElement).style.display = 'none'
                    }}
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-ink">
                    {isChamp ? c.itemName : c.champName}
                  </p>
                  <p className="text-[11px] text-muted">{c.sampleSize}판</p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={`font-mono text-sm font-black ${
                      TIER_STYLE[tierOf(c.avgPlacement)].text
                    }`}
                  >
                    {c.avgPlacement.toFixed(2)}
                  </p>
                  <p className="text-[10px] text-muted">
                    TOP4 {Math.round(c.top4Rate * 100)}%
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-subtle">
          ※ 평균등수가 낮을수록 강합니다. 표본 n&lt;10 항목은 참고용입니다.
        </p>
      </aside>
    </div>
  )
}

export function MetaRanking({ onOpenCoach }: { onOpenCoach?: () => void }) {
  const [tab, setTab] = useState<MetaTab>('decks')
  const [data, setData] = useState<TftMetaResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [itemClass, setItemClass] = useState<ItemClass>('all')
  const [selected, setSelected] = useState<{ type: 'champion' | 'item'; key: string } | null>(null)
  const [costFilter, setCostFilter] = useState<'all' | number>('all')
  const [tierFilter, setTierFilter] = useState<'all' | Tier>('all')
  const [minSample, setMinSample] = useState(0)
  const [sortBy, setSortBy] = useState<'avg' | 'sample' | 'threeStar' | 'top4' | 'cost'>('avg')
  const searchRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/tft/meta')
      const json: TftMetaResponse = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || '메타 데이터를 불러오지 못했습니다.')
      }
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : '네트워크 오류가 발생했습니다.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const q = query.trim().toLowerCase()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if (e.key === '/' && !typing) {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'Escape') {
        setQuery('')
        searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const decks = useMemo(() => {
    let list = filterRows(
      data?.decks ?? [],
      q,
      (r) =>
        `${r.name} ${r.units.map((u) => u.name).join(' ')} ${r.traits.map((t) => t.name).join(' ')}`
    )
    if (minSample > 0) list = list.filter((r) => (r.sampleSize || 0) >= minSample)
    if (tierFilter !== 'all') list = list.filter((r) => r.tier === tierFilter)

    return [...list].sort((a, b) => {
      if (sortBy === 'sample') return (b.sampleSize || 0) - (a.sampleSize || 0)
      if (sortBy === 'top4') return (b.top4Rate ?? 0) - (a.top4Rate ?? 0)
      if (sortBy === 'cost' || sortBy === 'threeStar') return b.unitCost - a.unitCost
      if (a.avgPlacement == null && b.avgPlacement == null) return b.unitCost - a.unitCost
      if (a.avgPlacement == null) return 1
      if (b.avgPlacement == null) return -1
      return a.avgPlacement - b.avgPlacement
    })
  }, [data, q, minSample, tierFilter, sortBy])

  const comps = useMemo(() => {
    let list = filterRows(
      data?.comps ?? [],
      q,
      (r) => `${r.name} ${r.key} ${r.items.map((i) => i.name).join(' ')}`
    )
    if (costFilter !== 'all') list = list.filter((r) => (r.cost ?? 0) === costFilter)
    if (minSample > 0) list = list.filter((r) => r.sampleSize >= minSample)
    if (tierFilter !== 'all') list = list.filter((r) => tierOf(r.avgPlacement) === tierFilter)
    return sortMeta(list, sortBy)
  }, [data, q, costFilter, minSample, tierFilter, sortBy])

  const champions = useMemo(() => {
    let list = filterRows(data?.champions ?? [], q, (r) => `${r.name} ${r.key}`)
    if (costFilter !== 'all') list = list.filter((r) => (r.cost ?? 0) === costFilter)
    if (minSample > 0) list = list.filter((r) => r.sampleSize >= minSample)
    if (tierFilter !== 'all') list = list.filter((r) => tierOf(r.avgPlacement) === tierFilter)
    return sortMeta(list, sortBy)
  }, [data, q, costFilter, minSample, tierFilter, sortBy])

  const traits = useMemo(() => {
    let list = filterRows(data?.traits ?? [], q, (r) => `${r.name} ${r.key}`)
    if (minSample > 0) list = list.filter((r) => r.sampleSize >= minSample)
    if (tierFilter !== 'all') list = list.filter((r) => tierOf(r.avgPlacement) === tierFilter)
    return sortMeta(list, sortBy)
  }, [data, q, minSample, tierFilter, sortBy])

  const items = useMemo(() => {
    const base = filterRows(data?.items ?? [], q, (r) => `${r.name} ${r.key}`)
    let list = itemClass === 'all' ? base : base.filter((r) => itemClassOf(r) === itemClass)
    if (minSample > 0) list = list.filter((r) => r.sampleSize >= minSample)
    if (tierFilter !== 'all') list = list.filter((r) => tierOf(r.avgPlacement) === tierFilter)
    return sortMeta(list, sortBy)
  }, [data, q, itemClass, minSample, tierFilter, sortBy])

  const hasMeta = Boolean(data?.hasMeta)
  const totalCount =
    tab === 'decks'
      ? decks.length
      : tab === 'comps'
      ? comps.length
      : tab === 'champions'
      ? champions.length
      : tab === 'traits'
      ? traits.length
      : items.length
  const needsMore = totalCount > (tab === 'champions' ? 20 : 12)
  const limit = showAll ? 999 : tab === 'decks' ? 8 : tab === 'comps' ? 9 : tab === 'champions' ? 6 : 12

  /** 상단 포디움 — 탭에 따라 덱/조합/기물 TOP3 */
  const podiumRows: MetaChampRanking[] = useMemo(() => {
    if (tab === 'decks') {
      return (data?.decks ?? [])
        .filter((d) => d.avgPlacement != null)
        .slice(0, 3)
        .map((d) => {
          const carry = d.units.find((u) => u.key === d.carryKey) || d.units[0]
          return {
            key: d.id,
            name: d.name,
            imgUrl: carry?.imgUrl || '',
            avgPlacement: d.avgPlacement as number,
            top4Rate: d.top4Rate ?? 0,
            sampleSize: d.sampleSize,
            avgTier: 0,
            threeStarRate: 0,
          }
        })
    }
    if (tab === 'comps') {
      return (data?.comps ?? []).slice(0, 3).map((c) => ({
        key: c.key,
        name: c.name,
        imgUrl: c.imgUrl,
        avgPlacement: c.avgPlacement,
        top4Rate: c.top4Rate,
        sampleSize: c.sampleSize,
        avgTier: c.avgTier,
        threeStarRate: c.threeStarRate,
        cost: c.cost,
      }))
    }
    return data?.champions ?? []
  }, [data, tab])

  /** 탭 전환 (모바일 하단 네비/데스크톱 탭 공용) */
  const selectTab = (next: MetaTab) => {
    setTab(next)
    setShowAll(false)
    window.requestAnimationFrame(() => {
      document.getElementById('meta-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  return (
    <div className="space-y-3 animate-fade-up">
      <Podium
        rows={podiumRows}
        title={tab === 'decks' ? 'TOP 3 메타 덱' : tab === 'comps' ? 'TOP 3 메타 조합' : 'TOP 3 기물'}
      />
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <KpiCard
          icon={CalendarDays}
          label="패치"
          value={data?.patch ?? '—'}
          sub={
            data?.source === 'riot-sample'
              ? 'Riot 실측 표본'
              : data?.source === 'riot-ladder'
              ? '래더 실측 표본'
              : '수집 표본'
          }
          tone="cyan"
        />
        <KpiCard
          icon={Crown}
          label="추적 기물"
          value={data ? data.champions.length : '—'}
          sub="티어 집계"
          tone="amber"
        />
        <KpiCard
          icon={Package}
          label="추적 아이템"
          value={data ? data.items.length : '—'}
          sub="성적 집계"
          tone="violet"
        />
        <KpiCard
          icon={Layers}
          label="메타 덱"
          value={data ? data.decks.length : '—'}
          sub={data?.deckMeta?.patch ? `롤체지지 v${data.deckMeta.patch}` : '보드 조합'}
          tone="emerald"
        />
      </div>

      <div
        id="meta-tabs"
        className="flex scroll-mt-16 flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between"
      >
        <div className="hidden flex-wrap items-center gap-1 rounded-xl border border-line/10 bg-sunken/70 p-1 md:flex">
          {TABS.map((t) => {
            const Icon = t.icon
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => selectTab(t.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition cursor-pointer ${
                  active
                    ? 'bg-elev/5 text-ink shadow-sm'
                    : 'text-muted hover:bg-elev/5 hover:text-ink-soft'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 lg:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              type="text"
              placeholder="이름 검색 (예: 럭스, 돌거북) — / 단축키"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-xl border border-line/10 bg-sunken/70 py-2 pl-9 pr-3 text-xs text-ink placeholder-slate-500 transition focus:border-cyan-400/50 focus:outline-none focus:ring-1 focus:ring-cyan-400/40"
            />
          </div>
          <button
            type="button"
            onClick={load}
            disabled={isLoading}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-line/10 bg-sunken/70 px-3 py-2 text-xs font-semibold text-muted transition hover:bg-elev/5 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isLoading ? '불러오는 중' : '새로고침'}</span>
          </button>
        </div>
      </div>

      {/* 필터/정렬: 모바일에서는 한 줄 가로 스크롤 */}
      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:overflow-visible md:px-0">
        <div className="flex min-w-max items-center gap-x-3 md:min-w-0 md:flex-wrap">
        {(tab === 'champions' || tab === 'comps') && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-subtle">코스트</span>
            <Chip active={costFilter === 'all'} onClick={() => setCostFilter('all')}>
              전체
            </Chip>
            {[1, 2, 3, 4, 5].map((c) => (
              <Chip key={c} active={costFilter === c} onClick={() => setCostFilter(c)}>
                {c}코
              </Chip>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-subtle">티어</span>
          <Chip active={tierFilter === 'all'} onClick={() => setTierFilter('all')}>
            전체
          </Chip>
          {TIER_ORDER.map((t) => (
            <Chip key={t} active={tierFilter === t} onClick={() => setTierFilter(t)}>
              {t}
            </Chip>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-subtle">표본</span>
          <Chip active={minSample === 0} onClick={() => setMinSample(0)}>
            전체
          </Chip>
          {[10, 20, 50].map((n) => (
            <Chip key={n} active={minSample === n} onClick={() => setMinSample(n)}>
              {n}+
            </Chip>
          ))}
        </div>

        <label className="flex items-center gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-subtle">정렬</span>
          <select
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as 'avg' | 'sample' | 'threeStar' | 'top4' | 'cost')
            }
            className="cursor-pointer rounded-lg border border-line/10 bg-sunken/60 px-2 py-1 text-[11px] font-bold text-ink-soft focus:border-cyan-400/50 focus:outline-none"
          >
            <option value="avg">평균등수</option>
            <option value="sample">표본</option>
            <option value="threeStar">3성률</option>
            <option value="top4">TOP4</option>
            <option value="cost">코스트</option>
          </select>
        </label>

        <span className="ml-auto hidden text-[10px] text-subtle sm:inline">
          <kbd className="rounded border border-line/15 px-1">/</kbd> 검색 ·{' '}
          <kbd className="rounded border border-line/15 px-1">Esc</kbd> 초기화
        </span>
        </div>
      </div>

      {tab === 'items' && (
        <div className="-mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:flex-wrap md:px-0">
          {ITEM_CLASSES.map((c) => {
            const active = itemClass === c.id
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setItemClass(c.id)}
                className={`cursor-pointer rounded-full border px-2.5 py-1 text-[12px] font-bold transition ${
                  active
                    ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-300'
                    : 'border-line/10 bg-elev/5 text-muted hover:text-ink-soft'
                }`}
              >
                {c.label}
              </button>
            )
          })}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-900/50 bg-red-950/40 p-3 text-xs text-red-200">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex animate-pulse items-center gap-3 rounded-xl border border-line/10 bg-elev/5 p-3"
            >
              <div className="h-10 w-10 rounded-xl bg-elev/5" />
              <div className="flex-1 space-y-1.5">
                <div className="h-2.5 w-28 rounded bg-elev/5" />
                <div className="h-2 w-20 rounded bg-elev/5" />
              </div>
              <div className="hidden h-2 w-24 rounded bg-elev/5 sm:block" />
              <div className="h-6 w-10 rounded bg-elev/5" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && !error && !hasMeta && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-800/50 bg-amber-950/40 p-3 text-xs text-amber-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            아직 실측 수집된 메타 통계가 없습니다. (scripts/buildMetaStats.js 로 Riot 매치 표본을
            수집하세요)
          </span>
        </div>
      )}

      {!isLoading && !error && hasMeta && (
        <>
          {tab === 'decks' && (
            <div className="grid gap-2.5 lg:grid-cols-2">
              {decks.slice(0, limit).map((r) => (
                <DeckCard
                  key={r.id}
                  r={r}
                  onSelectUnit={(key) => setSelected({ type: 'champion', key })}
                />
              ))}
              {decks.length === 0 && (
                <p className="col-span-full py-10 text-center text-xs text-muted">
                  {data && data.decks.length === 0
                    ? '덱 데이터가 없습니다. npm run collect:decks 로 생성하세요.'
                    : '검색 결과가 없습니다.'}
                </p>
              )}
            </div>
          )}

          {tab === 'comps' && (
            <div className="grid gap-2.5 md:grid-cols-2">
              {comps.slice(0, limit).map((r) => (
                <CompCard
                  key={r.key}
                  r={r}
                  onSelect={(x) => setSelected({ type: 'champion', key: x.key })}
                />
              ))}
              {comps.length === 0 && (
                <p className="col-span-full py-10 text-center text-xs text-muted">
                  검색 결과가 없습니다.
                </p>
              )}
            </div>
          )}

          {tab === 'champions' && (
            <div className="overflow-hidden rounded-2xl border border-line/10 bg-panel/95 shadow-2xl shadow-black/30">
              {TIER_ORDER.map((tier) => {
                const rows = champions.filter((r) => tierOf(r.avgPlacement) === tier)
                if (rows.length === 0) return null
                return (
                  <div key={tier} className="flex border-b border-line/10 last:border-0">
                    <TierRail tier={tier} count={rows.length} />
                    <div className="min-w-0 flex-1 divide-y divide-line/10">
                      {rows.slice(0, limit).map((r) => (
                        <ChampRow
                          key={r.key}
                          r={r}
                          onSelect={(x) => setSelected({ type: 'champion', key: x.key })}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
              {champions.length === 0 && (
                <p className="py-10 text-center text-xs text-muted">검색 결과가 없습니다.</p>
              )}
            </div>
          )}

          {tab === 'traits' && (
            <div className="grid gap-2 md:grid-cols-2">
              {traits.slice(0, limit).map((r) => (
                <TraitCard key={r.key} r={r} />
              ))}
              {traits.length === 0 && (
                <p className="col-span-full py-10 text-center text-xs text-muted">
                  검색 결과가 없습니다.
                </p>
              )}
            </div>
          )}

          {tab === 'items' && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {items.slice(0, limit).map((r) => (
                <ItemCard
                  key={r.key}
                  r={r}
                  onSelect={(x) => setSelected({ type: 'item', key: x.key })}
                />
              ))}
              {items.length === 0 && (
                <p className="col-span-full py-10 text-center text-xs text-muted">
                  검색 결과가 없습니다.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 rounded-xl border border-line/10 bg-elev/5 px-3 py-3">
            <p className="text-[12px] text-muted">
              {totalCount}개 항목
              <span className="text-subtle"> · 평균등수가 낮을수록 강함 (기준 4.50)</span>
            </p>
            {needsMore && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="cursor-pointer text-[12px] font-bold text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
              >
                {showAll ? '접기' : '전체 보기'}
              </button>
            )}
          </div>

          <p className="text-center text-[12px] text-subtle">
            출처: Riot 실측 표본 · 수집 {data?.generatedAt ? data.generatedAt.slice(0, 10) : '—'}
            {data?.prevGeneratedAt ? ` · 변동 기준 ${data.prevGeneratedAt.slice(0, 10)}` : ''} · 표본
            10판 미만 항목은 노이즈가 있을 수 있습니다.
          </p>

          {data?.deckMeta ? (
            <p className="text-center text-[12px] text-subtle">
              덱 구성 출처: {data.deckMeta.source}
              {data.deckMeta.patch ? ` (v${data.deckMeta.patch})` : ''} · 기물 통계 매칭{' '}
              {data.deckMeta.unitMatchRate}% · 덱 평균등수는 우리 표본 가중 평균입니다.
            </p>
          ) : null}
        </>
      )}

      <DetailDrawer selected={selected} data={data} onClose={() => setSelected(null)} />

      {/* 모바일 하단 탭 */}
      <MobileBottomNav tab={tab} onTab={selectTab} onOpenCoach={onOpenCoach} />
    </div>
  )
}



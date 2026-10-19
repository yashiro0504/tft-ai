'use client'

/* eslint-disable @next/next/no-img-element */

/**
 * TFT LAB 시그니처 UI 조각.
 * - PlacementStrip: 1~8등 분포 8칸 띠 (평균 등수만으로는 안 보이는 "안정형/도박형"을 보여준다)
 * - TraitHex: 시너지 단계를 육각형 + 강조색 농도로 표시 (디자인 가이드의 티어 농도 규칙과 같은 방식)
 * - EvidenceChip: 수치의 근거(표본, 커버리지, 패치)를 붙이는 작은 칩
 * - CoachMemo: AI 해석을 메모처럼 보여주는 인용 박스
 * - UnitHover: 기물 아이콘 호버 카드 (아이템·실측 통계)
 */
import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import breakpointData from '@/lib/traitBreakpoints.json'

/* ───────────── 등수 분포 띠 ───────────── */

export function PlacementStrip({ placements, className = '' }: { placements: number[]; className?: string }) {
  const counts = Array.from({ length: 8 }, (_, i) => placements.filter((p) => p === i + 1).length)
  const max = Math.max(1, ...counts)
  const total = placements.length
  const summary = counts.map((c, i) => `${i + 1}등 ${c}회`).join(', ')

  return (
    <div className={`inline-flex flex-col gap-1 ${className}`} role="img" aria-label={`최근 ${total}경기 등수 분포: ${summary}`}>
      <div className="flex h-7 items-end gap-[3px]">
        {counts.map((c, i) => {
          const color = i === 0 ? 'bg-gold' : i < 4 ? 'bg-good' : 'bg-bad'
          return (
            <span
              key={i}
              title={`${i + 1}등 ${c}회`}
              className={`w-3 rounded-[2px] ${c ? color : 'bg-sunken'}`}
              style={{ height: `${c ? Math.max(18, (c / max) * 100) : 12}%` }}
            />
          )
        })}
      </div>
      <div className="flex gap-[3px] text-xs leading-none text-subtle" aria-hidden="true">
        {counts.map((_, i) => (
          <span key={i} className="w-3 text-center">
            {i + 1}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ───────────── 시너지 육각형 ───────────── */

type BreakpointEntry = { breakpoints: number[] }
const BREAKPOINTS = (breakpointData as { traits: Record<string, BreakpointEntry> }).traits

/** 시너지 키(영문) 또는 한글 이름으로 단계 목록을 찾는다 */
function breakpointsOf(keyOrName: string): number[] {
  const hit = BREAKPOINTS[keyOrName.toLowerCase()] ?? BREAKPOINTS[keyOrName]
  return hit?.breakpoints ?? []
}

/** 유닛 수로 현재 단계(0 = 비활성)와 최대 단계를 계산한다 */
export function traitLevelFromCount(keyOrName: string, count: number) {
  const bps = breakpointsOf(keyOrName)
  return { level: bps.filter((b) => count >= b).length, max: bps.length }
}

/** 이미 단계(tier_current)를 알고 있을 때 최대 단계만 찾는다 */
export function traitMaxLevel(keyOrName: string) {
  return breakpointsOf(keyOrName).length
}

const HEX_CLIP = 'polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0% 50%)'

/**
 * 단계 농도: 비활성 → 회색 흐리게, 첫 단계 → 회색, 중간 → 옅은 파랑, 최고 단계 → 진한 파랑
 * (최대 단계가 1개뿐인 고유 시너지는 활성화되면 바로 최고 단계)
 */
function hexTone(level: number, max: number) {
  if (level <= 0) return { hex: 'bg-sunken text-subtle', label: 'text-subtle' }
  if (max > 0 && level >= max) return { hex: 'bg-accent text-on-accent', label: 'text-ink' }
  if (level >= 2) return { hex: 'bg-accent-bg text-accent', label: 'text-ink' }
  return { hex: 'bg-line text-ink', label: 'text-ink' }
}

export function TraitHex({
  name,
  count,
  level,
  max,
  iconUrl,
  compact = false,
}: {
  name: string
  count: number
  level: number
  max: number
  iconUrl?: string
  /** 표 행 안에서 쓰는 작은 크기 (이름 생략, 툴팁만) */
  compact?: boolean
}) {
  const tone = hexTone(level, max)
  // 아이콘 주소가 깨지면 육각형 안에 유닛 수를 대신 보여준다 (빈 육각형 방지)
  const [iconFailed, setIconFailed] = useState(false)
  const size = compact ? 'h-5 w-[22px]' : 'h-6 w-[26px]'
  const title = `${name} ${count}${max ? ` · ${level}/${max}단계` : ''}`

  return (
    <span className="inline-flex items-center gap-1" title={title}>
      <span className={`relative inline-flex shrink-0 items-center justify-center ${size} ${tone.hex}`} style={{ clipPath: HEX_CLIP }}>
        {iconUrl && !iconFailed ? (
          <img
            src={iconUrl}
            alt=""
            className={`${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} object-contain ${level >= max && max > 0 ? 'trait-glyph-on-accent' : 'trait-glyph'}`}
            onError={() => setIconFailed(true)}
          />
        ) : (
          <span className="text-xs font-bold">{count}</span>
        )}
      </span>
      {/* 유닛 수가 이미 육각형 안에 있으면 옆에 다시 쓰지 않는다 */}
      {compact ? (
        iconUrl && !iconFailed ? <span className={`text-xs font-bold ${tone.label}`}>{count}</span> : null
      ) : (
        <span className={`text-xs ${tone.label}`}>
          {iconUrl && !iconFailed ? <span className="font-bold">{count} </span> : null}
          {name}
        </span>
      )}
    </span>
  )
}

/* ───────────── 근거 칩 ───────────── */

export function EvidenceChip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-chip border border-line bg-sunken px-2 py-0.5 text-xs font-medium text-muted"
    >
      {children}
    </span>
  )
}

/* ───────────── 코치 메모 ───────────── */

export function CoachMemo({ label = '코치 메모', children }: { label?: string; children: ReactNode }) {
  return (
    <div className="rounded-control border border-line border-l-[3px] border-l-accent bg-sunken px-4 py-3">
      <p className="mb-1 text-xs font-bold text-accent">{label}</p>
      <div className="text-sm leading-relaxed text-ink">{children}</div>
    </div>
  )
}

/* ───────────── 기물 호버 카드 ───────────── */

export interface HoverUnit {
  name: string
  cost: number | null
  star: number
  imgUrl: string
  items: { key: string; name: string; iconUrl: string }[]
  stat?: { avgPlacement: number; top4Rate: number; sampleSize: number }
}

/**
 * 감싼 요소에 마우스를 올리면 기물 카드를 띄운다.
 * 표 행이 overflow:hidden 이라 카드는 body 에 portal 로 그린다.
 */
export function UnitHover({ unit, children }: { unit: HoverUnit; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null)

  const show = () => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const above = r.bottom + 180 > window.innerHeight
    const x = Math.min(Math.max(8, r.left + r.width / 2 - 110), window.innerWidth - 228)
    setPos({ x, y: above ? r.top - 8 : r.bottom + 8, above })
  }

  return (
    <span ref={ref} onMouseEnter={show} onMouseLeave={() => setPos(null)} className="inline-flex shrink-0">
      {children}
      {pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="tooltip"
              className="pointer-events-none fixed z-[95] w-[220px] rounded-card border border-line bg-panel p-3 text-left shadow-card"
              style={{ left: pos.x, top: pos.y, transform: pos.above ? 'translateY(-100%)' : undefined }}
            >
              <div className="flex items-center gap-2">
                <img src={unit.imgUrl} alt="" className="h-9 w-9 rounded-control object-cover" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink">{unit.name}</p>
                  <p className="text-xs text-muted">
                    {unit.cost ? `${unit.cost}코스트` : '코스트 정보 없음'}
                    {unit.star >= 2 ? ` · ★${unit.star}` : ''}
                  </p>
                </div>
              </div>
              {unit.items.length ? (
                <div className="mt-2 space-y-1">
                  {unit.items.map((it) => (
                    <div key={it.key} className="flex items-center gap-1.5 text-xs text-ink">
                      <img src={it.iconUrl} alt="" className="h-4 w-4 rounded-[3px] object-cover" />
                      <span className="truncate">{it.name}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {unit.stat ? (
                <div className="mt-2 flex flex-wrap gap-1 border-t border-line pt-2">
                  <EvidenceChip>평균 {unit.stat.avgPlacement.toFixed(2)}등</EvidenceChip>
                  <EvidenceChip>TOP4 {Math.round(unit.stat.top4Rate * 100)}%</EvidenceChip>
                  <EvidenceChip>표본 {unit.stat.sampleSize.toLocaleString()}판</EvidenceChip>
                </div>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </span>
  )
}

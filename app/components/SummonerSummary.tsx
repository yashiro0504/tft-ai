/* eslint-disable @next/next/no-img-element */

import type { ReactNode } from 'react'
import type { SlimMatchData, SummonerProfile } from '@/lib/types'
import type { DeckReport } from '@/lib/deckReportShared'
import { formatRankLabel, formatRankLp, formatRankRecord, rankWinRate } from '@/lib/rank'
import { PlacementTrend } from './PlacementTrend'
import { AxisOverview } from './AxisOverview'
import { HabitOverview } from './HabitOverview'
import { GoalTracker } from './GoalTracker'
import { DeckReportCard } from './DeckReportCard'
import { FavoriteButton } from './FavoriteButton'

/**
 * 소환사 개요 (코치 결과 / 공유용 프로필 페이지 공용).
 *
 * 왼쪽: 티어 엠블럼 · 이름 · 랭크 · 최근 경기 핵심 숫자 · 주력 캐리
 * 오른쪽: 최근 등수 칩 · 요약 타일 · 등수 흐름 그래프 · 6축 진단 · 반복 습관 · 등수 분포 · 자주 쓴 기물/시너지 · 내 덱 성적표
 *
 * 모든 수치는 검색으로 받은 최근 경기에서 계산한다 (AI 미사용).
 * LP 변동 그래프는 Riot API 가 LP 기록을 주지 않아 등수 흐름으로 대신한다.
 */

const EMBLEM_BASE =
  'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem'

const placeTone = (p: number) => (p === 1 ? 'gold' : p <= 4 ? 'good' : 'bad')

const CHIP_TONE: Record<'gold' | 'good' | 'bad', string> = {
  gold: 'border-gold text-gold',
  good: 'border-good text-good',
  bad: 'border-line text-subtle',
}

const BAR_TONE: Record<'gold' | 'good' | 'bad', string> = {
  gold: 'bg-gold',
  good: 'bg-good',
  bad: 'bg-bad/70',
}

/** 최근 연속 기록 (TOP4 연속 또는 하위권 연속) */
function currentStreak(placements: number[]) {
  if (!placements.length) return { count: 0, top4: true }
  const top4 = placements[0] <= 4
  let count = 0
  for (const p of placements) {
    if (p <= 4 !== top4) break
    count++
  }
  return { count, top4 }
}

/** 판마다 아이템을 가장 많이 든 기물 = 그 판의 캐리 */
function topCarry(matches: SlimMatchData[]) {
  const tally = new Map<string, { name: string; imgUrl?: string; n: number; placeSum: number }>()
  for (const m of matches) {
    const carry = [...m.units].sort((a, b) => b.items.length - a.items.length || (b.rarity ?? 0) - (a.rarity ?? 0))[0]
    if (!carry || carry.items.length < 2) continue
    const t = tally.get(carry.name) || { name: carry.name, imgUrl: carry.imgUrl, n: 0, placeSum: 0 }
    t.n++
    t.placeSum += m.placement
    tally.set(carry.name, t)
  }
  return [...tally.values()].sort((a, b) => b.n - a.n)[0] ?? null
}

function mostPlayed(matches: SlimMatchData[]) {
  const units = new Map<string, { name: string; imgUrl?: string; n: number }>()
  const traits = new Map<string, { name: string; n: number }>()
  for (const m of matches) {
    for (const u of m.units) {
      const t = units.get(u.name) || { name: u.name, imgUrl: u.imgUrl, n: 0 }
      t.n++
      units.set(u.name, t)
    }
    for (const tr of m.traits) {
      const t = traits.get(tr.name) || { name: tr.name, n: 0 }
      t.n++
      traits.set(tr.name, t)
    }
  }
  return {
    units: [...units.values()].sort((a, b) => b.n - a.n).slice(0, 8),
    traits: [...traits.values()].sort((a, b) => b.n - a.n).slice(0, 6),
  }
}

function StatTile({ label, value, tone = 'text-ink' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-control bg-sunken px-3 py-2.5">
      <p className={`text-xl font-bold leading-tight ${tone}`}>{value}</p>
      <p className="text-xs text-subtle">{label}</p>
    </div>
  )
}

export function SummonerSummary({
  profile,
  matches,
  as: Heading = 'h2',
  deckReport,
  children,
}: {
  profile: SummonerProfile
  /** 최근 경기 (최근 경기가 먼저) */
  matches: SlimMatchData[]
  /** 페이지의 첫 제목이면 h1 */
  as?: 'h1' | 'h2'
  /** 내 덱 성적표 (서버 계산, 없으면 카드 숨김) */
  deckReport?: DeckReport | null
  /** 왼쪽 카드 아래 추가 영역 (공유 버튼 등) */
  children?: ReactNode
}) {
  const rank = profile.rank
  const placements = matches.map((m) => m.placement)
  const n = placements.length
  const avg = n ? placements.reduce((s, p) => s + p, 0) / n : 0
  const top4 = placements.filter((p) => p <= 4).length
  const wins = placements.filter((p) => p === 1).length
  const streak = currentStreak(placements)
  const carry = topCarry(matches)
  const played = mostPlayed(matches)
  const dist = Array.from({ length: 8 }, (_, i) => placements.filter((p) => p === i + 1).length)
  const distMax = Math.max(1, ...dist)
  const seasonWinRate = rankWinRate(rank)

  return (
    <section aria-label="소환사 개요" className="grid items-start gap-4 lg:grid-cols-[272px_minmax(0,1fr)]">
      {/* 왼쪽: 프로필 */}
      <div className="flex flex-col gap-3 rounded-card border border-line bg-panel p-5 shadow-card">
        <div className="flex flex-col items-center text-center">
          <div className="relative h-[120px] w-[150px] overflow-hidden">
            {rank ? (
              // 원본은 1280×720 중앙에 엠블럼이 작게 있어, 크게 키워 가운데만 보이게 한다
              <img
                src={`${EMBLEM_BASE}/emblem-${rank.tier.toLowerCase()}.png`}
                alt={formatRankLabel(rank)}
                className="pointer-events-none absolute left-1/2 top-1/2 w-[460px] max-w-none -translate-x-1/2 -translate-y-1/2"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-full border border-line bg-sunken text-xs text-subtle">
                배치 중
              </div>
            )}
            <img
              src={profile.profileIconUrl}
              alt=""
              className="absolute bottom-0 right-0 h-11 w-11 rounded-full border-2 border-panel bg-sunken object-cover"
            />
          </div>
          <Heading className="mt-3 max-w-full truncate text-2xl font-bold tracking-tight text-ink">
            {profile.gameName}
            <span className="ml-1 text-base font-medium text-subtle">#{profile.tagLine}</span>
          </Heading>
          <p className="mt-0.5 text-sm font-semibold text-ink">
            {formatRankLabel(rank)}
            {rank ? <span className="ml-1.5 font-medium text-muted">{formatRankLp(rank)}</span> : null}
          </p>
          {rank ? (
            <div className="mt-2 w-full">
              <div className="flex h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
                <div className="bg-accent" style={{ width: `${seasonWinRate ?? 0}%` }} />
              </div>
              <p className="mt-1 text-xs text-subtle">
                시즌 {formatRankRecord(rank)}
                {seasonWinRate != null ? ` · 승률 ${seasonWinRate}%` : ''}
              </p>
            </div>
          ) : null}
          <p className="mt-1 text-xs text-subtle">Lv.{profile.summonerLevel}</p>
          <div className="mt-3">
            <FavoriteButton gameName={profile.gameName} tagLine={profile.tagLine} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <StatTile label="최근 경기" value={`${n}`} />
          <StatTile label="평균 등수" value={avg.toFixed(2)} />
          <StatTile label="TOP4" value={`${n ? Math.round((top4 / n) * 100) : 0}%`} />
          <StatTile label="1등" value={`${n ? Math.round((wins / n) * 100) : 0}%`} />
        </div>

        {carry ? (
          <div className="flex items-center gap-3 rounded-control bg-sunken p-2.5">
            {carry.imgUrl ? (
              <img src={carry.imgUrl} alt="" className="h-11 w-11 rounded-control object-cover" />
            ) : null}
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink">{carry.name}</p>
              <p className="text-xs text-subtle">
                주력 캐리 · {carry.n}판 · 평균 {(carry.placeSum / carry.n).toFixed(1)}등
              </p>
            </div>
          </div>
        ) : null}

        {children ? <div className="flex flex-wrap items-center gap-2 border-t border-sunken pt-3">{children}</div> : null}
      </div>

      {/* 오른쪽: 최근 경기 분석 */}
      <div className="flex min-w-0 flex-col gap-5 rounded-card border border-line bg-panel p-5 shadow-card">
        {/* 연습 목표 진행 (이 브라우저에 목표가 있을 때만) */}
        <GoalTracker gameName={profile.gameName} tagLine={profile.tagLine} matches={matches} />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-ink">
              최근 {n}경기 <span className="text-sm font-medium text-subtle">(랭크)</span>
            </h3>
            <ol className="mt-2 flex flex-wrap gap-1.5" aria-label="최근 경기 등수 (최근 경기부터)">
              {placements.map((p, i) => (
                <li
                  key={i}
                  className={`flex h-7 w-7 items-center justify-center rounded-chip border-2 text-sm font-bold ${CHIP_TONE[placeTone(p)]}`}
                >
                  {p}
                </li>
              ))}
            </ol>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <StatTile label="평균" value={avg.toFixed(2)} />
            <StatTile label="TOP4" value={`${top4}`} />
            <StatTile label="1등" value={`${wins}`} />
            <StatTile
              label={streak.top4 ? '연속 TOP4' : '연속 하위권'}
              value={`${streak.count}`}
              tone={streak.top4 ? 'text-good' : 'text-bad'}
            />
          </div>
        </div>

        <div>
          <p className="mb-1 text-sm font-semibold text-muted">등수 흐름</p>
          <PlacementTrend matches={matches} />
        </div>

        <div className="grid gap-6 border-t border-sunken pt-5 xl:grid-cols-2">
          <div>
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted">
              6축 진단
              <span className="rounded-chip border border-line px-1.5 py-0.5 text-xs font-medium text-subtle">
                경기 데이터 계산 · AI 미사용
              </span>
            </p>
            <AxisOverview matches={matches} />
            <div className="mt-5">
              <HabitOverview matches={matches} />
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <div>
              <p className="mb-2 text-sm font-semibold text-muted">등수 분포</p>
              <div className="flex h-28 items-end gap-2" role="img" aria-label={dist.map((c, i) => `${i + 1}등 ${c}회`).join(', ')}>
                {dist.map((c, i) => (
                  <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${i + 1}등 ${c}회`}>
                    <span className="text-xs font-semibold text-ink">{c || ''}</span>
                    <div
                      className={`w-full max-w-[28px] rounded-t-[4px] ${c ? BAR_TONE[placeTone(i + 1)] : 'bg-sunken'}`}
                      style={{ height: `${c ? Math.max(8, (c / distMax) * 100) : 4}%` }}
                    />
                    <span className="text-xs text-subtle">{i + 1}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-muted">자주 쓴 기물 · 시너지</p>
              <div className="flex flex-wrap gap-1.5">
                {played.units.map((u) => (
                  <span key={u.name} title={`${u.name} · ${u.n}판`} className="relative">
                    {u.imgUrl ? (
                      <img src={u.imgUrl} alt={u.name} className="h-10 w-10 rounded-control border border-line object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-control border border-line bg-sunken text-xs text-muted">
                        {u.name.slice(0, 2)}
                      </span>
                    )}
                    <span className="absolute -bottom-1 -right-1 rounded-chip bg-panel px-1 text-xs font-bold text-ink">{u.n}</span>
                  </span>
                ))}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {played.traits.map((t) => (
                  <span key={t.name} className="rounded-chip bg-sunken px-2 py-0.5 text-xs text-ink">
                    {t.name} <b className="text-muted">{t.n}</b>
                  </span>
                ))}
              </div>
            </div>

            {deckReport ? <DeckReportCard report={deckReport} /> : null}
          </div>
        </div>
      </div>
    </section>
  )
}

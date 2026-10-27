/* eslint-disable @next/next/no-img-element */

import type { ReactNode } from 'react'
import type { SlimMatchData, SummonerProfile } from '@/lib/types'
import type { DeckReport } from '@/lib/deckReportShared'
import { formatRankLabel, formatRankLp, formatRankRecord, rankWinRate } from '@/lib/rank'
import { analyzableMatches, excludedLabel, matchBreakdown } from '@/lib/queue'
import { CURRENT_SET } from '@/lib/gameFacts'
import { boardCarry } from '@/lib/deckType'
import { PlacementTrend } from './PlacementTrend'
import { AxisOverview } from './AxisOverview'
import { HabitOverview } from './HabitOverview'
import { GoalTracker } from './GoalTracker'
import { DeckReportCard } from './DeckReportCard'
import { FavoriteButton } from './FavoriteButton'
import { MobileCollapse } from './MobileCollapse'

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

/** 주력 캐리로 보여 줄 최소 판 수 — 1판짜리는 '주력'이 아니다 (판마다 캐리가 다르면 숨긴다) */
const MAIN_CARRY_MIN_GAMES = 2

/**
 * 주력 캐리 = 여러 판에서 가장 자주 캐리였던 기물. 판의 캐리는 6축·덱 유형·핵심 장면과 같은 정의(lib/deckType boardCarry —
 * 딜템 최다 → 성급 → 코스트). 예전엔 '아이템 수 최다 → 코스트'로 따로 골라 3판 3성 렝가 대신 1판짜리 유나라가 나왔다.
 * 판 수가 같으면 3성 판이 많은 쪽 → 평균 등수가 좋은 쪽.
 */
function topCarry(matches: SlimMatchData[]) {
  const tally = new Map<string, { name: string; imgUrl?: string; n: number; threeStar: number; placeSum: number }>()
  for (const m of matches) {
    const carry = boardCarry(m.units || [])
    if (!carry || !carry.items?.length) continue
    const t = tally.get(carry.name) || { name: carry.name, imgUrl: carry.imgUrl, n: 0, threeStar: 0, placeSum: 0 }
    t.n++
    if (carry.tier === 3) t.threeStar++
    t.placeSum += m.placement
    tally.set(carry.name, t)
  }
  const best = [...tally.values()].sort((a, b) => b.n - a.n || b.threeStar - a.threeStar || a.placeSum / a.n - b.placeSum / b.n)[0]
  return best && best.n >= MAIN_CARRY_MIN_GAMES ? best : null
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

/**
 * 티어 엠블럼 (랭크 있음) 또는 프로필 아이콘 원 (배치 중).
 * 휴대폰에서는 작게(이름 왼쪽), lg 사이드바에서는 크게(가운데).
 */
function ProfileEmblem({ rank, iconUrl }: { rank: SummonerProfile['rank']; iconUrl: string }) {
  if (!rank) {
    // 랭크가 없으면 빈 타원 대신 프로필 아이콘을 크게 — "배치 중"은 이름 아래 랭크 줄이 알려 준다
    return (
      <img
        src={iconUrl}
        alt=""
        className="h-16 w-16 shrink-0 rounded-full border-2 border-line bg-sunken object-cover lg:h-24 lg:w-24"
      />
    )
  }
  return (
    <div className="relative h-[72px] w-[90px] shrink-0 overflow-hidden lg:h-[120px] lg:w-[150px]">
      {/* 원본은 1280×720 중앙에 엠블럼이 작게 있어, 크게 키워 가운데만 보이게 한다 */}
      <img
        src={`${EMBLEM_BASE}/emblem-${rank.tier.toLowerCase()}.png`}
        alt={formatRankLabel(rank)}
        className="pointer-events-none absolute left-1/2 top-1/2 w-[276px] max-w-none -translate-x-1/2 -translate-y-1/2 lg:w-[460px]"
      />
      <img
        src={iconUrl}
        alt=""
        className="absolute bottom-0 right-0 h-8 w-8 rounded-full border-2 border-panel bg-sunken object-cover lg:h-11 lg:w-11"
      />
    </div>
  )
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
  matches: allMatches,
  olderScanned = 0,
  as: Heading = 'h2',
  deckReport,
  children,
}: {
  profile: SummonerProfile
  /** 최근 경기 (최근 경기가 먼저) */
  matches: SlimMatchData[]
  /** 랭크 판이 모자라 더 이전에서 훑은 판 수 (덧붙인 건 그중 랭크 판만) */
  olderScanned?: number
  /** 페이지의 첫 제목이면 h1 */
  as?: 'h1' | 'h2'
  /** 내 덱 성적표 (서버 계산, 없으면 카드 숨김) */
  deckReport?: DeckReport | null
  /** 왼쪽 카드 아래 추가 영역 (공유 버튼 등) */
  children?: ReactNode
}) {
  const rank = profile.rank
  // 등수·6축·습관·목표는 현재 세트 랭크 판만 (이벤트·일반·이전 시즌 판은 경기 목록에만 — lib/queue)
  const matches = analyzableMatches(allMatches)
  const breakdown = matchBreakdown(allMatches)
  const excluded = excludedLabel(breakdown)
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
        {/* 휴대폰: 엠블럼 · 이름 가로 한 줄 (첫 화면에서 경기 목록이 가깝게) / lg 사이드바: 가운데 세로 */}
        <div className="flex items-center gap-4 lg:flex-col lg:items-center lg:gap-0 lg:text-center">
          <ProfileEmblem rank={rank} iconUrl={profile.profileIconUrl} />
          <div className="flex min-w-0 flex-1 flex-col items-start lg:w-full lg:items-center">
            <Heading className="max-w-full truncate text-xl font-bold tracking-tight text-ink lg:mt-3 lg:text-2xl">
              {profile.gameName}
              <span className="ml-1 text-sm font-medium text-subtle lg:text-base">#{profile.tagLine}</span>
            </Heading>
            <p className="mt-0.5 text-sm font-semibold text-ink">
              {formatRankLabel(rank)}
              {rank ? <span className="ml-1.5 font-medium text-muted">{formatRankLp(rank)}</span> : null}
              <span className="ml-1.5 text-xs font-medium text-subtle lg:hidden">Lv.{profile.summonerLevel}</span>
            </p>
            {rank ? (
              <div className="mt-2 w-full">
                <div className="flex h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
                  <div className="bg-accent" style={{ width: `${seasonWinRate ?? 0}%` }} />
                </div>
                <p className="mt-1 text-xs text-subtle">
                  시즌 {formatRankRecord(rank)}
                  {seasonWinRate != null ? ` (${seasonWinRate}%)` : ''}
                </p>
              </div>
            ) : null}
            <p className="mt-1 hidden text-xs text-subtle lg:block">Lv.{profile.summonerLevel}</p>
            <div className="mt-2 lg:mt-3">
              <FavoriteButton gameName={profile.gameName} tagLine={profile.tagLine} />
            </div>
          </div>
        </div>

        {/* 휴대폰에서는 오른쪽 카드의 요약 타일(평균·TOP4·1등)과 겹쳐 숨긴다 */}
        <div className={`hidden grid-cols-2 gap-2 ${n ? 'lg:grid' : ''}`}>
          <StatTile label="분석 경기" value={`${n}`} />
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
                주력 캐리 · {carry.n}/{n}판{carry.threeStar ? ` · 3성 ${carry.threeStar}판` : ''} · 평균 {(carry.placeSum / carry.n).toFixed(1)}등
              </p>
            </div>
          </div>
        ) : null}

        {children ? <div className="flex flex-wrap items-center gap-2 border-t border-sunken pt-3">{children}</div> : null}
      </div>

      {/* 오른쪽: 최근 경기 분석 */}
      <div className="flex min-w-0 flex-col gap-5 rounded-card border border-line bg-panel p-5 shadow-card">
        {n === 0 ? (
          <div>
            <h3 className="text-base font-bold text-ink">이번 시즌 랭크 경기가 없어 진단할 수 없습니다</h3>
            <p className="mt-1 text-sm text-muted">
              불러온 최근 {breakdown.total}판 중 분석할 판이 없습니다{excluded ? ` (${excluded})` : ''}
              {olderScanned ? `. 그 이전 ${olderScanned}판도 확인했지만 랭크 게임이 없었습니다` : ''}. 등수·6축 진단·습관·덱
              성적표는 시즌 {CURRENT_SET} 랭크 게임만 계산합니다.
            </p>
          </div>
        ) : (
        <>
        {/* 연습 목표 진행 (이 브라우저에 목표가 있을 때만) */}
        <GoalTracker gameName={profile.gameName} tagLine={profile.tagLine} matches={matches} />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-ink">
              최근 {n}경기 <span className="text-sm font-medium text-subtle">(시즌 {CURRENT_SET} 랭크)</span>
            </h3>
            {excluded ? <p className="mt-0.5 text-xs text-subtle">불러온 {breakdown.total}판 중 {excluded}은 분석에서 뺐습니다</p> : null}
            {olderScanned ? (
              <p className="mt-0.5 text-xs text-subtle">최근 판에 랭크 게임이 적어 그 이전 {olderScanned}판에서 랭크 게임을 더 불러왔습니다</p>
            ) : null}
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

        {/* 휴대폰에서는 접어 둔다 — 6축·습관·분포·덱 성적표가 길어 경기 목록이 2천 px 아래로 밀렸다 */}
        <MobileCollapse label="6축 진단 · 등수 분포 · 내 덱 성적표">
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
        </MobileCollapse>
        </>
        )}
      </div>
    </section>
  )
}

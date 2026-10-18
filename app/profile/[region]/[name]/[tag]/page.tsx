import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isValidProfileParams, loadProfile } from '@/lib/profileData'
import { calculateProfileStats } from '@/lib/profile'
import { formatRankLabel, formatRankLp } from '@/lib/rank'
import { RiotApiError } from '@/lib/riot'
import { MatchCard } from '@/app/components/MatchCard'
import { RankBadge } from '@/app/components/RankBadge'
import { SimpleHeader } from '@/app/components/SimpleHeader'
import { SiteFooter } from '@/app/components/SiteFooter'
import { ShareButton } from '@/app/components/ShareButton'
import { SITE_URL } from '@/lib/site'

export const revalidate = 120

interface ProfilePageProps {
  params: Promise<{ region: string; name: string; tag: string }>
}

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** generateMetadata 와 페이지가 같은 결과를 공유하도록 캐시된 로더를 감싼다. */
async function loadOrError(name: string, tag: string) {
  try {
    return { data: await loadProfile(name, tag, 10), error: null as unknown }
  } catch (err) {
    return { data: null, error: err }
  }
}

function errorStatus(err: unknown): number {
  return err instanceof RiotApiError ? err.statusCode : 500
}

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  const { region, name, tag } = await params
  const gameName = decodeParam(name)
  const tagLine = decodeParam(tag)
  const canonical = `${SITE_URL}/profile/kr/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`

  if (!isValidProfileParams(region, gameName, tagLine)) {
    return { title: '소환사 전적', alternates: { canonical } }
  }

  const { data } = await loadOrError(gameName, tagLine)
  if (!data) {
    return {
      title: `${gameName}#${tagLine} 전적`,
      description: `${gameName}#${tagLine} 최근 TFT 전적과 AI 코칭`,
      alternates: { canonical },
    }
  }

  const stats = calculateProfileStats(
    data.matches,
    data.gameName,
    data.tagLine,
    data.summonerLevel,
    data.profileIconId,
    data.rank
  )
  const title = `${stats.gameName}#${stats.tagLine} 전적 — 평균 ${stats.avgPlacement}위 · TOP4 ${stats.top4Rate}%`
  const rankPart = stats.rank ? `${formatRankLabel(stats.rank)} ${formatRankLp(stats.rank)}` : '배치 중'
  const description = `${rankPart} · 최근 ${stats.totalGames}경기 기준 평균 ${stats.avgPlacement}위, 순방률 ${stats.top4Rate}%, 1등 ${stats.winRate}%. 경기별 AI 전략 코칭과 6축 진단을 확인하세요.`

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: 'profile',
      siteName: 'TFT LAB',
      locale: 'ko_KR',
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { region, name, tag } = await params
  const gameName = decodeParam(name)
  const tagLine = decodeParam(tag)

  if (!isValidProfileParams(region, gameName, tagLine)) notFound()

  const { data, error } = await loadOrError(gameName, tagLine)
  if (!data) {
    const status = errorStatus(error)
    if (status === 404) notFound()

    const message =
      error instanceof RiotApiError
        ? error.message
        : '전적을 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'

    return (
      <div className="min-h-screen bg-app text-ink">
        <SimpleHeader active="profile" />
        <main className="mx-auto max-w-3xl px-4 py-16">
          <div className="rounded-2xl border border-line/15 bg-panel/90 p-6 text-center">
            <h1 className="text-lg font-black">전적을 불러오지 못했습니다</h1>
            <p className="mt-2 text-sm text-muted">{message}</p>
            <Link
              href="/"
              className="mt-5 inline-block rounded-xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-cyan-500"
            >
              홈에서 다시 검색
            </Link>
          </div>
        </main>
        <SiteFooter />
      </div>
    )
  }

  const stats = calculateProfileStats(
    data.matches,
    data.gameName,
    data.tagLine,
    data.summonerLevel,
    data.profileIconId,
    data.rank
  )
  const sharePath = `/profile/kr/${encodeURIComponent(data.gameName)}/${encodeURIComponent(data.tagLine)}`

  return (
    <div className="min-h-screen bg-app text-ink">
      <SimpleHeader active="profile" />

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <nav className="text-[11px] text-subtle">
          <Link href="/" className="hover:text-ink">
            홈
          </Link>
          <span className="mx-1.5">/</span>
          <span>전적</span>
          <span className="mx-1.5">/</span>
          <span className="text-muted">
            {stats.gameName}#{stats.tagLine}
          </span>
        </nav>

        <section className="relative overflow-hidden rounded-2xl border border-line/10 bg-panel/90 p-5 shadow-xl backdrop-blur-xl md:p-6">
          <div className="pointer-events-none absolute -left-12 -top-12 h-36 w-36 rounded-full bg-cyan-500/15 blur-2xl" />

          <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={stats.profileIconUrl}
                  alt={`${stats.gameName} 프로필 아이콘`}
                  className="h-16 w-16 rounded-2xl border-2 border-cyan-400 bg-sunken/80 object-cover shadow-lg shadow-cyan-500/20"
                />
                <span className="absolute -bottom-2 -right-2 rounded-full border border-cyan-400/50 bg-slate-900 px-2 py-0.5 font-mono text-[10px] font-black text-cyan-300 shadow">
                  Lv.{stats.summonerLevel}
                </span>
              </div>
              <div>
                <h1 className="flex items-baseline gap-2 text-2xl font-black md:text-3xl">
                  <span>{stats.gameName}</span>
                  <span className="font-mono text-sm font-bold text-muted">#{stats.tagLine}</span>
                </h1>
                <div className="mt-1.5">
                  <RankBadge rank={stats.rank} />
                </div>
                <p className="mt-1 text-xs font-medium text-muted">
                  최근 <strong className="font-mono text-cyan-400">{stats.totalGames}경기</strong> 기준
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4 rounded-2xl border border-line/15 bg-sunken/80 px-5 py-3 shadow-inner sm:gap-6">
              <div className="text-center">
                <p className="text-[11px] font-bold text-muted">평균 등수</p>
                <p className="font-mono text-xl font-black text-amber-400 md:text-2xl">#{stats.avgPlacement}</p>
              </div>
              <div className="h-8 w-[1px] bg-line/10" />
              <div className="text-center">
                <p className="text-[11px] font-bold text-muted">순방률 (TOP 4)</p>
                <p className="font-mono text-xl font-black text-emerald-400 md:text-2xl">{stats.top4Rate}%</p>
              </div>
              <div className="h-8 w-[1px] bg-line/10" />
              <div className="text-center">
                <p className="text-[11px] font-bold text-muted">1등 승률</p>
                <p className="font-mono text-xl font-black text-cyan-400 md:text-2xl">{stats.winRate}%</p>
              </div>
            </div>
          </div>

          <div className="relative mt-4 flex flex-wrap items-center gap-2">
            <ShareButton path={sharePath} />
            {data.isDemo ? (
              <span className="rounded-lg border border-cyan-800/50 bg-cyan-950/40 px-2.5 py-1.5 text-[11px] font-bold text-cyan-300">
                체험 모드
              </span>
            ) : null}
            <span className="text-[11px] text-subtle">
              이 페이지 주소를 공유하면 같은 전적을 바로 볼 수 있습니다.
            </span>
          </div>
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-black">실전 매치 히스토리 ({data.matches.length}경기)</h2>
            <span className="text-xs text-muted">
              각 경기의 <strong className="text-cyan-300">[이 경기 AI 분석]</strong> 버튼으로 정밀 코칭
            </span>
          </div>

          <div className="space-y-4">
            {data.matches.map((match, index) => (
              <MatchCard
                key={match.matchId || index}
                match={match}
                index={index}
                puuid={data.puuid}
                gameName={data.gameName}
                tagLine={data.tagLine}
                isDemo={data.isDemo}
              />
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}

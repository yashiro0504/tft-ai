'use client'

import { useEffect, useState } from 'react'
import {
  RefreshCw, AlertCircle, Info, Sparkles, Lock,
} from 'lucide-react'
import type { TftSearchResponse, TftOverviewResponse, MetaCoachFeedback } from '@/lib/types'
import { MatchCard } from './components/MatchCard'
import { FeedbackReport } from './components/FeedbackReport'
import { MetaRanking } from './components/MetaRanking'
import { SiteHeader } from './components/SiteHeader'
import { TurnstileWidget } from './components/TurnstileWidget'
import { ShareButton } from './components/ShareButton'
import { SavedSearches } from './components/SavedSearches'
import { track, trackOnce } from '@/lib/analytics'
import { addRecentSearch } from '@/lib/recentSearches'
import { useQuota } from '@/lib/useQuota'
import { LimitModal } from './components/LimitModal'
import { TopDecks } from './components/TopDecks'
import { SummonerSummary } from './components/SummonerSummary'

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''

export default function TFTCoachPage() {
  const [tab, setTab] = useState<'meta' | 'coach'>('coach')
  const [gameName, setGameName] = useState('')
  const [tagLine, setTagLine] = useState('KR1')

  const [isLoading, setIsLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState<TftSearchResponse | null>(null)

  // Turnstile: 토큰은 1회용이므로 요청 후 resetSignal 을 증가시켜 재발급한다.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0)

  const [isOverviewLoading, setIsOverviewLoading] = useState(false)
  const [overviewFeedback, setOverviewFeedback] = useState<MetaCoachFeedback | null>(null)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const quota = useQuota()
  const [isLimitOpen, setIsLimitOpen] = useState(false)
  /** 종합 분석은 Pro 예정 기능: 정책 확정 전까지 막지 않고 안내만 보여준다 */
  const [showProNotice, setShowProNotice] = useState(false)

  // 기본 탭은 AI 코치. '/?tab=meta' 로 진입한 경우에만 메타 랭킹 탭을 연다.
  // (useSearchParams 는 Suspense 경계가 필요하므로 window 에서 직접 읽는다)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const initialTab = params.get('tab') === 'meta' ? 'meta' : 'coach'
    if (initialTab === 'meta') setTab('meta')
    trackOnce('tab_view:home:initial', 'tab_view', { tab: initialTab, surface: 'home' })
  }, [])

  /** 탭 전환 + URL 쿼리 동기화 (공유/새로고침 시 현재 탭 유지) */
  const handleTabChange = (next: 'meta' | 'coach') => {
    if (next === tab) return
    setTab(next)
    track('tab_view', { tab: next, surface: 'home' })
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (next === 'meta') url.searchParams.set('tab', 'meta')
    else url.searchParams.delete('tab')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }

  const handleSearch = async (overrideName?: string, overrideTag?: string) => {
    const targetName = (overrideName || gameName).trim()
    const targetTag = (overrideTag || tagLine).trim()

    if (!targetName) {
      setError('소환사 닉네임을 입력해주세요!')
      return
    }

    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setError('로봇 확인을 완료한 뒤 다시 검색해주세요.')
      return
    }

    setError(null)
    setSearch(null)
    setOverviewFeedback(null)
    setOverviewError(null)
    setIsLoading(true)
    setLoadingStep('Riot API 로 최근 전적과 로비 8인 데이터를 수집 중...')
    track('search_submit', { surface: 'coach' })
    const stepTimer1 = setTimeout(() => setLoadingStep('매치 리스트와 로비 기물 데이터를 정리하는 중...'), 900)

    try {
      const res = await fetch('/api/tft/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameName: targetName,
          tagLine: targetTag || 'KR1',
          limit: 10,
          turnstileToken: turnstileToken || undefined,
        }),
      })
      const data: TftSearchResponse = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error || '검색 중 오류가 발생했습니다.')
      }
      setSearch(data)
      addRecentSearch({ gameName: data.gameName, tagLine: data.tagLine })
      track('search_success', {
        matchCount: data.matches.length,
        isDemo: Boolean(data.isDemo),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : '네트워크 오류가 발생했습니다.'
      setError(message)
    } finally {
      clearTimeout(stepTimer1)
      setIsLoading(false)
      setLoadingStep('')
      // 토큰은 1회용: 성공/실패와 무관하게 위젯을 재발급한다.
      if (TURNSTILE_SITE_KEY) setTurnstileResetSignal((value) => value + 1)
    }
  }

  const handleOverview = async () => {
    if (!search || isOverviewLoading) return
    setShowProNotice(true)
    if (quota.exhausted) {
      setIsLimitOpen(true)
      return
    }
    setIsOverviewLoading(true)
    setOverviewError(null)
    track('analysis_click', { scope: 'overview', matchCount: search.matches.length })
    try {
      const res = await fetch('/api/tft/overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameName: search.gameName,
          tagLine: search.tagLine,
          matches: search.matches,
          mode: 'multi',
        }),
      })
      const data: TftOverviewResponse = await res.json()
      if (!res.ok || !data.success || !data.feedback) {
        throw new Error(data.error || '종합 분석 중 오류가 발생했습니다.')
      }
      setOverviewFeedback(data.feedback)
      quota.consume()
      track('analysis_success', { scope: 'overview', matchCount: search.matches.length })
    } catch (err) {
      const message = err instanceof Error ? err.message : '종합 분석 중 오류가 발생했습니다.'
      setOverviewError(message)
    } finally {
      setIsOverviewLoading(false)
    }
  }

  const setSample = (name: string, tag: string) => {
    setGameName(name)
    setTagLine(tag)
    handleSearch(name, tag)
  }

  // 예시 프리셋: 보조 버튼 모양, 현재 입력과 같은 프리셋만 선택된 칩 스타일
  const presetClass = (name: string, tag: string) =>
    gameName === name && tagLine === tag
      ? 'cursor-pointer rounded-control border border-accent bg-accent-bg px-3 py-1.5 font-semibold text-accent transition'
      : 'cursor-pointer rounded-control border border-line bg-sunken px-3 py-1.5 text-ink transition hover:border-accent'

  return (
    <div className="min-h-screen bg-app text-ink selection:bg-accent selection:text-on-accent">
      <SiteHeader active={tab} onChange={handleTabChange} />

      <main className="relative">
        {tab === 'meta' ? (
          <section className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
            <MetaRanking onOpenCoach={() => handleTabChange('coach')} showTitle />
          </section>
        ) : (
        <>
        {/* 첫 화면: 검색이 주인공 */}
        <section className="mx-auto max-w-[1200px] px-4 pb-10 pt-12 sm:px-6 sm:pt-16">
          <p className="mb-3 text-sm font-semibold text-accent">시즌 18 · AI 코치</p>
          <h1 className="max-w-[720px] text-[30px] font-bold leading-tight tracking-tight text-ink sm:text-[36px]">
            TFT 실전 전적 검색 &amp; 경기별 AI 코칭
          </h1>
          <p className="mb-8 mt-3 max-w-[640px] text-base leading-relaxed text-muted">
            아이디를 검색하면 최근 경기 리스트가 뜨고, 원하는 경기마다 AI 분석을 눌러 기물 경합·아이템·운영을 그 판 기준으로
            정밀 진단합니다.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSearch()
            }}
            className="flex max-w-[760px] flex-col gap-2 rounded-card border border-line bg-panel p-2 shadow-card focus-within:border-accent sm:h-[60px] sm:flex-row sm:items-stretch sm:gap-0"
          >
            <label htmlFor="riot-id" className="sr-only">
              Riot ID
            </label>
            <input
              id="riot-id"
              type="text"
              placeholder="Riot ID 입력 (예: 테스트#KR1 또는 소환사명)"
              value={gameName}
              onChange={(e) => setGameName(e.target.value)}
              className="h-11 min-w-0 flex-1 bg-transparent px-3 text-base text-ink placeholder:text-subtle focus:outline-none sm:h-auto sm:px-4"
            />
            <span className="hidden w-px self-stretch bg-line sm:my-2 sm:block" aria-hidden="true" />
            <label htmlFor="riot-tag" className="sr-only">
              태그
            </label>
            <input
              id="riot-tag"
              type="text"
              placeholder="#KR1"
              value={tagLine}
              onChange={(e) => setTagLine(e.target.value)}
              className="h-11 bg-transparent px-3 text-base text-muted placeholder:text-subtle focus:outline-none sm:h-auto sm:w-24 sm:text-center"
            />
            <button
              type="submit"
              disabled={isLoading}
              className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-control bg-accent px-6 text-base font-bold text-on-accent transition hover:opacity-90 disabled:opacity-50 sm:h-auto"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>검색 중...</span>
                </>
              ) : (
                <span>전적 검색</span>
              )}
            </button>
          </form>

          {/* Cloudflare Turnstile (site key 미설정 시 렌더링 안 됨) */}
          {TURNSTILE_SITE_KEY ? (
            <div className="mt-3 max-w-[760px]">
              <TurnstileWidget onToken={setTurnstileToken} resetSignal={turnstileResetSignal} />
            </div>
          ) : null}

          <div className="max-w-[760px]">
            {/* 최근 검색 / 즐겨찾기 (localStorage + 로그인 시 서버) */}
            <SavedSearches onPick={(name, tag) => setSample(name, tag)} disabled={isLoading} />

            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <span className="mr-1 text-subtle">아이디 없이 예시 보기</span>
              <button type="button" onClick={() => setSample('띵 땡', 'KR1')} className={presetClass('띵 땡', 'KR1')}>
                띵 땡#KR1
              </button>
              <button type="button" onClick={() => setSample('대깨고집러', 'KR1')} className={presetClass('대깨고집러', 'KR1')}>
                대깨 사출 판
              </button>
              <button type="button" onClick={() => setSample('빈집장인', 'KR1')} className={presetClass('빈집장인', 'KR1')}>
                빈집 유연 운영
              </button>
              <span className="ml-auto text-xs text-subtle">
                오늘 무료 AI 분석 {quota.remaining}/{quota.limit}회
              </span>
            </div>
          </div>
        </section>

        {/* 검색 전: 메타 상위 덱으로 바로 가치를 보여준다 */}
        {!search && !isLoading ? (
          <div className="border-t border-sunken bg-sunken/30">
            <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
              <TopDecks onOpenMeta={() => handleTabChange('meta')} />
            </div>
          </div>
        ) : null}

        <section className="mx-auto max-w-[1200px] px-4 sm:px-6">
        {/* Error Alert */}
        {error && (
          <div className="mb-8 p-4 rounded-card bg-bad/10 border border-bad/80 text-bad flex items-start gap-3 text-sm">
            <AlertCircle className="w-5 h-5 text-bad shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-bad">소환사 검색 오류</p>
              <p className="mt-1 text-ink">{error}</p>
            </div>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="bg-panel border border-line rounded-card p-8 text-center animate-pulse space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-accent-bg flex items-center justify-center text-accent">
              <RefreshCw className="w-6 h-6 animate-spin text-accent" />
            </div>
            <p className="text-lg font-bold text-ink-soft">{loadingStep}</p>
            <p className="text-xs text-muted">Riot 공식 서버 데이터를 실시간 로드하고 있습니다...</p>
          </div>
        )}

        {/* Search Results */}
        {search && !isLoading && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3 duration-500">
            {/* Demo Notice */}
            {search.isDemo && (
              <div className="px-4 py-3 rounded-card bg-accent-bg border border-accent/50 text-accent text-xs flex items-center gap-2">
                <Info className="w-4 h-4 shrink-0" />
                <span>
                  <strong>체험 모드:</strong> API 키가 없거나 데모 데이터로 동작 중입니다. 실제 Riot API 키를 설정하면
                  라이브 전적이 로드됩니다. (아래 경기마다 [AI 분석]을 눌러보세요)
                </span>
              </div>
            )}

            {/* 1. 소환사 요약 */}
            {search.summonerProfile && (
              <SummonerSummary profile={search.summonerProfile} placements={search.matches.map((m) => m.placement)} />
            )}

            {/* 2. 종합 AI 분석 (선택) */}
            <div className="bg-panel border border-line rounded-card p-6 shadow-card">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <h3 className="flex flex-wrap items-center gap-2 text-xl font-bold text-ink">
                    최근 {search.matches.length}경기 종합 AI 코칭
                    <span
                      title="Pro 기능 (출시 전까지 무료)"
                      className="inline-flex items-center gap-1 rounded-chip bg-accent-bg px-1.5 py-0.5 text-xs font-bold text-accent"
                    >
                      <Lock className="h-3 w-3" aria-hidden="true" />
                      PRO
                    </span>
                  </h3>
                  <p className="mt-1 text-sm text-muted">
                    여러 판을 묶어 플레이스타일·유연성 성향을 진단합니다. (개별 정밀 분석은 아래 경기 카드에서)
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-subtle whitespace-nowrap">오늘 {quota.remaining}/{quota.limit}회 남음</span>
                <button
                  type="button"
                  onClick={handleOverview}
                  disabled={isOverviewLoading}
                  className="shrink-0 inline-flex items-center gap-2 px-5 py-3 rounded-control bg-accent hover:opacity-90 disabled:opacity-60 text-on-accent font-bold text-sm transition cursor-pointer"
                >
                  {isOverviewLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>종합 분석 중...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>{overviewFeedback ? '종합 다시 분석' : '종합 AI 분석 실행'}</span>
                    </>
                  )}
                </button>
                </div>
              </div>

              {showProNotice && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-subtle">
                  <Lock className="h-3 w-3 text-accent" aria-hidden="true" />
                  종합 분석은 Pro 기능이에요. 출시 전까지는 무료로 쓸 수 있어요.
                </p>
              )}

              {overviewError && (
                <div className="mt-4 p-3 rounded-control bg-bad/10 border border-bad/60 text-bad text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-bad shrink-0" />
                  <span className="text-ink">{overviewError}</span>
                </div>
              )}

              {overviewFeedback && (
                <div className="mt-5 animate-in fade-in duration-300">
                  <FeedbackReport
                    feedback={overviewFeedback}
                    title={`최근 ${search.matches.length}경기 종합 메타 총평`}
                    matchCount={search.matches.length}
                  />
                </div>
              )}
            </div>

            {/* 3. 매치 히스토리 리스트 (경기별 AI 분석) */}
            <div className="pt-2">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <h3 className="text-xl font-bold text-ink">실전 매치 히스토리 ({search.matches.length}경기)</h3>
                <span className="text-xs text-muted">
                  각 경기의 [이 경기 AI 분석] 버튼으로 개별 정밀 코칭을 받아보세요.
                </span>
              </div>

              <div className="space-y-4">
                {search.matches.map((match, idx) => (
                  <MatchCard
                    key={match.matchId || idx}
                    match={match}
                    index={idx}
                    puuid={search.puuid}
                    gameName={search.gameName}
                    tagLine={search.tagLine}
                    isDemo={Boolean(search.isDemo)}
                  />
                ))}
              </div>
            </div>

            {/* Bottom actions */}
            <div className="flex flex-wrap items-center justify-center gap-3 pt-8">
              <ShareButton
                path={`/profile/kr/${encodeURIComponent(search.gameName)}/${encodeURIComponent(search.tagLine)}`}
                label="전적 페이지 링크 복사"
                surface="coach_result"
              />
              <button
                type="button"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="text-xs text-muted hover:text-ink-soft underline transition cursor-pointer"
              >
                소환사 다시 검색하기 ↑
              </button>
            </div>

          </div>
        )}
        </section>
        </>
        )}
      </main>

      <LimitModal open={isLimitOpen} onClose={() => setIsLimitOpen(false)} scope="overview" />

      <footer className="relative mt-16 border-t border-sunken">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-1.5 px-4 py-6 text-center sm:flex-row sm:px-6 sm:text-left">
          <p className="text-[12px] text-muted">
            <span className="font-black text-muted">TFT LAB</span> · 시즌 18 메타 랭킹 &amp; AI 코치
          </p>
          <div className="text-xs leading-relaxed text-subtle sm:text-right">
            <p>데이터: Riot 실측 매치 표본 · TFT LAB is not endorsed by Riot Games.</p>
            <p>이 서비스는 라이엇 게임즈와 제휴하거나 승인받지 않았습니다.</p>
          </div>
        </div>
      </footer>
    </div>
  )

}

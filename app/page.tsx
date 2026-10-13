'use client'

import { useState } from 'react'
import {
  Trophy, Compass, RefreshCw, AlertCircle, Info, Layers, BarChart3, Sparkles,
} from 'lucide-react'
import type { TftSearchResponse, TftOverviewResponse, MetaCoachFeedback } from '@/lib/types'
import { MatchCard } from './components/MatchCard'
import { FeedbackReport } from './components/FeedbackReport'

export default function TFTCoachPage() {
  const [gameName, setGameName] = useState('')
  const [tagLine, setTagLine] = useState('KR1')

  const [isLoading, setIsLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState<TftSearchResponse | null>(null)

  const [isOverviewLoading, setIsOverviewLoading] = useState(false)
  const [overviewFeedback, setOverviewFeedback] = useState<MetaCoachFeedback | null>(null)
  const [overviewError, setOverviewError] = useState<string | null>(null)

  const handleSearch = async (overrideName?: string, overrideTag?: string) => {
    const targetName = (overrideName || gameName).trim()
    const targetTag = (overrideTag || tagLine).trim()

    if (!targetName) {
      setError('소환사 닉네임을 입력해주세요!')
      return
    }

    setError(null)
    setSearch(null)
    setOverviewFeedback(null)
    setOverviewError(null)
    setIsLoading(true)
    setLoadingStep('Riot API 로 최근 전적과 로비 8인 데이터를 수집 중...')
    const stepTimer1 = setTimeout(() => setLoadingStep('매치 리스트와 로비 기물 데이터를 정리하는 중...'), 900)

    try {
      const res = await fetch('/api/tft/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameName: targetName, tagLine: targetTag || 'KR1', limit: 10 }),
      })
      const data: TftSearchResponse = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error || '검색 중 오류가 발생했습니다.')
      }
      setSearch(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : '네트워크 오류가 발생했습니다.'
      setError(message)
    } finally {
      clearTimeout(stepTimer1)
      setIsLoading(false)
      setLoadingStep('')
    }
  }

  const handleOverview = async () => {
    if (!search || isOverviewLoading) return
    setIsOverviewLoading(true)
    setOverviewError(null)
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

  return (
    <div className="min-h-screen bg-[#080C15] text-slate-100 selection:bg-blue-500 selection:text-white pb-20">
      {/* Background Ambience */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-blue-600/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -left-32 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-0 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-5xl mx-auto px-4 py-10 md:py-14">
        {/* Header Title */}
        <header className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-cyan-400 text-xs md:text-sm font-semibold tracking-wider uppercase mb-3">
            <Trophy className="w-4 h-4 text-amber-400" />
            TFT Match History &amp; AI Strategy Coach
          </div>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight text-white mb-3">
            TFT 실전 전적 검색 &amp;{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400">
              경기별 AI 코칭
            </span>
          </h1>
          <p className="text-slate-400 text-sm md:text-base max-w-2xl mx-auto leading-relaxed">
            아이디를 검색하면 최근 경기 리스트가 뜨고, <strong>원하는 경기마다 [AI 분석]</strong>을 눌러
            기물 경합·증강 선택·아이템·운영을 그 판 기준으로 정밀 진단합니다.
          </p>
        </header>

        {/* Search Input Box */}
        <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 md:p-6 shadow-2xl mb-8">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSearch()
            }}
            className="flex flex-col sm:flex-row gap-3"
          >
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="Riot ID 입력 (예: 테스트#KR1 또는 소환사명)"
                value={gameName}
                onChange={(e) => setGameName(e.target.value)}
                className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-4 py-3.5 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 text-sm md:text-base transition"
              />
            </div>
            <div className="w-full sm:w-28">
              <input
                type="text"
                placeholder="#KR1"
                value={tagLine}
                onChange={(e) => setTagLine(e.target.value)}
                className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3 py-3.5 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 text-sm md:text-base transition text-center"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 active:scale-95 disabled:opacity-50 text-white font-bold px-6 py-3.5 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25 transition duration-150 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>검색 중...</span>
                </>
              ) : (
                <>
                  <Compass className="w-5 h-5 text-cyan-200" />
                  <span>전적 검색</span>
                </>
              )}
            </button>
          </form>

          {/* Quick Preset Samples */}
          <div className="mt-4 flex flex-wrap items-center gap-2 pt-3 border-t border-slate-800/80 text-xs text-slate-400">
            <span className="font-semibold text-slate-500">체험용 프리셋:</span>
            <button
              type="button"
              onClick={() => setSample('띵 땡', 'KR1')}
              className="px-2.5 py-1 rounded-lg bg-blue-950/80 hover:bg-blue-900 text-cyan-300 transition border border-blue-700/80 font-bold"
            >
              👑 띵 땡#KR1
            </button>
            <button
              type="button"
              onClick={() => setSample('대깨고집러', 'KR1')}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition border border-slate-700/50"
            >
              ⚠️ 대깨 사출 판
            </button>
            <button
              type="button"
              onClick={() => setSample('빈집장인', 'KR1')}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition border border-slate-700/50"
            >
              📊 빈집 유연 운영
            </button>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-8 p-4 rounded-xl bg-red-950/60 border border-red-800/80 text-red-200 flex items-start gap-3 text-sm">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-red-300">소환사 검색 오류</p>
              <p className="mt-1 text-red-200/90">{error}</p>
            </div>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-8 text-center animate-pulse space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-blue-500/20 flex items-center justify-center text-cyan-400">
              <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
            </div>
            <p className="text-lg font-bold text-slate-200">{loadingStep}</p>
            <p className="text-xs text-slate-500">Riot 공식 서버 데이터를 실시간 로드하고 있습니다...</p>
          </div>
        )}

        {/* Search Results */}
        {search && !isLoading && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3 duration-500">
            {/* Demo Notice */}
            {search.isDemo && (
              <div className="px-4 py-2.5 rounded-xl bg-cyan-950/40 border border-cyan-800/50 text-cyan-300 text-xs flex items-center gap-2">
                <Info className="w-4 h-4 shrink-0" />
                <span>
                  <strong>체험 모드:</strong> API 키가 없거나 데모 데이터로 동작 중입니다. 실제 Riot API 키를 설정하면
                  라이브 전적이 로드됩니다. (아래 경기마다 [AI 분석]을 눌러보세요)
                </span>
              </div>
            )}

            {/* 1. 소환사 프로필 요약 카드 */}
            {search.summonerProfile && (
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <img
                      src={search.summonerProfile.profileIconUrl}
                      alt="Summoner Icon"
                      className="w-16 h-16 rounded-2xl border-2 border-cyan-500/50 shadow-lg object-cover bg-slate-950"
                      onError={(e) => {
                        ;(e.target as HTMLElement).style.display = 'none'
                      }}
                    />
                    <span className="absolute -bottom-2 -right-2 px-2 py-0.5 rounded-full bg-slate-950 border border-slate-700 text-[10px] font-mono font-bold text-slate-300">
                      Lv.{search.summonerProfile.summonerLevel}
                    </span>
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-white flex items-center gap-2">
                      <span>{search.summonerProfile.gameName}</span>
                      <span className="text-sm font-normal text-slate-400">#{search.summonerProfile.tagLine}</span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      최근 {search.summonerProfile.totalGames}경기 전적 통계 기준
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-6 bg-slate-950/80 border border-slate-800/80 rounded-xl px-6 py-3">
                  <div className="text-center">
                    <p className="text-[11px] font-bold text-slate-400">평균 등수</p>
                    <p className="text-xl md:text-2xl font-black text-amber-400 font-mono">
                      #{search.summonerProfile.avgPlacement}
                    </p>
                  </div>
                  <div className="w-[1px] h-8 bg-slate-800" />
                  <div className="text-center">
                    <p className="text-[11px] font-bold text-slate-400">순방률 (TOP 4)</p>
                    <p className="text-xl md:text-2xl font-black text-emerald-400 font-mono">
                      {search.summonerProfile.top4Rate}%
                    </p>
                  </div>
                  <div className="w-[1px] h-8 bg-slate-800" />
                  <div className="text-center">
                    <p className="text-[11px] font-bold text-slate-400">1등 승률</p>
                    <p className="text-xl md:text-2xl font-black text-cyan-400 font-mono">
                      {search.summonerProfile.winRate}%
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 2. 종합 AI 분석 (선택) */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-black text-white flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-cyan-400" />
                    최근 {search.matches.length}경기 종합 AI 코칭
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    여러 판을 묶어 플레이스타일·유연성 성향을 진단합니다. (개별 정밀 분석은 아래 경기 카드에서)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleOverview}
                  disabled={isOverviewLoading}
                  className="shrink-0 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-60 text-white font-bold text-sm shadow-lg shadow-indigo-600/25 transition cursor-pointer"
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

              {overviewError && (
                <div className="mt-4 p-3 rounded-lg bg-red-950/50 border border-red-900/60 text-red-200 text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{overviewError}</span>
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
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  <Layers className="w-5 h-5 text-cyan-400" />
                  <span>실전 매치 히스토리 ({search.matches.length}경기)</span>
                </h3>
                <span className="text-xs text-slate-400">
                  각 경기의 <strong className="text-cyan-300">[이 경기 AI 분석]</strong> 버튼으로 개별 정밀 코칭을 받아보세요.
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

            {/* Bottom button */}
            <div className="text-center pt-8">
              <button
                type="button"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="text-xs text-slate-400 hover:text-slate-200 underline transition cursor-pointer"
              >
                소환사 다시 검색하기 ↑
              </button>
            </div>

          </div>
        )}

      </div>
    </div>
  )

}

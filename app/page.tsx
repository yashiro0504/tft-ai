'use client'

import { useState } from 'react'
import { 
  Target, Shield, TrendingUp, CheckCircle2, 
  RefreshCw, Zap, Award, BarChart3, AlertCircle, 
  Lightbulb, Layers, Swords, Info, Users, Compass, AlertTriangle,
  ChevronDown, ChevronUp, Trophy, Sparkles
} from 'lucide-react'
import type { TFTAnalysisResponse, SlimMatchData, LobbyParticipant } from '@/lib/types'

export default function TFTCoachPage() {
  const [gameName, setGameName] = useState('')
  const [tagLine, setTagLine] = useState('KR1')
  const [analysisMode, setAnalysisMode] = useState<'single' | 'multi'>('single')
  const [isLoading, setIsLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TFTAnalysisResponse | null>(null)

  const handleAnalyze = async (overrideName?: string, overrideTag?: string, overrideMode?: 'single' | 'multi') => {
    const targetName = (overrideName || gameName).trim()
    const targetTag = (overrideTag || tagLine).trim()
    const targetMode = overrideMode || analysisMode

    if (!targetName) {
      setError('소환사 닉네임을 입력해주세요!')
      return
    }

    setError(null)
    setIsLoading(true)
    setResult(null)

    if (targetMode === 'single') {
      setLoadingStep('Riot API 로비 8명 전적 및 기물 데이터 수집 중...')
    } else {
      setLoadingStep('최근 5경기 전적 및 덱 다양성/유연성 패턴 분석 중...')
    }
    const stepTimer1 = setTimeout(() => setLoadingStep('로비 타 유저 대비 대깨 여부 및 메타 적합도 진단 중...'), 800)
    const stepTimer2 = setTimeout(() => setLoadingStep('AI 분석관이 실전 개선 리포트를 작성하는 중...'), 1600)

    try {
      const res = await fetch('/api/tft/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameName: targetName,
          tagLine: targetTag || 'KR1',
          mode: targetMode,
        }),
      })

      const data: TFTAnalysisResponse = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error || '분석 중 오류가 발생했습니다.')
      }

      setResult(data)
    } catch (err: any) {
      setError(err.message || '네트워크 오류가 발생했습니다.')
    } finally {
      clearTimeout(stepTimer1)
      clearTimeout(stepTimer2)
      setIsLoading(false)
      setLoadingStep('')
    }
  }

  const setSample = (name: string, tag: string, mode: 'single' | 'multi') => {
    setGameName(name)
    setTagLine(tag)
    setAnalysisMode(mode)
    handleAnalyze(name, tag, mode)
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
            TFT Live Match Analyst & AI Strategy Coach
          </div>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight text-white mb-3">
            TFT 실전 전적 검색 & <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400">AI 메타 코칭</span>
          </h1>
          <p className="text-slate-400 text-sm md:text-base max-w-2xl mx-auto leading-relaxed">
            롤체지지(LOLCHESS) 스타일의 실시간 전적 및 로비 8명 순위 조회와 함께, <strong>내 덱이 현재 메타와 얼마나 맞았는지, 대깨였는지 빈집이었는지</strong> 정밀 분석합니다.
          </p>
        </header>

        {/* Mode Selector Tabs */}
        <div className="flex justify-center mb-4">
          <div className="inline-flex p-1 rounded-xl bg-slate-900/90 border border-slate-800 backdrop-blur-md">
            <button
              type="button"
              onClick={() => {
                setAnalysisMode('single')
                if (result) handleAnalyze(gameName, tagLine, 'single')
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs md:text-sm font-bold transition-all cursor-pointer ${
                analysisMode === 'single'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Target className="w-4 h-4" />
              1경기 정밀 코칭 (로비 경합·대깨 진단)
            </button>
            <button
              type="button"
              onClick={() => {
                setAnalysisMode('multi')
                if (result) handleAnalyze(gameName, tagLine, 'multi')
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs md:text-sm font-bold transition-all cursor-pointer ${
                analysisMode === 'multi'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              5경기 종합 메타 분석 (플레이스타일·유연성)
            </button>
          </div>
        </div>

        {/* Search Input Box */}
        <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 md:p-6 shadow-2xl mb-8">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleAnalyze()
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
                  <span>분석 중...</span>
                </>
              ) : (
                <>
                  <Compass className="w-5 h-5 text-cyan-200" />
                  <span>전적 & 메타 코칭</span>
                </>
              )}
            </button>
          </form>

          {/* Quick Preset Samples */}
          <div className="mt-4 flex flex-wrap items-center gap-2 pt-3 border-t border-slate-800/80 text-xs text-slate-400">
            <span className="font-semibold text-slate-500">실시간 18시즌 라이브:</span>
            <button
              type="button"
              onClick={() => setSample('띵 땡', 'KR1', 'single')}
              className="px-2.5 py-1 rounded-lg bg-blue-950/80 hover:bg-blue-900 text-cyan-300 transition border border-blue-700/80 font-bold"
            >
              👑 [18시즌 한국 1위 챌린저] 띵 땡#KR1
            </button>
            <button
              type="button"
              onClick={() => setSample('대깨고집러', 'KR1', 'single')}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition border border-slate-700/50"
            >
              ⚠️ [18시즌 1판] 대깨 사출 판
            </button>
            <button
              type="button"
              onClick={() => setSample('빈집장인', 'KR1', 'multi')}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition border border-slate-700/50"
            >
              📊 [18시즌 5판] 종합 메타 분석
            </button>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-8 p-4 rounded-xl bg-red-950/60 border border-red-800/80 text-red-200 flex items-start gap-3 text-sm">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-red-300">소환사 분석 오류</p>
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
            <p className="text-xs text-slate-500">Riot 공식 서버 데이터와 메타 파워 커브를 실시간 대조하고 있습니다...</p>
          </div>
        )}

        {/* Analysis Result */}
        {result && !isLoading && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3 duration-500">
            {/* Demo Notice */}
            {result.isDemo && (
              <div className="px-4 py-2.5 rounded-xl bg-cyan-950/40 border border-cyan-800/50 text-cyan-300 text-xs flex items-center gap-2">
                <Info className="w-4 h-4 shrink-0" />
                <span>
                  <strong>체험 모드 가동:</strong> 시뮬레이션 매치 데이터를 기반으로 AI 분석관이 실시간 가동되었습니다. (실제 라이브 전적 검색을 누르시면 Riot API 실시간 전적이 로드됩니다)
                </span>
              </div>
            )}

            {/* 1. 소환사 프로필 요약 카드 (롤체지지 / OP.GG 시그니처 헤더) */}
            {result.summonerProfile && (
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <img
                      src={result.summonerProfile.profileIconUrl}
                      alt="Summoner Icon"
                      className="w-16 h-16 rounded-2xl border-2 border-cyan-500/50 shadow-lg object-cover bg-slate-950"
                      onError={(e) => {
                        ;(e.target as HTMLElement).style.display = 'none'
                      }}
                    />
                    <span className="absolute -bottom-2 -right-2 px-2 py-0.5 rounded-full bg-slate-950 border border-slate-700 text-[10px] font-mono font-bold text-slate-300">
                      Lv.{result.summonerProfile.summonerLevel}
                    </span>
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-white flex items-center gap-2">
                      <span>{result.summonerProfile.gameName}</span>
                      <span className="text-sm font-normal text-slate-400">#{result.summonerProfile.tagLine}</span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      최근 {result.summonerProfile.totalGames}경기 전적 통계 기준
                    </p>
                  </div>
                </div>

                {/* 프로필 통계 뱃지 (평균 등수, 순방률, 승률) */}
                <div className="flex items-center gap-6 bg-slate-950/80 border border-slate-800/80 rounded-xl px-6 py-3">
                  <div className="text-center">
                    <p className="text-[11px] font-bold text-slate-400">평균 등수</p>
                    <p className="text-xl md:text-2xl font-black text-amber-400 font-mono">
                      #{result.summonerProfile.avgPlacement}
                    </p>
                  </div>
                  <div className="w-[1px] h-8 bg-slate-800" />
                  <div className="text-center">
                    <p className="text-[11px] font-bold text-slate-400">순방률 (TOP 4)</p>
                    <p className="text-xl md:text-2xl font-black text-emerald-400 font-mono">
                      {result.summonerProfile.top4Rate}%
                    </p>
                  </div>
                  <div className="w-[1px] h-8 bg-slate-800" />
                  <div className="text-center">
                    <p className="text-[11px] font-bold text-slate-400">1등 승률</p>
                    <p className="text-xl md:text-2xl font-black text-cyan-400 font-mono">
                      {result.summonerProfile.winRate}%
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 2. Hero Score Card (메타 점수 + 유연성 성향) */}
            <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950/40 border border-slate-700/80 rounded-2xl p-6 md:p-8 shadow-2xl">
              <div className="absolute top-0 right-0 transform translate-x-10 -translate-y-10 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
              
              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                <div>
                  <div className="flex items-center gap-2 text-cyan-400 font-bold text-xs uppercase tracking-wider mb-2">
                    <Award className="w-4 h-4 text-cyan-400" />
                    <span>{result.mode === 'single' ? '단일 경기 정밀 코칭 총평' : `최근 ${result.matches.length}경기 종합 메타 총평`}</span>
                  </div>
                  <h2 className="text-xl md:text-2xl font-black text-white leading-snug">
                    AI 전략 코치 진단 리포트
                  </h2>
                  <p className="mt-2 text-slate-300 text-sm md:text-base leading-relaxed max-w-2xl">
                    {result.feedback.overview}
                  </p>
                </div>

                {/* Score & Playstyle Badges */}
                <div className="flex flex-wrap items-center gap-3 bg-slate-950/80 border border-slate-800 rounded-2xl p-4 shrink-0">
                  {/* 메타 점수 */}
                  <div className="text-center px-3">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">메타 점수</p>
                    <p className="text-2xl md:text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400 font-mono">
                      {result.feedback.metaScore}<span className="text-xs text-slate-500 font-normal">/100</span>
                    </p>
                    <span className="text-[11px] font-bold text-slate-400">등급: {result.feedback.metaTier}</span>
                  </div>

                  <div className="w-[1px] h-12 bg-slate-800 hidden sm:block" />

                  {/* 유연성 vs 대깨 성향 */}
                  <div className="text-center px-3">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">유연성 지수</p>
                    <p className={`text-2xl md:text-3xl font-black font-mono ${
                      result.feedback.flexibilityScore >= 65 ? 'text-emerald-400' :
                      result.feedback.flexibilityScore >= 45 ? 'text-amber-400' : 'text-rose-400'
                    }`}>
                      {result.feedback.flexibilityScore}%
                    </p>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                      result.feedback.flexibilityScore >= 65
                        ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-300'
                        : result.feedback.flexibilityScore >= 45
                        ? 'bg-amber-950/60 border-amber-800/80 text-amber-300'
                        : 'bg-rose-950/60 border-rose-800/80 text-rose-300'
                    }`}>
                      {result.feedback.playstyle}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. 로비 기물 경합 및 대깨/유연성 심층 진단 카드 */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
              <div className="flex items-center gap-2 text-cyan-300 font-extrabold text-sm uppercase tracking-wider mb-3">
                <Users className="w-5 h-5 text-cyan-400" />
                <span>로비 타 유저 기물 경합 & 대깨·유연성(피봇) 진단</span>
              </div>
              <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 text-sm md:text-base leading-relaxed text-slate-200">
                {result.feedback.contestAnalysis}
              </div>
            </div>

            {/* 4. 3대 핵심 영역 정밀 분석 */}
            <div>
              <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-cyan-400" />
                3대 핵심 세부 영역 평가
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
                  <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase mb-2">
                    <Swords className="w-4 h-4 text-amber-400" />
                    <span>아이템 최적화 (BIS)</span>
                  </div>
                  <p className="text-xs md:text-sm text-slate-300 leading-relaxed">
                    {result.feedback.itemAnalysis}
                  </p>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
                  <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase mb-2">
                    <Shield className="w-4 h-4 text-cyan-400" />
                    <span>앞/뒷라인 밸런스</span>
                  </div>
                  <p className="text-xs md:text-sm text-slate-300 leading-relaxed">
                    {result.feedback.synergyAnalysis}
                  </p>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
                  <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold uppercase mb-2">
                    <TrendingUp className="w-4 h-4 text-indigo-400" />
                    <span>레벨업 & 골드 운영</span>
                  </div>
                  <p className="text-xs md:text-sm text-slate-300 leading-relaxed">
                    {result.feedback.economyAnalysis}
                  </p>
                </div>
              </div>
            </div>

            {/* 5. 결정적 개선 포인트 3가지 */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center gap-2 text-amber-400 font-extrabold text-sm uppercase tracking-wider mb-4">
                <Lightbulb className="w-5 h-5 text-amber-400" />
                <span>결정적 개선 포인트 3가지 (Key Improvements)</span>
              </div>
              <div className="space-y-3">
                {result.feedback.improvements.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 text-sm leading-relaxed text-slate-200"
                  >
                    <span className="font-bold text-amber-300 bg-amber-950/70 border border-amber-800/60 rounded-md w-6 h-6 flex items-center justify-center shrink-0 text-xs mt-0.5">
                      {i + 1}
                    </span>
                    <span className="flex-1 whitespace-pre-line">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 6. 다음 경기 실전 가이드 */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center gap-2 text-emerald-400 font-extrabold text-sm uppercase tracking-wider mb-4">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span>다음 경기 즉시 적용 지침 (Practical Action Plan)</span>
              </div>
              <div className="space-y-3">
                {result.feedback.actionPlan.map((action, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-4 rounded-xl bg-emerald-950/20 border border-emerald-900/40 text-sm leading-relaxed text-emerald-100"
                  >
                    <Zap className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span className="flex-1 whitespace-pre-line">{action}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 7. 전적 검색 사이트 스타일 실전 경기 전적 리스트 (롤체지지/OP.GG) */}
            <div className="pt-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  <Layers className="w-5 h-5 text-cyan-400" />
                  <span>실전 매치 히스토리 ({result.matches.length}경기)</span>
                </h3>
                <span className="text-xs text-slate-400">
                  클릭하여 각 경기의 로비 8명 순위표를 펼쳐볼 수 있습니다.
                </span>
              </div>

              <div className="space-y-4">
                {result.matches.map((match, idx) => (
                  <MatchCard key={match.matchId || idx} match={match} index={idx} />
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

function MatchCard({ match, index }: { match: SlimMatchData; index: number }) {
  const [isOpenLobby, setIsOpenLobby] = useState(false)
  const isWin = match.placement === 1
  const isTop4 = match.placement <= 4 && !isWin

  // 롤체지지 / OP.GG 테마 색상 정의
  const containerTheme = isWin
    ? 'border-l-4 border-l-amber-400 bg-gradient-to-r from-amber-950/25 via-slate-900/95 to-slate-950 border-amber-500/30'
    : isTop4
    ? 'border-l-4 border-l-emerald-400 bg-gradient-to-r from-emerald-950/20 via-slate-900/95 to-slate-950 border-emerald-500/30'
    : 'border-l-4 border-l-slate-600 bg-gradient-to-r from-slate-950/80 via-slate-900/95 to-slate-950 border-slate-800'

  const placementBadgeTheme = isWin
    ? 'bg-amber-400 text-slate-950 font-black shadow-lg shadow-amber-500/30'
    : isTop4
    ? 'bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-500/20'
    : 'bg-slate-800 text-slate-400 font-semibold'

  const costBorder: Record<number, string> = {
    5: 'border-amber-400',
    4: 'border-purple-400',
    3: 'border-blue-400',
    2: 'border-emerald-500',
    1: 'border-slate-600',
  }

  const getTraitBadge = (tier: number) => {
    if (tier >= 3) return 'bg-amber-950/80 border-amber-400 text-amber-300 font-bold'
    if (tier === 2) return 'bg-slate-800/80 border-slate-300 text-slate-200 font-semibold'
    return 'bg-amber-950/40 border-amber-700/60 text-amber-400'
  }

  return (
    <div className={`border rounded-2xl overflow-hidden transition ${containerTheme}`}>
      <div className="p-4 md:p-5">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5">
          
          {/* 1. 좌측: 등수 및 경기 메타데이터 */}
          <div className="flex items-center gap-4 min-w-[200px] shrink-0">
            <div className="text-center">
              <div className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center ${placementBadgeTheme}`}>
                <span className="text-xl leading-none font-black font-mono">#{match.placement}</span>
                <span className="text-[10px] leading-tight mt-0.5">
                  {isWin ? '1등 승리' : isTop4 ? '순방' : '탈락'}
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white">{match.queueType || '랭크 게임'}</span>
                <span className="text-[11px] text-slate-400">{match.timeAgo || '최근'}</span>
              </div>
              <div className="text-xs text-slate-400 flex items-center gap-2">
                <span>{match.lastRound} 라운드</span>
                <span>•</span>
                <span>{match.gameLengthStr || '31분 20초'}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
                <span className="text-cyan-400 font-bold">Lv.{match.level}</span>
                <span>|</span>
                <span>잔여 {match.goldLeft}G</span>
              </div>
            </div>
          </div>

          {/* 2. 중앙: 활성 시너지 & 증강체 & 로비 기물 경합 뱃지 */}
          <div className="flex-1 space-y-2.5 w-full">
            {/* 시너지 뱃지 모음 (아이콘 + 한글명 + 개수) */}
            <div className="flex flex-wrap items-center gap-1.5">
              {match.traits.map((t, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] ${getTraitBadge(
                    t.tier
                  )}`}
                >
                  {t.iconUrl ? (
                    <img
                      src={t.iconUrl}
                      alt={t.name}
                      className="w-3.5 h-3.5 object-contain"
                      onError={(e) => {
                        ;(e.target as HTMLElement).style.display = 'none'
                      }}
                    />
                  ) : null}
                  <span className="font-bold">{t.count}</span>
                  <span>{t.name}</span>
                </span>
              ))}
            </div>

            {/* 증강체 & 경합 상태 */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {match.augments.length > 0 && (
                <div className="flex items-center gap-1">
                  {match.augments.map((aug, i) => (
                    <span
                      key={i}
                      title={aug}
                      className="px-2 py-0.5 rounded bg-slate-800/90 border border-slate-700 text-slate-300 text-[11px] truncate max-w-[120px]"
                    >
                      {aug}
                    </span>
                  ))}
                </div>
              )}

              {match.contestedInfo && (
                <div>
                  {match.contestedInfo.isContested ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-950/80 border border-rose-800/80 text-rose-300 text-[11px] font-semibold">
                      <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                      <span>로비 {match.contestedInfo.opponentCount}명 경합 ({match.contestedInfo.contestedTraits[0] || '기물'})</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-800/80 text-emerald-300 text-[11px] font-semibold">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span>빈집 선점</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 3. 우측: 챔피언 아바타 이미지 + 3성 골드 별 + 아이템 아이콘 */}
          <div className="flex flex-wrap items-end gap-2.5 w-full lg:w-auto shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-800">
            {match.units.map((unit, i) => {
              const cost = unit.rarity || 3
              const borderClass = costBorder[cost] || costBorder[3]

              return (
                <div key={i} className="flex flex-col items-center group relative">
                  {/* 성급 별 표시 */}
                  <div className="h-4 flex items-center justify-center">
                    {unit.tier === 3 ? (
                      <span className="text-amber-400 font-black text-xs drop-shadow-[0_0_4px_rgba(245,158,11,0.9)] tracking-tight">
                        ★★★
                      </span>
                    ) : unit.tier === 2 ? (
                      <span className="text-slate-300 font-bold text-[11px] tracking-tight">
                        ★★
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[10px]">★</span>
                    )}
                  </div>

                  {/* 챔피언 아바타 박스 (이미지 + 텍스트 백업) */}
                  <div
                    className={`w-12 h-12 rounded-xl border-2 overflow-hidden relative shadow-md bg-slate-900 transition-transform group-hover:scale-105 flex items-center justify-center ${borderClass}`}
                  >
                    {unit.imgUrl ? (
                      <img
                        src={unit.imgUrl}
                        alt={unit.name}
                        className="w-full h-full object-cover z-10"
                        onError={(e) => {
                          ;(e.target as HTMLElement).style.display = 'none'
                        }}
                      />
                    ) : null}
                    {/* 이미지 로딩 실패 시 백업 글자 */}
                    <span className="text-[11px] font-black text-slate-300 pointer-events-none absolute text-center px-0.5 truncate max-w-[44px]">
                      {unit.name.slice(0, 2)}
                    </span>
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent flex items-end justify-center pb-0.5 pointer-events-none z-20">
                      <span className="text-[9px] font-mono text-slate-300 font-bold">
                        {cost}G
                      </span>
                    </div>
                  </div>

                  {/* 기물 이름 */}
                  <span className="text-[10px] text-slate-300 truncate max-w-[48px] text-center mt-1 font-medium">
                    {unit.name}
                  </span>

                  {/* 장착 아이템 3슬롯 실제 아이콘 */}
                  <div className="flex items-center gap-0.5 mt-0.5 h-4">
                    {unit.items.slice(0, 3).map((item, itemIdx) => {
                      const iconUrl = unit.itemIcons?.[itemIdx]
                      return (
                        <div
                          key={itemIdx}
                          title={item}
                          className="w-4 h-4 rounded bg-slate-950 border border-amber-500/70 overflow-hidden shadow shrink-0 flex items-center justify-center"
                        >
                          {iconUrl ? (
                            <img
                              src={iconUrl}
                              alt={item}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                ;(e.target as HTMLElement).style.display = 'none'
                              }}
                            />
                          ) : (
                            <span className="text-[8px] text-amber-300 font-black">
                              {item.charAt(0)}
                            </span>
                          )}
                        </div>
                      )
                    })}
                    {unit.items.length === 0 && <span className="w-4 h-4" />}
                  </div>
                </div>
              )
            })}
          </div>

        </div>

        {/* 4. 하단: 로비 8명 전체 순위 펼쳐보기 토글 바 (롤체지지/OP.GG 시그니처) */}
        {match.lobbyParticipants && match.lobbyParticipants.length > 0 && (
          <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              로비 8인 경기 결과 기록
            </span>
            <button
              type="button"
              onClick={() => setIsOpenLobby(!isOpenLobby)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-cyan-300 text-xs font-semibold transition cursor-pointer border border-slate-700/60"
            >
              <span>{isOpenLobby ? '로비 순위 접기' : '로비 8명 전체 순위 보기'}</span>
              {isOpenLobby ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </div>

      {/* 펼쳐진 로비 8인 순위 테이블 (LOLCHESS 스타일) */}
      {isOpenLobby && match.lobbyParticipants && (
        <div className="bg-slate-950/90 border-t border-slate-800 p-4 animate-in fade-in duration-200">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                  <th className="pb-2 pl-2 w-12">등수</th>
                  <th className="pb-2 w-32">소환사</th>
                  <th className="pb-2 w-16">레벨</th>
                  <th className="pb-2">최종 덱 및 핵심 기물</th>
                  <th className="pb-2 w-28">활성 시너지</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {match.lobbyParticipants.map((p, idx) => (
                  <tr
                    key={idx}
                    className={`hover:bg-slate-900/50 transition ${
                      p.isUser ? 'bg-blue-950/30 font-semibold' : ''
                    }`}
                  >
                    {/* 등수 */}
                    <td className="py-2.5 pl-2 font-mono">
                      <span
                        className={`inline-block w-6 h-6 rounded-md text-center leading-6 font-bold text-xs ${
                          p.placement === 1
                            ? 'bg-amber-400 text-slate-950'
                            : p.placement <= 4
                            ? 'bg-emerald-500/80 text-white'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {p.placement}
                      </span>
                    </td>

                    {/* 소환사명 */}
                    <td className="py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`truncate max-w-[120px] ${p.isUser ? 'text-cyan-300 font-bold' : 'text-slate-200'}`}>
                          {p.gameName}
                        </span>
                        {p.isUser && (
                          <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-cyan-400 text-[10px] font-bold">
                            ME
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 레벨 */}
                    <td className="py-2.5 text-slate-400 font-mono">
                      Lv.{p.level}
                    </td>

                    {/* 기물들 */}
                    <td className="py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {p.units.slice(0, 6).map((u, uIdx) => (
                          <div
                            key={uIdx}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px]"
                          >
                            <span className="text-amber-400 text-[10px]">
                              {'★'.repeat(Math.min(u.tier, 3))}
                            </span>
                            <span className="text-slate-300">{u.name}</span>
                            {u.items.length > 0 && (
                              <span className="text-slate-500 text-[9px]">
                                ({u.items.length})
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>

                    {/* 시너지 */}
                    <td className="py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {p.traits.slice(0, 2).map((t, tIdx) => (
                          <span
                            key={tIdx}
                            className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 text-[10px]"
                          >
                            {t.name} {t.count}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

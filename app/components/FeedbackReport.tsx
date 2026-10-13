'use client'

import {
  Award, Users, Swords, Shield, TrendingUp, Lightbulb, CheckCircle2, Zap, Sparkles,
} from 'lucide-react'
import type { MetaCoachFeedback } from '@/lib/types'

interface FeedbackReportProps {
  feedback: MetaCoachFeedback
  /** 리포트 상단 라벨 (예: "단일 경기 정밀 코칭 총평") */
  title?: string
  /** 함께 표기할 경기 수 (예: 5) */
  matchCount?: number
  /** 인라인(경기 카드 내부) 렌더링 시 여백 축소 */
  compact?: boolean
}

/**
 * AI 코칭 리포트 렌더러 (경기별/종합 공용).
 * 기존 app/page.tsx 의 리포트 마크업을 재사용 가능하도록 분리.
 */
export function FeedbackReport({ feedback, title, matchCount, compact = false }: FeedbackReportProps) {
  const flexScore = feedback.flexibilityScore
  const flexColor =
    flexScore >= 65 ? 'text-emerald-400' : flexScore >= 45 ? 'text-amber-400' : 'text-rose-400'
  const flexBadge =
    flexScore >= 65
      ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-300'
      : flexScore >= 45
      ? 'bg-amber-950/60 border-amber-800/80 text-amber-300'
      : 'bg-rose-950/60 border-rose-800/80 text-rose-300'

  const pad = compact ? 'p-5 md:p-6' : 'p-6 md:p-8'

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      {/* Hero Score Card (메타 점수 + 유연성 성향) */}
      <div className={`relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950/40 border border-slate-700/80 rounded-2xl ${pad} shadow-2xl`}>
        <div className="absolute top-0 right-0 transform translate-x-10 -translate-y-10 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 font-bold text-xs uppercase tracking-wider mb-2">
              <Award className="w-4 h-4 text-cyan-400" />
              <span>{title || (feedback.mode === 'single' ? '단일 경기 정밀 코칭 총평' : `최근 ${matchCount ?? ''}경기 종합 메타 총평`)}</span>
            </div>
            <h2 className="text-xl md:text-2xl font-black text-white leading-snug flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-cyan-300" />
              AI 전략 코치 진단 리포트
            </h2>
            <p className="mt-2 text-slate-300 text-sm md:text-base leading-relaxed max-w-2xl">
              {feedback.overview}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 bg-slate-950/80 border border-slate-800 rounded-2xl p-4 shrink-0">
            <div className="text-center px-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">메타 점수</p>
              <p className="text-2xl md:text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400 font-mono">
                {feedback.metaScore}
                <span className="text-xs text-slate-500 font-normal">/100</span>
              </p>
              <span className="text-[11px] font-bold text-slate-400">등급: {feedback.metaTier}</span>
            </div>

            <div className="w-[1px] h-12 bg-slate-800 hidden sm:block" />

            <div className="text-center px-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">유연성 지수</p>
              <p className={`text-2xl md:text-3xl font-black font-mono ${flexColor}`}>{flexScore}%</p>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${flexBadge}`}>
                {feedback.playstyle}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 로비 기물 경합 & 대깨/유연성 진단 */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex items-center gap-2 text-cyan-300 font-extrabold text-sm uppercase tracking-wider mb-3">
          <Users className="w-5 h-5 text-cyan-400" />
          <span>로비 타 유저 기물 경합 & 대깨·유연성(피봇) 진단</span>
        </div>
        <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 text-sm md:text-base leading-relaxed text-slate-200">
          {feedback.contestAnalysis}
        </div>
      </div>

      {/* 3대 핵심 영역 */}
      <div>
        <h3 className="text-sm font-bold text-slate-300 mb-3">3대 핵심 세부 영역 평가</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase mb-2">
              <Swords className="w-4 h-4 text-amber-400" />
              <span>아이템 최적화 (BIS)</span>
            </div>
            <p className="text-xs md:text-sm text-slate-300 leading-relaxed">{feedback.itemAnalysis}</p>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase mb-2">
              <Shield className="w-4 h-4 text-cyan-400" />
              <span>앞/뒷라인 밸런스</span>
            </div>
            <p className="text-xs md:text-sm text-slate-300 leading-relaxed">{feedback.synergyAnalysis}</p>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold uppercase mb-2">
              <TrendingUp className="w-4 h-4 text-indigo-400" />
              <span>레벨업 & 골드 운영</span>
            </div>
            <p className="text-xs md:text-sm text-slate-300 leading-relaxed">{feedback.economyAnalysis}</p>
          </div>
        </div>
      </div>

      {/* 개선 포인트 */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-2 text-amber-400 font-extrabold text-sm uppercase tracking-wider mb-4">
          <Lightbulb className="w-5 h-5 text-amber-400" />
          <span>결정적 개선 포인트 (Key Improvements)</span>
        </div>
        <div className="space-y-3">
          {feedback.improvements.map((item, i) => (
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

      {/* 액션 플랜 */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-2 text-emerald-400 font-extrabold text-sm uppercase tracking-wider mb-4">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          <span>다음 경기 즉시 적용 지침 (Practical Action Plan)</span>
        </div>
        <div className="space-y-3">
          {feedback.actionPlan.map((action, i) => (
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
    </div>
  )
}

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
      <div className={`relative overflow-hidden bg-gradient-to-br from-panel via-panel to-blue-500/10 border border-line/15 rounded-2xl ${pad} shadow-2xl`}>
        <div className="absolute top-0 right-0 transform translate-x-10 -translate-y-10 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 font-bold text-xs uppercase tracking-wider mb-2">
              <Award className="w-4 h-4 text-cyan-400" />
              <span>{title || (feedback.mode === 'single' ? '단일 경기 정밀 코칭 총평' : `최근 ${matchCount ?? ''}경기 종합 메타 총평`)}</span>
            </div>
            <h2 className="text-xl md:text-2xl font-black text-ink leading-snug flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-cyan-300" />
              AI 전략 코치 진단 리포트
            </h2>
            <p className="mt-2 text-muted text-[15px] md:text-lg leading-relaxed max-w-2xl">
              {feedback.overview}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 bg-sunken/70 border border-line/10 rounded-2xl p-4 shrink-0">
            <div className="text-center px-3">
              <p className="text-[11px] font-bold text-muted uppercase tracking-wider">메타 점수</p>
              <p className="text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400 font-mono">
                {feedback.metaScore}
                <span className="text-xs text-muted font-normal">/100</span>
              </p>
              <span className="text-[12px] font-bold text-muted">등급: {feedback.metaTier}</span>
              <span className="block text-[11px] text-muted">코드 산출</span>
            </div>

            <div className="w-[1px] h-12 bg-slate-800 hidden sm:block" />

            <div className="text-center px-3">
              <p className="text-[11px] font-bold text-muted uppercase tracking-wider">유연성 지수</p>
              <p className={`text-3xl md:text-4xl font-black font-mono ${flexColor}`}>{flexScore}%</p>
              <span className={`text-[12px] font-bold px-2 py-0.5 rounded-full border ${flexBadge}`}>
                {feedback.playstyle}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 리포트 신뢰도/근거 검증 (코드 산출) */}
      {(feedback.grounding || feedback.provenance || feedback.isFallback) && (
        <div className="rounded-xl border border-line/10 bg-sunken/70 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            {feedback.grounding ? (
              <span
                className={`rounded-full border px-2 py-0.5 font-bold ${
                  feedback.grounding.score >= 85
                    ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300'
                    : feedback.grounding.score >= 65
                    ? 'border-amber-700/60 bg-amber-950/40 text-amber-300'
                    : 'border-rose-700/60 bg-rose-950/40 text-rose-300'
                }`}
              >
                근거 검증 {feedback.grounding.supported}/{feedback.grounding.total} ·{' '}
                {feedback.grounding.score}%
              </span>
            ) : null}
            {feedback.isFallback && (
              <span className="rounded-full border border-line/15 bg-slate-800/60 px-2 py-0.5 font-bold text-muted">
                규칙 기반 분석 (AI 미사용)
              </span>
            )}
            {feedback.provenance?.patch && (
              <span className="rounded-full border border-line/10 bg-panel/90 px-2 py-0.5 font-mono text-muted">
                패치 {feedback.provenance.patch}
              </span>
            )}
            {feedback.provenance?.source && (
              <span className="rounded-full border border-line/10 bg-panel/90 px-2 py-0.5 text-muted">
                {feedback.provenance.source === 'riot-ladder' ? '래더 실측' : feedback.provenance.source}
              </span>
            )}
            {feedback.provenance?.generatedAt && (
              <span className="text-muted">수집 {feedback.provenance.generatedAt.slice(0, 10)}</span>
            )}
          </div>
          {feedback.grounding && feedback.grounding.unsupported.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[12px] text-muted hover:text-ink-soft">
                근거 미확인 수치 {feedback.grounding.unsupported.length}개 보기
              </summary>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                {feedback.grounding.unsupported.join(', ')}
              </p>
            </details>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-subtle">
            ※ 리포트의 수치가 프롬프트에 제공된 실측 데이터에 존재하는지 코드가 대조합니다. 낮을수록
            창작(환각) 가능성이 큽니다.
          </p>
        </div>
      )}

      {/* 점수 산출 근거 (코드 계산) */}
      {feedback.scoreBreakdown && (
        <div className="rounded-xl border border-line/10 bg-sunken/70 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] font-bold text-muted">점수 산출 근거 (코드 계산)</p>
            <span className="font-mono text-[11px] text-muted">
              {feedback.scoreBreakdown.matches}경기 평균 · {feedback.scoreBreakdown.version}
            </span>
          </div>
          <div className="mt-2.5 space-y-2">
            {feedback.scoreBreakdown.components.map((c) => (
              <div key={c.key} className="flex items-center gap-2">
                <span className="w-[74px] shrink-0 text-[12px] text-muted">{c.label}</span>
                <span className="w-8 shrink-0 text-right font-mono text-[11px] text-muted">
                  {Math.round(c.weight * 100)}%
                </span>
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-elev/5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-400"
                    style={{ width: `${c.score}%` }}
                  />
                </div>
                <span className="w-7 shrink-0 text-right font-mono text-[12px] text-ink-soft">
                  {c.score}
                </span>
                <span className="hidden w-14 shrink-0 text-right font-mono text-[11px] text-muted sm:block">
                  +{c.contribution}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1 border-t border-line/10/60 pt-2">
            <span className="text-[11px] text-muted">
              {feedback.scoreBreakdown.components.map((c) => c.detail).join(' · ')}
            </span>
            <span className="font-mono text-[12px] font-black text-cyan-300">
              {feedback.scoreBreakdown.total}점 · {feedback.scoreBreakdown.tier}
            </span>
          </div>
        </div>
      )}

      {/* 로비 기물 경합 & 대깨/유연성 진단 */}
      <div className="bg-panel/90 border border-line/10 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex items-center gap-2 text-cyan-300 font-extrabold text-[15px] uppercase tracking-wider mb-3">
          <Users className="w-5 h-5 text-cyan-400" />
          <span>로비 타 유저 기물 경합 & 대깨·유연성(피봇) 진단</span>
        </div>
        <div className="p-4 rounded-xl bg-sunken/70 border border-line/10 text-[15px] md:text-lg leading-relaxed text-ink-soft">
          {feedback.contestAnalysis}
        </div>
      </div>

      {/* 3대 핵심 영역 */}
      <div>
        <h3 className="text-[15px] font-bold text-muted mb-3">3대 핵심 세부 영역 평가</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-panel/90 border border-line/10 rounded-xl p-5">
            <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase mb-2">
              <Swords className="w-4 h-4 text-amber-400" />
              <span>아이템 최적화 (BIS)</span>
            </div>
            <p className="text-[14px] md:text-[15px] text-muted leading-relaxed">{feedback.itemAnalysis}</p>
          </div>

          <div className="bg-panel/90 border border-line/10 rounded-xl p-5">
            <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase mb-2">
              <Shield className="w-4 h-4 text-cyan-400" />
              <span>앞/뒷라인 밸런스</span>
            </div>
            <p className="text-[14px] md:text-[15px] text-muted leading-relaxed">{feedback.synergyAnalysis}</p>
          </div>

          <div className="bg-panel/90 border border-line/10 rounded-xl p-5">
            <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold uppercase mb-2">
              <TrendingUp className="w-4 h-4 text-indigo-400" />
              <span>레벨업 & 골드 운영</span>
            </div>
            <p className="text-[14px] md:text-[15px] text-muted leading-relaxed">{feedback.economyAnalysis}</p>
          </div>
        </div>
      </div>

      {/* 개선 포인트 */}
      <div className="bg-panel/90 border border-line/10 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-2 text-amber-400 font-extrabold text-[15px] uppercase tracking-wider mb-4">
          <Lightbulb className="w-5 h-5 text-amber-400" />
          <span>결정적 개선 포인트 (Key Improvements)</span>
        </div>
        <div className="space-y-3">
          {feedback.improvements.map((item, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-4 rounded-xl bg-sunken/70 border border-line/10/80 text-[15px] leading-relaxed text-ink-soft"
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
      <div className="bg-panel/90 border border-line/10 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-2 text-emerald-400 font-extrabold text-[15px] uppercase tracking-wider mb-4">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          <span>다음 경기 즉시 적용 지침 (Practical Action Plan)</span>
        </div>
        <div className="space-y-3">
          {feedback.actionPlan.map((action, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-4 rounded-xl bg-emerald-950/20 border border-emerald-900/40 text-[15px] leading-relaxed text-emerald-100"
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

'use client'

import {
  Award, Users, Swords, Shield, TrendingUp, Lightbulb, CheckCircle2, Zap, Sparkles,
  GraduationCap, BookOpen, Target, ClipboardCheck, ArrowRight, Gauge,
} from 'lucide-react'
import type { CoachingAxis, MetaCoachFeedback } from '@/lib/types'
import { CoachMemo } from './LabUI'

interface FeedbackReportProps {
  feedback: MetaCoachFeedback
  /** 리포트 상단 라벨 (예: "단일 경기 정밀 코칭 총평") */
  title?: string
  /** 함께 표기할 경기 수 (예: 5) */
  matchCount?: number
  /** 인라인(경기 카드 내부) 렌더링 시 여백 축소 */
  compact?: boolean
}

/** 6축 진단 프로 게이머 HUD 바 */
function AxisRow({ axis, isFocus }: { axis: CoachingAxis; isFocus: boolean }) {
  return (
    <div
      className={`relative overflow-hidden rounded-card border p-3 transition-all ${
        isFocus
          ? 'border-accent bg-accent-bg'
          : 'border-line bg-sunken hover:border-line'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate text-xs font-black text-ink">{axis.label}</span>
          {isFocus ? (
            <span className="shrink-0 rounded-chip border border-accent bg-panel px-1.5 py-0.2 text-xs font-black text-accent animate-pulse">
              🎯 핵심 교정
            </span>
          ) : null}
        </div>
        <div className="flex items-baseline gap-0.5 shrink-0">
          <span className="font-mono text-base font-black text-ink">{axis.score}</span>
          <span className="text-xs text-muted">/100</span>
        </div>
      </div>

      {/* 스탯 프로그레스 게이지 */}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500"
          style={{ width: `${Math.max(axis.score, 4)}%` }}
        />
      </div>

      <p className="mt-2 text-xs font-semibold leading-relaxed text-ink-soft">
        {axis.verdict || axis.lesson}
      </p>
      <p className="mt-0.5 text-xs text-muted font-mono">{axis.detail}</p>
    </div>
  )
}

/** 강의형 코칭 블록 (개념 → 근거 → 대안 → 연습) */
function LectureBlock({ feedback }: { feedback: MetaCoachFeedback }) {
  const lec = feedback.lecture
  const plan = feedback.plan
  if (!lec) return null

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-card border border-line bg-panel p-5 shadow-card md:p-6">
        <div className="relative flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-accent">
          <GraduationCap className="h-4 w-4" />
          <span>오늘의 강의</span>
          {plan ? (
            <span className="rounded-chip border border-accent/30 bg-accent-bg px-2 py-0.5 text-xs tracking-normal">
              {plan.focusLabel}
            </span>
          ) : null}
        </div>
        <h3 className="relative mt-2 text-lg font-black leading-snug text-ink md:text-xl">
          {lec.topic}
        </h3>

        <div className="relative mt-4 space-y-3">
          <div className="rounded-card border border-line bg-sunken p-3.5">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-accent">
              <BookOpen className="h-3.5 w-3.5" /> 개념 · 원리
            </p>
            <p className="text-[14px] leading-relaxed text-ink-soft">{lec.concept}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{lec.why}</p>
          </div>

          <div className="rounded-card border border-line bg-sunken p-3.5">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-accent">
              <Gauge className="h-3.5 w-3.5" /> 이 데이터에서의 근거
            </p>
            <p className="text-[14px] leading-relaxed text-ink-soft">{lec.evidence}</p>
          </div>

          <div className="rounded-card border border-accent/25 bg-accent-bg p-3.5">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-accent">
              <ArrowRight className="h-3.5 w-3.5" /> 그 순간의 더 나은 선택
            </p>
            <p className="text-[14px] leading-relaxed text-ink-soft">{lec.alternative}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-card border border-accent/25 bg-accent-bg p-4">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-accent">
            <Target className="h-3.5 w-3.5" /> 다음 3판 연습 과제
          </p>
          <p className="mt-1.5 text-[14px] leading-relaxed text-ink">{lec.drill}</p>
        </div>

        <div className="rounded-card border border-line bg-panel p-4">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
            <ClipboardCheck className="h-3.5 w-3.5" /> 실전 체크리스트
          </p>
          <ul className="mt-2 space-y-1.5">
            {lec.checklist.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-soft">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {plan ? (
        <div className="rounded-card border border-line bg-panel p-4">
          <p className="mb-2 flex items-center gap-1.5 text-[13px] font-black text-ink">
            <Gauge className="h-4 w-4 text-accent" /> 6축 진단 (코드 산출)
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {plan.axes.map((a) => (
              <AxisRow key={a.key} axis={a} isFocus={a.key === plan.focus} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * AI 코칭 리포트 렌더러 (경기별/종합 공용).
 * 기존 app/page.tsx 의 리포트 마크업을 재사용 가능하도록 분리.
 */
export function FeedbackReport({ feedback, title, matchCount, compact = false }: FeedbackReportProps) {
  const flexScore = feedback.flexibilityScore
  const flexBadge =
    flexScore >= 65
      ? 'bg-good/10 border-good/80 text-good'
      : flexScore >= 45
      ? 'bg-gold/10 border-gold/80 text-gold'
      : 'bg-bad/10 border-bad/80 text-bad'

  const pad = compact ? 'p-5 md:p-6' : 'p-6 md:p-8'

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      {/* Hero Score Card (메타 점수 + 유연성 성향 - Tactical HUD Style) */}
      <div className={`relative overflow-hidden bg-panel border border-line rounded-card ${pad} shadow-card`}>
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="flex-1">
            {/* LAB 리포트 헤더: 장식 대신 메타 정보로 정체성을 낸다 */}
            <p className="mb-2 flex flex-wrap items-center gap-x-2 text-xs font-semibold tracking-wide text-subtle">
              <span className="text-accent">REPORT</span>
              <span aria-hidden="true">·</span>
              <span>{feedback.mode === 'single' ? '단일 경기' : `${matchCount ?? ''}경기 종합`}</span>
              {feedback.provenance?.patch ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>패치 {feedback.provenance.patch}</span>
                </>
              ) : null}
            </p>
            <div className="flex items-center gap-2 text-accent font-bold text-xs uppercase tracking-wider mb-2">
              <Award className="w-4 h-4 text-accent" />
              <span>{title || (feedback.mode === 'single' ? '단일 경기 정밀 코칭 총평' : `최근 ${matchCount ?? ''}경기 종합 메타 총평`)}</span>
            </div>
            <h2 className="text-xl md:text-2xl font-black text-ink leading-snug flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-accent" />
              <span>AI 전략 코치 종합 진단</span>
            </h2>
            <div className="mt-3 max-w-2xl">
              <CoachMemo>{feedback.overview}</CoachMemo>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 bg-sunken border border-line rounded-card p-4 shrink-0 shadow-card">
            {/* 메타 스코어 다이얼 */}
            <div className="text-center px-4 py-1">
              <p className="text-xs font-bold text-muted uppercase tracking-widest">전술 점수</p>
              <div className="my-1">
                <span className="text-3xl md:text-4xl font-black font-mono text-ink">
                  {feedback.metaScore}
                </span>
                <span className="text-xs text-muted font-mono ml-1 font-semibold">/100</span>
              </div>
              <div className="inline-flex items-center gap-1 rounded-chip border border-accent/30 bg-accent-bg px-2 py-0.5 text-xs font-black text-accent">
                <span>등급: {feedback.metaTier}</span>
              </div>
            </div>

            <div className="w-[1px] h-14 bg-line hidden sm:block" />

            {/* 유연성 지수 */}
            <div className="text-center px-4 py-1">
              <p className="text-xs font-bold text-muted uppercase tracking-widest">유연성 지수</p>
              <div className="my-1">
                <span className={`text-3xl md:text-4xl font-black font-mono text-ink`}>
                  {flexScore}%
                </span>
              </div>
              <span className={`text-xs font-black px-2 py-0.5 rounded-chip border ${flexBadge}`}>
                {feedback.playstyle}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 리포트 신뢰도/근거 검증 (코드 산출) */}
      {(feedback.grounding || feedback.provenance || feedback.isFallback) && (
        <div className="rounded-card border border-line bg-sunken px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            {feedback.grounding ? (
              <span
                className={`rounded-chip border px-2 py-0.5 font-bold ${
                  feedback.grounding.score >= 85
                    ? 'border-good/60 bg-good/10 text-good'
                    : feedback.grounding.score >= 65
                    ? 'border-gold/60 bg-gold/10 text-gold'
                    : 'border-bad/60 bg-bad/10 text-bad'
                }`}
              >
                근거 검증 {feedback.grounding.supported}/{feedback.grounding.total} ·{' '}
                {feedback.grounding.score}%
              </span>
            ) : null}
            {feedback.isFallback && (
              <span className="rounded-chip border border-line bg-sunken px-2 py-0.5 font-bold text-muted">
                규칙 기반 분석 (AI 미사용)
              </span>
            )}
            {feedback.provenance?.patch && (
              <span className="rounded-chip border border-line bg-panel px-2 py-0.5 font-mono text-muted">
                패치 {feedback.provenance.patch}
              </span>
            )}
            {feedback.provenance?.source && (
              <span className="rounded-chip border border-line bg-panel px-2 py-0.5 text-muted">
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
          <p className="mt-2 text-xs leading-relaxed text-subtle">
            ※ 리포트의 수치가 프롬프트에 제공된 실측 데이터에 존재하는지 코드가 대조합니다. 낮을수록
            창작(환각) 가능성이 큽니다.
          </p>
        </div>
      )}

      {/* 점수 산출 근거 (코드 계산) */}
      {feedback.scoreBreakdown && (
        <div className="rounded-card border border-line bg-sunken px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] font-bold text-muted">점수 산출 근거 (코드 계산)</p>
            <span className="font-mono text-xs text-muted">
              {feedback.scoreBreakdown.matches}경기 평균 · {feedback.scoreBreakdown.version}
            </span>
          </div>
          <div className="mt-2.5 space-y-2">
            {feedback.scoreBreakdown.components.map((c) => (
              <div key={c.key} className="flex items-center gap-2">
                <span className="w-[74px] shrink-0 text-[12px] text-muted">{c.label}</span>
                <span className="w-8 shrink-0 text-right font-mono text-xs text-muted">
                  {Math.round(c.weight * 100)}%
                </span>
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${c.score}%` }}
                  />
                </div>
                <span className="w-7 shrink-0 text-right font-mono text-[12px] text-ink-soft">
                  {c.score}
                </span>
                <span className="hidden w-14 shrink-0 text-right font-mono text-xs text-muted sm:block">
                  +{c.contribution}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1 border-t border-line pt-2">
            <span className="text-xs text-muted">
              {feedback.scoreBreakdown.components.map((c) => c.detail).join(' · ')}
            </span>
            <span className="font-mono text-[12px] font-black text-accent">
              {feedback.scoreBreakdown.total}점 · {feedback.scoreBreakdown.tier}
            </span>
          </div>
        </div>
      )}

      {/* 강의형 코칭 (개념 → 근거 → 대안 → 연습) */}
      <LectureBlock feedback={feedback} />

      {/* 로비 수렴도 (6축 중 1개 — 보조 지표) */}
      <div className="rounded-card border border-line bg-panel p-5 shadow-card md:p-6">
        <div className="mb-3 flex items-center gap-2 text-[14px] font-extrabold uppercase tracking-wider text-accent">
          <Users className="h-4 w-4 text-accent" />
          <span>로비 수렴도 (보조 지표)</span>
        </div>
        <div className="rounded-card border border-line bg-sunken p-4 text-[14px] leading-relaxed text-ink-soft md:text-[15px]">
          {feedback.contestAnalysis}
        </div>
      </div>

      {/* 3대 핵심 영역 */}
      <div>
        <h3 className="text-[15px] font-bold text-muted mb-3">3대 핵심 세부 영역 평가</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-panel border border-line rounded-card p-5">
            <div className="flex items-center gap-2 text-accent text-xs font-bold uppercase mb-2">
              <Swords className="w-4 h-4 text-accent" />
              <span>아이템 최적화 (BIS)</span>
            </div>
            <p className="text-[14px] md:text-[15px] text-muted leading-relaxed">{feedback.itemAnalysis}</p>
          </div>

          <div className="bg-panel border border-line rounded-card p-5">
            <div className="flex items-center gap-2 text-accent text-xs font-bold uppercase mb-2">
              <Shield className="w-4 h-4 text-accent" />
              <span>앞/뒷라인 밸런스</span>
            </div>
            <p className="text-[14px] md:text-[15px] text-muted leading-relaxed">{feedback.synergyAnalysis}</p>
          </div>

          <div className="bg-panel border border-line rounded-card p-5">
            <div className="flex items-center gap-2 text-accent text-xs font-bold uppercase mb-2">
              <TrendingUp className="w-4 h-4 text-accent" />
              <span>레벨업 & 골드 운영</span>
            </div>
            <p className="text-[14px] md:text-[15px] text-muted leading-relaxed">{feedback.economyAnalysis}</p>
          </div>
        </div>
      </div>

      {/* 개선 포인트 */}
      <div className="bg-panel border border-line rounded-card p-6 shadow-card">
        <div className="flex items-center gap-2 text-accent font-extrabold text-[15px] uppercase tracking-wider mb-4">
          <Lightbulb className="w-5 h-5 text-accent" />
          <span>결정적 개선 포인트 (Key Improvements)</span>
        </div>
        <div className="space-y-3">
          {feedback.improvements.map((item, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-4 rounded-card bg-sunken border border-line text-[15px] leading-relaxed text-ink-soft"
            >
              <span className="font-bold text-accent bg-accent-bg border border-accent/60 rounded-chip w-6 h-6 flex items-center justify-center shrink-0 text-xs mt-0.5">
                {i + 1}
              </span>
              <span className="flex-1 whitespace-pre-line">{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 액션 플랜 */}
      <div className="bg-panel border border-line rounded-card p-6 shadow-card">
        <div className="flex items-center gap-2 text-accent font-extrabold text-[15px] uppercase tracking-wider mb-4">
          <CheckCircle2 className="w-5 h-5 text-accent" />
          <span>다음 경기 즉시 적용 지침 (Practical Action Plan)</span>
        </div>
        <div className="space-y-3">
          {feedback.actionPlan.map((action, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-4 rounded-card bg-sunken border border-line text-[15px] leading-relaxed text-ink-soft"
            >
              <Zap className="w-4 h-4 text-accent shrink-0 mt-0.5" />
              <span className="flex-1 whitespace-pre-line">{action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

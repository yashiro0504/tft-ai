'use client'

import {
  Users, Swords, Shield, TrendingUp, Lightbulb, CheckCircle2, Zap,
  GraduationCap, BookOpen, Target, ClipboardCheck, ArrowRight, Gauge,
} from 'lucide-react'
import { useState } from 'react'
import type { CoachingAxis, MetaCoachFeedback } from '@/lib/types'

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

      {/* 점수 근거: axisConfig 공식의 가점/감점 + 입력 지표 (예전 캐시 리포트에는 없을 수 있음) */}
      {axis.effects?.length ? (
        <details className="group mt-2 text-xs">
          <summary className="cursor-pointer select-none text-subtle hover:text-ink-soft">점수 근거</summary>
          <ul className="mt-1.5 space-y-0.5">
            {axis.effects
              .filter((e) => e.points !== 0)
              .map((e) => (
                <li key={e.key} className="flex justify-between gap-2">
                  <span className="text-muted">{e.label}</span>
                  <span className={`font-mono ${e.points < 0 ? 'text-bad' : 'text-ink-soft'}`}>
                    {e.points > 0 ? '+' : ''}
                    {e.points}
                  </span>
                </li>
              ))}
          </ul>
          {axis.metrics?.length ? (
            <p className="mt-1.5 border-t border-line pt-1.5 text-subtle">
              {axis.metrics.map((m) => `${m.label} ${m.value}${m.unit ?? ''}`).join(' · ')}
            </p>
          ) : null}
        </details>
      ) : null}
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
            {lec.moments?.length ? null : <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{lec.why}</p>}
          </div>

          {lec.moments?.length ? (
            // 핵심 장면 (프롬프트 2026-10-21.14~): 장면 사실(코드) → 왜 문제였나 → 다음 판 행동.
            // 종합 분석(2026-10-21.15~)은 여러 판에 반복된 습관이라 '습관'으로 표시한다.
            <ol className="space-y-3">
              {lec.moments.map((mo, i) => (
                <li key={i} className="rounded-card border border-line bg-sunken p-3.5">
                  <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-accent">
                    <Gauge className="h-3.5 w-3.5" /> {feedback.mode === 'multi' ? '습관' : '장면'} {i + 1} · {mo.title}
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink">{mo.fact}</p>
                  {mo.why ? <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{mo.why}</p> : null}
                  {mo.fix ? (
                    <p className="mt-2 flex items-start gap-1.5 rounded-control border border-accent/25 bg-accent-bg px-2.5 py-2 text-[13px] leading-relaxed text-ink-soft">
                      <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                      <span>{mo.fix}</span>
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-card border border-accent/25 bg-accent-bg p-4">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-accent">
            <Target className="h-3.5 w-3.5" /> 다음 3판 목표
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
            <Gauge className="h-4 w-4 text-accent" /> 6축 진단 (코드 산출{plan.scoringVersion ? ` · 공식 ${plan.scoringVersion}` : ''})
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
  // 스키마 v2: 유연성은 6축 contest 점수(코드 산출). v1 캐시 리포트는 AI 피봇 성향(flexibilityScore)을 그대로 보여 준다.
  const contestAxis = feedback.plan?.axes.find((a) => a.key === 'contest')
  const flex = contestAxis
    ? { label: '유연성 (6축)', value: `${contestAxis.score}`, unit: '/100', score: contestAxis.score, title: '6축 진단의 유연성(로비 수렴도 대응) 점수 — 코드 산출' }
    : typeof feedback.flexibilityScore === 'number'
      ? { label: '피봇 성향', value: `${feedback.flexibilityScore}`, unit: '%', score: feedback.flexibilityScore, title: 'AI 가 판단한 피봇(덱 전환) 성향 — 6축의 유연성 점수와는 별개' }
      : null
  const flexBadge =
    (flex?.score ?? 0) >= 65
      ? 'bg-good/10 border-good/80 text-good'
      : (flex?.score ?? 0) >= 45
      ? 'bg-gold/10 border-gold/80 text-gold'
      : 'bg-bad/10 border-bad/80 text-bad'
  // 스키마 v2 actions (v1 캐시 리포트는 improvements)
  const actions = feedback.actions?.length ? feedback.actions : feedback.improvements ?? []

  const pad = compact ? 'p-5 md:p-6' : 'p-6 md:p-8'
  const [showAll, setShowAll] = useState(false)
  const [showEvidence, setShowEvidence] = useState(false)

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      {/* 요약: 리포트 헤더 → 총평 → 점수 3개 → 핵심 교정 3개. 나머지는 펼쳐서 본다 */}
      <div className={`space-y-4 rounded-card border border-line bg-panel ${pad} shadow-card`}>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-subtle">
          <span className="tracking-wide text-accent">REPORT</span>
          <span>{feedback.mode === 'single' ? '단일 경기' : `${matchCount ?? ''}경기 종합`}</span>
          {feedback.dataQuality?.lowSample ? (
            <span className="rounded-chip border border-gold/60 bg-gold/10 px-1.5 py-0.5 text-[10px] font-bold text-gold">
              표본 부족
            </span>
          ) : null}
          {feedback.provenance?.patch ? <span>· 패치 {feedback.provenance.patch}</span> : null}
          {title ? <span className="font-medium">· {title}</span> : null}
        </p>

        <p className="max-w-[820px] text-base font-medium leading-relaxed text-ink sm:text-lg">{feedback.overview}</p>

        {feedback.dataQuality?.lowSample ? (
          <p className="rounded-control border border-gold/40 bg-gold/5 px-3 py-2 text-xs leading-relaxed text-muted">
            초반 종료 표본이라 점수·강의 해석에 주의가 필요합니다
            {feedback.dataQuality.reason ? ` (${feedback.dataQuality.reason})` : ''}. 판을 끝까지 운영한 경기가
            쌓이면 더 정확해집니다.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <div className="min-w-[140px] rounded-control bg-sunken px-4 py-3">
            <p className="text-xs text-subtle">전술 점수</p>
            <p className="text-2xl font-bold text-ink">
              {feedback.metaScore}
              <span className="ml-1 text-sm font-medium text-subtle">/100</span>
            </p>
            <span className="mt-1 inline-block rounded-chip bg-accent-bg px-1.5 py-0.5 text-xs font-semibold text-accent">
              등급 {feedback.metaTier}
            </span>
          </div>
          {flex ? (
            <div className="min-w-[140px] rounded-control bg-sunken px-4 py-3">
              <p className="text-xs text-subtle" title={flex.title}>{flex.label}</p>
              <p className="text-2xl font-bold text-ink">
                {flex.value}
                {flex.unit === '%' ? '%' : <span className="ml-1 text-sm font-medium text-subtle">{flex.unit}</span>}
              </p>
              {feedback.playstyle ? (
                <span className={`mt-1 inline-block rounded-chip border px-1.5 py-0.5 text-xs font-semibold ${flexBadge}`}>
                  {feedback.playstyle}
                </span>
              ) : null}
            </div>
          ) : null}
          {feedback.grounding ? (
            <div className="min-w-[140px] rounded-control bg-sunken px-4 py-3">
              <p className="text-xs text-subtle">근거 검증</p>
              <p className="text-2xl font-bold text-ink">{feedback.grounding.score}%</p>
              <span className="mt-1 inline-block text-xs text-subtle">
                수치 {feedback.grounding.supported}/{feedback.grounding.total} 확인
              </span>
            </div>
          ) : null}
        </div>

        {actions.length ? (
          <ol className="grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 p-0">
            {actions.slice(0, 3).map((item, i) => (
              <li key={i} className="flex gap-2.5 rounded-control bg-sunken px-3.5 py-3">
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-chip bg-accent-bg text-xs font-bold text-accent">
                  {i + 1}
                </span>
                <span className="line-clamp-4 whitespace-pre-line text-sm leading-relaxed text-ink">{item}</span>
              </li>
            ))}
          </ol>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
            className="cursor-pointer rounded-control border border-line bg-sunken px-4 py-2 text-sm text-ink transition hover:border-accent"
          >
            {showAll ? '전체 리포트 접기' : '전체 리포트 펼치기'}
          </button>
          {feedback.grounding || feedback.scoreBreakdown || feedback.provenance || feedback.isFallback ? (
            <button
              type="button"
              onClick={() => setShowEvidence((v) => !v)}
              aria-expanded={showEvidence}
              className="cursor-pointer rounded-control border border-line bg-sunken px-4 py-2 text-sm text-ink transition hover:border-accent"
            >
              {showEvidence ? '분석 근거 접기' : '분석 근거 보기'}
            </button>
          ) : null}
        </div>
      </div>

      {showEvidence ? (
        <>
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
                {feedback.provenance.source === 'riot-ladder'
                  ? '래더 실측'
                  : feedback.provenance.source === 'riot-ranked-db'
                    ? `KR 랭크 집계${feedback.provenance.filter ? ` · ${feedback.provenance.filter}` : ''}`
                    : feedback.provenance.source}
                {feedback.provenance.matches ? ` · ${feedback.provenance.matches.toLocaleString()}판` : ''}
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
          {feedback.grounding?.warnings && feedback.grounding.warnings.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[12px] text-gold hover:text-ink-soft">
                이름/코스트 경고 {feedback.grounding.warnings.length}개 보기
              </summary>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                {feedback.grounding.warnings.join(', ')}
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
          {feedback.scoreBreakdown.sampleWarning ? (
            <p className="mt-2 rounded-control border border-gold/40 bg-gold/5 px-2.5 py-1.5 text-[12px] leading-relaxed text-muted">
              {feedback.scoreBreakdown.sampleWarning}
            </p>
          ) : null}
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

        </>
      ) : null}

      {showAll ? (
        <>
      {/* 강의형 코칭 (개념 → 근거 → 대안 → 연습) */}
      <LectureBlock feedback={feedback} />

      {/* 유연성 해설 — 스키마 v1 캐시 리포트에만 있다 (v2 는 위 6축 진단의 contest 한 줄) */}
      {feedback.contestAnalysis ? (
        <div className="rounded-card border border-line bg-panel p-5 shadow-card md:p-6">
          <div className="mb-3 flex items-center gap-2 text-[14px] font-extrabold uppercase tracking-wider text-accent">
            <Users className="h-4 w-4 text-accent" />
            <span>유연성 (보조 지표)</span>
          </div>
          <div className="rounded-card border border-line bg-sunken p-4 text-[14px] leading-relaxed text-ink-soft md:text-[15px]">
            {feedback.contestAnalysis}
          </div>
        </div>
      ) : null}

      {/* 3대 핵심 영역 — 스키마 v1 캐시 리포트에만 있다 (v2 는 6축 진단 verdict) */}
      {feedback.itemAnalysis || feedback.synergyAnalysis || feedback.economyAnalysis ? (
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
      ) : null}

      {/* 개선 포인트 (v2 actions · v1 improvements) */}
      {actions.length ? (
        <div className="bg-panel border border-line rounded-card p-6 shadow-card">
          <div className="flex items-center gap-2 text-accent font-extrabold text-[15px] uppercase tracking-wider mb-4">
            <Lightbulb className="w-5 h-5 text-accent" />
            <span>결정적 개선 포인트 (Key Improvements)</span>
          </div>
          <div className="space-y-3">
            {actions.map((item, i) => (
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
      ) : null}

      {/* 액션 플랜 — 스키마 v1 캐시 리포트에만 있다 (v2 는 actions · 강의 체크리스트) */}
      {feedback.actionPlan?.length ? (
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
      ) : null}
        </>
      ) : null}
    </div>
  )
}

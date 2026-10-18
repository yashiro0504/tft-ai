import { GoogleGenerativeAI } from '@google/generative-ai'
import { SlimMatchData, MetaCoachFeedback, FeedbackProvenance, CoachLecture, CoachingAxisKey, CoachingPlan } from './types'
import { serializeMatchesForLLM } from './summarize'
import {
  getChampionRankings,
  getTraitRankings,
  getItemRankings,
  getComboRankings,
  getMetaSectionInfo,
} from './meta'
import { translateChampion, translateItem, translateTrait } from './constants'
import { validateFeedbackGrounding } from './grounding'
import { computeScoreBreakdown } from './scoring'
import { buildCoachingPlan } from './coaching'
import { errorFields, incrMetric, logEvent } from './observability'
import { addLlmSpendUsd, getLlmBudgetStatus } from './llmBudget'

/** 프롬프트/스키마 변경 시 올린다. 분석 캐시 키에 포함되어 자동 무효화된다. */
export const COACH_PROMPT_VERSION = '2026-10-18.1'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ''
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

function numEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const LLM_TIMEOUT_MS = Math.floor(numEnv('LLM_TIMEOUT_MS', 45_000))
/** 대략적 단가(USD / 1M tokens). 과금 변동 시 env 로 보정한다. */
const DEEPSEEK_PRICE_INPUT_PER_M = numEnv('DEEPSEEK_PRICE_INPUT_PER_M', 0.27)
const DEEPSEEK_PRICE_OUTPUT_PER_M = numEnv('DEEPSEEK_PRICE_OUTPUT_PER_M', 1.1)
const GEMINI_PRICE_INPUT_PER_M = numEnv('GEMINI_PRICE_INPUT_PER_M', 0.3)
const GEMINI_PRICE_OUTPUT_PER_M = numEnv('GEMINI_PRICE_OUTPUT_PER_M', 2.5)

/** LLM 호출 비용을 카운터/로그로 남긴다 (마이크로 USD 정수로 누적 → 정밀도 손실 방지). */
function recordLlmUsage(
  provider: 'deepseek' | 'gemini',
  model: string,
  inputTokens: number,
  outputTokens: number,
  inputPricePerM: number,
  outputPricePerM: number
): void {
  const usd = (inputTokens / 1_000_000) * inputPricePerM + (outputTokens / 1_000_000) * outputPricePerM
  incrMetric(`llm.call.${provider}`)
  if (inputTokens > 0) incrMetric('llm.tokens.input', inputTokens)
  if (outputTokens > 0) incrMetric('llm.tokens.output', outputTokens)
  incrMetric('llm.cost_usd_micros', Math.round(usd * 1_000_000))
  // 일일 예산 누적(전역 Redis 또는 인메모리). 실패해도 호출 자체는 계속된다.
  void addLlmSpendUsd(usd)
  logEvent('info', 'llm_call', {
    provider,
    model,
    inputTokens,
    outputTokens,
    estimatedUsd: Number(usd.toFixed(6)),
  })
}

/** Promise 에 타임아웃을 건다 (SDK가 자체 시그널을 지원하지 않을 때 사용). */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 응답 시간 초과 (${timeoutMs}ms)`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

const SYSTEM_INSTRUCTION = `너는 TFT(롤토체스) 아카데미의 전임 강사다. 모든 리포트를 "한 편의 강의"로 만든다.
목표: 점수 나열이나 팩폭이 아니라, 유저가 다음 판에서 바로 쓸 수 있는 **원리 + 판단 기준 + 연습 과제**를 남긴다.

★★★ 이번 강의 주제는 코드가 이미 결정했다 ★★★
- 프롬프트의 [이번 강의 주제]와 [6축 진단]을 그대로 사용한다. 임의로 다른 주제를 만들지 마라.
- '경합(로비 수렴도)'은 6개 축 중 하나일 뿐이다. 주제가 경합일 때만 본문 중심에 두고, 그 외에는 axes 항목의 한 줄로만 다뤄라.
- "겹쳐서(대깨) 졌다"는 인과 단정 금지. 겹침은 조건이고, 판단(비틀었는가)만 평가하라.

[강의 본문 구성 — 반드시 이 순서]
1) concept: 이번 주제의 개념/원리를 일반화해 정의 (2~3문장, 특정 판에 매몰되지 않게)
2) why: 그 원리가 왜 이기는지 인과 설명 (1~2문장)
3) evidence: 이 유저 데이터에서 원리가 어긋난 지점 (제공된 수치 최소 2개 직접 인용)
4) alternative: 그 순간의 더 나은 선택 (행동 + 타이밍 + 판단 기준 수치)
5) drill: 다음 3판 동안 지킬 연습 과제 1개 (측정 가능하게, 예: "4-1에 8레벨 도달 시 골드 30 이상 유지")
6) checklist: 실전 체크리스트 3~5개 (짧은 명령문, 중복 금지)

[진단 6축]
- 코드가 계산한 axes 점수를 그대로 쓴다. 점수를 새로 만들지 마라.
- 각 축에 verdict(한 줄 진단, 25자 내외)를 붙인다. 축끼리 문장이 겹치면 안 된다.
- contestAnalysis/itemAnalysis/synergyAnalysis/economyAnalysis 는 각 축 해설이며, 강의 본문(lecture)과 문장을 복사하지 마라.

★★★ 데이터 접지(Grounding) ★★★
- TFT 메타 '기억'은 현재 패치와 다를 수 있다. 오직 프롬프트에 '제공된 수치/사실'만 근거로 쓴다.
- 제공되지 않은 메타 티어리스트·증강 승률·패치 내용을 지어내지 마라. 근거가 없으면 "메타 통계 미제공으로 단정 불가"라고 밝혀라.
- [메타 실측 통계] 블록에 있는 수치만 인용 가능. 표본(n)이 작으면 "표본이 적어 참고용"이라고 밝혀라.
- 인용 수치는 표기 그대로 쓴다(예: 평균등수 3.44, 표본 n=21, 골드 42, 5-2 탈락). 새로 계산한 근사치를 만들지 마라.
- metaScore/metaTier 는 코드 산출값을 그대로 반환한다.

[문체]
- 강의하듯 "~입니다/~합니다" 경어체. 비유는 리포트당 1개까지. 이모지 금지.
- 같은 문장 구조 반복 금지. overview는 서로 다른 축 3개를 한 줄씩 요약.

반드시 아래 JSON 형식으로만 응답하라(마크다운 코드블록 허용):
{
  "metaScore": 75,
  "metaTier": "B+",
  "flexibilityScore": 40,
  "playstyle": "성향 한 줄",
  "overview": "서로 다른 축 3개를 각각 한 문장으로 요약 (3문장)",
  "lecture": {
    "topic": "<[이번 강의 주제] 그대로>",
    "concept": "개념/원리 정의 2~3문장",
    "why": "왜 중요한가 1~2문장",
    "evidence": "이 데이터 근거 (수치 2개 이상 인용)",
    "alternative": "그 순간의 더 나은 선택 (행동+타이밍)",
    "drill": "다음 3판 연습 과제 1개",
    "checklist": ["체크1", "체크2", "체크3"]
  },
  "axes": [
    { "key": "economy", "verdict": "한 줄 진단" },
    { "key": "itemization", "verdict": "한 줄 진단" },
    { "key": "tempo", "verdict": "한 줄 진단" },
    { "key": "completion", "verdict": "한 줄 진단" },
    { "key": "synergy", "verdict": "한 줄 진단" },
    { "key": "contest", "verdict": "한 줄 진단" }
  ],
  "contestAnalysis": "로비 수렴도 1~2문장",
  "itemAnalysis": "아이템 설계 해설",
  "synergyAnalysis": "시너지 설계 해설",
  "economyAnalysis": "경제/템포 해설",
  "improvements": ["개선점 1", "개선점 2", "개선점 3"],
  "actionPlan": ["실전 가이드 1", "실전 가이드 2", "실전 가이드 3"]
}`

/**
 * DeepSeek API 호출 (deepseek-chat)
 */
async function callDeepSeek(prompt: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 3400,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errText = await response.text()
      incrMetric(`llm.http_${response.status}`)
      throw new Error(`DeepSeek API 오류 (${response.status}): ${errText.slice(0, 300)}`)
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }

    recordLlmUsage(
      'deepseek',
      'deepseek-chat',
      data.usage?.prompt_tokens || 0,
      data.usage?.completion_tokens || 0,
      DEEPSEEK_PRICE_INPUT_PER_M,
      DEEPSEEK_PRICE_OUTPUT_PER_M
    )

    return data.choices?.[0]?.message?.content || ''
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      incrMetric('llm.timeout')
      throw new Error(`DeepSeek 응답 시간 초과 (${LLM_TIMEOUT_MS}ms)`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 프롬프트에 주입할 [메타 실측 통계] 블록 + 출처 메타데이터.
 * LLM이 인용할 수 있는 수치의 화이트리스트 역할을 한다.
 */
function buildMetaFacts(): { text: string; provenance: FeedbackProvenance } {
  const info = getMetaSectionInfo()
  const provenance: FeedbackProvenance = {
    patch: info.patch,
    source: info.source,
    generatedAt: info.generatedAt,
    sample: info.sample,
    championStats: 0,
    itemStats: 0,
    comboStats: 0,
  }

  if (!info.hasMeta) {
    return {
      text: '[메타 실측 통계]\n※ 수집된 메타 통계가 없다. 기물/아이템/시너지의 평균등수·픽률을 인용하지 말고 "메타 통계 미제공"으로 명시하라.',
      provenance,
    }
  }

  const champs = getChampionRankings().filter((c) => c.sampleSize >= 10).slice(0, 12)
  const traits = getTraitRankings(10).slice(0, 10)
  const items = getItemRankings().filter((i) => i.sampleSize >= 10).slice(0, 10)
  const combos = getComboRankings(10).slice(0, 8)
  provenance.championStats = champs.length
  provenance.itemStats = items.length
  provenance.comboStats = combos.length

  const fmt = (x: number) => (Math.round(x * 100) / 100).toFixed(2)
  const lines = [
    '[메타 실측 통계 — 아래 수치만 인용 가능]',
    `- 패치: ${info.patch ?? '?'} · 출처: ${info.source ?? '?'} · 수집일: ${
      (info.generatedAt || '').slice(0, 10) || '?'
    }${info.sample ? ' · (샘플/검증 전)' : ''}`,
    `- 기물 TOP${champs.length} (평균등수 · 표본): ${champs
      .map((c) => `${translateChampion(c.key).name} ${fmt(c.avgPlacement)} (n=${c.sampleSize})`)
      .join(', ')}`,
    `- 시너지 TOP${traits.length}: ${traits
      .map((t) => `${translateTrait(t.key).name} ${fmt(t.avgPlacement)} (n=${t.sampleSize})`)
      .join(', ')}`,
    `- 아이템 TOP${items.length}: ${items
      .map((i) => `${translateItem(i.key).name} ${fmt(i.avgPlacement)} (n=${i.sampleSize})`)
      .join(', ')}`,
    `- BIS 조합 TOP${combos.length}: ${combos
      .map((c) => {
        const [ck, ...rest] = c.key.split('|')
        return `${translateChampion(ck).name} × ${translateItem(rest.join('|')).name} ${fmt(c.avgPlacement)} (n=${c.sampleSize})`
      })
      .join(', ')}`,
    '※ 위 목록에 없는 기물/아이템/시너지의 수치는 인용 금지. n<10은 참고용으로만.',
  ]
  return { text: lines.join('\n'), provenance }
}

/**
 * 전문 메타 분석 AI 코칭 피드백 생성
 */
export async function generateMetaCoachFeedback(
  gameName: string,
  matches: SlimMatchData[],
  mode: 'single' | 'multi' = 'single'
): Promise<MetaCoachFeedback> {
  const matchSerialized = serializeMatchesForLLM(matches)
  const { text: metaFacts, provenance } = buildMetaFacts()
  const scoring = computeScoreBreakdown(matches)
  const scoreFacts = scoring
    ? [
        '[코드 산출 점수 — 이 값을 그대로 사용하라]',
        `- metaScore: ${scoring.total} · metaTier: ${scoring.tier} (산출식 ${scoring.version}, ${scoring.matches}경기 평균)`,
        ...scoring.components.map(
          (c) =>
            `- ${c.label}: ${c.score}/100 × ${Math.round(c.weight * 100)}% = +${c.contribution} (${c.detail})`
        ),
        '※ metaScore/metaTier 는 반드시 위 코드 산출값을 그대로 반환하라. 점수 해설은 위 구성요소 수치를 근거로 작성하라.',
      ].join('\n')
    : '[코드 산출 점수]\n※ 산출 불가 (경기 데이터 없음)'

  // 강의 계획: 가장 약한 축을 코드가 결정 (LLM이 주제를 바꾸지 못하게 고정)
  const plan = buildCoachingPlan(matches)
  const planFacts = [
    '[이번 강의 주제 — 코드가 결정, 변경 금지]',
    `- 주제: ${plan.topic}`,
    `- 초점 축: ${plan.focusLabel} (${plan.focus})`,
    `- 기본 개념 문장(참고): ${plan.drillTemplate}`,
    '',
    '[6축 진단 — 코드 산출 점수, 그대로 사용]',
    ...plan.axes.map((a) => `- ${a.key}(${a.label}): ${a.score}/100 · ${a.detail}`),
    '※ axes 배열에는 위 6개 key 를 모두 넣고, score/점수는 위 코드 값을 그대로 인용하라.',
    '※ 초점 축이 contest 가 아니라면 로비 경합은 axes 의 한 줄 + contestAnalysis 로만 다루고, lecture 주제로 삼지 마라.',
  ].join('\n')
  const modeContext = mode === 'single'
    ? '분석 모드: [단일 경기 정밀 분석] - 해당 판 로비 8명 중 경쟁자들과의 기물 겹침, 대깨/유연성 판단 및 구체적 승패 요인을 데이터 근거로 해부하라.'
    : `분석 모드: [최근 ${matches.length}경기 종합 분석] - 여러 판의 덱 다양성, 기물 겹침 시 대처 패턴, 고착된 습관을 데이터 근거로 종합 진단하라.`

  // 증강 데이터/메타 통계 제공 여부에 따라 접지 안내를 동적으로 구성
  const hasAugments = matches.some((m) => (m.augments?.length || 0) > 0)
  const metaDetail = matches.find((m) => m.augmentAnalysis?.hasMeta)?.augmentAnalysis

  let metaNote: string
  if (!hasAugments) {
    metaNote =
      '※ 이번 경기 데이터에는 증강 정보가 포함되어 있지 않다. 증강/증강 메타에 대한 평가나 추측을 하지 말고, 경제·아이템·템포·완성도·시너지·수렴도에 집중하라.'
  } else if (metaDetail) {
    metaNote = metaDetail.sample
      ? `※ 이번 요청에는 증강 메타 통계가 '샘플(검증 전)'로 제공되었다. 참고용으로만 언급하고, 실측 통계인 것처럼 단정하지 마라. (출처: ${metaDetail.source ?? 'unknown'}, 패치 ${metaDetail.patch ?? '?'})`
      : `※ 이번 요청에는 증강 메타 통계(평균 등수/티어)가 제공되었다. 증강 선택 평가에 이 수치를 직접 인용하라. (출처: ${metaDetail.source ?? 'unknown'}, 패치 ${metaDetail.patch ?? '?'}, baseline 평균등수 ${metaDetail.baselineAvgPlacement ?? 4.5})`
  } else {
    metaNote =
      '※ 이번 요청에는 메타 통계(증강 승률/티어리스트, 패치 변경점, 아이템 BIS 통계)가 제공되지 않았다. 증강체/메타 관련 평가는 "메타 통계 미제공으로 단정 불가"임을 명시하고 추측을 배제하라.'
  }

  const prompt = `소환사명: ${gameName}
${modeContext}

[제공된 사실 데이터 — 아래 수치만 근거로 사용하라]
${matchSerialized}

${metaNote}

${metaFacts}

${scoreFacts}

${planFacts}

   모든 서술은 위 데이터의 수치(골드, 레벨, 탈락 라운드, 2성 수, 아이템 수, 로비 수렴도)를 직접 인용해 작성하라.

위 유저의 경기 데이터를 접지(Grounding) 원칙에 따라 분석하되, [이번 강의 주제]를 중심으로 "원리 → 데이터 근거 → 더 나은 선택 → 연습 과제"가 이어지는 강의형 JSON 리포트를 작성하라.
6축(경제·아이템·템포·완성도·시너지·수렴도)을 모두 진단하되, 주제가 아닌 축은 한 줄로만 다뤄 분량을 분산시켜라.`

  // LLM 응답에 코드 기반 '점수/근거 검증/출처/강의계획'을 붙인다.
  const finalize = (
    fb: MetaCoachFeedback,
    isFallback = false,
    axisVerdicts?: Partial<Record<CoachingAxisKey, string>>
  ): MetaCoachFeedback => {
    const planWithVerdicts: CoachingPlan = {
      ...plan,
      axes: plan.axes.map((a) => ({ ...a, verdict: axisVerdicts?.[a.key] })),
    }
    return {
      ...fb,
      metaScore: scoring ? scoring.total : fb.metaScore,
      metaTier: scoring ? scoring.tier : fb.metaTier,
      isFallback,
      provenance,
      scoreBreakdown: scoring ?? undefined,
      plan: planWithVerdicts,
      lecture: normalizeLecture(fb.lecture, planWithVerdicts, fb),
      grounding: validateFeedbackGrounding(fb, prompt),
    }
  }

  // 0. 일일 예산 가드 — 초과 시 제공자 호출을 건너뛰고 폴백 리포트를 반환한다.
  const budget = await getLlmBudgetStatus()
  if (budget.exceeded) {
    incrMetric('llm.budget_blocked')
    logEvent('warn', 'llm_budget_blocked', {
      spentUsd: budget.spentUsd,
      budgetUsd: budget.budgetUsd,
      matches: matches.length,
      mode,
    })
    return finalize(generateFallbackMetaFeedback(gameName, matches), true)
  }

  // 1. DeepSeek API 키가 있는 경우 우선 사용
  if (DEEPSEEK_API_KEY) {
    try {
      const text = await callDeepSeek(prompt)
      const parsed = parseJsonFeedback(text)
      if (parsed) return finalize(parsed.feedback, false, parsed.axisVerdicts)
    } catch (err) {
      incrMetric('llm.fallback.deepseek_error')
      logEvent('warn', 'llm_provider_failed', { provider: 'deepseek', model: 'deepseek-chat', ...errorFields(err) })
    }
  }

  // 2. Gemini API 키가 있는 경우 사용 (GEMINI_MODEL 로 모델 지정)
  if (GEMINI_API_KEY) {
    try {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
      const model = genAI.getGenerativeModel({
        model: GEMINI_MODEL,
        systemInstruction: SYSTEM_INSTRUCTION,
        generationConfig: { temperature: 0.2, maxOutputTokens: 3400 },
      })

      const result = await withTimeout(model.generateContent(prompt), LLM_TIMEOUT_MS, 'Gemini')
      const usage = result.response.usageMetadata as
        | { promptTokenCount?: number; candidatesTokenCount?: number }
        | undefined
      recordLlmUsage(
        'gemini',
        GEMINI_MODEL,
        usage?.promptTokenCount || 0,
        usage?.candidatesTokenCount || 0,
        GEMINI_PRICE_INPUT_PER_M,
        GEMINI_PRICE_OUTPUT_PER_M
      )

      const text = result.response.text()
      const parsed = parseJsonFeedback(text)
      if (parsed) return finalize(parsed.feedback, false, parsed.axisVerdicts)
    } catch (err) {
      incrMetric('llm.fallback.gemini_error')
      logEvent('warn', 'llm_provider_failed', { provider: 'gemini', model: GEMINI_MODEL, ...errorFields(err) })
    }
  }

  // 3. 지능형 메타 코칭 폴백
  incrMetric('llm.fallback')
  return finalize(generateFallbackMetaFeedback(gameName, matches), true)
}

/**
 * 강의 본문 정규화 (LLM 누락 시 코드가 채움)
 */
const AXIS_KEYS: CoachingAxisKey[] = ['economy', 'itemization', 'tempo', 'completion', 'synergy', 'contest']

function defaultChecklist(plan: CoachingPlan): string[] {
  return [
    `${plan.focusLabel} 지표를 매 라운드 시작 전에 한 번 확인`,
    '결정 전 5초: 지금 쓰는 골드/아이템이 3라운드 뒤에도 유효한가',
    '판 종료 후 잔여 골드·탈락 라운드 기록해 추세 확인',
  ]
}

function normalizeLecture(
  lecture: CoachLecture | undefined,
  plan: CoachingPlan,
  fb: MetaCoachFeedback
): CoachLecture {
  const focus = plan.axes.find((a) => a.key === plan.focus)
  const checklist = (lecture?.checklist || []).map((s) => String(s).trim()).filter(Boolean)
  const merged = checklist.length >= 3 ? checklist : [...checklist, ...defaultChecklist(plan)]
  return {
    topic: lecture?.topic?.trim() || plan.topic,
    concept: lecture?.concept?.trim() || plan.drillTemplate,
    why:
      lecture?.why?.trim() ||
      `이 축의 점수는 ${focus?.score ?? 0}/100 입니다. ${focus?.detail ?? ''} — 이 지표는 보드 강도와 직결되므로 다음 판에서 가장 먼저 손봐야 할 지점입니다.`,
    evidence: lecture?.evidence?.trim() || fb.overview || focus?.detail || '',
    alternative:
      lecture?.alternative?.trim() ||
      (fb.actionPlan && fb.actionPlan[0]) ||
      '다음 판에는 같은 라운드에서 한 번 더 멈춰 판단해 보세요.',
    drill:
      lecture?.drill?.trim() ||
      `다음 3판은 ${plan.focusLabel} 하나만 의식하세요. ${plan.drillTemplate}`,
    checklist: [...new Set(merged)].slice(0, 5),
  }
}

/**
 * LLM의 JSON 응답을 MetaCoachFeedback 인터페이스로 파싱
 */
function parseJsonFeedback(
  rawText: string
): { feedback: MetaCoachFeedback; axisVerdicts: Partial<Record<CoachingAxisKey, string>> } | null {
  try {
    let cleanJson = rawText.trim()
    const jsonMatch = cleanJson.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (jsonMatch && jsonMatch[1]) {
      cleanJson = jsonMatch[1].trim()
    } else {
      const startIdx = cleanJson.indexOf('{')
      const endIdx = cleanJson.lastIndexOf('}')
      if (startIdx !== -1 && endIdx !== -1) {
        cleanJson = cleanJson.slice(startIdx, endIdx + 1)
      }
    }

    const obj = JSON.parse(cleanJson)
    if (obj.overview) {
      const flexibility = typeof obj.flexibilityScore === 'number' ? Math.min(Math.max(obj.flexibilityScore, 0), 100) : 55
      const playstyle = obj.playstyle || (flexibility < 45 ? '대깨 고집형 빌드업' : flexibility > 70 ? '빈집 탐색 유연형' : '하이브리드 템포형')
      const llmScore = typeof obj.metaScore === 'number' ? Math.min(Math.max(obj.metaScore, 0), 100) : 0

      // 강의 본문 (없으면 finalize 에서 코드가 채움)
      const rawLecture = obj.lecture && typeof obj.lecture === 'object' ? obj.lecture : null
      const lecture: CoachLecture | undefined = rawLecture
        ? {
            topic: typeof rawLecture.topic === 'string' ? rawLecture.topic : '',
            concept: typeof rawLecture.concept === 'string' ? rawLecture.concept : '',
            why: typeof rawLecture.why === 'string' ? rawLecture.why : '',
            evidence: typeof rawLecture.evidence === 'string' ? rawLecture.evidence : '',
            alternative: typeof rawLecture.alternative === 'string' ? rawLecture.alternative : '',
            drill: typeof rawLecture.drill === 'string' ? rawLecture.drill : '',
            checklist: Array.isArray(rawLecture.checklist)
              ? rawLecture.checklist.filter((s: unknown): s is string => typeof s === 'string')
              : [],
          }
        : undefined

      // 6축 한 줄 진단
      const axisVerdicts: Partial<Record<CoachingAxisKey, string>> = {}
      if (Array.isArray(obj.axes)) {
        for (const a of obj.axes) {
          const key = String(a?.key || '') as CoachingAxisKey
          const verdict = typeof a?.verdict === 'string' ? a.verdict.trim() : ''
          if (verdict && AXIS_KEYS.includes(key)) axisVerdicts[key] = verdict
        }
      }

      const feedback: MetaCoachFeedback = {
        mode: (obj.mode as 'single' | 'multi') || 'single',
        metaScore: llmScore,
        metaTier: obj.metaTier || calculateTier(llmScore),
        flexibilityScore: flexibility,
        playstyle,
        overview: obj.overview,
        contestAnalysis: obj.contestAnalysis || '로비 내 타 유저들과의 기물 경합이 일부 발생하였으나 기용 템포에서 차이를 보였습니다.',
        itemAnalysis: obj.itemAnalysis || '아이템 배분이 주력 딜러에게 집중될 필요가 있습니다.',
        synergyAnalysis: obj.synergyAnalysis || '앞라인 탱커 시너지 보강이 권장됩니다.',
        economyAnalysis: obj.economyAnalysis || '탈락 라운드 대비 골드 소모 타이밍 조절이 필요합니다.',
        improvements: Array.isArray(obj.improvements) && obj.improvements.length > 0
          ? obj.improvements
          : ['메인 캐리 기물의 3신기 아이템 집중 완성', '앞라인 2성 탱커 확보 우선순위 상향', '피 관리 구간에서의 과감한 리롤 타이밍 조정'],
        actionPlan: Array.isArray(obj.actionPlan) && obj.actionPlan.length > 0
          ? obj.actionPlan
          : ['초반 2-1~3-2 구간 피 관리를 위한 연승/연패 확실한 노선 선택', '4-1 라운드 7레벨 핵심 딜러 2성작 완료 후 레벨업', '3-2 라운드까지 앞라인 2성과 핵심 아이템을 확정해 중반 템포 확보'],
        lecture,
        fullMarkdown: rawText,
      }
      return { feedback, axisVerdicts }
    }
  } catch (e) {
    console.error('Failed to parse JSON feedback from LLM:', e)
  }
  return null
}

function calculateTier(score: number): string {
  if (score >= 90) return 'S'
  if (score >= 80) return 'A'
  if (score >= 70) return 'B'
  if (score >= 60) return 'C'
  return 'D'
}

/**
 * 매치 데이터를 정밀 분석하여 메타 관점의 객관적이고 건설적인 코칭 피드백 생성
 */
function generateFallbackMetaFeedback(
  gameName: string,
  matches: SlimMatchData[],
  mode: 'single' | 'multi' = 'single'
): MetaCoachFeedback {
  const latest = matches[0] || { placement: 6, level: 8, lastRound: '5-1', goldLeft: 24, units: [], traits: [] }
  const avgPlacement = matches.reduce((acc, m) => acc + m.placement, 0) / (matches.length || 1)
  const hasAugments = matches.some((m) => (m.augments?.length || 0) > 0)

  const actionPlan = [
    '매 라운드 준비 시간 초반 5초 동안 상대 필드를 정찰하여 겹친 기물 여부 체크할 것',
    '아이템 조합 시 딜템 3개 + 탱템 3개 구조를 확정하고 남는 템만 서브 기물에 장착할 것',
    '4-1 혹은 4-2 라운드 7/8레벨 도달 시점 필드 2성작 상태를 점검하고 피가 낮다면 즉시 롤 다운 진행',
  ]
  if (hasAugments) {
    actionPlan.push('증강체 선택 시 덱 파워를 즉각 올려주는 전투 증강을 최소 1개 이상 확보하여 템포 유지')
  }

  // 겹침/경합 강도에 따른 유연성 점수 (경합 강도가 높을수록 유연성 낮음)
  const contestScores = matches
    .map((m) => m.contestedInfo?.contestScore)
    .filter((n): n is number => typeof n === 'number')
  const avgContest = contestScores.length
    ? contestScores.reduce((a, b) => a + b, 0) / contestScores.length
    : matches.some((m) => m.contestedInfo?.isContested)
    ? 50
    : 15
  const flexibility = Math.round(Math.min(Math.max(100 - avgContest, 10), 95))
  const playstyle = flexibility < 45 ? '고집형 대깨 성향' : flexibility > 70 ? '빈집 탐색 유연형' : '하이브리드 템포형'

  let score = Math.round(100 - (avgPlacement - 1) * 12)
  score = Math.min(Math.max(score, 35), 98)
  const tier = calculateTier(score)

  const contestAnalysis = mode === 'single'
    ? (latest.contestedInfo?.isContested
      ? `로비 내 ${latest.contestedInfo.opponentCount}명의 경쟁자가 동일한 핵심 시너지(${latest.contestedInfo.contestedTraits.join(', ') || '메인 시너지'})를 동시에 기용하여 4~5스테이지 기물 풀 고갈이 발생했습니다. 겹침을 감지하고도 덱을 우회하지 않고 대깨로 밀어붙여 2성작 타이밍이 크게 지연되었습니다.`
      : `로비 내 다른 유저들과 메인 시너지 겹침이 거의 없는 '빈집'을 효과적으로 선점했습니다. 기물 선점 경쟁에서는 매우 유리했으나 중후반 덱 밸류 업그레이드 타이밍이 아쉬웠습니다.`)
    : `최근 ${matches.length}경기를 종합 분석한 결과, 초반 손패와 무관하게 선호하는 특정 덱을 강제로 대깨 치는 경향이 ${flexibility < 50 ? '높게' : '낮게'} 나타났습니다. 로비 정찰을 통해 겹친 유저를 확인하고 과감하게 피봇하는 유연성이 절실합니다.`

  return {
    mode,
    metaScore: score,
    metaTier: tier,
    flexibilityScore: flexibility,
    playstyle,
    overview: mode === 'single'
      ? `단일 경기 분석 결과: ${latest.placement}위로 마감하였으며, 메타 덱의 기본 시너지는 구성되었으나 로비 내 경쟁 구도 대응 및 핵심 캐리 아이템 집중도에서 전력 누수가 발생했습니다.`
      : `최근 ${matches.length}경기 종합 분석 결과: 평균 ${avgPlacement.toFixed(1)}등을 기록 중이며, 덱 풀의 다양성과 기물 겹침 상황에서의 유연한 피봇 판단력이 순방의 핵심 분기점으로 나타났습니다.`,
    contestAnalysis,
    itemAnalysis: `메인 딜러에게 3신기 핵심 코어템이 완벽히 몰리지 못하고 보조 기물들로 아이템이 분산되어 후반 DPS 한계점에 부딪혔습니다. 특히 메인 탱커의 방어 아이템(워모그, 가고일 등) 3부위 완성이 늦어져 상대 주력 딜러의 화력을 버텨내지 못했습니다.`,
    synergyAnalysis: `시너지를 폭넓게 활성화하려다 보니 실질적인 덱의 코어 시너지(고티어 시너지)의 단계가 낮아졌습니다. 앞라인 탱커 기물들의 2성작이 미흡한 상태에서 뒷라인 딜러만 배치되어 전투 초반 진형이 붕괴되는 구조적 취약점이 관찰되었습니다.`,
    economyAnalysis: `${latest.lastRound} 탈락 시점에 잔여 골드가 ${latest.goldLeft}G 남아있던 점으로 미루어볼 때, 체력이 30 이하로 내려간 위험 구간에서 과감하게 골드를 소모하여 2성작을 완성하는 리롤 템포 전환 타이밍을 놓쳤습니다.`,
    improvements: [
      '로비 정찰 기반의 피봇 판단: 2-5 및 3-2 라운드에 타 유저 필드를 확인하고 2명 이상 겹쳤다면 즉시 대체 딜러/시너지로 선회해야 합니다.',
      '메인 캐리 기물 아이템 3신기 우선 완성: 서브 딜러에게 템을 나누지 말고, 메인 캐리 1명에게 완제품 3개를 몰아준 뒤 메인 탱커 3방템을 구축해야 합니다.',
      '체력 관리 기반의 유연한 리롤 전환: 체력이 35 이하로 떨어지는 4~5스테이지 구간에서는 50골드 이자에 집착하지 말고 20~30골드까지 과감히 소모해 필드 파워를 반등시켜야 합니다.',
    ],
    actionPlan,
  }
}

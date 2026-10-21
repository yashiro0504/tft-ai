import { GoogleGenerativeAI } from '@google/generative-ai'
import { SlimMatchData, MetaCoachFeedback, FeedbackProvenance, CoachLecture, CoachingAxisKey, CoachingPlan, LectureMoment } from './types'
import { serializeMatchesForLLM } from './summarize'
import { getMetaSectionInfo } from './meta'
import { getDecks, getStats } from './tftStats'
import { buildComparisonFacts, type ComboFact } from './comparisonFacts'
import { keyMoments, type KeyMoment } from './keyMoments'
import { DEFAULT_FILTER, filterLabel, type StatRow } from './statsShared'
import { validateFeedbackGrounding } from './grounding'
import { feedbackTexts, validateEntityFacts } from './semanticGrounding'
import { computeScoreBreakdown, scoreToTier, SCORING_VERSION } from './scoring'
import { buildCoachingPlan } from './coaching'
import { isEarlyGame, lowSampleReason } from './quality'
import { errorFields, incrMetric, logEvent } from './observability'
import { addLlmSpendUsd, getLlmBudgetStatus } from './llmBudget'
import { DEEPSEEK_MODEL, DEEPSEEK_THINKING, recordLlmHttpError } from './llmStatus'
import { cacheGetWithSource, cacheSet, CACHE_TTL } from './cache'

/** 프롬프트/스키마 변경 시 올린다. 분석 캐시 키에 포함되어 자동 무효화된다. */
export const COACH_PROMPT_VERSION = '2026-10-21.14'
/** 짧은 인트로 프롬프트/캐시 스키마 버전. 전체 리포트와 별도로 무효화한다. */
const INTRO_PROMPT_VERSION = '2026-10-19.1'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ''
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
/*
 * DEEPSEEK_MODEL: 레거시 별칭 `deepseek-chat` 도 현재 V4.1-Flash 로 라우팅되지만
 * 문서에서 빠졌으므로 정식 ID 를 기본값으로 쓴다. (`deepseek-v4-pro` 등으로 교체 가능)
 * DEEPSEEK_THINKING: V4.x 는 thinking 모드가 기본값이다. 켜면 reasoning 토큰이 max_tokens 를 먼저 소모해
 * JSON 이 잘리거나 인트로가 비므로 기본은 끈다. (`DEEPSEEK_THINKING=enabled` 로 켤 수 있음)
 * 값은 /api/health 와 같이 쓰도록 lib/llmStatus.ts 에 있다.
 */

/** DeepSeek HTTP 오류: 모델 ID·응답 본문 일부를 로그·헬스 상태에 남기고 던질 에러를 만든다 */
function deepSeekHttpError(label: string, status: number, errText: string): Error {
  const body = errText.slice(0, 300)
  incrMetric(`llm.http_${status}`)
  recordLlmHttpError({ provider: 'deepseek', model: DEEPSEEK_MODEL, status, body })
  // 4xx(429 제외)는 모델 ID·파라미터(thinking 등) 스펙 불일치일 가능성이 크다
  logEvent(status >= 400 && status < 500 && status !== 429 ? 'error' : 'warn', 'llm_http_error', {
    provider: 'deepseek',
    model: DEEPSEEK_MODEL,
    thinking: DEEPSEEK_THINKING,
    status,
    body,
  })
  return new Error(`${label} (${status}): ${body}`)
}

function numEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const LLM_TIMEOUT_MS = Math.floor(numEnv('LLM_TIMEOUT_MS', 45_000))
/** 전체 리포트 출력 상한 (인트로 240 은 별도). 기본 3400 — 평가 하네스가 변형별로 바꾼다 */
const DEEPSEEK_MAX_TOKENS = Math.floor(numEnv('DEEPSEEK_MAX_TOKENS', 3400))
/**
 * 리포트 제공자 강제: deepseek | gemini. 비우면 DeepSeek → Gemini → 결정론적 폴백.
 * 강제하면 다른 제공자로 넘어가지 않아 평가에서 제공자가 섞이지 않는다 (실패 시 결정론적 폴백).
 */
const LLM_PROVIDER = process.env.LLM_PROVIDER === 'deepseek' || process.env.LLM_PROVIDER === 'gemini' ? process.env.LLM_PROVIDER : ''
/**
 * 대략적 단가(USD / 1M tokens). 과금 변동 시 env 로 보정한다.
 * DeepSeek 기본값은 deepseek-flash 피크 단가(2026-10 기준, 오프피크는 절반) — 예산 가드가 보수적으로 동작하도록.
 */
const DEEPSEEK_PRICE_INPUT_PER_M = numEnv('DEEPSEEK_PRICE_INPUT_PER_M', 0.3)
const DEEPSEEK_PRICE_CACHED_INPUT_PER_M = numEnv('DEEPSEEK_PRICE_CACHED_INPUT_PER_M', 0.006)
const DEEPSEEK_PRICE_OUTPUT_PER_M = numEnv('DEEPSEEK_PRICE_OUTPUT_PER_M', 1.2)
const GEMINI_PRICE_INPUT_PER_M = numEnv('GEMINI_PRICE_INPUT_PER_M', 0.3)
const GEMINI_PRICE_OUTPUT_PER_M = numEnv('GEMINI_PRICE_OUTPUT_PER_M', 2.5)

/** OpenAI 호환 usage — DeepSeek 는 프롬프트 캐시 히트 토큰을 별도로 준다. */
interface DeepSeekUsage {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_cache_hit_tokens?: number
}

/** DeepSeek 공통 요청 바디 (모델/thinking 설정을 한 곳에서 관리) */
function deepSeekBody(system: string, prompt: string, maxTokens: number, extra: Record<string, unknown>) {
  return JSON.stringify({
    model: DEEPSEEK_MODEL,
    thinking: { type: DEEPSEEK_THINKING },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    max_tokens: maxTokens,
    ...extra,
  })
}

/** LLM 호출 비용을 카운터/로그로 남긴다 (마이크로 USD 정수로 누적 → 정밀도 손실 방지). */
function recordLlmUsage(
  provider: 'deepseek' | 'gemini',
  model: string,
  inputTokens: number,
  outputTokens: number,
  inputPricePerM: number,
  outputPricePerM: number,
  cachedInputTokens = 0,
  cachedInputPricePerM = inputPricePerM
): void {
  const cached = Math.min(Math.max(cachedInputTokens, 0), inputTokens)
  const usd =
    ((inputTokens - cached) / 1_000_000) * inputPricePerM +
    (cached / 1_000_000) * cachedInputPricePerM +
    (outputTokens / 1_000_000) * outputPricePerM
  incrMetric(`llm.call.${provider}`)
  if (inputTokens > 0) incrMetric('llm.tokens.input', inputTokens)
  if (cached > 0) incrMetric('llm.tokens.input_cached', cached)
  if (outputTokens > 0) incrMetric('llm.tokens.output', outputTokens)
  incrMetric('llm.cost_usd_micros', Math.round(usd * 1_000_000))
  // 일일 예산 누적(전역 Redis 또는 인메모리). 실패해도 호출 자체는 계속된다.
  void addLlmSpendUsd(usd)
  logEvent('info', 'llm_call', {
    provider,
    model,
    inputTokens,
    cachedInputTokens: cached,
    outputTokens,
    estimatedUsd: Number(usd.toFixed(6)),
  })
}

/** DeepSeek usage 를 비용 기록으로 넘긴다. */
function recordDeepSeekUsage(usage: DeepSeekUsage | undefined, inputFallback = 0, outputFallback = 0): void {
  recordLlmUsage(
    'deepseek',
    DEEPSEEK_MODEL,
    usage?.prompt_tokens || inputFallback,
    usage?.completion_tokens || outputFallback,
    DEEPSEEK_PRICE_INPUT_PER_M,
    DEEPSEEK_PRICE_OUTPUT_PER_M,
    usage?.prompt_cache_hit_tokens || 0,
    DEEPSEEK_PRICE_CACHED_INPUT_PER_M
  )
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
목표: 점수 나열이나 일반론이 아니라, **이 판에서 실제로 일어난 장면을 콕 집어** 왜 문제였고 다음 판에 무엇을 할지 남긴다.
일반론(원리 정의)은 한 문장뿐이다. 나머지는 모두 이 판의 기물·성급·아이템·수치로 말한다.

★★★ 이번 강의 주제는 코드가 이미 결정했다 ★★★
- 프롬프트의 [이번 강의 주제]와 [6축 진단]을 그대로 사용한다. 임의로 다른 주제를 만들지 마라.
- '유연성(로비 수렴도 대응, key: contest)'은 6개 축 중 하나일 뿐이다. 주제가 경합일 때만 본문 중심에 두고, 그 외에는 axes 항목의 한 줄로만 다뤄라.
- "겹쳐서(대깨) 졌다"는 인과 단정 금지. 겹침은 조건이고, 판단(비틀었는가)만 평가하라.

[강의 본문 구성 — 핵심 장면 중심]
1) concept: 이번 주제의 원리 한 문장 (이 리포트에서 일반론은 이 한 문장뿐)
2) moments: [핵심 장면] 블록의 장면을 블록 순서대로 하나씩 해설한다 (블록에 있는 장면 수만큼, 최대 3개).
   - title: 장면 제목 그대로
   - fact: 장면의 사실 줄을 그대로 옮긴다 (기물·성급·개수·수치를 바꾸지 마라)
   - why: 이 판에서 그게 왜 보드를 약하게 만들었는지 1~2문장. 제공된 수치·기물로만 말한다
     (예: 같은 아이템이 2성 기물에 있었다면 / 같은 구성 상대와의 성급 차이). 등수의 원인으로 단정하지는 마라.
   - fix: 다음 판 같은 상황에서 할 구체적 행동 1~2문장 (어떤 기물·아이템을 어떻게). 라운드·타이밍 숫자는 만들지 마라.
   - [핵심 장면] 블록이 없거나 비어 있으면 [6축 진단]의 초점 축 지표로 장면 1개를 만든다 (title: 초점 축 이름).
3) drill: 다음 3판 동안 지킬 목표 1개 — 최종 보드로 확인할 수 있는 숫자 목표로 (예: 기물 성급·2성 수·아이템 위치).
   라운드·레벨 도달 시점은 데이터에 없으니 넣지 마라.
4) checklist: 실전 체크리스트 3개 (짧은 명령문, moments 의 fix 를 그대로 복사하지 마라)

[진단 6축]
- 코드가 계산한 axes 점수를 그대로 쓴다. 점수를 새로 만들지 마라.
- 각 축에 verdict(한 줄 진단, 25자 내외)를 붙인다. 축끼리 문장이 겹치면 안 된다.
- 덱 유형이 리롤형이면 템포 축을 "레벨이 낮다"가 아니라 "3성 완성·캐리 3성" 기준으로 해설하라. 표준형에만 레벨 격차를 적용하라.
- actions 는 다음 판에서 할 행동 3개다(서로 다른 축, 측정 가능하게). lecture.checklist·axes verdict 와 문장을 복사하지 마라.

★★★ 데이터 접지(Grounding) ★★★
- TFT 메타 '기억'은 현재 패치와 다를 수 있다. 오직 프롬프트에 '제공된 수치/사실'만 근거로 쓴다.
- 제공되지 않은 메타 티어리스트·증강 승률·패치 내용을 지어내지 마라. 근거가 없으면 "메타 통계 미제공으로 단정 불가"라고 밝혀라.
- [메타 실측 통계] 블록에 있는 수치만 인용 가능. 표본(n)이 작으면 "표본이 적어 참고용"이라고 밝혀라.
- 인용 수치는 제공된 표기 그대로 쓴다(평균등수·표본 n·골드·탈락 라운드 등). 새로 계산한 근사치를 만들지 마라.
- metaScore/metaTier 는 코드 산출값을 그대로 반환한다.

★★★ 이름/코스트 환각 금지 ★★★
- 제공된 사실 데이터에 등장한 기물·시너지·아이템·증강 이름만 쓴다. 다른 세트의 시너지명(예: 결투가)이나 존재하지 않는 이름을 만들지 마라.
- 기물 코스트는 1~5만 존재한다. "6코스트" 같은 표현을 쓰지 마라.
- 경합이 없는 경우(경합 없음/0/100)는 실패가 아니라 유리한 조건이다. "빈집 활용 실패"처럼 실패로 단정하지 마라.
- 레벨 9~10 표준형(밸류) 보드에서 5코스트 겹침은 그 레벨에 간 모두가 겪는 조건이다. "겹쳐서 졌다", "다른 덱으로 비틀었어야" 식으로
  원인 삼지 말고, 같은 5코스트를 쓴 상대와 2성 수·아이템 차이를 비교하라.
- 증강 정보는 Riot API 가 제공하지 않는다. 증강 판단(프리즘 개수 등)을 추측하지 말되, "증강이 약했다/좋았다"처럼 단정하지도 마라.
- 초반 종료(2-2 등) 표본은 등급·강의 근거로 쓰지 말고 "표본 부족"을 명시하라. 단일 경기 분석이면 "평균"이 아니라 "이 경기"로 쓴다.
- 기물의 성급·아이템 소유는 제공된 최종 보드와 정확히 일치해야 한다. 여러 기물을 "A·B·C 모두 N성"처럼 묶어 말할 때도 각 기물의 실제 성급을 확인하라.

- [비교 사실] 블록(로비 1등·로비 평균·같은 구성 상대·유사 메타 덱·BIS 일치율)은 코드가 계산한 서술 통계다. 수치는 그대로 인용하되
  "그래서 졌다"처럼 원인으로 단정하지 마라. 차이를 근거로 한 개선 제안은 "~를 비교하면"처럼 비교로 표현하라.
- 같은 구성 상대 줄은 최종 보드의 코어 기물이 겹치는 로비 상대와의 비교다. 같은 구성끼리의 레벨·2성 수·코어 기물 성급·아이템 차이는
  인용해도 되고, 덱이 다른 로비 1등보다 이 줄을 우선 비교 기준으로 써도 된다. 단 성급 차이를 "그래서 등수가 갈렸다"로 단정하지 말고,
  줄에 없는 기물의 성급이나 상대의 운영(리롤·레벨 타이밍)을 지어내지 마라. 줄이 없으면 같은 구성 상대를 언급하지 마라.
  상대 성급을 말하는 문장에는 "같은 구성 상대(N등)"를 밝혀 내 보드 성급과 섞이지 않게 하라(예: "같은 구성 상대(2등)는 타릭 2성, 나는 1성").
- 메타 덱 운영도(메타 평균등수 대비 내 등수)는 점수가 아니다. 점수·등급 해설에 섞지 마라.
  '메타 평균 수준'이면 강의 근거로 쓰지 마라. '못 굴림'의 원인은 "내 보드에 없음"으로 제공된 기물처럼 확인된 사실로만 설명하고,
  그 외 원인(타이밍·리롤 횟수 등)을 지어내지 마라. '참고용' 표시가 있으면 참고용임을 밝혀라.
- 보드 가치(G)는 최종 보드에 들어간 골드 총량이다. 늦게 탈락할수록 커지므로, 상대와의 차이를 "그래서 졌다"로 단정하지 마라.
- 덱 가이드는 래더 상위권 최종 보드 통계다. 캐리 아이템은 '채용률 순'이지 조합(슬램) 순서가 아니다 — "먼저 만들어라"로 바꿔 말하지 마라.
  채용률·가이드 수치를 '먼저/우선 슬램' 같은 순서 조언의 근거로 붙이지 마라. 조합 순서 원칙을 말하려면 가이드 수치 없이 일반 원칙으로만 말하라.
  초반 기물·빌드업 경로·전환 시점은 데이터에 없으니 지어내지 마라. 핵심 기물 미보유·유동 기물 선택·레벨은 가이드 수치와 비교로 말하라.
- 덱 가이드·상위 랭커 줄의 패치 표기(예: "18.4 기준", "이 경기는 18.5 추정, 패치 다름")를 지켜라. 패치가 다르면 그 수치가 이 경기 패치에서도
  같다고 말하지 마라.
- 상위 랭커 운영은 챌린저 상위 랭커가 같은 덱을 탄 최근 판의 최종 보드 집계다(표본이 작다). 내 보드·래더 가이드와 '비교'로만 말하고,
  "고수는 이렇게 한다"를 단정하거나 표본 수 없이 인용하지 마라. 아이템은 채용률이지 조합 순서가 아니다.
- 패치 변경점은 공식 패치 노트의 변경 수치(이전 ⇒ 이후)다. 수치를 그대로 인용하고, '상향/하향'으로 단정하지 마라.
  경기 결과의 원인으로 쓰지 마라. '경기 이후 패치' 변경은 다음 판 조언의 근거로만 써라.
- 빈집 메타 덱 후보는 로비 최종 보드 기준의 사후 비교다. "~를 갔어야 했다"고 단정하지 말고 "같은 재료로 ~도 가능했다"는
  후보로만 언급하라. 피봇 시점·상점 기물 공급은 데이터에 없으니 언제 갈아탔어야 하는지 말하지 마라.
  후보 줄이 없으면 빈집 덱을 추천하지 마라(코드가 조건을 만족하는 덱을 찾지 못한 것이다).

★★★ 라운드 타이밍 단정 금지 ★★★
- 제공된 데이터에는 라운드별 레벨업·리롤·골드 곡선이 없다(최종 보드·최종 레벨·탈락 라운드만 있다).
- "언제 레벨업/리롤했다", "레벨에 쓰지 않아서 졌다"처럼 시점이나 원인을 단정하지 마라.
  최종 레벨·탈락 라운드로 추정한 경우 "최종 상태 기준으로 보면"이라고 밝혀라.
- 잔여 골드로 경제를 평가하지 마라. 탈락 직전엔 누구나 리롤로 골드를 다 쓰므로 "골드를 남겼다/안 썼다"는 근거가 되지 않는다.

[문체]
- 강의하듯 "~입니다/~합니다" 경어체. 비유는 리포트당 1개까지. 이모지 금지.
- 같은 문장 구조 반복 금지. overview는 서로 다른 축 3개를 한 줄씩 요약.

반드시 아래 JSON 형식으로만 응답하라(마크다운 코드블록 허용):
{
  "metaScore": <[코드 산출 점수]의 metaScore 정수>,
  "metaTier": "<[코드 산출 점수]의 metaTier>",
  "playstyle": "성향 한 줄",
  "overview": "서로 다른 축 3개를 각각 한 문장으로 요약 (3문장)",
  "lecture": {
    "topic": "<[이번 강의 주제] 그대로>",
    "concept": "원리 한 문장",
    "moments": [
      { "title": "<장면 제목>", "fact": "<장면 사실 줄 그대로>", "why": "이 판에서 왜 문제였나", "fix": "다음 판 행동" }
    ],
    "drill": "다음 3판 최종 보드 숫자 목표 1개",
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
  "actions": ["다음 판 행동 1", "다음 판 행동 2", "다음 판 행동 3"]
}`

/** 짧은 인트로(핵심 진단) 전용 시스템 지시 — 전체 리포트와 별도 호출 */
const INTRO_SYSTEM_INSTRUCTION = `너는 TFT 아카데미 코치다. 주어진 사실만 근거로 2~3문장의 "핵심 진단"을 쓴다.
- 경어체, 이모지/마크다운/JSON 금지
- 수치를 최소 2개 직접 인용
- 제공된 기물/시너지 이름만 사용하고 새로운 이름·6코스트를 만들지 마라
- 표본이 부족하면 첫 문장에 "표본 부족"을 명시하고 단정하지 마라
- 점수/등급은 코드 값을 그대로 쓴다`

/**
 * DeepSeek API 호출 (DEEPSEEK_MODEL, JSON 모드)
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
      body: deepSeekBody(SYSTEM_INSTRUCTION, prompt, DEEPSEEK_MAX_TOKENS, { response_format: { type: 'json_object' } }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw deepSeekHttpError('DeepSeek API 오류', response.status, await response.text())
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
      usage?: DeepSeekUsage
    }

    recordDeepSeekUsage(data.usage)

    // max_tokens 에 걸려 잘린 JSON 은 파싱이 깨지거나 일부 필드가 빠진다 → 실패로 보고 다음 제공자로 넘긴다.
    const finishReason = data.choices?.[0]?.finish_reason
    if (finishReason === 'length') {
      incrMetric('llm.truncated.deepseek')
      throw new Error(`DeepSeek 응답이 max_tokens 에서 잘림 (completion_tokens=${data.usage?.completion_tokens ?? '?'})`)
    }

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

/* ───────────── D+C: 짧은 인트로 토큰 스트리밍 ───────────── */

interface IntroFacts {
  facts: string
  fallback: string
}

/** 인트로 프롬프트에 넣을 압축 사실 + LLM 실패 시 결정론적 문장 */
function buildIntroFacts(match: SlimMatchData, mode: 'single' | 'multi'): IntroFacts {
  const scoring = computeScoreBreakdown([match])
  const plan = buildCoachingPlan([match])
  const axis = plan.axes.find((a) => a.key === plan.focus)
  const twoPlus = match.units.filter((u) => (u.tier || 1) >= 2).length
  const three = match.units.filter((u) => u.tier === 3).length
  const traits = (match.traits || []).filter((t) => (t.count || 0) >= 2).slice(0, 3)
  const early = isEarlyGame(match)
  const reason = lowSampleReason(match)
  const others = (match.lobbyParticipants || [])
    .filter((p) => !p.isUser)
    .sort((a, b) => a.placement - b.placement)
    .slice(0, 3)
  const lobby =
    mode === 'single' && others.length
      ? others.map((p) => `${p.placement}등 Lv.${p.level}`).join(' · ')
      : ''

  const facts = [
    `- 경기: ${match.placement}등 · Lv.${match.level} · ${match.lastRound} 종료`,
    `- 보드: 유닛 ${match.units.length} · 2성+ ${twoPlus} · 3성 ${three} · 활성 시너지 ${match.traits.length}${
      traits.length ? ` (${traits.map((t) => `${t.name} ${t.count}`).join(', ')})` : ''
    }`,
    `- 표본: ${early ? `표본 부족 (${reason})` : '정상'}`,
    scoring
      ? `- 코드 점수: ${scoring.total}/100 ${scoring.tier} (${scoring.components
          .map((c) => `${c.label} ${c.score}`)
          .join(' · ')})`
      : '- 코드 점수: 산출 불가',
    `- 6축 최저: ${axis?.label ?? '-'} ${axis?.score ?? '-'}/100`,
    `- 이번 강의 주제: ${plan.topic}`,
    lobby ? `- 로비 상위: ${lobby} (내 Lv.${match.level})` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const fallback = early
    ? `표본 부족: ${reason}. ${match.placement}등 · Lv.${match.level} · ${match.lastRound} 종료라 단정은 이릅니다.`
    : `${match.placement}등 · Lv.${match.level} · ${match.lastRound} 종료. 코드 점수 ${
        scoring?.total ?? '-'
      }점(${scoring?.tier ?? '-'}), 가장 약한 축은 ${axis?.label ?? '-'} ${axis?.score ?? '-'}점입니다.`

  return { facts, fallback }
}

/** DeepSeek 스트리밍 호출 — OpenAI 호환 SSE 의 delta.content 를 콜백으로 전달한다. */
async function callDeepSeekStream(
  prompt: string,
  system: string,
  onDelta: ((text: string) => void) | undefined,
  maxTokens: number,
  signal?: AbortSignal
): Promise<{ text: string; usage: DeepSeekUsage; finishReason: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: deepSeekBody(system, prompt, maxTokens, { stream: true, stream_options: { include_usage: true } }),
      signal: controller.signal,
    })

    if (!response.ok || !response.body) {
      throw deepSeekHttpError('DeepSeek stream 오류', response.status, await response.text())
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let usage: DeepSeekUsage = {}
    let finishReason = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r/g, '')

      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const chunk = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')

        for (const line of chunk.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (!data || data === '[DONE]') continue
          try {
            const obj = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
              usage?: DeepSeekUsage
            }
            const delta = obj.choices?.[0]?.delta?.content
            if (typeof delta === 'string' && delta) {
              text += delta
              try {
                onDelta?.(delta)
              } catch {
                /* 클라이언트가 끊겨도 스트림 읽기는 계속한다 */
              }
            }
            const reason = obj.choices?.[0]?.finish_reason
            if (reason) finishReason = reason
            if (obj.usage) usage = obj.usage
          } catch {
            /* 형식이 깨진 청크는 무시 */
          }
        }
      }
    }

    return { text, usage, finishReason }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export interface CoachIntroParams {
  match: SlimMatchData
  mode: 'single' | 'multi'
  onDelta?: (text: string) => void
  signal?: AbortSignal
}

/**
 * 전체 리포트 생성과 **병렬로** 실행되는 짧은 인트로(2~3문장).
 * DeepSeek 토큰 스트림 → Gemini 단일 응답 → 결정론적 폴백 순으로 동작한다.
 * 실패해도 전체 리포트에는 영향을 주지 않는다.
 */
export async function generateCoachIntro({
  match,
  mode,
  onDelta,
  signal,
}: CoachIntroParams): Promise<string> {
  const { facts, fallback } = buildIntroFacts(match, mode)
  const prompt = `아래 사실만 근거로 TFT 코치의 "핵심 진단"을 2~3문장(150자 이내)으로 써라.

[사실]
${facts}

[규칙]
- 경어체, 이모지/마크다운/JSON 금지
- 수치를 최소 2개 직접 인용
- 제공된 기물/시너지 이름만 사용, 새로운 이름·6코스트 금지
- 표본 부족이면 첫 문장에 "표본 부족"을 명시하고 단정하지 마라
- 점수/등급은 코드 값을 그대로 쓴다`

  if (signal?.aborted) return ''

  // 짧게 캐시(6h): 전체 리포트 캐시가 만료/무효화돼도 인트로는 재사용한다.
  const cacheKey = match.matchId ? `intro:${match.matchId}:${mode}:${INTRO_PROMPT_VERSION}:${SCORING_VERSION}` : ''
  if (cacheKey) {
    try {
      const cached = await cacheGetWithSource<string>(cacheKey)
      if (cached?.value) {
        try {
          onDelta?.(cached.value)
        } catch {
          /* ignore */
        }
        return cached.value
      }
    } catch {
      /* 캐시 장애는 무시하고 생성으로 진행 */
    }
  }

  const budget = await getLlmBudgetStatus()
  if (budget.exceeded) {
    try {
      onDelta?.(fallback)
    } catch {
      /* ignore */
    }
    return fallback
  }

  let emitted = ''
  let pending = ''
  /** 문장 단위(또는 48자)로 묶어 UI 업데이트 횟수를 줄인다. */
  const flush = () => {
    if (!pending) return
    const chunk = pending
    pending = ''
    emitted += chunk
    try {
      onDelta?.(chunk)
    } catch {
      /* ignore */
    }
  }

  if (DEEPSEEK_API_KEY) {
    try {
      const result = await callDeepSeekStream(
        prompt,
        INTRO_SYSTEM_INSTRUCTION,
        (delta) => {
          pending += delta
          // 첫 청크는 16자에서 바로 내보내 체감 지연을 줄이고, 이후에는 문장 단위/48자로 묶는다.
          const threshold = emitted ? 48 : 16
          if (/[.!?。！？]\s*$/.test(pending) || pending.includes('\n') || pending.length >= threshold) flush()
        },
        240,
        signal
      )
      flush()
      const text = result.text.trim()
      // 잘린 인트로는 이미 화면에 흘려보냈으므로 그대로 쓰되, 캐시에는 남기지 않는다.
      const truncated = result.finishReason === 'length'
      if (truncated) incrMetric('llm.truncated.deepseek_intro')
      if (text) {
        recordDeepSeekUsage(result.usage, Math.ceil(prompt.length / 3), Math.ceil(text.length / 2))
        if (cacheKey && !truncated) void cacheSet(cacheKey, text, CACHE_TTL.INTRO).catch(() => {})
        return text
      }
    } catch (err) {
      flush()
      logEvent('warn', 'llm_intro_failed', { provider: 'deepseek', ...errorFields(err) })
      if (emitted.trim()) return emitted.trim()
    }
  }

  if (GEMINI_API_KEY && !signal?.aborted) {
    try {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
      const model = genAI.getGenerativeModel({
        model: GEMINI_MODEL,
        systemInstruction: INTRO_SYSTEM_INSTRUCTION,
        generationConfig: { temperature: 0.2, maxOutputTokens: 240 },
      })
      const result = await withTimeout(model.generateContent(prompt), LLM_TIMEOUT_MS, 'Gemini intro')
      const text = result.response.text().trim()
      if (text) {
        const usage = result.response.usageMetadata as
          | { promptTokenCount?: number; candidatesTokenCount?: number }
          | undefined
        recordLlmUsage(
          'gemini',
          GEMINI_MODEL,
          usage?.promptTokenCount || Math.ceil(prompt.length / 3),
          usage?.candidatesTokenCount || Math.ceil(text.length / 2),
          GEMINI_PRICE_INPUT_PER_M,
          GEMINI_PRICE_OUTPUT_PER_M
        )
        try {
          onDelta?.(text)
        } catch {
          /* ignore */
        }
        if (cacheKey) void cacheSet(cacheKey, text, CACHE_TTL.INTRO).catch(() => {})
        return text
      }
    } catch (err) {
      logEvent('warn', 'llm_intro_failed', { provider: 'gemini', ...errorFields(err) })
    }
  }

  flush()
  if (signal?.aborted) return emitted.trim()
  try {
    if (!emitted) onDelta?.(fallback)
  } catch {
    /* ignore */
  }
  return emitted.trim() || fallback
}

/**
 * 프롬프트에 주입할 [메타 실측 통계] 블록 + 출처 메타데이터.
 * LLM이 인용할 수 있는 수치의 화이트리스트 역할을 한다.
 *
 * 메타 대시보드와 같은 집계(/api/tft/stats 기본 필터: 최신 패치 · 마스터+ · 최근 7일)를 쓴다.
 * DB 집계를 쓸 수 없으면 getStats 가 lib/metaStats.json 으로 폴백하고, 출처·패치가 그에 맞게 찍힌다.
 * 표본 하한(기물·시너지·아이템 30, 기물×아이템 20) 미만은 넣지 않는다.
 */
async function buildMetaFacts(): Promise<{ text: string; provenance: FeedbackProvenance }> {
  const info = getMetaSectionInfo()
  const [units, traits, items, combos] = await Promise.all(
    (['unit', 'trait', 'item', 'unit_item'] as const).map((t) => getStats(t, DEFAULT_FILTER))
  )
  const fromDb = units.source === 'db' && units.filter != null
  const provenance: FeedbackProvenance = fromDb
    ? {
        patch: units.filter?.patch,
        source: 'riot-ranked-db',
        generatedAt: new Date().toISOString(),
        sample: false,
        filter: filterLabel({ tier: DEFAULT_FILTER.tier, days: DEFAULT_FILTER.days }),
        matches: units.totalMatches,
        championStats: 0,
        itemStats: 0,
        comboStats: 0,
      }
    : {
        patch: info.patch,
        source: info.source,
        generatedAt: info.generatedAt,
        sample: info.sample,
        championStats: 0,
        itemStats: 0,
        comboStats: 0,
      }

  const enough = (r: StatRow) => !r.lowSample
  const top = (res: typeof units, n: number) => res.rows.filter(enough).slice(0, n)
  const champRows = top(units, 12)
  const traitRows = top(traits, 10)
  const itemRows = top(items, 10)
  const comboRows = top(combos, 8)

  if ((!fromDb && !info.hasMeta) || (!champRows.length && !traitRows.length && !itemRows.length)) {
    return {
      text: '[메타 실측 통계]\n※ 수집된 메타 통계가 없다. 기물/아이템/시너지의 평균등수·픽률을 인용하지 말고 "메타 통계 미제공"으로 명시하라.',
      provenance,
    }
  }
  provenance.championStats = champRows.length
  provenance.itemStats = itemRows.length
  provenance.comboStats = comboRows.length

  const fmt = (x: number) => (Math.round(x * 100) / 100).toFixed(2)
  const label = (r: StatRow) => ('champName' in r ? `${r.champName} × ${r.itemName}` : r.name)
  const list = (rows: StatRow[]) => rows.map((r) => `${label(r)} ${fmt(r.avgPlacement)} (n=${r.sampleSize})`).join(', ')
  const header = fromDb
    ? `- 패치: ${provenance.patch ?? '?'} · 출처: KR 랭크 판 집계 · 범위: ${provenance.filter} · 판 수: ${provenance.matches ?? '?'}`
    : `- 패치: ${info.patch ?? '?'} · 출처: ${info.source ?? '?'} · 수집일: ${(info.generatedAt || '').slice(0, 10) || '?'}${
        info.sample ? ' · (샘플/검증 전)' : ''
      }`
  const lines = [
    '[메타 실측 통계 — 아래 수치만 인용 가능]',
    header,
    `- 기물 TOP${champRows.length} (평균등수 · 표본): ${list(champRows)}`,
    `- 시너지 TOP${traitRows.length}: ${list(traitRows)}`,
    `- 아이템 TOP${itemRows.length}: ${list(itemRows)}`,
    `- BIS 조합 TOP${comboRows.length}: ${list(comboRows)}`,
    '※ 위 목록에 없는 기물/아이템/시너지의 수치는 인용 금지. 평균등수 오차는 약 ±2.29/√n 이므로 차이가 0.1 미만이면 우열을 단정하지 마라.',
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
  const matchSerialized = serializeMatchesForLLM(matches, { includeLobby: mode === 'single' })
  const { text: metaFacts, provenance } = await buildMetaFacts()
  // 비교 사실: 같은 기본 필터의 기물×아이템(BIS)·메타 덱 (메모 캐시라 buildMetaFacts 와 중복 호출 비용 없음)
  const [comboStats, deckStats] = await Promise.all([
    getStats('unit_item', DEFAULT_FILTER),
    // 덱 가이드(guide)는 AI 프롬프트에서만 쓴다 — 공개 응답에는 포함하지 않는다
    getDecks({ patch: DEFAULT_FILTER.patch, tier: DEFAULT_FILTER.tier }, { withGuide: true }),
  ])
  const comparisonFacts = buildComparisonFacts({
    matches,
    mode,
    combos: comboStats.rows.filter((r): r is StatRow & ComboFact => 'champKey' in r),
    decks: deckStats.decks,
  })
  const scoring = computeScoreBreakdown(matches)
  const scoreFacts = scoring
    ? [
        '[코드 산출 점수 — 이 값을 그대로 사용하라]',
        `- metaScore: ${scoring.total} · metaTier: ${scoring.tier} (산출식 ${scoring.version}, ${scoring.matches}경기 평균)`,
        ...scoring.components.map(
          (c) =>
            `- ${c.label}: ${c.score}/100 × ${Math.round(c.weight * 100)}% = +${c.contribution} (${c.detail})`
        ),
        ...(scoring.sampleWarning ? [`- 표본: ${scoring.sampleWarning}`] : []),
        '※ metaScore/metaTier 는 반드시 위 코드 산출값을 그대로 반환하라. 점수 해설은 위 구성요소 수치를 근거로 작성하라.',
      ].join('\n')
    : '[코드 산출 점수]\n※ 산출 불가 (경기 데이터 없음)'

  // 강의 계획: 가장 약한 축을 코드가 결정 (LLM이 주제를 바꾸지 못하게 고정)
  const plan = buildCoachingPlan(matches)
  // 핵심 장면: 최종 보드에서 코드가 콕 집은 사실 (단일 경기만). 강의 본문(moments)은 이 장면들을 해설한다.
  const moments = mode === 'single' && matches[0] && !plan.lowSample ? keyMoments(matches[0]) : []
  const momentFacts = moments.length
    ? [
        '[핵심 장면 — 코드 산출, 강의 moments 는 이 순서대로 해설하라. 사실 줄은 그대로 옮겨라]',
        ...moments.map((x, i) => `${i + 1}. ${x.title}: ${x.fact}`),
      ].join('\n')
    : '[핵심 장면]\n※ 코드가 콕 집은 장면이 없다. [6축 진단] 초점 축 지표로 장면 1개를 만들어라.'
  const planFacts = [
    '[이번 강의 주제 — 코드가 결정, 변경 금지]',
    `- 주제: ${plan.topic}`,
    `- 초점 축: ${plan.focusLabel} (${plan.focus})`,
    `- 기본 개념 문장(참고): ${plan.drillTemplate}`,
    '',
    '[6축 진단 — 코드 산출 점수, 그대로 사용]',
    ...plan.axes.map((a) => {
      const effects = (a.effects || [])
        .filter((e) => e.points !== 0)
        .map((e) => `${e.label} ${e.points > 0 ? '+' : ''}${e.points}`)
        .join(', ')
      const metrics = (a.metrics || []).map((m) => `${m.label} ${m.value}${m.unit ?? ''}`).join(', ')
      return [
        `- ${a.key}(${a.label}): ${a.score}/100 · ${a.detail}`,
        metrics ? `  · 지표: ${metrics}` : '',
        effects ? `  · 점수 구성: ${effects}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    }),
    '※ axes 배열에는 위 6개 key 를 모두 넣고, score/점수는 위 코드 값을 그대로 인용하라.',
    '※ 초점 축이 contest 가 아니라면 로비 경합은 axes 의 contest 한 줄로만 다루고, lecture 주제로 삼지 마라.',
    ...(plan.sampleWarning ? [`- 표본: ${plan.sampleWarning}`] : []),
  ].join('\n')
  // 경합(기물 겹침)은 코드가 contest 를 강의 주제로 고른 경우에만 해부 대상이다. 예전엔 단일 경기면 항상 겹침을 해부하라고 해서
  // 레벨 9~10 밸류 덱처럼 5코스트를 모두가 나눠 쓰는 판에도 "겹침 타령"이 나왔다.
  const modeContext = mode === 'single'
    ? plan.focus === 'contest'
      ? '분석 모드: [단일 경기 정밀 분석] - 해당 판 로비 8명 중 경쟁자들과의 기물 겹침, 대깨/유연성 판단 및 구체적 승패 요인을 데이터 근거로 해부하라. 한 판뿐이므로 "평균"이 아니라 "이 경기"로 서술하라.'
      : `분석 모드: [단일 경기 정밀 분석] - 해당 판 로비 8명과 비교해 이번 강의 주제(${plan.focusLabel}) 중심으로 구체적 승패 요인을 데이터 근거로 해부하라. 기물 겹침은 contest 축 한 줄로만 다룬다. 한 판뿐이므로 "평균"이 아니라 "이 경기"로 서술하라.`
    : `분석 모드: [최근 ${matches.length}경기 종합 분석] - 여러 판의 덱 다양성, 기물 겹침 시 대처 패턴, 고착된 습관을 데이터 근거로 종합 진단하라.`

  const qualityFacts = [
    '[표본 품질 — 코드 판정]',
    ...(plan.lowSample
      ? [
          `- ${plan.sampleWarning ?? '표본 부족'}`,
          '※ 초반 종료 표본뿐이다. 점수/등급을 단정하지 말고 리포트 첫 문장에 "표본 부족"을 명시하라.',
        ]
      : [
          `- 집계 경기 ${plan.matchCount}건${plan.excludedMatches ? ` (초반 종료 ${plan.excludedMatches}건 제외)` : ''}`,
        ]),
  ].join('\n')

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
${comparisonFacts ? `
${comparisonFacts}
` : ''}
${momentFacts}

${scoreFacts}

${planFacts}

${qualityFacts}

   모든 서술은 위 데이터의 수치(골드, 레벨, 탈락 라운드, 2성 수, 아이템 수, 로비 수렴도)를 직접 인용해 작성하라.

위 유저의 경기 데이터를 접지(Grounding) 원칙에 따라 분석하되, [이번 강의 주제]를 중심으로 "원리 → 데이터 근거 → 더 나은 선택 → 연습 과제"가 이어지는 강의형 JSON 리포트를 작성하라.
6축(경제·아이템·템포·완성도·시너지·유연성)을 모두 진단하되, 주제가 아닌 축은 한 줄로만 다뤄 분량을 분산시켜라.`

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
    const earlyReasons = [...new Set(matches.filter(isEarlyGame).map(lowSampleReason).filter(Boolean))]
    const lecture = normalizeLecture(fb.lecture, planWithVerdicts, fb, moments)
    // actions 가 빠지면 강의 체크리스트 앞 3개로 채운다 (화면의 "핵심 교정"·"개선 포인트" 자리)
    const actions = fb.actions?.length ? fb.actions.slice(0, 3) : lecture.checklist.slice(0, 3)
    return {
      ...fb,
      actions,
      mode,
      metaScore: scoring ? scoring.total : fb.metaScore,
      metaTier: scoring ? scoring.tier : fb.metaTier,
      isFallback,
      provenance,
      scoreBreakdown: scoring ?? undefined,
      plan: planWithVerdicts,
      lecture,
      grounding: {
        ...validateFeedbackGrounding(fb, prompt),
        // 정규화된 강의(코드가 채운 부분 포함)·축 한 줄까지 최종 보드와 대조
        entityErrors: validateEntityFacts(feedbackTexts({ ...fb, lecture, actions }, axisVerdicts), matches),
      },
      dataQuality: {
        lowSample: Boolean(plan.lowSample),
        reason: earlyReasons.length ? earlyReasons.join(' · ') : undefined,
        excludedMatches: plan.excludedMatches,
      },
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
    return finalize(generateFallbackMetaFeedback(gameName, matches, mode), true)
  }

  // 1. DeepSeek API 키가 있는 경우 우선 사용 (LLM_PROVIDER=gemini 면 건너뜀)
  if (DEEPSEEK_API_KEY && LLM_PROVIDER !== 'gemini') {
    try {
      const text = await callDeepSeek(prompt)
      const parsed = parseJsonFeedback(text)
      if (parsed) return finalize(parsed.feedback, false, parsed.axisVerdicts)
    } catch (err) {
      incrMetric('llm.fallback.deepseek_error')
      logEvent('warn', 'llm_provider_failed', { provider: 'deepseek', model: DEEPSEEK_MODEL, ...errorFields(err) })
    }
  }

  // 2. Gemini API 키가 있는 경우 사용 (GEMINI_MODEL 로 모델 지정, LLM_PROVIDER=deepseek 면 건너뜀)
  if (GEMINI_API_KEY && LLM_PROVIDER !== 'deepseek') {
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
  return finalize(generateFallbackMetaFeedback(gameName, matches, mode), true)
}

/**
 * 강의 본문 정규화 (LLM 누락 시 코드가 채움)
 */
const AXIS_KEYS: CoachingAxisKey[] = ['economy', 'itemization', 'tempo', 'completion', 'synergy', 'contest']

function defaultChecklist(plan: CoachingPlan): string[] {
  return [
    `${plan.focusLabel} 지표를 매 라운드 시작 전에 한 번 확인`,
    '결정 전 5초: 지금 쓰는 골드/아이템이 3라운드 뒤에도 유효한가',
    '판 종료 후 최종 레벨·탈락 라운드 기록해 추세 확인',
  ]
}

/**
 * 핵심 장면: 제목·사실은 코드 값을 그대로 쓰고(LLM 이 수치를 바꿔도 덮어씀), why·fix 만 LLM 것을 쓴다.
 * 코드 장면이 없으면(종합 분석 등) LLM 이 초점 축으로 만든 장면을 그대로 둔다.
 */
function mergeMoments(code: KeyMoment[], llm: LectureMoment[] | undefined): LectureMoment[] {
  const fromLlm = (llm || []).filter((x) => x.why.trim() || x.fix.trim())
  if (!code.length) return fromLlm.slice(0, 3)
  return code.map((c, i) => {
    const hit = fromLlm.find((x) => x.title.trim() === c.title) ?? fromLlm[i]
    return { title: c.title, fact: c.fact, why: hit?.why.trim() || '', fix: hit?.fix.trim() || '' }
  })
}

function normalizeLecture(
  lecture: CoachLecture | undefined,
  plan: CoachingPlan,
  fb: MetaCoachFeedback,
  codeMoments: KeyMoment[] = []
): CoachLecture {
  const focus = plan.axes.find((a) => a.key === plan.focus)
  const moments = mergeMoments(codeMoments, lecture?.moments)
  const checklist = (lecture?.checklist || []).map((s) => String(s).trim()).filter(Boolean)
  const merged = checklist.length >= 3 ? checklist : [...checklist, ...defaultChecklist(plan)]
  return {
    topic: lecture?.topic?.trim() || plan.topic,
    concept: lecture?.concept?.trim() || plan.drillTemplate,
    why:
      lecture?.why?.trim() ||
      `이 축의 점수는 ${focus?.score ?? 0}/100 입니다. ${focus?.detail ?? ''} — 이 지표는 보드 강도와 직결되므로 다음 판에서 가장 먼저 손봐야 할 지점입니다.`,
    evidence: lecture?.evidence?.trim() || moments.map((x) => x.fact).join(' / ') || fb.overview || focus?.detail || '',
    alternative:
      lecture?.alternative?.trim() ||
      moments.find((x) => x.fix)?.fix ||
      fb.actions?.[0] ||
      '다음 판에는 같은 라운드에서 한 번 더 멈춰 판단해 보세요.',
    drill:
      lecture?.drill?.trim() ||
      `다음 3판은 ${plan.focusLabel} 하나만 의식하세요. ${plan.drillTemplate}`,
    checklist: [...new Set(merged)].slice(0, 5),
    ...(moments.length ? { moments } : {}),
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
      const playstyle = typeof obj.playstyle === 'string' ? obj.playstyle.trim() : ''
      const strings = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : []
      // v2 actions (모델이 v1 형식으로 답하면 improvements 를 행동으로 쓴다)
      const actions = strings(obj.actions).length ? strings(obj.actions) : strings(obj.improvements)
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
            moments: Array.isArray(rawLecture.moments)
              ? rawLecture.moments
                  .filter((x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
                  .map((x: Record<string, unknown>) => ({
                    title: typeof x.title === 'string' ? x.title : '',
                    fact: typeof x.fact === 'string' ? x.fact : '',
                    why: typeof x.why === 'string' ? x.why : '',
                    fix: typeof x.fix === 'string' ? x.fix : '',
                  }))
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
        playstyle,
        overview: obj.overview,
        // 비면 finalize 가 강의 체크리스트로 채운다
        actions: actions.length ? actions : undefined,
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

const calculateTier = scoreToTier

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

  return {
    mode,
    metaScore: score,
    metaTier: tier,
    playstyle,
    overview: mode === 'single'
      ? `단일 경기 분석 결과: ${latest.placement}위로 마감하였으며, 메타 덱의 기본 시너지는 구성되었으나 로비 내 경쟁 구도 대응 및 핵심 캐리 아이템 집중도에서 전력 누수가 발생했습니다.`
      : `최근 ${matches.length}경기 종합 분석 결과: 평균 ${avgPlacement.toFixed(1)}등을 기록 중이며, 덱 풀의 다양성과 기물 겹침 상황에서의 유연한 피봇 판단력이 순방의 핵심 분기점으로 나타났습니다.`,
    actions: [
      '로비 정찰 기반의 피봇 판단: 2-5 및 3-2 라운드에 타 유저 필드를 확인하고 2명 이상 겹쳤다면 대체 딜러/시너지를 검토합니다.',
      '메인 캐리 기물 아이템 집중: 서브 딜러에게 템을 나누지 말고, 메인 캐리 1명에게 완제품 3개를 몰아준 뒤 메인 탱커 방템을 구축합니다.',
      '체력 기준 리롤 전환: 체력이 35 이하로 떨어지는 4~5스테이지에서는 이자보다 필드 파워를 우선해 20~30골드까지 소모합니다.',
    ],
  }
}

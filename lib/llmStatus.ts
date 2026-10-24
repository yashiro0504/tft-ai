/**
 * LLM 연동 상태 (인스턴스 메모리). /api/health 가 lib/llm.ts 전체를 import 하지 않게 따로 둔다.
 *
 * 모델 ID·thinking 파라미터가 API 스펙과 맞지 않으면 모든 호출이 4xx 로 실패하고
 * Gemini → 결정론적 폴백으로 조용히 떨어지므로, 마지막 HTTP 오류를 헬스 체크에 드러낸다.
 */

export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash'
export const DEEPSEEK_THINKING: 'enabled' | 'disabled' = process.env.DEEPSEEK_THINKING === 'enabled' ? 'enabled' : 'disabled'

export interface LlmHttpError {
  provider: 'deepseek'
  model: string
  status: number
  /** 응답 본문 앞부분 (키·프롬프트는 포함되지 않는다) */
  body: string
  at: string
}

let lastHttpError: LlmHttpError | null = null

/**
 * DeepSeek 은 선불 충전이라 잔액이 바닥나면 모든 호출이 402(Insufficient Balance)로 실패한다.
 * 그때마다 왕복하며 응답을 늦추지 않도록 이 인스턴스에서 잠시 DeepSeek 호출을 건너뛴다.
 * 충전 후에는 길어야 이 시간 안에 자동으로 다시 시도한다.
 */
const BALANCE_COOLDOWN_MS = 5 * 60_000
let balanceBlockedUntil = 0

export function isInsufficientBalance(status: number): boolean {
  return status === 402
}

export function recordLlmHttpError(e: Omit<LlmHttpError, 'at'>): void {
  lastHttpError = { ...e, at: new Date().toISOString() }
  if (isInsufficientBalance(e.status)) balanceBlockedUntil = Date.now() + BALANCE_COOLDOWN_MS
}

/** 성공 응답을 받으면 지난 오류(충전 전 402 등)를 지워 헬스/ops-check 가 계속 경고하지 않게 한다 */
export function recordLlmSuccess(): void {
  lastHttpError = null
  balanceBlockedUntil = 0
}

/** 최근 402 를 받아 DeepSeek 호출을 건너뛰는 중인지 */
export function deepSeekBalanceBlocked(): boolean {
  return Date.now() < balanceBlockedUntil
}

export function lastLlmHttpError(): LlmHttpError | null {
  return lastHttpError
}

/**
 * 헬스 응답용. 공개(토큰 없는) 응답에는 provider 오류 본문(요청 ID·조직 정보 등이 섞일 수 있음)을 빼고,
 * HEALTH_TOKEN 으로 인증된 응답에만 넣는다. 본문은 로그(llm_http_error)에 항상 남는다.
 */
export function redactLlmError(e: LlmHttpError | null, { includeBody }: { includeBody: boolean }): Partial<LlmHttpError> | null {
  if (!e) return null
  if (includeBody) return { ...e }
  return { provider: e.provider, model: e.model, status: e.status, at: e.at }
}

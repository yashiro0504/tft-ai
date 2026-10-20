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

export function recordLlmHttpError(e: Omit<LlmHttpError, 'at'>): void {
  lastHttpError = { ...e, at: new Date().toISOString() }
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

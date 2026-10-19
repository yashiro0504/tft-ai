'use client'

import type { TftMatchAnalysisResponse } from './types'

/**
 * 경기 1건 분석 SSE 클라이언트.
 *
 * - `POST /api/tft/match/stream` 을 호출해 `stage`(진행) / `result`(결과) / `error` 이벤트를 읽는다.
 * - 스트리밍을 지원하지 않는 배포(404/405)나 본문이 없는 응답은
 *   `AnalysisStreamUnavailableError` 로 알려 호출부가 기존 JSON 경로로 폴백하게 한다.
 * - 쿼터는 서버에서 스트림 개시 전에 이미 소모되므로, **중간 실패 시 재요청하지 않는다**
 *   (재요청하면 쿼터가 두 번 소모된다).
 */

export class AnalysisStreamUnavailableError extends Error {
  constructor(message = '스트리밍을 사용할 수 없습니다.') {
    super(message)
    this.name = 'AnalysisStreamUnavailableError'
  }
}

interface SseEvent {
  event: string
  data: string
}

function parseSseChunk(chunk: string): SseEvent | null {
  let event = 'message'
  const dataLines: string[] = []

  for (const line of chunk.split('\n')) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }

  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}

export interface AnalyzeMatchStreamOptions {
  body: Record<string, unknown>
  /** 진행 단계 문구 콜백 */
  onStage?: (message: string) => void
  /** 인트로 토큰 델타 (도착하는 순서대로 누적하면 된다) */
  onDelta?: (text: string) => void
  signal?: AbortSignal
}

/**
 * 스트림으로 분석을 요청한다.
 * @throws AnalysisStreamUnavailableError 스트리밍 미지원 → JSON 폴백 필요
 * @throws Error 서버가 보낸 오류 메시지
 */
export async function analyzeMatchStream({
  body,
  onStage,
  onDelta,
  signal,
}: AnalyzeMatchStreamOptions): Promise<TftMatchAnalysisResponse> {
  const res = await fetch('/api/tft/match/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal,
  })

  // 스트리밍 엔드포인트가 없는 배포(구버전) → JSON 경로로 폴백
  if (res.status === 404 || res.status === 405 || !res.body) {
    throw new AnalysisStreamUnavailableError()
  }

  if (!res.ok) {
    let message = '이 경기 분석 중 오류가 발생했습니다.'
    try {
      const data = (await res.json()) as { error?: string }
      if (data?.error) message = data.error
    } catch {
      /* 본문이 JSON 이 아닌 경우 기본 메시지 유지 */
    }
    throw new Error(message)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: TftMatchAnalysisResponse | null = null
  let resultReceived = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const chunk = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')

      const parsed = parseSseChunk(chunk)
      if (!parsed) continue

      if (parsed.event === 'stage') {
        try {
          const payload = JSON.parse(parsed.data) as { message?: string }
          if (payload?.message) onStage?.(payload.message)
        } catch {
          /* 형식이 깨진 stage 는 무시 */
        }
      } else if (parsed.event === 'delta') {
        if (resultReceived) continue
        try {
          const payload = JSON.parse(parsed.data) as { text?: string }
          if (typeof payload?.text === 'string' && payload.text) {
            try {
              onDelta?.(payload.text)
            } catch {
              /* UI 콜백 오류는 스트림을 깨지 않는다 */
            }
          }
        } catch {
          /* 형식이 깨진 delta 는 무시 */
        }
      } else if (parsed.event === 'result') {
        resultReceived = true
        try {
          result = JSON.parse(parsed.data) as TftMatchAnalysisResponse
        } catch {
          throw new Error('분석 결과를 해석하지 못했습니다.')
        }
      } else if (parsed.event === 'error') {
        let message = '이 경기 분석 중 오류가 발생했습니다.'
        try {
          const payload = JSON.parse(parsed.data) as { error?: string }
          if (payload?.error) message = payload.error
        } catch {
          /* 형식이 깨진 error 는 기본 메시지 사용 */
        }
        throw new Error(message)
      }
    }
  }

  if (!result) throw new Error('분석이 중단되었습니다. 다시 시도해 주세요.')
  return result
}

/** 스트리밍을 쓸 수 없을 때의 기존 JSON 경로. */
export async function analyzeMatchJson({
  body,
  signal,
}: {
  body: Record<string, unknown>
  signal?: AbortSignal
}): Promise<TftMatchAnalysisResponse> {
  const res = await fetch('/api/tft/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal,
  })

  const data = (await res.json()) as TftMatchAnalysisResponse
  if (!res.ok || !data.success || !data.feedback) {
    throw new Error(data.error || '이 경기 분석 중 오류가 발생했습니다.')
  }
  return data
}

import { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { elapsedMs, errorFields, logEvent } from '@/lib/observability'
import {
  ANALYSIS_STAGE_MESSAGE,
  MatchAnalysisError,
  runMatchAnalysis,
  type MatchAnalysisParams,
} from '@/lib/matchAnalysis'
import { RiotApiError } from '@/lib/riot'
import { generateCoachIntro } from '@/lib/llm'
import {
  quotaGuard,
  rateLimitGuard,
  readJson,
  normalizeGameNameTagLine,
  isNextResponse,
  turnstileGuard,
} from '@/lib/apiUtils'
import { dailyQuotaLimit } from '@/lib/quota'
import { getAuthUser } from '@/lib/supabase/server'
import { botGateForbidden, hasBotGate, issueBotGate } from '@/lib/botGate'

export const dynamic = 'force-dynamic'

/**
 * SSE 헤더.
 * - `no-transform`: 프록시의 응답 버퍼링/압축 변형을 막는다.
 * - `X-Accel-Buffering: no`: nginx 계열 버퍼링 비활성화.
 */
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const

const HEARTBEAT_MS = 15_000

/**
 * POST /api/tft/match/stream — 경기 1건 분석을 SSE 로 진행 상황과 함께 전송한다.
 *
 * 이벤트
 *  - `stage`  { stage: 'start'|'match'|'analyzing', message }
 *  - `result` TftMatchAnalysisResponse (기존 JSON 라우트와 동일한 형태)
 *  - `error`  { status, error }
 *
 * 쿼터는 **스트림을 열기 전에 1회만** 소모한다. (초과 시 일반 JSON 429 응답)
 * 캐시 히트면 Riot/LLM 호출 없이 곧바로 `result` 가 전송된다.
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now()

  // ── 스트림을 열기 전에 거부해야 하는 조건들 (일반 JSON 응답) ──
  const limited = rateLimitGuard(req, 'match', 30, 60_000)
  if (limited) return limited

  const raw = await readJson(req)
  if (isNextResponse(raw)) return raw

  // 봇 게이트: 검색 통과 쿠키가 있으면 통과, 없으면 Turnstile 토큰을 검증한다.
  // Turnstile 로 통과했으면 스트림 응답에 게이트 쿠키를 새로 실어 다음 경기 분석은 바로 통과시킨다.
  let passedByTurnstile = false
  if (!hasBotGate(req)) {
    const hasToken = typeof raw.turnstileToken === 'string' && raw.turnstileToken.trim().length > 0
    if (!hasToken) return botGateForbidden()
    const botCheck = await turnstileGuard(req, raw)
    if (botCheck) return botCheck
    passedByTurnstile = true
  }

  const daily = await quotaGuard(
    req,
    'analysis',
    dailyQuotaLimit('QUOTA_ANALYSIS_PER_DAY', 3),
    (await getAuthUser())?.id,
    dailyQuotaLimit('QUOTA_ANALYSIS_PRO_PER_DAY', 10)
  )
  if (daily) return daily

  const matchId = typeof raw.matchId === 'string' ? raw.matchId.trim() : ''
  if (!matchId) {
    return NextResponse.json({ success: false, error: '분석할 경기(matchId)가 필요합니다.' }, { status: 400 })
  }

  const params: MatchAnalysisParams = {
    matchId,
    puuid: typeof raw.puuid === 'string' ? raw.puuid.trim() : '',
    isDemo: raw.isDemo === true,
    mode: raw.mode === 'multi' ? 'multi' : 'single',
  }

  if (!params.puuid) {
    const nt = normalizeGameNameTagLine(raw)
    if (isNextResponse(nt)) return nt
    params.gameName = nt.gameName
    params.tagLine = nt.tagLine
  }

  const encoder = new TextEncoder()
  let closed = false
  let heartbeat: ReturnType<typeof setInterval> | null = null
  /** 클라이언트가 끊기거나 결과가 도착하면 인트로 스트림을 중단한다. */
  const introAbort = new AbortController()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const stopHeartbeat = () => {
        if (heartbeat) {
          clearInterval(heartbeat)
          heartbeat = null
        }
      }

      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          // 클라이언트가 이미 끊김 — 이후 쓰기는 무시
          closed = true
          stopHeartbeat()
        }
      }

      let resultSent = false
      /** 인트로 토큰 델타 — 결과가 이미 나갔으면 늦은 델타는 버린다. */
      const sendDelta = (text: string) => {
        if (resultSent) return
        send('delta', { text })
      }

      const finish = () => {
        if (closed) return
        closed = true
        stopHeartbeat()
        try {
          controller.close()
        } catch {
          /* 이미 닫힘 */
        }
      }

      heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          closed = true
          stopHeartbeat()
        }
      }, HEARTBEAT_MS)

      void (async () => {
        try {
          // 첫 이벤트를 즉시 보내 TTFB 를 줄인다. (이후 단계마다 갱신)
          send('stage', { stage: 'start', message: '분석을 준비하는 중...' })

          const outcome = await runMatchAnalysis(params, {
            onStage: (stage) => {
              send('stage', { stage, message: ANALYSIS_STAGE_MESSAGE[stage] })
            },
            onMatch: (match) => {
              // 전체 리포트 생성과 병렬로 짧은 인트로를 토큰 스트리밍한다.
              void generateCoachIntro({
                match,
                mode: params.mode,
                onDelta: sendDelta,
                signal: introAbort.signal,
              }).catch(() => {
                /* 인트로 실패는 전체 분석에 영향을 주지 않는다 */
              })
            },
          })

          resultSent = true
          send('result', outcome.response)
          logEvent('info', 'api_match_stream', {
            ms: elapsedMs(startedAt),
            cacheSource: outcome.cached ? 'hit' : 'miss',
            matchId,
            mode: params.mode,
            isDemo: params.isDemo,
          })
        } catch (err) {
          introAbort.abort()
          const status =
            err instanceof MatchAnalysisError
              ? err.status
              : err instanceof RiotApiError
                ? err.statusCode
                : 500
          const message =
            err instanceof MatchAnalysisError || err instanceof RiotApiError
              ? err.message
              : '분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'

          send('error', { status, error: message })
          logEvent(status >= 500 ? 'error' : 'warn', 'api_match_stream_failed', {
            ms: elapsedMs(startedAt),
            status,
            matchId,
            ...errorFields(err),
          })
        } finally {
          introAbort.abort()
          finish()
        }
      })()
    },

    cancel() {
      // 클라이언트 연결 종료
      closed = true
      introAbort.abort()
      if (heartbeat) {
        clearInterval(heartbeat)
        heartbeat = null
      }
    },
  })

  const res = new NextResponse(stream, { status: 200, headers: SSE_HEADERS })
  return passedByTurnstile ? issueBotGate(res, req) : res
}

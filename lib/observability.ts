/**
 * 경량 관측성(Observability) 유틸.
 *
 * - 외부 SDK(Sentry 등) 없이도 운영에 필요한 최소 계측을 제공한다.
 * - 구조화 JSON 로그: Vercel/CloudWatch 등에서 event 기준으로 필터링 가능.
 * - 인프로세스 카운터: /api/health 에서 스냅샷 조회. (서버리스에서는 인스턴스별 값)
 *
 * ⚠️ 카운터는 분산 집계가 아니다. 전역 지표가 필요하면 Log Drain → BigQuery 등으로
 *    `event` 필드를 집계하는 것을 권장한다.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const configuredLevel = (process.env.LOG_LEVEL || 'info').toLowerCase()
const THRESHOLD = LEVEL_ORDER[configuredLevel as LogLevel] ?? LEVEL_ORDER.info

export type LogFields = Record<string, unknown>

function safeStringify(value: LogFields): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '{"logSerializeError":true}'
  }
}

/** 구조화 로그 한 줄 출력. */
export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (LEVEL_ORDER[level] < THRESHOLD) return
  const line = safeStringify({ ts: new Date().toISOString(), level, event, ...fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/** 에러를 로그 필드로 안전하게 변환. */
export function errorFields(err: unknown): LogFields {
  if (err instanceof Error) {
    return { errorName: err.name, errorMessage: err.message }
  }
  return { errorMessage: String(err) }
}

const counters = new Map<string, number>()

/** 카운터 증가 (인스턴스 로컬). */
export function incrMetric(name: string, by = 1): void {
  counters.set(name, (counters.get(name) || 0) + by)
}

/** 현재 인스턴스의 카운터 스냅샷 (이름 오름차순). */
export function snapshotMetrics(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of [...counters.keys()].sort()) {
    out[key] = counters.get(key) as number
  }
  return out
}

const PROCESS_STARTED_AT = Date.now()

/** 프로세스(인스턴스) 가동 시간(초). */
export function uptimeSeconds(): number {
  return Math.floor((Date.now() - PROCESS_STARTED_AT) / 1000)
}

/** 경과 시간(ms) 계산 헬퍼. */
export function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}

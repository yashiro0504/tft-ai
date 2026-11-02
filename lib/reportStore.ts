import { createSupabaseAdminClient } from './supabase/admin'
import { errorFields, incrMetric, logEvent } from './observability'

/**
 * AI 리포트 영구 저장소 (2026-11-02 지시문 1) — Supabase public.analysis_reports (0012 마이그레이션).
 *
 * Redis 캐시는 TTL 이 지나면 사라진다. 경기 분석 캐시가 24시간이라 10/30 에 만든 리포트가 11/02 에는 없었고,
 * "이 경기 AI 분석"이 안내 없이 새로 생성되며 1회씩 차감됐다. 한 번 만든 AI 리포트(폴백 제외)는 여기에 남겨 두고,
 * 캐시가 비면 이 표에서 꺼내 보여 준다 — LLM 호출·횟수 차감 없음.
 *
 * - service role 키가 없거나 표가 아직 없으면(마이그레이션 전) 조용히 건너뛴다 (fail-open, 캐시만 쓰던 예전 동작).
 * - 읽기는 짧은 타임아웃 — 저장소가 느려도 분석 화면이 묶이지 않게.
 */
const READ_TIMEOUT_MS = 1500

let disabledUntil = 0
/** 표가 없다는 오류(42P01 · PGRST205)면 10분 동안 다시 묻지 않는다 */
function markMissing(err: unknown) {
  const code = (err as { code?: string } | null)?.code
  if (code === '42P01' || code === 'PGRST205') disabledUntil = Date.now() + 10 * 60_000
}

export async function loadStoredReport<T>(cacheKey: string): Promise<T | null> {
  if (Date.now() < disabledUntil) return null
  const c = createSupabaseAdminClient()
  if (!c) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS)
  try {
    const { data, error } = await c.from('analysis_reports').select('payload').eq('cache_key', cacheKey).abortSignal(controller.signal).maybeSingle()
    if (error) {
      markMissing(error)
      incrMetric('report_store.read_error')
      logEvent('warn', 'report_store_read_failed', errorFields(error))
      return null
    }
    if (!data?.payload) return null
    incrMetric('report_store.hit')
    return data.payload as T
  } catch (err) {
    incrMetric('report_store.read_error')
    logEvent('warn', 'report_store_read_failed', errorFields(err))
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function saveStoredReport(cacheKey: string, payload: unknown, meta: { kind: 'match' | 'overview'; generatorVersion?: string }): Promise<boolean> {
  if (Date.now() < disabledUntil) return false
  const c = createSupabaseAdminClient()
  if (!c) return false
  try {
    const { error } = await c
      .from('analysis_reports')
      .upsert({ cache_key: cacheKey, kind: meta.kind, generator_version: meta.generatorVersion ?? null, payload, updated_at: new Date().toISOString() }, { onConflict: 'cache_key' })
    if (error) {
      markMissing(error)
      incrMetric('report_store.write_error')
      logEvent('warn', 'report_store_write_failed', errorFields(error))
      return false
    }
    return true
  } catch (err) {
    incrMetric('report_store.write_error')
    logEvent('warn', 'report_store_write_failed', errorFields(err))
    return false
  }
}

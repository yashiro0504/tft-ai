/**
 * AI 리포트 피드백 (👍/👎 + 한 줄 코멘트) 저장·조회 — 서버 전용.
 *
 * - 저장: anon key + insert-only RLS (public.report_feedback). 같은 방문자·같은 리포트는 1번만 (23505 → duplicate).
 * - 조회: service role 클라이언트 (운영자 페이지에서만 호출).
 * - Riot ID / 이메일 / IP 는 받지 않는다. 스냅샷은 리포트 본문 일부라 길이를 잘라 저장한다.
 */
import { ANON_ID_PATTERN } from './eventSchema'
import { createSupabaseAdminClient } from './supabase/admin'
import { createSupabaseServerClient } from './supabase/server'
import { errorFields, logEvent } from './observability'

export const MAX_COMMENT_LENGTH = 200

export interface FeedbackSnapshot {
  overview?: string
  topic?: string
  actions?: string[]
  metaScore?: number
  isFallback?: boolean
}

export interface ReportFeedbackInput {
  visitorId: string
  reportKey: string
  mode: 'single' | 'multi'
  matchId: string | null
  rating: 1 | -1
  comment: string | null
  patch: string | null
  snapshot: FeedbackSnapshot
}

export interface ReportFeedbackRow {
  id: number
  createdAt: string
  mode: 'single' | 'multi'
  matchId: string | null
  rating: 1 | -1
  comment: string | null
  patch: string | null
  snapshot: FeedbackSnapshot
}

const REPORT_KEY_PATTERN = /^[A-Za-z0-9_:.-]{1,120}$/
const MATCH_ID_PATTERN = /^[A-Za-z0-9_]{1,40}$/

function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text ? text.slice(0, max) : undefined
}

function parseSnapshot(raw: unknown): FeedbackSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const obj = raw as Record<string, unknown>
  const actions = Array.isArray(obj.actions)
    ? obj.actions.map((a) => clip(a, 400)).filter((a): a is string => Boolean(a)).slice(0, 3)
    : undefined
  return {
    overview: clip(obj.overview, 1200),
    topic: clip(obj.topic, 120),
    actions: actions?.length ? actions : undefined,
    metaScore: typeof obj.metaScore === 'number' && Number.isFinite(obj.metaScore) ? Math.round(obj.metaScore) : undefined,
    isFallback: typeof obj.isFallback === 'boolean' ? obj.isFallback : undefined,
  }
}

export function parseReportFeedback(raw: Record<string, unknown>): { value: ReportFeedbackInput } | { error: string } {
  const visitorId = typeof raw.visitorId === 'string' ? raw.visitorId.trim() : ''
  if (!ANON_ID_PATTERN.test(visitorId)) return { error: 'visitorId 형식이 올바르지 않습니다.' }

  const reportKey = typeof raw.reportKey === 'string' ? raw.reportKey.trim() : ''
  if (!REPORT_KEY_PATTERN.test(reportKey)) return { error: 'reportKey 형식이 올바르지 않습니다.' }

  if (raw.mode !== 'single' && raw.mode !== 'multi') return { error: 'mode 가 올바르지 않습니다.' }
  if (raw.rating !== 1 && raw.rating !== -1) return { error: '평가는 👍 또는 👎 만 가능합니다.' }

  const matchRaw = typeof raw.matchId === 'string' ? raw.matchId.trim() : ''
  const matchId = MATCH_ID_PATTERN.test(matchRaw) ? matchRaw : null

  const commentRaw = typeof raw.comment === 'string' ? raw.comment.trim() : ''
  if (commentRaw.length > MAX_COMMENT_LENGTH) return { error: `코멘트는 ${MAX_COMMENT_LENGTH}자 이내로 입력해주세요.` }

  return {
    value: {
      visitorId,
      reportKey,
      mode: raw.mode,
      matchId,
      rating: raw.rating,
      comment: commentRaw || null,
      patch: clip(raw.patch, 16) ?? null,
      snapshot: parseSnapshot(raw.snapshot),
    },
  }
}

export type SaveResult = { ok: true } | { ok: false; code: 'duplicate' | 'unavailable' }

export async function saveReportFeedback(input: ReportFeedbackInput): Promise<SaveResult> {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return { ok: false, code: 'unavailable' }
  try {
    const { error } = await supabase.from('report_feedback').insert({
      visitor_id: input.visitorId,
      report_key: input.reportKey,
      mode: input.mode,
      match_id: input.matchId,
      rating: input.rating,
      comment: input.comment,
      patch: input.patch,
      snapshot: input.snapshot,
    })
    if (!error) return { ok: true }
    if (error.code === '23505') return { ok: false, code: 'duplicate' }
    logEvent('warn', 'report_feedback_insert_failed', { errorMessage: error.message, code: error.code })
  } catch (err) {
    logEvent('warn', 'report_feedback_insert_failed', errorFields(err))
  }
  return { ok: false, code: 'unavailable' }
}

export interface FeedbackListing {
  rows: ReportFeedbackRow[]
  up: number
  down: number
}

/** 최근 피드백 (최신순) + 전체 👍/👎 수. service role 키가 없거나 오류면 null. */
export async function listReportFeedback(
  opts: { rating?: 1 | -1; limit?: number } = {}
): Promise<FeedbackListing | null> {
  const admin = createSupabaseAdminClient()
  if (!admin) return null
  try {
    let query = admin
      .from('report_feedback')
      .select('id, created_at, mode, match_id, rating, comment, patch, snapshot')
      .order('created_at', { ascending: false })
      .limit(opts.limit ?? 100)
    if (opts.rating) query = query.eq('rating', opts.rating)

    const [list, up, down] = await Promise.all([
      query,
      admin.from('report_feedback').select('id', { count: 'exact', head: true }).eq('rating', 1),
      admin.from('report_feedback').select('id', { count: 'exact', head: true }).eq('rating', -1),
    ])
    if (list.error) {
      logEvent('warn', 'report_feedback_list_failed', { errorMessage: list.error.message, code: list.error.code })
      return null
    }
    const rows = (list.data ?? []).map((r) => ({
      id: r.id as number,
      createdAt: r.created_at as string,
      mode: r.mode as 'single' | 'multi',
      matchId: (r.match_id as string | null) ?? null,
      rating: r.rating as 1 | -1,
      comment: (r.comment as string | null) ?? null,
      patch: (r.patch as string | null) ?? null,
      snapshot: (r.snapshot as FeedbackSnapshot) ?? {},
    }))
    return { rows, up: up.count ?? 0, down: down.count ?? 0 }
  } catch (err) {
    logEvent('warn', 'report_feedback_list_failed', errorFields(err))
    return null
  }
}

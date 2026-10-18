/**
 * 이벤트 저장소 (서버 전용).
 *
 * - Supabase 가 설정되어 있으면 `public.events` 테이블에 insert 한다. (RLS: insert-only)
 * - 미설정/오류 시에는 **구조화 로그**(`analytics_event`)로만 남긴다.
 *   → Vercel Log Drain 등에서 `event` 필드로 집계할 수 있다.
 * - 저장 실패가 요청 실패로 이어지지 않는다. (계측은 best-effort)
 */
import { createSupabaseServerClient } from './supabase/server'
import { errorFields, logEvent } from './observability'
import type { AnalyticsEventPayload } from './eventSchema'

export type EventStorage = 'supabase' | 'log'

/** 이벤트 1건을 저장한다. 저장 경로를 반환한다. */
export async function recordEvent(event: AnalyticsEventPayload): Promise<EventStorage> {
  const supabase = await createSupabaseServerClient()

  if (supabase) {
    try {
      // return=minimal (select 없이 insert) → anon 롤에 SELECT 권한이 없어도 동작한다.
      const { error } = await supabase.from('events').insert({
        name: event.name,
        session_id: event.sessionId,
        visitor_id: event.visitorId,
        route: event.route || null,
        props: event.props,
      })

      if (!error) return 'supabase'

      logEvent('warn', 'events_insert_failed', {
        errorMessage: error.message,
        code: error.code,
        name: event.name,
      })
    } catch (err) {
      logEvent('warn', 'events_insert_failed', { name: event.name, ...errorFields(err) })
    }
  }

  logEvent('info', 'analytics_event', {
    name: event.name,
    sessionId: event.sessionId,
    visitorId: event.visitorId,
    route: event.route,
    props: event.props,
  })
  return 'log'
}

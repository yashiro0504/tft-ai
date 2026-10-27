import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_URL } from './config'

/**
 * 서버 전용 service role 클라이언트 — RLS 를 우회하므로 **운영자 확인을 마친 경로에서만** 쓴다.
 * (현재: /owner/feedback 의 리포트 피드백 조회). 키가 없으면 null.
 */
export function createSupabaseAdminClient(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!SUPABASE_URL || !key) return null
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

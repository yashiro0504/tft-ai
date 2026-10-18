'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './config'

/** 브라우저용 Supabase 클라이언트. 미설정 시 null. */
export function createSupabaseBrowserClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY)
}

import type { User } from '@supabase/supabase-js'

/**
 * 일일 쿼터 면제 계정 (운영자·테스트용).
 * QUOTA_EXEMPT_USERS = 쉼표로 구분한 Supabase user id 또는 이메일.
 * 이메일은 인증된(email_confirmed_at) 경우에만 인정한다 — 미인증 가입으로 남의 이메일을 사칭하지 못하게.
 * Discord 로그인처럼 이메일이 없을 수 있으니 user id 로 지정하는 쪽이 확실하다 (/api/me 응답의 user.id).
 * LLM 일일 예산(LLM_DAILY_BUDGET_USD)은 면제하지 않는다.
 */
export function isQuotaExempt(user: Pick<User, 'id' | 'email' | 'email_confirmed_at'> | null | undefined): boolean {
  if (!user) return false
  const list = (process.env.QUOTA_EXEMPT_USERS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (!list.length) return false
  if (list.includes(user.id.toLowerCase())) return true
  const email = user.email?.trim().toLowerCase()
  return Boolean(email && user.email_confirmed_at && list.includes(email))
}

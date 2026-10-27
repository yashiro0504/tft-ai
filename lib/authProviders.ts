/**
 * 로그인 버튼으로 보여 줄 OAuth 제공자.
 * Supabase Dashboard → Authentication → Providers 에서 켠 것만 NEXT_PUBLIC_AUTH_PROVIDERS 에 넣는다
 * (켜지 않은 제공자를 누르면 Supabase 가 400 JSON 페이지를 띄운다). 미설정 시 Discord 만.
 */
export type AuthProvider = 'kakao' | 'google' | 'discord'

/** 화면에 보이는 순서 — 국내 사용자 기준 카카오 먼저 */
const ORDER: AuthProvider[] = ['kakao', 'google', 'discord']

export const AUTH_PROVIDER_LABEL: Record<AuthProvider, string> = {
  kakao: '카카오',
  google: 'Google',
  discord: 'Discord',
}

export function enabledAuthProviders(raw = process.env.NEXT_PUBLIC_AUTH_PROVIDERS): AuthProvider[] {
  const wanted = new Set(
    (raw || 'discord')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )
  const list = ORDER.filter((p) => wanted.has(p))
  return list.length > 0 ? list : ['discord']
}

/**
 * 사이트 전역 상수/URL.
 *
 * NEXT_PUBLIC_SITE_URL 은 배포 시 반드시 지정한다. (예: https://tft-ai.vercel.app)
 * 지정하지 않으면 Vercel 프리뷰 URL → localhost 순으로 폴백한다.
 * → Riot 프로덕션 키 심사에는 고정 공개 URL이 필요하므로 커스텀 도메인을 권장.
 */
export const SITE_NAME = 'TFT LAB'

const rawSiteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

export const SITE_URL = rawSiteUrl.replace(/\/+$/, '')

export const SITE_DESCRIPTION =
  'TFT 시즌 18 실측 메타 랭킹(기물·시너지·아이템·BIS 조합)과 경기별 AI 전략 코칭을 제공하는 롤토체스 분석 사이트'

/** 운영자 표기 (약관/개인정보처리방침) */
export const OPERATOR_NAME = process.env.NEXT_PUBLIC_OPERATOR_NAME || 'TFT LAB 운영자'

/** 문의 이메일 — 배포 전 실제 주소로 설정할 것 */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'contact@example.com'

/** 약관/개인정보처리방침 시행일 */
export const POLICY_EFFECTIVE_DATE = '2026-10-18'

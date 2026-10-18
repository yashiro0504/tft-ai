/**
 * 모바일 브라우저 UI(주소창) 색상 동기화.
 *
 * Next 의 `viewport.themeColor` 는 `prefers-color-scheme` 기준으로 두 개의 meta 를 렌더한다.
 * 서비스는 사용자가 직접 테마를 토글하므로, 토글 시 meta content 를 덮어써서
 * 시스템 설정과 무관하게 실제 테마와 일치시킨다.
 */
export const THEME_COLOR = {
  dark: '#080c15',
  light: '#f3f5f9',
} as const

export function syncThemeColor(theme: 'dark' | 'light'): void {
  if (typeof document === 'undefined') return
  const color = THEME_COLOR[theme]
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', color)
  }
}

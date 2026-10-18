/**
 * OG 이미지용 한글 폰트 로더.
 *
 * 전체 한글 폰트는 수 MB라 OG 생성마다 부담이 크므로, Google Fonts `text=` 서브셋을
 * TTF 로 받아 이미지에 실제로 쓰는 글자만 포함한다.
 * 실패하면 null 을 반환하고 호출부에서 기본 폰트로 폴백한다.
 */
const FONT_UA = 'Mozilla/5.0 (Linux; U; Android 2.2; en-us; Nexus One Build/FRF91) AppleWebKit/533.1'

let cache: { text: string; data: ArrayBuffer } | null = null

export async function loadKoreanFont(text: string): Promise<ArrayBuffer | null> {
  if (cache && cache.text === text) return cache.data

  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700&text=${encodeURIComponent(text)}`
    const css = await fetch(cssUrl, {
      headers: { 'User-Agent': FONT_UA },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    }).then((res) => res.text())

    const match = css.match(/src:\s*url\(([^)]+)\)/)
    if (!match) return null

    const data = await fetch(match[1], {
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    }).then((res) => res.arrayBuffer())

    cache = { text, data }
    return data
  } catch {
    return null
  }
}

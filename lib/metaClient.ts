import type { TftMetaResponse } from './types'

/**
 * 브라우저에서 /api/tft/meta?view=decks 를 한 번만 받는다 (2026-10-30 2차 지시문 5-3).
 * 홈의 추천 덱(TopDecks)과 메타 탭(MetaDashboard)이 같은 페이지에서 각자 불러 한 번 로드에 view=decks 가 두 번 나갔다.
 * 진행 중인 요청과 받은 응답을 같은 화면 세션 동안(5분) 나눠 쓴다. 실패하면 비워 다음 호출이 다시 받는다.
 */
const TTL_MS = 5 * 60_000
let entry: { promise: Promise<TftMetaResponse>; at: number } | null = null

export function fetchMetaDecks(): Promise<TftMetaResponse> {
  const now = Date.now()
  if (entry && now - entry.at < TTL_MS) return entry.promise
  const promise = fetch('/api/tft/meta?view=decks').then(async (res) => {
    const json = (await res.json()) as TftMetaResponse
    if (!res.ok || !json.success) throw new Error(json.error || '메타 데이터를 불러오지 못했습니다.')
    return json
  })
  entry = { promise, at: now }
  promise.catch(() => {
    if (entry?.promise === promise) entry = null
  })
  return promise
}

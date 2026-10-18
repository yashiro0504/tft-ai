'use client'

import { useEffect } from 'react'
import { trackOnce } from '@/lib/analytics'

/**
 * 덱 상세 페이지 진입 계측.
 * 서버 컴포넌트(`/deck/[id]`)에서 렌더하므로 클라이언트 경계만 얇게 둔다.
 * 같은 세션에서 같은 덱을 여러 번 열어도 1회만 집계한다.
 */
export function DeckViewTracker({ deckId }: { deckId: string }) {
  useEffect(() => {
    trackOnce(`deck_open:${deckId}`, 'deck_open', { surface: 'deck_page' })
  }, [deckId])

  return null
}

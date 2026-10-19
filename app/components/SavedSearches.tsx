'use client'

import { Star } from 'lucide-react'
import { favoriteKey, useFavorites } from '@/lib/useFavorites'

interface SavedSearchesProps {
  /** 칩을 누르면 검색을 실행한다. */
  onPick: (gameName: string, tagLine: string) => void
  /** 검색 중에는 클릭을 막는다. */
  disabled?: boolean
}

/**
 * 검색창 아래 "즐겨찾기" 칩.
 *
 * - 즐겨찾기한 소환사만 보여준다 (최근 검색 기록은 보여주지 않는다)
 * - 추가는 소환사 카드의 ★ 버튼, 해제는 이 칩의 ★ 버튼
 * - 저장 위치는 lib/useFavorites (로그인: 서버, 비로그인: 브라우저)
 */
export function SavedSearches({ onPick, disabled = false }: SavedSearchesProps) {
  const { favorites, busy, toggle } = useFavorites()
  if (!favorites.length) return null

  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-sm text-subtle">즐겨찾기</span>
      {favorites.map((item) => {
        const label = `${item.gameName}#${item.tagLine}`
        return (
          <span
            key={favoriteKey(item)}
            className="inline-flex items-center rounded-control border border-line bg-sunken text-sm text-ink transition hover:border-accent"
          >
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(item.gameName, item.tagLine)}
              className="cursor-pointer py-1.5 pl-3 pr-2 disabled:cursor-not-allowed disabled:opacity-50"
              title={`${label} 전적 검색`}
            >
              {label}
            </button>
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => void toggle(item)}
              aria-label={`${label} 즐겨찾기 해제`}
              className="cursor-pointer border-l border-line px-2 py-1.5 text-accent disabled:opacity-40"
            >
              <Star className="h-3.5 w-3.5 fill-accent" aria-hidden="true" />
            </button>
          </span>
        )
      })}
    </div>
  )
}

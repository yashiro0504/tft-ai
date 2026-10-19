'use client'

import { Star } from 'lucide-react'
import { useFavorites } from '@/lib/useFavorites'

/** 소환사 카드의 즐겨찾기 토글 (검색창 아래 즐겨찾기 칩과 같은 목록) */
export function FavoriteButton({ gameName, tagLine, region = 'kr' }: { gameName: string; tagLine: string; region?: string }) {
  const { isFavorite, toggle, busy } = useFavorites()
  const on = isFavorite({ region, gameName, tagLine })

  return (
    <button
      type="button"
      onClick={() => void toggle({ region, gameName, tagLine })}
      disabled={busy}
      aria-pressed={on}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-control border px-3 py-1.5 text-sm transition disabled:opacity-50 ${
        on ? 'border-accent bg-accent-bg font-semibold text-accent' : 'border-line bg-sunken text-ink hover:border-accent'
      }`}
    >
      <Star className={`h-4 w-4 ${on ? 'fill-accent' : ''}`} aria-hidden="true" />
      {on ? '즐겨찾기됨' : '즐겨찾기'}
    </button>
  )
}

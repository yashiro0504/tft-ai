'use client'

import { useEffect, useState } from 'react'
import { Star, X } from 'lucide-react'
import {
  RECENT_UPDATED_EVENT,
  getRecentSearches,
  removeRecentSearch,
  type RecentSearch,
} from '@/lib/recentSearches'

interface FavoriteItem {
  region: string
  gameName: string
  tagLine: string
}

interface SavedSearchesProps {
  /** 칩을 누르면 검색을 실행한다. */
  onPick: (gameName: string, tagLine: string) => void
  /** 검색 중에는 클릭을 막는다. */
  disabled?: boolean
}

function keyOf(region: string, gameName: string, tagLine: string): string {
  return `${region.toLowerCase()}|${gameName.toLowerCase()}|${tagLine.toUpperCase()}`
}

function labelOf(item: { gameName: string; tagLine: string }): string {
  return `${item.gameName}#${item.tagLine}`
}

/**
 * 검색창 아래 "최근 검색 / 즐겨찾기" 칩.
 *
 * - 최근 검색: localStorage, 최대 5개 (비로그인 포함 항상 사용)
 * - 즐겨찾기: 로그인 시 서버(`/api/favorites`, RLS 본인만)에서 최대 20개
 * - 최근 검색 칩의 ☆ 로 즐겨찾기 추가, 즐겨찾기 칩의 ★ 로 해제
 */
export function SavedSearches({ onPick, disabled = false }: SavedSearchesProps) {
  const [recent, setRecent] = useState<RecentSearch[]>([])
  const [favorites, setFavorites] = useState<FavoriteItem[]>([])
  const [loggedIn, setLoggedIn] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  // 최근 검색: 첫 로드 + 다른 곳에서 갱신될 때 동기화
  useEffect(() => {
    setRecent(getRecentSearches())
    const onChange = () => setRecent(getRecentSearches())
    window.addEventListener(RECENT_UPDATED_EVENT, onChange)
    return () => window.removeEventListener(RECENT_UPDATED_EVENT, onChange)
  }, [])

  // 로그인 사용자면 즐겨찾기 로드 (익명/미설정이면 조용히 건너뛴다)
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        // /api/me 를 따로 부르지 않고 즐겨찾기 응답으로 로그인 여부를 판별한다.
        // (미설정 → 200 configured:false, 비로그인 → 401)
        const res = await fetch('/api/favorites', { cache: 'no-store' })
        if (!alive || res.status === 401) return
        const data = await res.json()
        if (!alive || !data?.success || !data.configured) return
        setLoggedIn(true)
        setFavorites(Array.isArray(data.favorites) ? data.favorites : [])
      } catch {
        /* 네트워크 실패 시 즐겨찾기 숨김 (최근 검색은 계속 동작) */
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [])

  const isFavorite = (item: { region?: string; gameName: string; tagLine: string }) =>
    favorites.some(
      (f) => keyOf(f.region, f.gameName, f.tagLine) === keyOf(item.region || 'kr', item.gameName, item.tagLine)
    )

  const toggleFavorite = async (item: { region?: string; gameName: string; tagLine: string }) => {
    const region = item.region || 'kr'
    const key = keyOf(region, item.gameName, item.tagLine)
    if (busyKey) return
    setBusyKey(key)

    try {
      if (isFavorite(item)) {
        const query = new URLSearchParams({
          gameName: item.gameName,
          tagLine: item.tagLine,
          region,
        })
        const res = await fetch(`/api/favorites?${query.toString()}`, { method: 'DELETE' })
        const data = await res.json()
        if (data?.success) {
          setFavorites((prev) => prev.filter((f) => keyOf(f.region, f.gameName, f.tagLine) !== key))
        }
      } else {
        const res = await fetch('/api/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameName: item.gameName, tagLine: item.tagLine, region }),
        })
        const data = await res.json()
        if (data?.success && data.favorite) {
          const saved: FavoriteItem = {
            region: data.favorite.region,
            gameName: data.favorite.gameName,
            tagLine: data.favorite.tagLine,
          }
          setFavorites((prev) => [saved, ...prev.filter((f) => keyOf(f.region, f.gameName, f.tagLine) !== key)])
        }
      }
    } catch {
      /* 실패는 조용히 무시 (UI 상태 유지) */
    } finally {
      setBusyKey(null)
    }
  }

  const removeRecent = (item: RecentSearch) => {
    setRecent(removeRecentSearch(item))
  }

  const hasAny = recent.length > 0 || (loggedIn && favorites.length > 0)
  if (!hasAny) return null

  const chipBase =
    'inline-flex items-center rounded-control border border-line bg-sunken text-xs font-bold text-muted transition'

  return (
    <div className="mt-4 space-y-2 border-t border-line pt-3">
      {recent.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-xs font-bold text-muted">최근 검색</span>
          {recent.map((item) => {
            const key = keyOf(item.region, item.gameName, item.tagLine)
            const fav = isFavorite(item)
            return (
              <span key={key} className={chipBase}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(item.gameName, item.tagLine)}
                  className="cursor-pointer px-2 py-1 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  title={`${labelOf(item)} 전적 검색`}
                >
                  {labelOf(item)}
                </button>
                {loggedIn ? (
                  <button
                    type="button"
                    disabled={disabled || busyKey === key}
                    onClick={() => void toggleFavorite(item)}
                    aria-label={fav ? `${labelOf(item)} 즐겨찾기 해제` : `${labelOf(item)} 즐겨찾기 추가`}
                    aria-pressed={fav}
                    className="cursor-pointer border-l border-line px-1.5 py-1 hover:text-accent disabled:opacity-40"
                  >
                    <Star
                      className={`h-3 w-3 ${fav ? 'fill-accent text-accent' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => removeRecent(item)}
                  aria-label={`${labelOf(item)} 최근 검색에서 삭제`}
                  className="cursor-pointer border-l border-line px-1.5 py-1 hover:text-bad"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            )
          })}
        </div>
      ) : null}

      {loggedIn && favorites.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-xs font-bold text-muted">즐겨찾기</span>
          {favorites.map((item) => {
            const key = keyOf(item.region, item.gameName, item.tagLine)
            return (
              <span key={key} className={chipBase}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(item.gameName, item.tagLine)}
                  className="cursor-pointer px-2 py-1 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  title={`${labelOf(item)} 전적 검색`}
                >
                  {labelOf(item)}
                </button>
                <button
                  type="button"
                  disabled={disabled || busyKey === key}
                  onClick={() => void toggleFavorite(item)}
                  aria-label={`${labelOf(item)} 즐겨찾기 해제`}
                  className="cursor-pointer border-l border-line px-1.5 py-1 text-accent hover:text-accent disabled:opacity-40"
                >
                  <Star className="h-3 w-3 fill-accent text-accent" aria-hidden="true" />
                </button>
              </span>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

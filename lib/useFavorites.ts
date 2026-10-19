'use client'

import { useSyncExternalStore } from 'react'

/**
 * 즐겨찾기 소환사 (검색창 아래 칩 + 소환사 카드의 ★ 버튼이 함께 쓴다).
 *
 * - 로그인 사용자: 서버(`/api/favorites`, Supabase RLS 본인만)
 * - 비로그인 / 로그인 미설정: 브라우저(localStorage)에 저장
 * 한 번만 불러오고, 모든 구독자에게 같은 목록을 나눠 준다.
 */
export interface FavoriteItem {
  region: string
  gameName: string
  tagLine: string
}

const LOCAL_KEY = 'tft-favorites'
const LOCAL_MAX = 20

let items: FavoriteItem[] = []
let mode: 'server' | 'local' = 'local'
let loaded = false
let busy = false
const listeners = new Set<() => void>()
let snapshot = { items, busy, loaded }

function emit() {
  snapshot = { items, busy, loaded }
  listeners.forEach((fn) => fn())
}

export function favoriteKey(item: { region?: string; gameName: string; tagLine: string }) {
  return `${(item.region || 'kr').toLowerCase()}|${item.gameName.toLowerCase()}|${item.tagLine.toUpperCase()}`
}

function readLocal(): FavoriteItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((f) => f && f.gameName && f.tagLine) : []
  } catch {
    return []
  }
}

function writeLocal(list: FavoriteItem[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(0, LOCAL_MAX)))
  } catch {
    /* 저장 불가 환경: 이번 탭에서만 유지 */
  }
}

async function load() {
  if (loaded) return
  loaded = true
  try {
    // 미설정 → 200 configured:false, 비로그인 → 401
    const res = await fetch('/api/favorites', { cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      if (data?.success && data.configured) {
        mode = 'server'
        items = Array.isArray(data.favorites) ? data.favorites : []
        emit()
        return
      }
    }
  } catch {
    /* 네트워크 실패 → 브라우저 저장으로 */
  }
  mode = 'local'
  items = readLocal()
  emit()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  void load()
  return () => listeners.delete(fn)
}

const EMPTY = { items: [] as FavoriteItem[], busy: false, loaded: false }

export async function toggleFavorite(input: { region?: string; gameName: string; tagLine: string }) {
  if (busy) return
  const item: FavoriteItem = { region: input.region || 'kr', gameName: input.gameName, tagLine: input.tagLine }
  const key = favoriteKey(item)
  const exists = items.some((f) => favoriteKey(f) === key)

  if (mode === 'local') {
    items = exists ? items.filter((f) => favoriteKey(f) !== key) : [item, ...items].slice(0, LOCAL_MAX)
    writeLocal(items)
    emit()
    return
  }

  busy = true
  emit()
  try {
    if (exists) {
      const q = new URLSearchParams({ gameName: item.gameName, tagLine: item.tagLine, region: item.region })
      const data = await (await fetch(`/api/favorites?${q}`, { method: 'DELETE' })).json()
      if (data?.success) items = items.filter((f) => favoriteKey(f) !== key)
    } else {
      const data = await (
        await fetch('/api/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        })
      ).json()
      if (data?.success && data.favorite) {
        const saved = { region: data.favorite.region, gameName: data.favorite.gameName, tagLine: data.favorite.tagLine }
        items = [saved, ...items.filter((f) => favoriteKey(f) !== key)]
      }
    }
  } catch {
    /* 실패는 조용히 무시 (목록 유지) */
  } finally {
    busy = false
    emit()
  }
}

export function useFavorites() {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => EMPTY)
  const isFavorite = (item: { region?: string; gameName: string; tagLine: string }) =>
    state.items.some((f) => favoriteKey(f) === favoriteKey(item))
  return { favorites: state.items, busy: state.busy, loaded: state.loaded, isFavorite, toggle: toggleFavorite }
}

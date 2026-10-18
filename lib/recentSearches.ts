'use client'

/**
 * 비로그인 사용자의 "최근 검색" 저장소 (localStorage).
 *
 * - 최대 5개, 최신순. 같은 소환사(대소문자 무시)는 중복 저장하지 않고 맨 앞으로 올린다.
 * - 저장 실패(시크릿 모드/용량 초과)는 조용히 무시한다. (검색 자체를 막지 않는다)
 * - 다른 컴포넌트가 갱신을 감지할 수 있도록 window 이벤트를 함께 발생시킨다.
 */

export interface RecentSearch {
  region: string
  gameName: string
  tagLine: string
  /** 저장 시각 (epoch ms) — 정렬/디버깅용 */
  at: number
}

const STORAGE_KEY = 'tftlab:recent'
export const MAX_RECENT = 5
export const RECENT_UPDATED_EVENT = 'tftlab:recent-updated'

function keyOf(region: string, gameName: string, tagLine: string): string {
  return `${region.toLowerCase()}|${gameName.toLowerCase()}|${tagLine.toUpperCase()}`
}

function isRecentSearch(value: unknown): value is RecentSearch {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.region === 'string' &&
    typeof v.gameName === 'string' &&
    typeof v.tagLine === 'string' &&
    typeof v.at === 'number'
  )
}

function read(): RecentSearch[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecentSearch).slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

function write(list: RecentSearch[]): RecentSearch[] {
  const trimmed = list.slice(0, MAX_RECENT)
  if (typeof window === 'undefined') return trimmed
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    /* localStorage 차단/용량 초과 무시 */
  }
  try {
    window.dispatchEvent(new Event(RECENT_UPDATED_EVENT))
  } catch {
    /* 이벤트 미지원 환경 무시 */
  }
  return trimmed
}

export function getRecentSearches(): RecentSearch[] {
  return read()
}

/** 최근 검색에 추가(중복은 맨 앞으로 이동). 갱신된 목록을 반환한다. */
export function addRecentSearch(input: {
  gameName: string
  tagLine: string
  region?: string
}): RecentSearch[] {
  const gameName = input.gameName.trim()
  const tagLine = input.tagLine.trim()
  if (!gameName || !tagLine) return read()

  const region = (input.region || 'kr').toLowerCase()
  const entry: RecentSearch = { region, gameName, tagLine, at: Date.now() }
  const key = keyOf(region, gameName, tagLine)
  const rest = read().filter((item) => keyOf(item.region, item.gameName, item.tagLine) !== key)
  return write([entry, ...rest])
}

/** 최근 검색에서 삭제. 갱신된 목록을 반환한다. */
export function removeRecentSearch(input: {
  gameName: string
  tagLine: string
  region?: string
}): RecentSearch[] {
  const region = (input.region || 'kr').toLowerCase()
  const key = keyOf(region, input.gameName, input.tagLine)
  return write(read().filter((item) => keyOf(item.region, item.gameName, item.tagLine) !== key))
}

export function clearRecentSearches(): RecentSearch[] {
  return write([])
}

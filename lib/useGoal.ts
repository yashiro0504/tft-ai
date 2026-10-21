'use client'

import { useCallback, useSyncExternalStore } from 'react'
import type { PracticeGoal } from './goals'

/**
 * 연습 목표 저장 (브라우저 로컬 · 소환사별 키 lib/goals.goalStorageKey).
 * 로그인이 없어 서버에 두지 않는다. localStorage 가 막힌 환경에서는 탭 메모리로만 기억한다.
 * 리포트(목표 설정)와 프로필(진행 표시)이 같은 키를 구독해 바로 함께 갱신된다.
 */
const memory = new Map<string, string | null>()
const listeners = new Set<() => void>()

function readRaw(key: string): string | null {
  try {
    const v = localStorage.getItem(key)
    if (v !== null) return v
  } catch {
    /* localStorage 차단: 메모리 값 사용 */
  }
  return memory.get(key) ?? null
}

function writeRaw(key: string, value: string | null) {
  memory.set(key, value)
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* 무시 */
  }
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith('tftlab-goal:')) fn()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', onStorage)
  }
}

function parse(raw: string | null): PracticeGoal | null {
  if (!raw) return null
  try {
    const g = JSON.parse(raw) as PracticeGoal
    return g && typeof g.kind === 'string' && typeof g.target === 'number' && typeof g.since === 'number' ? g : null
  } catch {
    return null
  }
}

export function useGoal(key: string | null) {
  // 문자열 스냅샷을 구독하고 파싱은 렌더에서 (매번 새 객체를 돌려주면 useSyncExternalStore 가 무한 갱신된다)
  const raw = useSyncExternalStore(subscribe, () => (key ? readRaw(key) : null), () => null)
  const goal = parse(raw)
  const setGoal = useCallback((g: PracticeGoal) => key && writeRaw(key, JSON.stringify(g)), [key])
  const clearGoal = useCallback(() => key && writeRaw(key, null), [key])
  return { goal, setGoal, clearGoal }
}

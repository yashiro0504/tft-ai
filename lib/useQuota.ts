'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { kstDayWindow } from './dayWindow'

/**
 * 하루 무료 AI 분석 횟수 (임시: 브라우저 로컬 저장).
 *
 * ⚠️ 서버 한도 적용(전환 지시서 단계 5) 전까지 쓰는 임시 구현이다.
 *    화면은 이 훅 하나만 읽으므로, 나중에 서버 값(/api/me 등)으로 이 파일만 교체하면 된다.
 * - 한국 시간 자정에 초기화 (lib/dayWindow 와 같은 기준)
 * - 경기별/종합 분석이 같은 횟수를 나눠 쓴다.
 * - localStorage 가 막힌 환경에서는 탭 메모리로만 센다.
 * - 운영자 키 쿠키(/owner)가 있는 브라우저는 무제한 (쿠키는 httpOnly 라 /api/owner 로 한 번 확인한다).
 */
export const FREE_ANALYSIS_LIMIT = 3

const STORAGE_KEY = 'tft-analysis-quota'

let memory: { day: string; used: number } = { day: '', used: 0 }
const listeners = new Set<() => void>()

function read(): number {
  const today = kstDayWindow().key
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { day?: string; used?: number }
      if (parsed.day === today && typeof parsed.used === 'number') return parsed.used
      return 0
    }
  } catch {
    /* localStorage 차단 환경: 메모리 값 사용 */
  }
  return memory.day === today ? memory.used : 0
}

function write(used: number) {
  const day = kstDayWindow().key
  memory = { day, used }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ day, used }))
  } catch {
    /* 무시 */
  }
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) fn()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', onStorage)
  }
}

let ownerExempt = false
let ownerChecked = false

/** 페이지당 한 번 /api/owner 로 운영자 면제 여부를 확인한다 (실패하면 일반 사용자로 둔다) */
function checkOwner() {
  if (ownerChecked) return
  ownerChecked = true
  fetch('/api/owner', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d?.exempt === true) {
        ownerExempt = true
        listeners.forEach((fn) => fn())
      }
    })
    .catch(() => {})
}

function subscribeWithOwner(fn: () => void) {
  checkOwner()
  return subscribe(fn)
}

export function useQuota() {
  const used = useSyncExternalStore(subscribe, read, () => 0)
  const unlimited = useSyncExternalStore(subscribeWithOwner, () => ownerExempt, () => false)
  const limit = FREE_ANALYSIS_LIMIT
  const remaining = Math.max(0, limit - used)

  /** 분석 1회 사용 기록 (분석이 성공했을 때 호출) */
  const consume = useCallback(() => write(read() + 1), [])

  /**
   * 분석 응답 반영 — 서버가 이번 요청에서 실제로 차감했을 때(quota.charged)만 1회 센다.
   * 캐시 적중·AI 미사용 폴백·같은 경기 재분석은 서버가 차감하지 않으므로 화면도 그대로 (2026-10-29 지시문 2).
   * 서버 쿼터 정보가 없으면(면제·무제한·구버전 서버) 새로 만든 AI 리포트일 때만 센다.
   */
  const settle = useCallback(
    (res: { cached?: boolean; feedback?: { isFallback?: boolean } | null; quota?: { charged: boolean } }) => {
      const charged = res.quota ? res.quota.charged : !res.cached && !res.feedback?.isFallback
      if (charged) write(read() + 1)
    },
    []
  )

  return { limit, used, remaining, unlimited, exhausted: !unlimited && remaining === 0, consume, settle }
}

'use client'

import { useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { DEFAULT_DAYS, DEFAULT_TIER, parseStatFilter, type StatFilter } from '@/lib/statsShared'

/**
 * 메타 대시보드 필터·탭 ↔ URL 쿼리 동기화 (/meta 전용, UI 스프린트 S2).
 *
 * - `useSearchParams` 는 이 컴포넌트에만 둔다. 부모가 `<Suspense fallback={null}>` 로 감싸면
 *   /meta 는 정적(ISR) HTML 에 SSR 덱 표를 그대로 담고, URL 적용은 마운트 뒤에 일어난다.
 * - 기본값(최신 패치 · 마스터+ · 7일 · 덱 탭)은 쿼리에서 뺀다. 잘못된 값은 기본값으로 읽는다.
 * - 상태 → URL 은 history.replaceState (RSC 재요청 없음, 새로고침·공유에서 유지).
 * - URL → 상태는 뒤로가기/앞으로가기·링크 진입 시. 마지막으로 맞춘 쿼리를 ref 에 두어 서로 되먹임하지 않는다.
 */
export function MetaUrlSync<T extends string>({
  filter,
  tab,
  tabs,
  defaultTab,
  latestPatch,
  patches,
  syncFilter,
  onApply,
}: {
  filter: StatFilter
  tab: T
  tabs: readonly T[]
  defaultTab: T
  /** 최신 패치 (이 값이면 쿼리에서 생략) */
  latestPatch: string | null
  /** 사용 가능한 패치 — 목록에 없는 패치 쿼리는 무시 */
  patches: string[]
  /** DB 필터가 있을 때만 patch·tier·days 를 쿼리에 싣는다 */
  syncFilter: boolean
  onApply: (next: { filter: StatFilter; tab: T }) => void
}) {
  const sp = useSearchParams()
  const lastQuery = useRef<string | null>(null)

  const toQuery = (f: StatFilter, t: T) => {
    const q = new URLSearchParams()
    if (syncFilter) {
      if (f.patch && f.patch !== latestPatch) q.set('patch', f.patch)
      if (f.tier !== DEFAULT_TIER) q.set('tier', f.tier)
      if (f.days !== DEFAULT_DAYS) q.set('days', String(f.days))
    }
    if (t !== defaultTab) q.set('tab', t)
    return q.toString()
  }

  // URL → 상태 (첫 진입 · 뒤로가기/앞으로가기)
  useEffect(() => {
    const parsed = parseStatFilter(new URLSearchParams(sp.toString()))
    const rawTab = sp.get('tab') as T | null
    const next = {
      filter: syncFilter
        ? { ...parsed, patch: parsed.patch && patches.includes(parsed.patch) ? parsed.patch : latestPatch }
        : filter,
      tab: rawTab && tabs.includes(rawTab) ? rawTab : defaultTab,
    }
    const q = toQuery(next.filter, next.tab)
    if (q === lastQuery.current) return
    lastQuery.current = q
    const same =
      next.tab === tab && next.filter.patch === filter.patch && next.filter.tier === filter.tier && next.filter.days === filter.days
    if (!same) onApply(next)
    // 잘못된 값·기본값이 섞인 URL 은 정규화된 쿼리로 바꿔 둔다
    if (q !== sp.toString()) replaceQuery(q)
    // URL 이 바뀔 때만 반응한다 (상태 변화는 아래 effect 가 URL 로 보낸다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp])

  // 상태 → URL
  useEffect(() => {
    const q = toQuery(filter, tab)
    if (q === lastQuery.current) return
    lastQuery.current = q
    replaceQuery(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.patch, filter.tier, filter.days, tab])

  return null
}

function replaceQuery(q: string) {
  const url = `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`
  window.history.replaceState(window.history.state, '', url)
}

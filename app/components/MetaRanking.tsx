'use client'

import type { TftMetaResponse } from '@/lib/types'
import type { MetaFiltersResponse } from '@/lib/statsShared'
import { MetaDashboard } from './MetaDashboard'

/**
 * 기존 진입점 유지용 래퍼.
 * 카드형 구현(약 75KB)은 조밀 표 대시보드로 대체되었다. 원본은 git 히스토리에 남아 있다.
 */
export function MetaRanking({
  onOpenCoach,
  initialData,
  showTitle,
  deferSections,
  filters,
  initialDecksSource,
  decksUpdatedAt,
  syncUrl,
}: {
  onOpenCoach?: () => void
  initialData?: TftMetaResponse
  showTitle?: boolean
  deferSections?: boolean
  filters?: MetaFiltersResponse
  initialDecksSource?: 'db' | 'json'
  /** 덱 스냅샷 갱신 시각 (덱 성적표와 같은 값) */
  decksUpdatedAt?: string
  /** 필터·탭 URL 동기화 (/meta) */
  syncUrl?: boolean
}) {
  return (
    <MetaDashboard
      onOpenCoach={onOpenCoach}
      initialData={initialData}
      showTitle={showTitle}
      deferSections={deferSections}
      filters={filters}
      initialDecksSource={initialDecksSource}
      decksUpdatedAt={decksUpdatedAt}
      syncUrl={syncUrl}
    />
  )
}

'use client'

import type { TftMetaResponse } from '@/lib/types'
import { MetaDashboard } from './MetaDashboard'

/**
 * 기존 진입점 유지용 래퍼.
 * 카드형 구현(약 75KB)은 조밀 표 대시보드로 대체되었다. 원본은 git 히스토리에 남아 있다.
 */
export function MetaRanking({
  onOpenCoach,
  initialData,
}: {
  onOpenCoach?: () => void
  initialData?: TftMetaResponse
}) {
  return <MetaDashboard onOpenCoach={onOpenCoach} initialData={initialData} />
}

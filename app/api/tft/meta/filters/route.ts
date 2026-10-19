import { NextRequest, NextResponse } from 'next/server'
import { getMetaFilters } from '@/lib/tftStats'
import { rateLimitGuard, handleApiError } from '@/lib/apiUtils'
import { STATS_CACHE_HEADERS } from '@/lib/statsCache'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tft/meta/filters
 *
 * 메타 대시보드 필터 목록: 집계에 있는 패치(최신순) · 티어 필터별 판 수 · 기본값 · 표본 하한.
 * source 가 'json' 이면 DB 집계를 쓸 수 없는 상태이므로 화면은 필터를 숨기고 JSON 스냅샷을 보여 준다.
 */
export async function GET(req: NextRequest) {
  try {
    const limited = rateLimitGuard(req, 'meta_filters', 60, 60_000)
    if (limited) return limited
    return NextResponse.json(await getMetaFilters(), { headers: STATS_CACHE_HEADERS })
  } catch (err) {
    return handleApiError(err, 'meta_filters')
  }
}

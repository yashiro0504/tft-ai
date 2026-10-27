import { NextRequest, NextResponse } from 'next/server'
import { getBuilds } from '@/lib/tftStats'
import { parseStatFilter } from '@/lib/statsShared'
import { rateLimitGuard, handleApiError } from '@/lib/apiUtils'
import { STATS_CACHE_HEADERS } from '@/lib/statsCache'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tft/builds?patch=&tier=
 *
 * 기물 빌드(아이템 3개를 함께 든 세트) — 수집기가 덱 클러스터와 같이 하루 1회 패치 × 티어 필터별로 만든 stat_unit_build.
 * 기간 필터는 없다 (패치 전체). DB 가 없거나 0008 미적용·실패면 lib/unitBuilds.json 으로 폴백한다 (source 로 구분).
 */
export async function GET(req: NextRequest) {
  try {
    const limited = rateLimitGuard(req, 'builds', 60, 60_000)
    if (limited) return limited
    const { patch, tier } = parseStatFilter(req.nextUrl.searchParams)
    return NextResponse.json(await getBuilds({ patch, tier }), { headers: STATS_CACHE_HEADERS })
  } catch (err) {
    return handleApiError(err, 'builds')
  }
}

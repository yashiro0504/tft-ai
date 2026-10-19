import { NextRequest, NextResponse } from 'next/server'
import { getDecks } from '@/lib/tftStats'
import { parseStatFilter } from '@/lib/statsShared'
import { rateLimitGuard, handleApiError } from '@/lib/apiUtils'
import { STATS_CACHE_HEADERS } from '@/lib/statsCache'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tft/decks?patch=&tier=
 *
 * 덱 티어표 — 수집기가 하루 1회 패치 × 티어 필터별로 묶은 stat_comp.
 * 기간 필터는 없다 (패치 전체). DB 가 없거나 실패하면 lib/decksData.json 으로 폴백한다.
 */
export async function GET(req: NextRequest) {
  try {
    const limited = rateLimitGuard(req, 'decks', 60, 60_000)
    if (limited) return limited
    const { patch, tier } = parseStatFilter(req.nextUrl.searchParams)
    return NextResponse.json(await getDecks({ patch, tier }), { headers: STATS_CACHE_HEADERS })
  } catch (err) {
    return handleApiError(err, 'decks')
  }
}

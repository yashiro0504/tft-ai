import { NextRequest, NextResponse } from 'next/server'
import { getStats, isStatType } from '@/lib/tftStats'
import { parseStatFilter } from '@/lib/statsShared'
import { rateLimitGuard, handleApiError } from '@/lib/apiUtils'
import { STATS_CACHE_HEADERS } from '@/lib/statsCache'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tft/stats?type=unit|item|trait|unit_item&patch=&tier=&days=[&unit=]
 *
 * Supabase 일별 집계(0006_tft_rollups.sql)를 필터(패치 · 티어 이상 · 최근 N일)로 합친 표.
 * DB 가 없거나 실패하면 lib/metaStats.json 으로 폴백한다 (source: 'json', filter: null).
 * - tier: challenger | grandmaster | master(기본) | diamond — 그 구간 이상 누적
 * - days: 3 | 7(기본) | 0(패치 전체)
 * - unit: type=unit_item 일 때 기물 키로 거른다 (BIS)
 */
export async function GET(req: NextRequest) {
  try {
    const limited = rateLimitGuard(req, 'stats', 120, 60_000)
    if (limited) return limited

    const params = req.nextUrl.searchParams
    const type = params.get('type')
    if (!isStatType(type)) {
      return NextResponse.json({ success: false, error: 'type 은 unit | item | trait | unit_item 중 하나여야 합니다.' }, { status: 400 })
    }
    const res = await getStats(type, parseStatFilter(params))
    const unit = params.get('unit')
    if (type === 'unit_item' && unit) {
      const u = unit.toLowerCase()
      res.rows = res.rows.filter((r) => 'champKey' in r && r.champKey.toLowerCase() === u)
    }
    return NextResponse.json(res, { headers: STATS_CACHE_HEADERS })
  } catch (err) {
    return handleApiError(err, 'stats')
  }
}

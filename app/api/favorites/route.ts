import { NextRequest, NextResponse } from 'next/server'
import { rateLimitGuard } from '@/lib/apiUtils'
import {
  MAX_FAVORITES,
  addFavorite,
  listFavorites,
  parseFavoriteInput,
  removeFavorite,
} from '@/lib/favorites'
import { incrMetric, logEvent } from '@/lib/observability'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { getAuthUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }
const RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000

function unauthorized() {
  return NextResponse.json(
    {
      success: false,
      configured: isSupabaseConfigured(),
      error: '로그인이 필요합니다.',
    },
    { status: 401, headers: NO_STORE_HEADERS }
  )
}

/**
 * GET /api/favorites — 로그인 사용자의 즐겨찾기 목록 (최신순).
 * Supabase 미설정 시에도 200 + 빈 목록을 반환해 UI 가 조용히 익명 모드로 동작한다.
 */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { success: true, configured: false, favorites: [], max: MAX_FAVORITES },
      { headers: NO_STORE_HEADERS }
    )
  }

  const user = await getAuthUser()
  if (!user) return unauthorized()

  const favorites = await listFavorites(user.id)
  if (favorites === null) {
    return NextResponse.json(
      { success: false, configured: true, error: '즐겨찾기를 불러오지 못했습니다.' },
      { status: 503, headers: NO_STORE_HEADERS }
    )
  }

  return NextResponse.json(
    { success: true, configured: true, favorites, max: MAX_FAVORITES },
    { headers: NO_STORE_HEADERS }
  )
}

/**
 * POST /api/favorites — 즐겨찾기 추가. 이미 있으면 200(created=false).
 * body: { gameName, tagLine, region? }
 */
export async function POST(req: NextRequest) {
  const limited = rateLimitGuard(req, 'favorites', RATE_LIMIT, RATE_WINDOW_MS)
  if (limited) return limited

  const user = await getAuthUser()
  if (!user) return unauthorized()

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { success: false, error: '요청 본문(JSON) 형식이 올바르지 않습니다.' },
      { status: 400, headers: NO_STORE_HEADERS }
    )
  }

  const parsed = parseFavoriteInput(raw)
  if ('error' in parsed) {
    return NextResponse.json(
      { success: false, error: parsed.error },
      { status: 400, headers: NO_STORE_HEADERS }
    )
  }

  const result = await addFavorite(user.id, parsed.value)
  if (!result.ok) {
    incrMetric(`favorites.rejected.${result.code}`)
    logEvent('warn', 'favorite_add_rejected', { code: result.code })
    return NextResponse.json(
      { success: false, code: result.code, error: result.message, max: MAX_FAVORITES },
      { status: result.code === 'limit' ? 409 : 503, headers: NO_STORE_HEADERS }
    )
  }

  return NextResponse.json(
    { success: true, favorite: result.entry, created: result.created, max: MAX_FAVORITES },
    { status: result.created ? 201 : 200, headers: NO_STORE_HEADERS }
  )
}

/**
 * DELETE /api/favorites?gameName=..&tagLine=..&region=kr — 즐겨찾기 삭제.
 * 이미 없으면 200(removed=false).
 */
export async function DELETE(req: NextRequest) {
  const limited = rateLimitGuard(req, 'favorites', RATE_LIMIT, RATE_WINDOW_MS)
  if (limited) return limited

  const user = await getAuthUser()
  if (!user) return unauthorized()

  const params = req.nextUrl.searchParams
  const parsed = parseFavoriteInput({
    gameName: params.get('gameName') ?? '',
    tagLine: params.get('tagLine') ?? '',
    region: params.get('region') ?? '',
  })
  if ('error' in parsed) {
    return NextResponse.json(
      { success: false, error: parsed.error },
      { status: 400, headers: NO_STORE_HEADERS }
    )
  }

  const result = await removeFavorite(user.id, parsed.value)
  if (!result.ok) {
    return NextResponse.json(
      { success: false, code: result.code, error: result.message },
      { status: 503, headers: NO_STORE_HEADERS }
    )
  }

  return NextResponse.json(
    { success: true, removed: result.removed },
    { headers: NO_STORE_HEADERS }
  )
}

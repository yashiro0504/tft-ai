/**
 * 즐겨찾기 데이터 접근 (서버 전용).
 *
 * - Supabase 미설정/오류 시 `null` 을 반환해 호출부가 503/500 으로 응답한다.
 * - service role key 를 쓰지 않는다. anon key + 사용자 세션 + RLS 로 본인 행만 다룬다.
 * - 개수 상한(MAX_FAVORITES)은 애플리케이션에서 강제한다.
 */
import { createSupabaseServerClient } from './supabase/server'
import { errorFields, incrMetric, logEvent } from './observability'

export const MAX_FAVORITES = 20
export const SUPPORTED_REGION = 'kr'

export interface FavoriteEntry {
  region: string
  gameName: string
  tagLine: string
  createdAt: string
}

export interface FavoriteInput {
  region: string
  gameName: string
  tagLine: string
}

/** `이름#태그` 형태도 허용하고, 공백/길이/지역을 검증한다. */
export function parseFavoriteInput(raw: unknown): { value: FavoriteInput } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: '요청 본문이 올바르지 않습니다.' }
  }
  const obj = raw as Record<string, unknown>

  let gameName = typeof obj.gameName === 'string' ? obj.gameName.trim() : ''
  let tagLine = typeof obj.tagLine === 'string' ? obj.tagLine.trim() : ''
  const regionRaw = typeof obj.region === 'string' ? obj.region.trim().toLowerCase() : ''
  const region = regionRaw || SUPPORTED_REGION

  if (gameName.includes('#')) {
    const [namePart, tagPart] = gameName.split('#')
    gameName = (namePart || '').trim()
    tagLine = tagLine || (tagPart || '').trim()
  }

  if (!gameName) return { error: '소환사 닉네임을 입력해주세요.' }
  if (gameName.length > 32) return { error: '소환사 닉네임은 32자 이내로 입력해주세요.' }
  if (!tagLine) return { error: '태그를 입력해주세요. (예: KR1)' }
  if (tagLine.length > 10) return { error: '태그는 10자 이내로 입력해주세요.' }
  if (region !== SUPPORTED_REGION) return { error: '지원하지 않는 지역입니다.' }

  return { value: { region, gameName, tagLine } }
}

/** 대소문자 무시 비교용 키 */
function favoriteKey(region: string, gameName: string, tagLine: string): string {
  return `${region.toLowerCase()}|${gameName.toLowerCase()}|${tagLine.toUpperCase()}`
}

interface FavoriteRow {
  id: number
  region: string
  game_name: string
  tag_line: string
  created_at: string
}

function toEntry(row: FavoriteRow): FavoriteEntry {
  return {
    region: row.region,
    gameName: row.game_name,
    tagLine: row.tag_line,
    createdAt: row.created_at,
  }
}

/** 즐겨찾기 목록 (최신순). 저장소 오류/미설정 시 null. */
export async function listFavorites(userId: string): Promise<FavoriteEntry[] | null> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return null

    const { data, error } = await supabase
      .from('favorites')
      .select('id, region, game_name, tag_line, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(MAX_FAVORITES)

    if (error) {
      incrMetric('favorites.list_error')
      logEvent('warn', 'favorites_list_failed', { code: error.code })
      return null
    }
    return (data as FavoriteRow[] | null)?.map(toEntry) ?? []
  } catch (err) {
    incrMetric('favorites.list_error')
    logEvent('warn', 'favorites_list_failed', errorFields(err))
    return null
  }
}

export type AddFavoriteResult =
  | { ok: true; entry: FavoriteEntry; created: boolean }
  | { ok: false; code: 'limit' | 'storage'; message: string }

/** 즐겨찾기 추가. 이미 있으면 created=false 로 성공 처리한다(중복 방지). */
export async function addFavorite(userId: string, input: FavoriteInput): Promise<AddFavoriteResult> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) {
      return { ok: false, code: 'storage', message: '즐겨찾기 저장소가 설정되지 않았습니다.' }
    }

    const current = await listFavorites(userId)
    if (current === null) {
      return { ok: false, code: 'storage', message: '즐겨찾기를 불러오지 못했습니다.' }
    }

    const key = favoriteKey(input.region, input.gameName, input.tagLine)
    const existing = current.find((f) => favoriteKey(f.region, f.gameName, f.tagLine) === key)
    if (existing) return { ok: true, entry: existing, created: false }

    if (current.length >= MAX_FAVORITES) {
      return {
        ok: false,
        code: 'limit',
        message: `즐겨찾기는 최대 ${MAX_FAVORITES}개까지 저장할 수 있습니다.`,
      }
    }

    const { data, error } = await supabase
      .from('favorites')
      .insert({
        user_id: userId,
        region: input.region,
        game_name: input.gameName,
        tag_line: input.tagLine,
      })
      .select('id, region, game_name, tag_line, created_at')
      .single()

    if (error) {
      // 23505: 유니크 위반 = 동시 요청으로 이미 저장됨 → 성공으로 처리
      if (error.code === '23505') {
        const again = await listFavorites(userId)
        const found = again?.find((f) => favoriteKey(f.region, f.gameName, f.tagLine) === key)
        if (found) return { ok: true, entry: found, created: false }
      }
      incrMetric('favorites.insert_error')
      logEvent('warn', 'favorites_insert_failed', { code: error.code })
      return { ok: false, code: 'storage', message: '즐겨찾기 저장에 실패했습니다.' }
    }

    incrMetric('favorites.added')
    return { ok: true, entry: toEntry(data as FavoriteRow), created: true }
  } catch (err) {
    incrMetric('favorites.insert_error')
    logEvent('warn', 'favorites_insert_failed', errorFields(err))
    return { ok: false, code: 'storage', message: '즐겨찾기 저장에 실패했습니다.' }
  }
}

export type RemoveFavoriteResult =
  | { ok: true; removed: boolean }
  | { ok: false; code: 'storage'; message: string }

/** 즐겨찾기 삭제 (대소문자 무시 매칭). 없으면 removed=false 로 성공 처리한다. */
export async function removeFavorite(userId: string, input: FavoriteInput): Promise<RemoveFavoriteResult> {
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) {
      return { ok: false, code: 'storage', message: '즐겨찾기 저장소가 설정되지 않았습니다.' }
    }

    const current = await listFavorites(userId)
    if (current === null) {
      return { ok: false, code: 'storage', message: '즐겨찾기를 불러오지 못했습니다.' }
    }

    const key = favoriteKey(input.region, input.gameName, input.tagLine)
    const target = current.find((f) => favoriteKey(f.region, f.gameName, f.tagLine) === key)
    if (!target) return { ok: true, removed: false }

    // id 기준 삭제 + user_id 조건으로 이중 방어 (RLS 도 본인 행만 허용)
    const { error } = await supabase
      .from('favorites')
      .delete()
      .eq('user_id', userId)
      .eq('region', target.region)
      .eq('game_name', target.gameName)
      .eq('tag_line', target.tagLine)

    if (error) {
      incrMetric('favorites.delete_error')
      logEvent('warn', 'favorites_delete_failed', { code: error.code })
      return { ok: false, code: 'storage', message: '즐겨찾기 삭제에 실패했습니다.' }
    }

    incrMetric('favorites.removed')
    return { ok: true, removed: true }
  } catch (err) {
    incrMetric('favorites.delete_error')
    logEvent('warn', 'favorites_delete_failed', errorFields(err))
    return { ok: false, code: 'storage', message: '즐겨찾기 삭제에 실패했습니다.' }
  }
}

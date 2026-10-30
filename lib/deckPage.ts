import { getDeckById, getMetaDeckSnapshot } from './tftStats'
import { toMetaDeck } from './metaPayload'
import { TIER_FILTER_OPTIONS, type DecksResponse, type TierFilter } from './statsShared'
import type { MetaDeckRanking } from './types'

/**
 * 덱 페이지(/deck/[id])·OG 이미지가 쓰는 덱 해석 (서버 전용).
 * 2026-10-30 2차 지시문 1: 덱 페이지가 래더 JSON(decksData.json)을 먼저 읽어 메타 랭킹(덱 성적표 스냅샷)과 100개 중 44개가 달랐다
 * (개화 카르마 6.19등 · 75판 ↔ 메타 5.78등 · 1,038판, "패치 정보 없음"). 이제 기본 덱 페이지는 메타와 같은 스냅샷 하나만 읽고,
 * 스냅샷에 없는 id 는 404 다. 메타 대시보드의 다른 패치·티어 필터 링크(?patch=&tier=)만 같은 DB(stat_comp)에서 그 필터로 연다.
 */

export interface DeckPageData {
  deck: MetaDeckRanking
  /** 화면 머리말 — 항상 채운다 ("패치 정보 없음" 금지) */
  patch: string | null
  tierLabel: string | null
  updatedAt?: string
  /** 메타 기본 스냅샷이 아닌 필터 덱이면 쿼리를 공유 링크에 싣는다 */
  query: { patch: string; tier: TierFilter } | null
}

const PATCH_RE = /^\d{1,2}\.\d{1,2}$/

const tierLabelOf = (t: TierFilter | null | undefined) => (t ? TIER_FILTER_OPTIONS.find((o) => o.id === t)?.label ?? t : null)

/** 스냅샷 응답의 패치 (세트 표기 'set18' 은 패치가 아니다) */
export function snapshotPatch(res: Pick<DecksResponse, 'filter' | 'patch'>): string | null {
  const p = res.filter?.patch ?? res.patch ?? null
  return p && PATCH_RE.test(p) ? p : null
}

/** 스냅샷 덱 목록에서 id 로 1개 (테스트에서도 같은 함수로 메타 값과 대조한다) */
export function deckFromSnapshot(res: DecksResponse, id: string): DeckPageData | null {
  const deck = res.decks?.find((d) => d.id === id)
  if (!deck) return null
  return { deck, patch: snapshotPatch(res), tierLabel: tierLabelOf(res.filter?.tier ?? null), updatedAt: res.updatedAt, query: null }
}

/** 머리말 문구: "패치 16.21 · 마스터+ 집계" — 패치를 모르면 스냅샷 시각으로 (빈칸·"패치 정보 없음" 없음) */
export function deckSnapshotLabel(d: Pick<DeckPageData, 'patch' | 'tierLabel' | 'updatedAt'>): string {
  const head = d.patch ? `패치 ${d.patch}` : '최신 스냅샷'
  return d.tierLabel ? `${head} · ${d.tierLabel} 집계` : `${head} 집계`
}

/** 덱 1개 — 쿼리가 없거나 스냅샷과 같은 필터면 스냅샷, 다른 필터면 그 패치·티어 DB 덱. 없으면 null(404) */
export async function resolveDeckPage(id: string, q: { patch: string | null; tier: TierFilter | null } = { patch: null, tier: null }): Promise<DeckPageData | null> {
  const snapshot = await getMetaDeckSnapshot()
  const samePatch = !q.patch || q.patch === snapshot.filter?.patch
  const sameTier = !q.tier || q.tier === snapshot.filter?.tier
  if ((samePatch && sameTier) || snapshot.source !== 'db') return deckFromSnapshot(snapshot, id)
  const db = await getDeckById(id, { patch: q.patch, tier: q.tier })
  if (!db) return null
  return {
    deck: toMetaDeck(db.deck),
    patch: PATCH_RE.test(db.patch) ? db.patch : null,
    tierLabel: tierLabelOf(db.tierMin),
    updatedAt: db.updatedAt,
    query: { patch: db.patch, tier: db.tierMin },
  }
}

/** 페이지 본문·<title>·설명·OG 가 같은 문자열을 쓰게 한 곳에서 만든다 */
export function deckHeadline(deck: Pick<MetaDeckRanking, 'avgPlacement' | 'top4Rate'>): string {
  const avg = typeof deck.avgPlacement === 'number' ? deck.avgPlacement.toFixed(2) : '-'
  const top4 = typeof deck.top4Rate === 'number' ? `${Math.round(deck.top4Rate * 100)}%` : '-'
  return `평균 ${avg}등 · TOP4 ${top4}`
}

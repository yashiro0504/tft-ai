import type { DecksResponse, MetaFiltersResponse, StatFilter, TierFilter } from './statsShared'

/**
 * 메타 덱 스냅샷 고르기 (순수 함수 — scripts/testSitemapDecks.js).
 *
 * 2026-11-04 지시문(sitemap 덱 URL 404): 16.22 전환 첫날, 새 패치 판 수가 기준(500판) 미만이거나 새 패치 덱 클러스터(stat_comp)가
 * 아직 없어 스냅샷이 래더 JSON 폴백으로 바뀌었다. 폴백은 1분만 캐시되고 그 뒤엔 마지막 DB 사본(16.21)을 다시 주어,
 * 스냅샷이 1분 간격으로 DB(16.21) ↔ 래더 JSON 을 오갔다. 두 목록은 덱 id 형식(ladder-…)이 같고 절반만 겹쳐서,
 * 한쪽으로 만든 sitemap 의 덱 100개 중 53개가 다른 쪽으로 연 덱 페이지에서 404 였다.
 *
 * 규칙: 같은 세트의 DB 스냅샷 사본이 있으면 래더 JSON 으로 내려가지 않는다.
 *  1) 최신 패치의 DB 덱이 있으면 그것
 *  2) 없으면(새 패치 표본 부족 · 새 패치 덱 클러스터 전 · DB 오류) 마지막 DB 스냅샷 사본 — heldReason 을 달아 짧게만 캐시하고 곧 다시 고른다
 *  3) 사본도 없을 때만 래더 JSON (DB 를 처음 켠 직후 · 새 세트 첫날 · DB 미설정)
 */
export interface SnapshotDeps {
  getMetaFilters: () => Promise<MetaFiltersResponse>
  getDecks: (filter: Pick<StatFilter, 'patch' | 'tier'>) => Promise<DecksResponse>
  /** 마지막으로 만든 DB 스냅샷 사본 (없으면 null) */
  lastDbSnapshot: () => Promise<DecksResponse | null>
}

const hasDbDecks = (r: DecksResponse | null | undefined): boolean => Boolean(r && r.source === 'db' && r.decks?.length)

export async function buildMetaDeckSnapshot(deps: SnapshotDeps): Promise<DecksResponse> {
  const filters = await deps.getMetaFilters()
  const tier: TierFilter = filters.defaults.tier
  const latest = await deps.getDecks({ patch: filters.source === 'db' ? filters.defaults.patch : null, tier })
  if (hasDbDecks(latest)) return latest

  // 이전 패치 DB 덱을 새로 조회하지 않고 사본을 쓴다 — 사본 키에는 세트가 들어 있어(SNAPSHOT_STALE_KEY) 세트 전환 뒤
  // 이전 세트 덱을 붙잡지 않는다. 사본이 없으면(첫 DB 전 · 3일 만료) 래더 JSON 하나로 일관되게 간다
  const reason = latest.fallbackReason || filters.fallbackReason || 'empty'
  const last = await deps.lastDbSnapshot().catch(() => null)
  if (last && hasDbDecks(last)) return { ...last, heldReason: reason }
  return latest
}

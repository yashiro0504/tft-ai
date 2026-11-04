import type { MetadataRoute } from 'next'
import { listDeckPageIds } from '@/lib/deckPage'
import { SITE_URL } from '@/lib/site'
import { listEntitySlugs } from '@/lib/entityData'
import { ENTITY_PATH, type EntityKind } from '@/lib/entitySlug'

/**
 * 요청마다 만든다 (2026-11-04 지시문: sitemap 덱 URL 100개 중 53개 404).
 * 예전에는 1시간 캐시(revalidate 3600)라 덱 페이지(5분)와 다른 순간의 스냅샷을 실었다. 이제 덱 페이지와 같은 함수
 * (lib/deckPage listDeckPageIds → 같은 Redis 스냅샷)를 요청 시점에 읽어, 실린 덱은 그 순간 덱 페이지에서 200 이다.
 * 스냅샷은 Redis 공유 캐시라 요청마다 DB 를 치지 않는다.
 */
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  // 덱 페이지는 메타 랭킹과 같은 스냅샷의 덱만 열린다 (스냅샷에 없는 id 는 404 — 2026-10-30 2차 지시문 1).
  // 실패하면 덱을 싣지 않는다 (404 가 날 수 있는 URL 을 싣느니 빼는 쪽)
  const snapshot = await listDeckPageIds().catch(() => null)
  const deckUpdated = snapshot?.updatedAt && !Number.isNaN(Date.parse(snapshot.updatedAt)) ? new Date(snapshot.updatedAt) : now

  const deckEntries: MetadataRoute.Sitemap = (snapshot?.ids ?? []).map((id) => ({
    url: `${SITE_URL}/deck/${id}`,
    lastModified: deckUpdated,
    changeFrequency: 'daily',
    priority: 0.7,
  }))

  // 기물·아이템·시너지 상세 (표본 충분한 항목만)
  const entityEntries: MetadataRoute.Sitemap = (['champion', 'trait', 'item'] as EntityKind[]).flatMap((kind) =>
    listEntitySlugs(kind).map((slug) => ({
      url: `${SITE_URL}${ENTITY_PATH[kind]}/${slug}`,
      lastModified: deckUpdated,
      changeFrequency: 'daily' as const,
      priority: kind === 'item' ? 0.5 : 0.6,
    }))
  )

  return [
    {
      url: `${SITE_URL}/`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${SITE_URL}/meta`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    ...deckEntries,
    ...entityEntries,
    {
      url: `${SITE_URL}/pro`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ]
}

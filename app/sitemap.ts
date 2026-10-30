import type { MetadataRoute } from 'next'
import { getMetaDeckSnapshot } from '@/lib/tftStats'
import { SITE_URL } from '@/lib/site'
import { listEntitySlugs } from '@/lib/entityData'
import { ENTITY_PATH, type EntityKind } from '@/lib/entitySlug'

/** 덱 목록이 메타 스냅샷을 따라가도록 한 시간마다 다시 만든다 (빌드 시점 스냅샷에 고정되지 않게) */
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  // 덱 페이지는 메타 랭킹과 같은 스냅샷의 덱만 열린다 (스냅샷에 없는 id 는 404 — 2026-10-30 2차 지시문 1)
  const snapshot = await getMetaDeckSnapshot().catch(() => null)
  const deckUpdated = snapshot?.updatedAt && !Number.isNaN(Date.parse(snapshot.updatedAt)) ? new Date(snapshot.updatedAt) : now

  const deckEntries: MetadataRoute.Sitemap = (snapshot?.decks ?? []).map((deck) => ({
    url: `${SITE_URL}/deck/${deck.id}`,
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

import type { MetadataRoute } from 'next'
import { getDeckMetaInfo, getDeckViews } from '@/lib/decks'
import { SITE_URL } from '@/lib/site'
import { listEntitySlugs } from '@/lib/entityData'
import { ENTITY_PATH, type EntityKind } from '@/lib/entitySlug'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const deckMeta = getDeckMetaInfo()
  const deckUpdated = deckMeta.generatedAt && !Number.isNaN(Date.parse(deckMeta.generatedAt))
    ? new Date(deckMeta.generatedAt)
    : now

  const deckEntries: MetadataRoute.Sitemap = getDeckViews().map((deck) => ({
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

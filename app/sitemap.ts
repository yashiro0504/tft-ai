import type { MetadataRoute } from 'next'
import { getDeckMetaInfo, getDeckViews } from '@/lib/decks'
import { SITE_URL } from '@/lib/site'

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

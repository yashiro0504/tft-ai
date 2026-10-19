/** /api/tft/stats · /api/tft/decks · /api/tft/meta/filters 공통 CDN 캐시 (집계는 매시간 갱신) */
export const STATS_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
} as const

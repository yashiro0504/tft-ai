import type { MetadataRoute } from 'next'
import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/site'

/**
 * PWA 매니페스트 (`/manifest.webmanifest`).
 * 아이콘은 `npm run icons` (scripts/generateIcons.js) 로 생성한다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: `${SITE_NAME} — 시즌 18 메타 랭킹 & AI 코치`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    lang: 'ko',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    // 다크 테마 기본 배경과 동일 (스플래시 화면 색)
    background_color: '#0E1320',
    theme_color: '#0E1320',
    categories: ['games', 'sports', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: '메타 랭킹',
        short_name: '메타',
        description: '기물·시너지·아이템 티어표',
        url: '/rank',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'AI 코치',
        short_name: '코치',
        description: '내 전적 검색 및 경기별 AI 분석',
        url: '/?tab=coach',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
    ],
  }
}

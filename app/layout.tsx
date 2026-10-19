import type { Metadata, Viewport } from 'next'
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site'
import './globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // 모바일 브라우저 상단바 색. 테마 토글 시 ThemeToggle 이 이 값을 함께 갱신한다.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F5F7FB' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1320' },
  ],
}

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'TFT LAB — 시즌 18 메타 랭킹 & AI 코치',
    template: '%s | TFT LAB',
  },
  description:
    'TFT 시즌 18 실측 매치 표본 기반 메타 랭킹(기물·시너지·아이템·BIS 조합)과 경기별 AI 전략 코칭을 제공하는 롤체 분석 사이트',
  keywords: ['TFT', '롤토체스', '전략적팀전투', '롤체 메타', 'TFT 티어표', 'TFT 조합', 'AI 코치', '덱 빌드업'],
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'TFT LAB — 시즌 18 메타 랭킹 & AI 코치',
    description: SITE_DESCRIPTION,
    type: 'website',
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: 'ko_KR',
  },
  twitter: {
    card: 'summary',
    title: 'TFT LAB — 시즌 18 메타 랭킹 & AI 코치',
    description: '실측 매치 표본 기반 TFT 메타 티어표와 경기별 AI 전략 코칭',
  },
  manifest: '/manifest.webmanifest',
  applicationName: SITE_NAME,
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false, address: false, email: false },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
    shortcut: ['/favicon.ico'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script
          // 저장된 테마(또는 시스템 설정)를 첫 페인트 전에 적용해 깜빡임 방지
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('tft-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.dataset.theme=t;}catch(e){}})();`,
          }}
        />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link rel="preconnect" href="https://ddragon.leagueoflegends.com" />
        <link rel="preconnect" href="https://raw.communitydragon.org" />
        <link
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
          rel="stylesheet"
        />
      </head>
      <body className="font-pretendard bg-app text-ink antialiased min-h-screen selection:bg-accent selection:text-on-accent">
        {children}
      </body>
    </html>
  )
}

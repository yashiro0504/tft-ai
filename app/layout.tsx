import type { Metadata, Viewport } from 'next'
import './globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'TFT LAB — 시즌 18 메타 랭킹 & AI 코치',
  description:
    'TFT 시즌 18 실측 매치 표본 기반 메타 랭킹(기물·시너지·아이템·BIS 조합)과 경기별 AI 전략 코칭을 제공하는 롤체 분석 사이트',
  keywords: ['TFT', '롤토체스', '전략적팀전투', '롤체 메타', 'TFT 티어표', 'TFT 조합', 'AI 코치', '덱 빌드업'],
  openGraph: {
    title: 'TFT LAB — 시즌 18 메타 랭킹 & AI 코치',
    description: '실측 매치 표본 기반 TFT 메타 티어표와 경기별 AI 전략 코칭',
    type: 'website',
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
        <link
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-pretendard bg-app text-ink antialiased min-h-screen selection:bg-rose-500 selection:text-white">
        {children}
      </body>
    </html>
  )
}

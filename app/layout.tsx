import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '🎯 TFT 메타 분석 & AI 전략 코치 | 롤체 실전 개선 리포트',
  description: '최근 롤체 경기 전적과 정석 메타 적합도를 정밀 분석하고 구체적인 실력 개선 포인트를 제공하는 AI 전략 코치',
  keywords: ['TFT', '롤토체스', '전략적팀전투', '롤체 메타 분석', 'AI 코치', 'TFT 공략', '덱 빌드업'],
  openGraph: {
    title: '🎯 TFT 메타 분석 & AI 전략 코치',
    description: '내 플레이가 현재 메타와 얼마나 맞았는지 정밀 진단하고 다음 경기 승률을 올릴 액션 플랜을 제시합니다.',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <head>
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
      <body className="font-pretendard bg-[#090D16] text-slate-100 antialiased min-h-screen selection:bg-rose-500 selection:text-white">
        {children}
      </body>
    </html>
  )
}

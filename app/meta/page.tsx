import type { Metadata } from 'next'
import Link from 'next/link'
import { buildMetaPayload } from '@/lib/metaPayload'
import { toDecksOnly } from '@/lib/metaSlim'
import { MetaRanking } from '@/app/components/MetaRanking'
import { SimpleHeader } from '@/app/components/SimpleHeader'
import { SiteFooter } from '@/app/components/SiteFooter'
import { SITE_URL } from '@/lib/site'

// 빌드 타임 JSON 기반이므로 정적 생성 + 5분 ISR.
export const revalidate = 300

export const metadata: Metadata = {
  title: '시즌 18 메타 랭킹 — 기물·시너지·아이템 티어표',
  description:
    '챌린저 래더 실측 표본 기반 TFT 시즌 18 메타 랭킹. 기물 티어, 시너지, 아이템, BIS 조합과 추천 덱을 평균 등수·순방률로 확인하세요.',
  alternates: { canonical: `${SITE_URL}/meta` },
  openGraph: {
    title: 'TFT LAB — 시즌 18 메타 랭킹',
    description: '실측 매치 표본 기반 기물·시너지·아이템·BIS 조합 티어표',
    url: `${SITE_URL}/meta`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'TFT LAB — 시즌 18 메타 랭킹',
    description: '실측 매치 표본 기반 기물·시너지·아이템·BIS 조합 티어표',
  },
}

export default function MetaPage() {
  const data = buildMetaPayload()
  const patchLabel = data.patch ? `패치 ${data.patch}` : '패치 정보 없음'
  const updated = data.generatedAt ? new Date(data.generatedAt).toLocaleDateString('ko-KR') : '-'

  return (
    <div className="min-h-screen bg-app text-ink">
      <SimpleHeader active="meta" />

      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-black tracking-tight md:text-2xl">시즌 18 메타 랭킹</h1>
          <p className="mt-1 text-xs text-muted">
            챌린저 래더 실측 표본 · {patchLabel} · 갱신 {updated}
            {!data.hasMeta ? ' · 표본 수집 전(샘플)' : ''}
          </p>
        </div>

        <MetaRanking initialData={toDecksOnly(data)} deferSections />

        <div className="mt-8 text-center">
          <Link href="/" className="text-xs text-muted underline transition hover:text-ink">
            내 전적 AI 코칭 받으러 가기 →
          </Link>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}

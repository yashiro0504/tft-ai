import type { Metadata } from 'next'
import Link from 'next/link'
import { buildMetaPayload } from '@/lib/metaPayload'
import { toDecksOnly } from '@/lib/metaSlim'
import { getMetaFilters } from '@/lib/tftStats'
import { withDeckSnapshot } from '@/lib/metaSnapshot'
import { metaMatchesLabel, metaScopeLabel, metaSnapshotLabel, snapshotFailed } from '@/lib/deckReportShared'
import { MetaRanking } from '@/app/components/MetaRanking'
import { SimpleHeader } from '@/app/components/SimpleHeader'
import { SiteFooter } from '@/app/components/SiteFooter'
import { SITE_URL } from '@/lib/site'

// 요청마다 렌더 — 덱 탭은 덱 성적표와 같은 공유 스냅샷(lib/tftStats getMetaDeckSnapshot, Redis 5분)을 그 시점에 읽는다.
// 예전엔 정적 생성 + ISR 이라 빌드 때 그린 JSON 래더 표본(10.28 09:29)이 남아, 성적표의 DB 집계(10.27 17:13)와 평균이 갈렸다.
// DB 집계(Phase B)가 있으면 기본 필터(최신 패치 · 마스터+) 덱을, 없으면 JSON 래더 표본을 그린다 — 어느 쪽이든 두 화면이 같은 스냅샷.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '시즌 18 메타 랭킹 — 기물·시너지·아이템 티어표',
  description:
    'KR 마스터+ 랭크 실측 표본 기반 TFT 시즌 18 메타 랭킹. 기물 티어, 시너지, 아이템, BIS 조합과 추천 덱을 평균 등수·순방률로 확인하세요.',
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

export default async function MetaPage() {
  const filters = await getMetaFilters()
  // 덱 탭 = 내 덱 성적표와 같은 스냅샷 — 홈 메타 탭(/api/tft/meta)과 같은 함수(lib/metaSnapshot)로 채운다
  const data = await withDeckSnapshot(buildMetaPayload())
  const snapshotMeta = data.decksMeta ?? { source: 'json' as const }
  const fromDb = snapshotMeta.source === 'db' && filters.source === 'db'
  if (fromDb && snapshotMeta.patch) data.patch = snapshotMeta.patch
  const snapshotLabel = metaSnapshotLabel(snapshotMeta)
  // 상단 배지: 수집 랭크 구간 + 전체 경기 수 (메타 페이지만 보고도 데이터 범위·규모를 알 수 있게)
  const scopeBadge = metaScopeLabel(snapshotMeta)
  const matchesBadge = metaMatchesLabel(snapshotMeta) || null

  return (
    <div className="min-h-screen bg-app text-ink">
      <SimpleHeader active="meta" />

      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
        <div className="mb-4">
          <h1 className="text-xl font-black tracking-tight md:text-2xl">시즌 18 메타 랭킹</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded-chip border border-line bg-sunken px-2 py-0.5 font-semibold text-ink" title="수집 랭크 구간">
              {scopeBadge}
            </span>
            {matchesBadge ? (
              <span className="rounded-chip border border-line bg-sunken px-2 py-0.5 font-semibold text-ink" title="덱 표에 들어간 전체 경기 수">
                {matchesBadge}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted">
            {snapshotLabel}
            {snapshotFailed(snapshotMeta) ? ' · DB 집계를 불러오지 못해 래더 표본을 보여 줍니다' : ''}
            {!data.hasMeta && !fromDb ? ' · 표본 수집 전(샘플)' : ''}
          </p>
        </div>

        <MetaRanking
          initialData={toDecksOnly(data)}
          deferSections
          filters={filters}
          initialDecksSource={fromDb ? 'db' : 'json'}
          syncUrl
        />

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

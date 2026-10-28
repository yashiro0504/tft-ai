import type { Metadata } from 'next'
import Link from 'next/link'
import { buildMetaPayload } from '@/lib/metaPayload'
import { toDecksOnly } from '@/lib/metaSlim'
import { getMetaDeckSnapshot, getMetaFilters } from '@/lib/tftStats'
import { deckReportMeta } from '@/lib/deckReport'
import { metaSnapshotLabel } from '@/lib/deckReportShared'
import { MetaRanking } from '@/app/components/MetaRanking'
import { SimpleHeader } from '@/app/components/SimpleHeader'
import { SiteFooter } from '@/app/components/SiteFooter'
import { SITE_URL } from '@/lib/site'

// 정적 생성 + 1분 ISR (덱 성적표와 같은 스냅샷 — lib/tftStats getMetaDeckSnapshot 이 인스턴스 간 공유 캐시로 맞춘다). DB 집계(Phase B)가 있으면 기본 필터(최신 패치 · 마스터+) 덱을, 없으면 빌드 타임 JSON 을 그린다.
export const revalidate = 60

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

export default async function MetaPage() {
  const data = buildMetaPayload()
  const filters = await getMetaFilters()
  // 덱 탭 = 내 덱 성적표와 같은 스냅샷 (DB 집계 또는 폴백 JSON 어느 쪽이든 두 화면이 같은 값)
  const snapshot = await getMetaDeckSnapshot()
  const fromDb = snapshot.source === 'db' && filters.source === 'db'
  data.decks = snapshot.decks
  if (fromDb) data.patch = snapshot.filter?.patch ?? data.patch
  const snapshotMeta = deckReportMeta(snapshot)
  const snapshotLabel = metaSnapshotLabel(snapshotMeta)
  // 상단 배지: 수집 랭크 구간 + 전체 경기 수 (메타 페이지만 보고도 데이터 범위·규모를 알 수 있게)
  const scopeBadge = snapshotMeta.source === 'db' ? `KR ${snapshotMeta.tier ?? '랭크'}` : 'KR 챌린저 래더'
  const matchesBadge = snapshotMeta.matches ? `${snapshotMeta.matches.toLocaleString('ko-KR')}경기` : null

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
            {!data.hasMeta && !fromDb ? ' · 표본 수집 전(샘플)' : ''}
          </p>
        </div>

        <MetaRanking
          initialData={toDecksOnly(data)}
          deferSections
          filters={filters}
          initialDecksSource={fromDb ? 'db' : 'json'}
          decksUpdatedAt={snapshot.updatedAt}
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

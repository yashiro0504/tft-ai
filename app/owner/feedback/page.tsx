import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { SimpleHeader } from '@/app/components/SimpleHeader'
import { SiteFooter } from '@/app/components/SiteFooter'
import { OWNER_COOKIE, isOwnerCookieValue } from '@/lib/ownerKey'
import { listReportFeedback, type ReportFeedbackRow } from '@/lib/reportFeedback'

export const metadata: Metadata = {
  title: '리포트 피드백',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

const FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'down', label: '👎 아쉬움' },
  { key: 'up', label: '👍 도움 됨' },
] as const

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-app text-ink">
      <SimpleHeader active="profile" />
      <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
      <SiteFooter />
    </div>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-panel p-6 text-sm leading-relaxed text-muted shadow-card">
      {children}
    </div>
  )
}

function FeedbackItem({ row }: { row: ReportFeedbackRow }) {
  const s = row.snapshot
  return (
    <li className="rounded-card border border-line bg-panel p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle">
        <span className={`font-bold ${row.rating === 1 ? 'text-good' : 'text-bad'}`}>
          {row.rating === 1 ? '👍 도움 됨' : '👎 아쉬움'}
        </span>
        <span>· {row.mode === 'single' ? '단일 경기' : '종합'}</span>
        {row.patch ? <span>· 패치 {row.patch}</span> : null}
        {s.isFallback ? <span>· 규칙 기반</span> : null}
        {typeof s.metaScore === 'number' ? <span>· {s.metaScore}점</span> : null}
        {row.matchId ? <span className="font-mono">· {row.matchId}</span> : null}
        <span className="ml-auto">{new Date(row.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span>
      </div>
      {row.comment ? (
        <p className="mt-2 text-sm font-semibold text-ink">“{row.comment}”</p>
      ) : (
        <p className="mt-2 text-xs text-subtle">코멘트 없음</p>
      )}
      {s.overview || s.topic || s.actions?.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted hover:text-ink">평가한 리포트 보기</summary>
          <div className="mt-2 space-y-1.5 rounded-control bg-sunken p-3 text-xs leading-relaxed text-ink-soft">
            {s.topic ? <p><span className="font-bold">강의 주제</span> · {s.topic}</p> : null}
            {s.overview ? <p>{s.overview}</p> : null}
            {s.actions?.length ? (
              <ol className="list-decimal space-y-1 pl-4">
                {s.actions.map((a, i) => <li key={i} className="whitespace-pre-line">{a}</li>)}
              </ol>
            ) : null}
          </div>
        </details>
      ) : null}
    </li>
  )
}

export default async function OwnerFeedbackPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const cookieStore = await cookies()
  if (!isOwnerCookieValue(cookieStore.get(OWNER_COOKIE)?.value)) {
    return (
      <Shell>
        <Notice>
          운영자만 볼 수 있습니다. <Link href="/owner" className="text-accent underline">운영자 키</Link>를 먼저 입력해 주세요.
        </Notice>
      </Shell>
    )
  }

  const { r } = await searchParams
  const filter = r === 'up' || r === 'down' ? r : 'all'
  const listing = await listReportFeedback({ rating: filter === 'up' ? 1 : filter === 'down' ? -1 : undefined })

  if (!listing) {
    return (
      <Shell>
        <Notice>
          피드백을 불러오지 못했습니다. 서버 환경변수 <code>SUPABASE_SERVICE_ROLE_KEY</code>와 마이그레이션{' '}
          <code>0007_report_feedback.sql</code> 적용 여부를 확인해 주세요.
        </Notice>
      </Shell>
    )
  }

  const total = listing.up + listing.down
  const downRate = total ? Math.round((listing.down / total) * 100) : 0

  return (
    <Shell>
      <h1 className="text-xl font-black tracking-tight">리포트 피드백</h1>
      <p className="mt-1 text-xs text-muted">
        전체 {total}건 · 👍 {listing.up} · 👎 {listing.down} ({downRate}%) · 최근 100건까지 표시
      </p>

      <nav className="mt-4 flex gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === 'all' ? '/owner/feedback' : `/owner/feedback?r=${f.key}`}
            className={`rounded-control border px-3 py-1.5 text-xs font-semibold ${
              filter === f.key ? 'border-accent bg-accent-bg text-accent' : 'border-line bg-sunken text-muted hover:border-accent'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {listing.rows.length ? (
        <ul className="mt-4 space-y-3">
          {listing.rows.map((row) => <FeedbackItem key={row.id} row={row} />)}
        </ul>
      ) : (
        <div className="mt-4">
          <Notice>아직 피드백이 없습니다.</Notice>
        </div>
      )}
    </Shell>
  )
}

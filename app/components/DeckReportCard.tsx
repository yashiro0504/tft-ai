import Link from 'next/link'
import { DECK_REPORT_MIN_GAMES, DECK_REPORT_MIN_SAMPLE, type DeckReport, type DeckReportMeta, type DeckReportRow } from '@/lib/deckReportShared'

/**
 * 내 덱 성적표 (AI 미사용 — lib/deckReport 가 서버에서 메타 덱으로 묶어 계산).
 * 판정은 DECK_REPORT_MIN_GAMES 판 이상 + 판수 오차보다 큰 차이 + 메타 표본이 충분한 덱만. 나머지는 수치만 보여 준다.
 */
const VERDICT: Record<NonNullable<DeckReportRow['verdict']>, { label: string; tone: string }> = {
  good: { label: '잘 맞음', tone: 'border-good/50 bg-good/10 text-good' },
  even: { label: '메타 수준', tone: 'border-line bg-sunken text-muted' },
  bad: { label: '안 맞음', tone: 'border-bad/50 bg-bad/10 text-bad' },
}

/** 메타 평균 출처 한 줄 — 메타 랭킹 페이지 머리말과 같은 값 (예: "KR 랭크 마스터+ 집계 · 패치 16.21 · 10. 26. 갱신") */
function metaSourceLabel(meta: DeckReportMeta): string {
  const base = meta.source === 'db' ? (meta.tier ? `KR 랭크 ${meta.tier} 집계` : 'KR 랭크 집계') : '챌린저 래더 표본'
  const updated = meta.updatedAt ? new Date(meta.updatedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : ''
  return [base, meta.patch ? `패치 ${meta.patch}` : '', updated ? `${updated} 갱신` : ''].filter(Boolean).join(' · ')
}

export function DeckReportCard({ report }: { report: DeckReport }) {
  if (!report.total || (!report.rows.length && !report.unmatched.games)) return null
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted">
        내 덱 성적표
        <span className="rounded-chip border border-line px-1.5 py-0.5 text-xs font-medium text-subtle">메타 평균 비교 · AI 미사용</span>
      </p>
      <ul className="space-y-1.5">
        {report.rows.map((r) => (
          <li key={r.name} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-control border border-line bg-sunken px-3 py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate font-semibold text-ink" title={r.name}>
              {r.name}
            </span>
            <span className="text-muted">
              {r.games}판 · 평균 <b className="text-ink">{r.avgPlacement}</b>등
              {r.metaAvg != null ? (
                <>
                  {' '}
                  (메타 {r.metaAvg}등
                  {r.delta != null ? <>, {r.delta > 0 ? `+${r.delta}` : r.delta}</> : null}
                  {r.metaSample < DECK_REPORT_MIN_SAMPLE ? <> · 메타 표본 {r.metaSample}판 참고용</> : null})
                </>
              ) : null}
            </span>
            {r.verdict ? (
              <span className={`rounded-chip border px-1.5 py-0.5 text-[11px] font-bold ${VERDICT[r.verdict].tone}`}>{VERDICT[r.verdict].label}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] leading-relaxed text-subtle">
        {report.unmatched.games ? `메타 덱과 다른 조합 ${report.unmatched.games}판 (평균 ${report.unmatched.avgPlacement}등) · ` : ''}
        {report.early ? `초반 종료 ${report.early}판 (기물이 적어 덱 판정 제외) · ` : ''}
        판정은 {DECK_REPORT_MIN_GAMES}판 이상 탄 덱에서 차이가 판수 오차보다 클 때만 — 판수가 적으면 운의 영향이 큽니다.
      </p>
      {report.meta ? (
        <p className="mt-1 text-[11px] text-subtle">
          메타 평균: {metaSourceLabel(report.meta)} —{' '}
          <Link href="/meta" className="underline hover:text-ink">
            메타 랭킹
          </Link>
          과 같은 데이터
        </p>
      ) : null}
    </div>
  )
}

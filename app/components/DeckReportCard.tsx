import Link from 'next/link'
import { DECK_REPORT_MIN_GAMES, DECK_REPORT_MIN_SAMPLE, metaSnapshotLabel, type DeckReport, type DeckReportRow } from '@/lib/deckReportShared'

/**
 * 내 덱 성적표 (AI 미사용 — lib/deckReport 가 서버에서 메타 덱으로 묶어 계산).
 * 판정은 DECK_REPORT_MIN_GAMES 판 이상 + 판수 오차보다 큰 차이 + 메타 표본이 충분한 덱만. 나머지는 수치만 보여 준다.
 */
const VERDICT: Record<NonNullable<DeckReportRow['verdict']>, { label: string; tone: string }> = {
  good: { label: '잘 맞음', tone: 'border-good/50 bg-good/10 text-good' },
  even: { label: '메타 수준', tone: 'border-line bg-sunken text-muted' },
  bad: { label: '안 맞음', tone: 'border-bad/50 bg-bad/10 text-bad' },
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
                  {r.delta != null ? <>, {r.delta > 0 ? `+${r.delta}` : r.delta}</> : null})
                </>
              ) : (
                <span title={`메타 랭킹 덱 티어는 ${DECK_REPORT_MIN_SAMPLE}판 이상 덱만 매깁니다 — 이 덱은 ${r.metaSample}판이라 비교하지 않습니다`}>
                  {' '}
                  (메타 표본 없음{r.metaSample ? ` · ${r.metaSample}판` : ''})
                </span>
              )}
            </span>
            {r.verdict ? (
              <span className={`rounded-chip border px-1.5 py-0.5 text-[11px] font-bold ${VERDICT[r.verdict].tone}`}>{VERDICT[r.verdict].label}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] leading-relaxed text-subtle">
        {report.unmatched.games ? `메타 덱과 다른 조합 ${report.unmatched.games}판 (평균 ${report.unmatched.avgPlacement}등) · ` : ''}
        {report.early ? `초반 종료 ${report.early}판 (3스테이지 전 탈락 · 덱 판정 제외) · ` : ''}
        {report.incomplete ? `보드 데이터 불완전 ${report.incomplete}판 (기물이 일부만 잡혀 덱 판정 제외) · ` : ''}
        판정은 {DECK_REPORT_MIN_GAMES}판 이상 탄 덱에서 차이가 판수 오차보다 클 때만 — 판수가 적으면 운의 영향이 큽니다.
      </p>
      {report.meta ? (
        <p className="mt-1 text-[11px] text-subtle">
          메타 평균: {metaSnapshotLabel(report.meta)} —{' '}
          <Link href="/meta" className="underline hover:text-ink">
            메타 랭킹
          </Link>
          과 같은 데이터
        </p>
      ) : null}
    </div>
  )
}

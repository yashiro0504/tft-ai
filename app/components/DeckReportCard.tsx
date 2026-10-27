import { DECK_REPORT_MIN_GAMES, type DeckReport, type DeckReportRow } from '@/lib/deckReportShared'

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
        판정은 {DECK_REPORT_MIN_GAMES}판 이상 탄 덱에서 차이가 판수 오차보다 클 때만 — 판수가 적으면 운의 영향이 큽니다.
      </p>
    </div>
  )
}

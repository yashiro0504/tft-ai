import type { TftRankInfo } from '@/lib/types'
import { formatRankLabel, formatRankLp, formatRankRecord, rankTierStyle, rankWinRate } from '@/lib/rank'

/**
 * 티어/ LP / 승패 배지 (서버·클라이언트 공용).
 *
 * - 랭크가 없으면(배치 중·조회 실패) "배치 중" 만 표시한다.
 * - 360px 에서 넘치지 않도록 승패/승률은 화면 폭에 따라 숨긴다.
 */
export function RankBadge({ rank }: { rank: TftRankInfo | null | undefined }) {
  const style = rankTierStyle(rank)
  const winRate = rankWinRate(rank)

  return (
    <span
      className={`inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-control border px-2.5 py-1 text-xs font-bold ${style.chip}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.bar}`} />
      <b className={style.text}>{formatRankLabel(rank)}</b>
      {rank ? (
        <>
          <span className="font-mono text-ink-soft">{formatRankLp(rank)}</span>
          <span className="hidden text-subtle sm:inline">·</span>
          <span className="hidden font-mono text-muted sm:inline">{formatRankRecord(rank)}</span>
          {winRate !== null ? (
            <>
              <span className="hidden text-subtle md:inline">·</span>
              <span className="hidden font-mono text-muted md:inline">승률 {winRate}%</span>
            </>
          ) : null}
          {rank.hotStreak ? (
            <span className="text-accent" title="연승 중" aria-label="연승 중">
              🔥
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  )
}

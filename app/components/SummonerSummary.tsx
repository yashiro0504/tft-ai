/* eslint-disable @next/next/no-img-element */

import type { ReactNode } from 'react'
import type { SummonerProfile } from '@/lib/types'
import { RankBadge } from './RankBadge'
import { PlacementStrip } from './LabUI'

/**
 * 소환사 요약 카드 (코치 결과 / 공유용 프로필 페이지 공용).
 * 왼쪽: 아이콘·이름·랭크, 오른쪽: 큰 숫자 3개 + 등수 분포 띠.
 */
export function SummonerSummary({
  profile,
  placements,
  as: Heading = 'h2',
  children,
}: {
  profile: SummonerProfile
  placements: number[]
  /** 페이지의 첫 제목이면 h1 */
  as?: 'h1' | 'h2'
  /** 카드 아래쪽 추가 행 (공유 버튼 등) */
  children?: ReactNode
}) {
  return (
    <section aria-label="소환사 요약" className="rounded-card border border-line bg-panel p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex min-w-0 flex-[1_1_320px] items-center gap-4">
          <div className="relative shrink-0">
            <img
              src={profile.profileIconUrl}
              alt={`${profile.gameName} 프로필 아이콘`}
              className="h-16 w-16 rounded-card border border-line bg-sunken object-cover"
            />
            <span className="absolute -bottom-2 -right-2 rounded-chip border border-line bg-sunken px-1.5 py-0.5 text-xs font-semibold text-ink">
              Lv.{profile.summonerLevel}
            </span>
          </div>
          <div className="min-w-0">
            <Heading className="truncate text-[28px] font-bold leading-tight tracking-tight text-ink">
              {profile.gameName} <span className="text-base font-medium text-subtle">#{profile.tagLine}</span>
            </Heading>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <RankBadge rank={profile.rank} />
              <span className="rounded-chip border border-line bg-sunken px-2 py-0.5 text-xs text-muted">
                최근 {profile.totalGames}경기 기준
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <p className="text-xs text-subtle">평균 등수</p>
            <p className="text-[28px] font-bold leading-tight text-ink">{profile.avgPlacement}</p>
          </div>
          <div>
            <p className="text-xs text-subtle">순방률</p>
            <p className={`text-[28px] font-bold leading-tight ${profile.top4Rate >= 50 ? 'text-good' : 'text-bad'}`}>
              {profile.top4Rate}%
            </p>
          </div>
          <div>
            <p className="text-xs text-subtle">1등</p>
            <p className="text-[28px] font-bold leading-tight text-ink">{profile.winRate}%</p>
          </div>
          <div>
            <p className="mb-1.5 text-xs text-subtle">등수 분포</p>
            <PlacementStrip placements={placements} />
          </div>
        </div>
      </div>
      {children ? <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-sunken pt-4">{children}</div> : null}
    </section>
  )
}

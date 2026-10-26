import { SlimMatchData, SummonerProfile, TftRankInfo } from './types'
import { DDRAGON_VERSION } from './constants'
import { rankedMatches } from './queue'

/**
 * 소환사 프로필 요약 통계 계산 (평균 등수 / 1등 승률 / 순방률).
 * 주의: 표본은 로드된 매치 수(1~20경기)이므로 "최근 N경기 기준" 통계입니다.
 * 랭크(티어/LP/승패)는 TFT League v1 에서 별도로 받아 그대로 전달합니다.
 */
export function calculateProfileStats(
  matches: SlimMatchData[],
  gameName: string,
  tagLine: string,
  level = 100,
  iconId = 7193,
  rank: TftRankInfo | null = null
): SummonerProfile {
  // 평균·승률·TOP4 는 랭크 판만 (이벤트·일반 판은 목록에만 보인다 — lib/queue)
  matches = rankedMatches(matches)
  const total = matches.length || 1
  const avgPlacement = Math.round((matches.reduce((acc, m) => acc + m.placement, 0) / total) * 10) / 10
  const winCount = matches.filter((m) => m.placement === 1).length
  const top4Count = matches.filter((m) => m.placement <= 4).length

  return {
    gameName,
    tagLine,
    summonerLevel: level,
    profileIconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/profileicon/${iconId}.png`,
    avgPlacement,
    winRate: Math.round((winCount / total) * 100),
    top4Rate: Math.round((top4Count / total) * 100),
    totalGames: total,
    rank,
  }
}

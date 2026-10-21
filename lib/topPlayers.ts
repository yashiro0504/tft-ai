import topData from './topPlayerGuide.json'

/**
 * 상위 랭커 운영 (scripts/buildTopPlayerGuide.js → lib/topPlayerGuide.json) — 서버 전용(AI 프롬프트).
 * 챌린저 LP 상위 랭커의 최근 랭크 보드를 메타 덱별로 집계한 것. 래더 전체 평균(덱 가이드)과 비교하는 용도다.
 */

export interface TopPlayerDeckStats {
  boards: number
  players: number
  avgPlacement: number
  top4Rate: number
  carryThreeStarRate: number
  carryItems: { name: string; rate: number }[]
  levels: Record<string, number>
  extraUnits: { name: string; usage: number }[]
}

interface TopPlayerGuide {
  sourceUpdatedAt?: string | null
  players?: number
  decks?: Record<string, TopPlayerDeckStats>
}

/** 이보다 적은 판이면 표본이 너무 작아 프롬프트에 넣지 않는다 */
export const TOP_MIN_BOARDS = 5

const DATA = topData as TopPlayerGuide

export function topPlayerMeta(): { players: number; sourceUpdatedAt: string | null } {
  return { players: DATA.players || 0, sourceUpdatedAt: DATA.sourceUpdatedAt || null }
}

/** 메타 덱 이름으로 상위 랭커 집계 (표본 TOP_MIN_BOARDS 미만이면 undefined). data 는 테스트용 주입 */
export function topPlayerStats(deckName: string, data: TopPlayerGuide = DATA): TopPlayerDeckStats | undefined {
  const s = data.decks?.[deckName]
  return s && s.boards >= TOP_MIN_BOARDS ? s : undefined
}

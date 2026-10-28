import type { SlimMatchData } from './types'

/**
 * 경기 카드·6가지 항목 진단·AI 리포트가 같이 쓰는 보드 수치 (한 곳에서만 센다).
 * 102#2600 7등 경기에서 카드는 "시너지 4", 진단·리포트는 고유 시너지(부식)를 빼고 "활성 시너지 3개"라고 쓰면서
 * 4개를 나열했다 (2026-10-28). 화면·프롬프트·검증은 이 함수의 값만 쓴다.
 * 클라이언트 공용 (의존성 없음).
 */
export interface BoardCounts {
  units: number
  twoStarPlus: number
  threeStar: number
  /** 활성 시너지 (Riot tier_current > 0, 고유 시너지 포함 — 카드에 그리는 칩 수) */
  activeTraits: number
  totalItems: number
}

export function boardCounts(m: Pick<SlimMatchData, 'units' | 'traits'>): BoardCounts {
  const units = m.units || []
  return {
    units: units.length,
    twoStarPlus: units.filter((u) => (u.tier || 1) >= 2).length,
    threeStar: units.filter((u) => u.tier === 3).length,
    activeTraits: (m.traits || []).filter((t) => (t.tier ?? 1) > 0).length,
    totalItems: units.reduce((s, u) => s + (u.items?.length || 0), 0),
  }
}

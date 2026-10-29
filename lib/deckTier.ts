export type Tier = 'S' | 'A' | 'B' | 'C' | 'D'

/**
 * 덱 티어 = 보정 평균등수 고정 구간 (2026-10-29 지시문 1).
 * 예전 '기준 덱과 오차가 겹치면 같은 티어 · 3~5개 · 한 티어 50% 이하' 규칙은 표본이 1만 판을 넘어 오차가 ±0.03~0.1로
 * 줄자 티어를 수십 개 요구했고, '3~5개' 제한이 억지로 합쳐 화면 설명과 S 39개 중 36개가 어긋났다.
 * adj = (n × 평균등수 + 50 × 4.5) / (n + 50) — 50판만큼 4.5등을 섞어 표본 적은 덱이 운으로 S가 되지 않게 한다.
 */
export const DECK_TIER_PRIOR_GAMES = 50
/** 덱 티어 상한 (adj ≤ 값이면 그 티어, 모두 넘으면 D) */
export const DECK_TIER_CUTS: [Tier, number][] = [
  ['S', 3.9],
  ['A', 4.3],
  ['B', 4.7],
  ['C', 5.1],
]
/** 이 판수 미만 덱은 티어 없이 '참고용' (티어별 개수에도 안 셈) */
export const DECK_TIER_MIN_SAMPLE = 50

/** 보정 평균등수 (덱 티어 기준) */
export function adjustedPlacement(avg: number, sample: number): number {
  const n = Math.max(0, sample || 0)
  return (n * avg + DECK_TIER_PRIOR_GAMES * 4.5) / (n + DECK_TIER_PRIOR_GAMES)
}

/** 보정 평균등수 → 티어. 경계 비교 전 소수 셋째 자리에서 반올림해 부동소수 오차(3.9000000001)로 갈리지 않게 한다 */
export function deckTierFromAdjusted(adj: number): Tier {
  const v = Math.round(adj * 1000) / 1000
  for (const [tier, cut] of DECK_TIER_CUTS) if (v <= cut) return tier
  return 'D'
}

/** 덱 한 개의 티어 — 표본 50판 미만은 '-' (참고용) */
export function deckTier(avg: number, sample: number): Tier | '-' {
  if (!(sample >= DECK_TIER_MIN_SAMPLE) || !Number.isFinite(avg)) return '-'
  return deckTierFromAdjusted(adjustedPlacement(avg, sample))
}

/** 덱 탭 화면 설명 — deckTier 와 같은 규칙 (지시문 1의 문구 그대로) */
export const DECK_TIER_RULE_SHORT = '티어 = 보정 평균등수 기준 (S ≤3.90 · A ≤4.30 · B ≤4.70 · C ≤5.10) · 50판 미만 참고용'
export const DECK_TIER_RULE =
  `보정 평균등수 = (판수 × 평균등수 + ${DECK_TIER_PRIOR_GAMES} × 4.5) ÷ (판수 + ${DECK_TIER_PRIOR_GAMES}). ` +
  'S ≤3.90 · A ≤4.30 · B ≤4.70 · C ≤5.10 · 그 위는 D. ' +
  `${DECK_TIER_MIN_SAMPLE}판 미만 덱은 티어 없이 참고용이며 티어별 개수에 넣지 않습니다. 평균등수 열은 원래 평균 ± 표준오차이고, 보정값은 평균등수에 마우스를 올리면 보입니다.`

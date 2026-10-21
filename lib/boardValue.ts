/**
 * 보드 가치(G) — 최종 보드에 들어간 골드 총량.
 * Σ 코스트 × 들어간 장수 (1성 1장 · 2성 3장 · 3성 9장). 아이템·증강은 포함하지 않는다.
 *
 * 골든셋 로비 보드 184개에서 등수와 강하게 연관되지만(ρ ≈ 0.64), 늦게 탈락할수록 골드를 더 쓰므로
 * 일부는 역방향 효과다. 점수 반영 전 스테이지 보정 지표(scripts/testAxes.js 타당도)를 함께 본다.
 */
export function boardValue(units: { rarity?: number | null; tier?: number | null }[]): number {
  return (units || []).reduce((s, u) => s + (u.rarity || 1) * 3 ** (Math.min(Math.max(u.tier || 1, 1), 3) - 1), 0)
}

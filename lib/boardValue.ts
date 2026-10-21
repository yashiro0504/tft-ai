/**
 * 보드 가치(G) — 최종 보드에 들어간 골드 총량.
 * Σ 코스트 × 들어간 장수 (1성 1장 · 2성 3장 · 3성 9장). 아이템·증강은 포함하지 않는다.
 *
 * 골든셋 로비 보드 194개에서 원시 ρ 0.58이지만, 늦게 탈락할수록 골드를 더 쓰므로 상당 부분이 역방향 효과다
 * (같은 탈락 스테이지끼리 비교한 스테이지 보정 ρ 0.26 — scripts/testAxes.js 타당도). 점수에는 아직 넣지 않는다.
 */
export function boardValue(units: { rarity?: number | null; tier?: number | null }[]): number {
  return (units || []).reduce((s, u) => s + (u.rarity || 1) * 3 ** (Math.min(Math.max(u.tier || 1, 1), 3) - 1), 0)
}

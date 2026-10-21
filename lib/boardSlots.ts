import { entitySlug } from './entitySlug'

/**
 * 보드 칸 수 — 기물마다 차지하는 칸이 다르다 (세트18 장로 드래곤은 2칸).
 * 실측: 픽스처·실전 로비 보드 274개 중 '기물 수 = 레벨 − 1' 인 38개가 모두 장로 드래곤 보드였고,
 * 장로 드래곤 보드 46개 중 38개(83%)가 그랬다. 나머지는 팀 규모 +1 증강 등으로 보인다.
 * 시너지 인원(협곡야수 등)은 Riot 이 이미 2명으로 세어 주므로 여기서 다루지 않는다.
 */
const SLOTS_BY_SLUG: Record<string, number> = {
  elderdragon: 2,
}

/** 이 기물이 차지하는 보드 칸 */
export function unitSlots(u: { id?: string | null }): number {
  return SLOTS_BY_SLUG[entitySlug('champion', u.id || '')] ?? 1
}

/** 최종 보드가 차지한 칸 합 */
export function slotsUsed(units: { id?: string | null }[]): number {
  return (units || []).reduce((s, u) => s + unitSlots(u), 0)
}

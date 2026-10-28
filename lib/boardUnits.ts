import { CURRENT_SET, championSlots, isKnownChampion } from './gameFacts'
import type { SlimMatchData, SlimMatchUnit } from './types'

/**
 * 보드 집계 전 기물 정리 — 소환 기물·복제 기물을 뺀다 (유닛 수·2성+ 수·덱 판정 공용).
 *
 * Riot units 목록에는 소환·복제로 생긴 기물이 섞여 나온다: 빈 틈#123 34분 경기에 장로 드래곤이 9개, "유닛 20" (2026-10-28).
 * - 소환 기물: 현재 세트 상점 기물 목록(lib/gameFacts)에 없는 id → 뺀다.
 * - 복제 기물: 같은 기물·같은 성급 3장은 자동으로 합쳐지므로 정상 보드에 동시에 있을 수 없다.
 *   그래서 같은 기물·성급이 3장 이상(3성은 2장 이상)이면 복제로 보고 아이템이 가장 많은 1장만 남긴다.
 *   2장까지는 실제로 1성 두 장을 올린 보드일 수 있어 그대로 둔다 (keyMoments duplicateCopies).
 * - 칸 상한: 그래도 차지한 칸이 레벨 + BOARD_SLOT_ALLOWANCE 를 넘으면, 같은 기물이 두 장 이상인 것 중
 *   아이템·성급이 낮은 복사본부터 뺀다. 서로 다른 기물은 빼지 않는다 (팀 규모 증강일 수 있다).
 */
export const BOARD_SLOT_ALLOWANCE = 1

type BoardUnit = { id?: string | null; tier?: number; items?: unknown[] }

const unitWeight = (u: BoardUnit) => (u.items?.length ?? 0) * 10 + (u.tier ?? 1)

export function cleanBoardUnits<T extends BoardUnit>(
  units: T[],
  { setNumber, level }: { setNumber?: number; level?: number } = {}
): { units: T[]; removed: number } {
  const list = (units || []).filter(Boolean)
  const filterSummons = !setNumber || setNumber === CURRENT_SET
  const known = filterSummons ? list.filter((u) => !u.id || isKnownChampion(u.id)) : list
  const groups = new Map<string, T[]>()
  for (const u of known) {
    const key = `${u.id ?? ''}|${u.tier ?? 1}`
    const g = groups.get(key)
    if (g) g.push(u)
    else groups.set(key, [u])
  }
  const keep = new Set<T>()
  for (const g of groups.values()) {
    const tier = g[0].tier ?? 1
    const cloned = g.length >= 3 || (tier >= 3 && g.length >= 2)
    if (!cloned) {
      g.forEach((u) => keep.add(u))
      continue
    }
    keep.add(g.reduce((best, u) => ((u.items?.length ?? 0) > (best.items?.length ?? 0) ? u : best), g[0]))
  }
  let out = known.filter((u) => keep.has(u))
  if (level && level > 0) {
    const cap = level + BOARD_SLOT_ALLOWANCE
    const slots = (xs: T[]) => xs.reduce((n, u) => n + championSlots(u.id), 0)
    while (slots(out) > cap) {
      const count = new Map<string, number>()
      for (const u of out) count.set(u.id ?? '', (count.get(u.id ?? '') ?? 0) + 1)
      const extras = out.filter((u) => (count.get(u.id ?? '') ?? 0) > 1)
      if (!extras.length) break
      const drop = extras.reduce((worst, u) => (unitWeight(u) <= unitWeight(worst) ? u : worst), extras[0])
      out = out.filter((u) => u !== drop)
    }
  }
  return { units: out, removed: list.length - out.length }
}

/**
 * 캐시에서 읽은 경기를 현재 규칙으로 맞춘다 (매치 상세는 30일 캐시라 예전 형식이 남아 있다). 여러 번 불러도 같다.
 * - 경과 시간 문자열(timeAgo)은 지운다 — 화면이 gameDatetime 으로 계산한다 (lib/timeAgo)
 * - 내 보드와 로비 보드에서 소환·복제 기물을 뺀다
 */
export function normalizeSlimMatch(m: SlimMatchData): SlimMatchData {
  if (!m) return m
  const { timeAgo: _drop, ...rest } = m
  void _drop
  const units = cleanBoardUnits<SlimMatchUnit>(m.units || [], { setNumber: m.setNumber, level: m.level }).units
  const lobbyParticipants = m.lobbyParticipants?.map((p) => ({
    ...p,
    units: cleanBoardUnits<SlimMatchUnit>(p.units || [], { setNumber: m.setNumber, level: p.level }).units,
  }))
  return { ...rest, units, ...(lobbyParticipants ? { lobbyParticipants } : {}) }
}

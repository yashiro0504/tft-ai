import { findChampion, findItem, findTrait } from './gameData'
import type { SlimMatchData, SlimMatchUnit } from './types'

/**
 * 시너지 단계를 받치는 기물 — 최종 보드에서 "이 기물을 빼면 켜진 시너지 단계가 내려간다"를 코드가 계산한다.
 *
 * LLM 이 "2성 수를 늘려라"는 조언을 하며 협곡야수 7단계를 받치는 장로 드래곤·어스름늑대 자리를 다른 2성으로 바꾸라고 한
 * 오진단(2026-10-23)을 막는다. 프롬프트에 이 목록을 주고, 교체·빼기 제안은 목록 밖 기물로만 하게 한다.
 *
 * 인원 계산: 기물 고유 시너지 1명 · 2칸 기물(장로 드래곤)은 2명 — Riot 집계와 같다 (래더 보드에서 기물 6개 = 협곡야수 7).
 *           상징 아이템("X 상징")은 그 기물에 X 를 1명 더한다.
 * 계산한 인원이 Riot 인원과 다르면(증강 등 모르는 출처) 그 시너지는 건너뛴다 — 틀린 목록보다 없는 편이 낫다.
 */

export interface TraitAnchor {
  trait: string
  count: number
  /** 지금 켜진 단계 인원 */
  active: number
  /** 기물 하나를 빼면 내려가는 단계 인원 (0 = 꺼짐) */
  dropTo: number
  /** 단계 인원표 — 프롬프트는 "N단계"를 몇 번째 단계로 쓴다 (lib/summarize 의 "주문술사(4)[2단계]"와 같은 뜻) */
  breakpoints: number[]
  units: { name: string; tier: number; contributes: number }[]
}

const EMBLEM_SUFFIX = ' 상징'

/** 기물 하나가 시너지별로 더하는 인원 */
export function unitTraitCounts(u: SlimMatchUnit): Map<string, number> {
  const out = new Map<string, number>()
  const champ = findChampion(u.id) || findChampion(u.name)
  if (champ) {
    for (const id of champ.traits) {
      const t = findTrait(id)
      if (t) out.set(t.name, (out.get(t.name) || 0) + Math.max(1, champ.slots || 1))
    }
  }
  for (const item of u.items || []) {
    const it = findItem(item)
    const name = it?.kind === 'emblem' ? it.name : item.endsWith(EMBLEM_SUFFIX) ? item : null
    const trait = name && findTrait(name.slice(0, -EMBLEM_SUFFIX.length))
    if (trait && !out.has(trait.name)) out.set(trait.name, 1)
  }
  return out
}

/** 켜진 다인원 시너지마다, 빼면 단계가 내려가는 기물 (인원 검증을 통과한 시너지만) */
export function traitAnchors(m: SlimMatchData): TraitAnchor[] {
  const perUnit = (m.units || []).map((u) => ({ u, c: unitTraitCounts(u) }))
  return (m.traits || []).flatMap((t) => {
    const bps = findTrait(t.name)?.breakpoints || []
    const count = t.count || 0
    const active = [...bps].reverse().find((b) => b <= count) || 0
    // 1명짜리 고유 시너지 · 꺼진 시너지 · 첫 단계 스플래시(사냥꾼 2 등)는 대상이 아니다.
    // 첫 단계까지 지키면 거의 모든 기물이 묶여 "교체 후보 없음"만 남는다 — 덱이 노린 두 번째 단계 이상(협곡야수 7 등)만 지킨다.
    if (!active || (bps[0] ?? 1) <= 1 || active <= bps[0]) return []
    const members = perUnit.filter((x) => x.c.get(t.name))
    if (members.reduce((s, x) => s + (x.c.get(t.name) || 0), 0) !== count) return []
    const units = members
      .filter((x) => count - (x.c.get(t.name) || 0) < active)
      .map((x) => ({ name: x.u.name, tier: x.u.tier || 1, contributes: x.c.get(t.name) || 0 }))
    if (!units.length) return []
    const dropTo = (n: number) => [...bps].reverse().find((b) => b <= count - n) || 0
    return [{ trait: t.name, count, active, dropTo: Math.max(...units.map((x) => dropTo(x.contributes))), breakpoints: bps, units }]
  })
}

/** 핵심 시너지 단계를 받치지 않는 1성 기물 — 2성 확보용 교체 후보 (2성·3성을 바꿔도 2성 수는 늘지 않는다) */
export function freeUnits(m: SlimMatchData): SlimMatchUnit[] {
  const anchored = new Set(traitAnchors(m).flatMap((a) => a.units.map((u) => u.name)))
  return (m.units || []).filter((u) => !anchored.has(u.name) && (u.tier || 1) === 1)
}

/** 프롬프트 블록 줄 (없으면 빈 배열) */
export function traitAnchorFacts(m: SlimMatchData): string[] {
  const anchors = traitAnchors(m)
  if (!anchors.length) return []
  const free = freeUnits(m)
  // "N단계"는 몇 번째 단계다 — "4명 단계"라고 쓰면 모델이 "4단계"로 옮겨 단계 번호와 섞인다 (2026-10-23 평가에서 확인)
  const stage = (a: TraitAnchor, n: number) => a.breakpoints.indexOf(n) + 1
  return [
    ...anchors.map(
      (a) =>
        `- ${a.trait} ${a.count}명(${stage(a, a.active)}단계)을 받치는 기물: ${a.units
          .map((u) => `${u.name} ${u.tier}성${u.contributes > 1 ? `(${u.contributes}명분)` : ''}`)
          .join(', ')} — 하나라도 빼면 ${a.dropTo ? `${stage(a, a.dropTo)}단계(${a.dropTo}명)로 내려감` : '시너지가 꺼짐'}`
    ),
    // 모델이 줄 표기를 문장에 그대로 옮기는 경우가 많아(평가 11/18) 표기 자체를 사용자에게 보여도 되는 말로 쓴다
    free.length
      ? `- 핵심 시너지와 무관한 1성 기물: ${free.map((u) => u.name).join(', ')}`
      : '- 핵심 시너지와 무관한 1성 기물은 없다 (1성 기물이 모두 핵심 시너지를 받친다)',
  ]
}

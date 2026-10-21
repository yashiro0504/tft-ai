import patchData from './patchNotes.json'
import type { SlimMatchData } from './types'

/**
 * 공식 패치 노트 변경 목록 (scripts/fetchPatchNotes.js → lib/patchNotes.json) — 서버 전용(AI 프롬프트).
 *
 * - 경기 시각 → 패치: 공지 게시 시각(displayedPublishDate) 이후 첫 경기부터 그 패치로 본다.
 *   실제 적용은 서버 점검 뒤라 게시 직후 몇 시간은 이전 패치일 수 있다(근사치).
 * - 상향/하향은 판단하지 않는다. 변경 줄("항목: 이전 ⇒ 이후")을 그대로 쓴다.
 */

export interface PatchChange {
  entity: string
  lines: string[]
}
export interface PatchSection {
  title: string
  kind: 'trait' | 'unit' | 'item' | 'radiantItem' | 'augment' | 'system'
  changes: PatchChange[]
}
export interface PatchNote {
  patch: string
  url: string
  publishedAt: string
  sections: PatchSection[]
}

const PATCHES: PatchNote[] = ((patchData as { patches?: PatchNote[] }).patches || [])
  .filter((p) => p.patch && p.publishedAt && !Number.isNaN(Date.parse(p.publishedAt)))
  .sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt))

/** 수집된 패치 목록 (게시 시각 오름차순) */
export function getPatchNotes(): PatchNote[] {
  return PATCHES
}

/** 경기 시각(ms)에 적용 중이던 패치 (게시 시각 기준 근사). 수집된 첫 패치보다 이르면 undefined. patches 는 오름차순 */
export function patchAt(ms: number | undefined, patches: PatchNote[] = PATCHES): PatchNote | undefined {
  if (!ms || !Number.isFinite(ms)) return undefined
  let hit: PatchNote | undefined
  for (const p of patches) if (Date.parse(p.publishedAt) <= ms) hit = p
  return hit
}

/** "(9) 나무정령" · "요정 (2/4)" · "소라카:" → 이름만 */
export function normalizeEntity(name: string): string {
  return name
    .replace(/\(\s*[\d/·,\s]+\s*\)/g, '')
    .replace(/[:：]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface PatchHit {
  patch: string
  kind: PatchSection['kind']
  entity: string
  lines: string[]
}

/**
 * 내 보드(기물·켠 시너지·아이템)와 관련된 패치 변경.
 * - 경기 이후 패치가 있으면 그 패치들(다음 판 기준 변경), 없으면 경기 당시 패치(이번 경기에 적용된 변경)
 * - 찬란한 아이템 변경은 내 아이템이 "찬란한 X" 일 때만
 */
export function boardPatchChanges(
  m: SlimMatchData,
  patches: PatchNote[] = PATCHES
): { matchPatch?: string; patches: string[]; later: boolean; hits: PatchHit[] } {
  const current = patchAt(m.gameDatetime, patches)
  if (!current) return { patches: [], later: false, hits: [] }
  const after = patches.filter((p) => Date.parse(p.publishedAt) > Date.parse(current.publishedAt))
  const targets = after.length ? after : [current]
  const units = new Set((m.units || []).map((u) => u.name))
  // 켠 시너지 → 유닛 수 ("(9) 나무정령" 처럼 구간을 지정한 변경은 그 구간에 닿았을 때만)
  const traits = new Map((m.traits || []).filter((t) => (t.tier || 0) > 0).map((t) => [t.name, t.count || 0]))
  const items = new Set((m.units || []).flatMap((u) => u.items || []))
  const hits: PatchHit[] = []
  for (const p of targets) {
    for (const s of p.sections) {
      for (const c of s.changes) {
        const name = normalizeEntity(c.entity)
        if (!name || !c.lines.length) continue
        const breakpoint = Number((c.entity.match(/^\s*\((\d+)\)/) || [])[1] || 0)
        const mine =
          (s.kind === 'unit' && units.has(name)) ||
          (s.kind === 'trait' && traits.has(name) && (traits.get(name) as number) >= breakpoint) ||
          (s.kind === 'item' && items.has(name)) ||
          (s.kind === 'radiantItem' && items.has(`찬란한 ${name}`))
        if (!mine) continue
        // 시너지 변경 줄 중 "(6) 구간 …" 처럼 내가 닿지 않은 구간 이야기는 뺀다
        const lines =
          s.kind === 'trait'
            ? c.lines.filter((l) => Number((l.match(/^\s*\((\d+)\)/) || [])[1] || 0) <= (traits.get(name) as number))
            : c.lines
        if (lines.length) hits.push({ patch: p.patch, kind: s.kind, entity: s.kind === 'radiantItem' ? `찬란한 ${name}` : name, lines })
      }
    }
  }
  // 기물 → 아이템 → 시너지 순 (보드의 핵심 정보부터)
  const order: Record<string, number> = { unit: 0, radiantItem: 1, item: 1, trait: 2 }
  hits.sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3))
  return { matchPatch: current.patch, patches: targets.map((p) => p.patch), later: after.length > 0, hits }
}

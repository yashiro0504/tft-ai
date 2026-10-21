import { entitySlug } from './entitySlug'
import { isCoreUnit } from './contest'
import type { LobbyParticipant, SlimMatchUnit } from './types'

/**
 * 같은 구성 상대 찾기 — 비교 사실(lib/comparisonFacts)·핵심 장면(lib/keyMoments)·반복 습관(lib/habits) 공용.
 * 브라우저 번들에서도 쓰므로(경기 카드·프로필의 AI 미사용 장면) 패치 노트·덱 가이드 같은 큰 JSON 을 끌어오지 않는 가벼운 모듈로 둔다.
 */
/** 같은 구성 상대: 코스트 가중 유사도 하한 · 겹치는 기물 최소 개수 · 성급 차이 최대 표시 개수 */
// 0.5 였으나 Lv.10 밸류 보드(KR_8427579901)가 같은 5코스트 5개를 쓴 2등과 0.44 로 빠졌다 — 5코스트끼리는 나머지 칸이
// 서로 달라도 같은 판이다. 픽스처의 다른 덱끼리는 최대 0.33 이라 0.4 도 여유가 있다 (겹치는 코어 4개+ 조건은 그대로).
export const SIMILAR_OPPONENT_MIN = 0.4
export const SIMILAR_OPPONENT_MIN_SHARED = 4
const SIMILAR_OPPONENT_CORE_COST = 4

export interface SimilarOpponent {
  opponent: LobbyParticipant
  /** 코어 기물의 코스트 가중 Jaccard (기물 슬러그, 성급 무시) */
  similarity: number
  /** 겹치는 코어 기물 — 내 성급 · 상대 성급 (같은 기물 여러 장이면 최고 성급), 코스트 높은 순 */
  shared: { name: string; cost: number; mine: number; theirs: number }[]
}

/** 같은 구성 판정에 쓰는 코어 기물: 4코스트+ 또는 contest 코어(2성+ 또는 아이템 보유) — 1성 무템 저코스트 채우기 기물 제외 */
function isSimilarityCore(u: SlimMatchUnit): boolean {
  return (u.rarity || 1) >= SIMILAR_OPPONENT_CORE_COST || isCoreUnit(u)
}

/** 코어 기물 슬러그 → 최고 성급 기물 (같은 기물 여러 장이면 성급 높은 쪽) */
function coreBySlug(units: SlimMatchUnit[]): Map<string, SlimMatchUnit> {
  const out = new Map<string, SlimMatchUnit>()
  for (const u of units.filter(isSimilarityCore)) {
    const s = entitySlug('champion', u.id)
    if (!s) continue
    const prev = out.get(s)
    if (!prev || (u.tier || 1) > (prev.tier || 1)) out.set(s, u)
  }
  return out
}

/**
 * 로비에서 최종 보드가 나와 가장 비슷한 상대 (나 제외).
 * 유사도 = 코어 기물(isSimilarityCore)의 코스트 가중 Jaccard(기물 슬러그 기준, 성급 무시).
 * 채우기 기물까지 세면 다른 덱끼리도 공용 기물로 겹친다(픽스처: 아리·알룬 캐리 vs 돌거북 리롤이 기물 5개 공유).
 * 픽스처 38판에서 실제 같은 구성은 0.84, 나머지는 최대 0.33. 밸류 보드 실전 판(5코스트 5개 공유)은 0.44.
 * SIMILAR_OPPONENT_MIN 이상이고 겹치는 코어 기물이 SIMILAR_OPPONENT_MIN_SHARED 개 이상일 때만. 같으면 등수 높은 상대.
 */
export function mostSimilarOpponent(m: { units: SlimMatchUnit[]; lobbyParticipants?: LobbyParticipant[] }): SimilarOpponent | null {
  const mine = coreBySlug(m.units)
  if (!mine.size) return null
  const cost = (u: SlimMatchUnit) => Math.max(u.rarity || 1, 1)
  let best: SimilarOpponent | null = null
  const opponents = (m.lobbyParticipants || []).filter((p) => !p.isUser).sort((a, b) => a.placement - b.placement)
  for (const p of opponents) {
    const theirs = coreBySlug(p.units)
    let inter = 0
    let total = 0
    const shared: SimilarOpponent['shared'] = []
    for (const [s, u] of mine) {
      total += cost(u)
      const t = theirs.get(s)
      if (!t) continue
      inter += cost(u)
      shared.push({ name: u.name, cost: cost(u), mine: u.tier || 1, theirs: t.tier || 1 })
    }
    for (const [s, t] of theirs) if (!mine.has(s)) total += cost(t)
    const similarity = total ? inter / total : 0
    if (!best || similarity > best.similarity) {
      best = { opponent: p, similarity, shared: shared.sort((a, b) => b.cost - a.cost) }
    }
  }
  return best && best.similarity >= SIMILAR_OPPONENT_MIN && best.shared.length >= SIMILAR_OPPONENT_MIN_SHARED ? best : null
}


import gameNames from './gameNames.json'
import { buildIndex, lower, normalizeItemId, normalizeTftId } from './gameIds'

/**
 * 전 세트 이름표 (서버 전용 — 700KB 라 클라이언트 컴포넌트에서 import 하지 않는다).
 * 이전 세트 판(데모 데이터)의 이름·아이콘과 다른 세트 시너지명 환각 검사에 쓴다.
 * 현재 세트는 lib/gameData 를 먼저 찾을 것.
 */

export interface NameEntry {
  name: string
  icon: string
  cost?: number
  set?: number
}

const NAMES = gameNames as unknown as {
  champions: Record<string, NameEntry>
  traits: Record<string, NameEntry>
  items: Record<string, NameEntry>
}

/** 정규화 키가 겹치면(여러 세트의 아칼리) 최신 세트가 이기도록 세트 내림차순 */
const latestFirst = (m: Record<string, NameEntry>) => Object.entries(m).sort((a, b) => (b[1].set ?? 0) - (a[1].set ?? 0))
const ANY_CHAMP = buildIndex(latestFirst(NAMES.champions), ([id]) => [id, lower(normalizeTftId(id))])
const ANY_TRAIT = buildIndex(latestFirst(NAMES.traits), ([id]) => [id, lower(normalizeTftId(id))])
const ANY_ITEM = buildIndex(Object.entries(NAMES.items), ([id]) => [id, normalizeItemId(id)])

/** 어느 세트든 기물 이름표 (현재 세트를 먼저 찾을 것) */
export function findAnyChampionName(id: string): NameEntry | undefined {
  return ANY_CHAMP.get(id)?.[1] ?? ANY_CHAMP.get(normalizeTftId(id).toLowerCase())?.[1]
}

export function findAnyTraitName(id: string): NameEntry | undefined {
  return ANY_TRAIT.get(id)?.[1] ?? ANY_TRAIT.get(normalizeTftId(id).toLowerCase())?.[1]
}

export function findAnyItemName(id: string): NameEntry | undefined {
  return ANY_ITEM.get(id)?.[1] ?? ANY_ITEM.get(normalizeItemId(id))?.[1]
}

/** 모든 세트의 시너지 한글명 (다른 세트 시너지명 환각 검사용) */
export const ALL_SET_TRAIT_NAMES: string[] = [...new Set(Object.values(NAMES.traits).map((t) => t.name))]

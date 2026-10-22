import gameData from './gameData.json'
import { buildIndex, compact, exactKeys, looseKeys, lookup, lower, normChamp, normalizeItemId } from './gameIds'

export { normalizeTftId } from './gameIds'

/**
 * 게임 기준 DB 접근 (서버·스크립트용 — 스킬·아이템 설명까지 든 전체 데이터라 240KB 다).
 *
 * 데이터는 scripts/buildGameData.js 가 Community Dragon 에서 패치별로 만든 lib/gameData.json 하나뿐이다.
 * 기물 코스트·시너지·단계표·조합법을 다른 곳에 따로 적지 말고 여기서 읽는다.
 * 조회 규칙(apiName · 통계 키 · 한글명 · 영문명 · 별칭)은 lib/gameIds.
 *
 * 클라이언트 컴포넌트가 닿는 모듈은 lib/gameFacts(단계표·칸 수·슬러그, 같은 빌드의 lite 파일)를 쓴다.
 * 이전 세트 이름(데모·환각 검사)은 lib/gameNames.
 *
 * 스킬 설명의 '?' 는 Community Dragon 에 수치가 없는 자리다 (세트18 스킬 변수는 공개 데이터에 없다).
 */

export interface GameChampion {
  apiName: string
  slug: string
  name: string
  nameEn: string
  cost: number
  /** 시너지 apiName */
  traits: string[]
  role: string | null
  /** 보드 칸 수 (장로 드래곤 2) */
  slots: number
  stats: {
    hp: number
    armor: number
    magicResist: number
    damage: number
    attackSpeed: number | null
    range: number
    mana: number
    initialMana: number
  }
  ability: { name: string; desc: string }
  icon: string
  /** 형태 변형이면 본체 apiName (럭스 형태 9종 → DA_Lux18_Base). 경기 데이터에는 본체 id 만 나온다 */
  variantOf?: string
}

export interface GameTraitLevel {
  min: number
  max: number | null
  style: number
  text: string
}

export interface GameTrait {
  apiName: string
  slug: string
  name: string
  nameEn: string
  /** 단계 인원 (중복 제거). 단계가 없는 특수 시너지(일월식)는 빈 배열 */
  breakpoints: number[]
  desc: string
  levels: GameTraitLevel[]
  icon: string
  aliases?: string[]
}

export type GameItemKind = 'component' | 'completed' | 'emblem' | 'radiant' | 'artifact' | 'consumable'

export interface GameItem {
  apiName: string
  slug: string
  name: string
  nameEn: string
  kind: GameItemKind
  /** 재료 apiName 2개 (조합 아이템이 아니면 빈 배열) */
  recipe: string[]
  tags: string[]
  desc: string
  unique: boolean
  icon: string
}

interface GameDataFile {
  set: number
  gameVersion: string
  contentVersion: string
  generatedAt: string
  champions: Record<string, GameChampion>
  traits: Record<string, GameTrait>
  items: Record<string, GameItem>
}

const DATA = gameData as unknown as GameDataFile

export const GAME_DATA_INFO = {
  set: DATA.set,
  gameVersion: DATA.gameVersion,
  contentVersion: DATA.contentVersion,
  generatedAt: DATA.generatedAt,
}

export const GAME_CHAMPIONS: GameChampion[] = Object.values(DATA.champions)
export const GAME_TRAITS: GameTrait[] = Object.values(DATA.traits)
export const GAME_ITEMS: GameItem[] = Object.values(DATA.items)

const CHAMP_INDEX = buildIndex(GAME_CHAMPIONS, exactKeys)
const CHAMP_LOOSE = buildIndex(GAME_CHAMPIONS, looseKeys)
const TRAIT_INDEX = buildIndex(GAME_TRAITS, exactKeys)
const TRAIT_LOOSE = buildIndex(GAME_TRAITS, looseKeys)
const ITEM_INDEX = buildIndex(GAME_ITEMS, (i) => [i.apiName, i.name])
const ITEM_LOOSE = buildIndex(GAME_ITEMS, (i) => [normalizeItemId(i.apiName), i.slug, lower(i.nameEn), compact(i.name)])

/** 현재 세트 기물 (apiName · 통계 키 · 슬러그 · 한글명 · 영문명) */
export function findChampion(idOrName: string | null | undefined): GameChampion | undefined {
  return lookup(CHAMP_INDEX, CHAMP_LOOSE, idOrName, normChamp)
}

/** 현재 세트 시너지 (apiName · 슬러그 · 한글명 · 영문명 · 옛 키 별칭) */
export function findTrait(idOrName: string | null | undefined): GameTrait | undefined {
  return lookup(TRAIT_INDEX, TRAIT_LOOSE, idOrName, normChamp)
}

/** 현재 세트 아이템 (apiName · 슬러그 · 한글명 · 영문명) */
export function findItem(idOrName: string | null | undefined): GameItem | undefined {
  return lookup(ITEM_INDEX, ITEM_LOOSE, idOrName, normalizeItemId)
}

/** 기물의 시너지 한글명 */
export function championTraitNames(c: GameChampion): string[] {
  return c.traits.map((id) => DATA.traits[id]?.name ?? id)
}

/* ───────── 아이템 조합 ───────── */

/** 일반 조합 재료 8종 (뒤집개·프라이팬은 상징·전략가 아이템 재료라 뺀다) */
const isBasicComponent = (i: GameItem) => i.kind === 'component' && !/Spatula|FryingPan/i.test(i.apiName)

/**
 * 완성템 한글명 → 재료 한글명 2개 (일반 재료로만 만드는 완성템).
 * 같은 이름이 세트 아이템(DA_)과 일반 아이템(TFT_Item_)으로 두 번 있으면 먼저 나온 세트 아이템을 쓴다.
 */
export const ITEM_RECIPES: Record<string, string[]> = {}
for (const i of GAME_ITEMS) {
  if (i.kind !== 'completed' || ITEM_RECIPES[i.name]) continue
  const parts = i.recipe.map((id) => DATA.items[id])
  if (parts.length === 2 && parts.every((p) => p && isBasicComponent(p))) ITEM_RECIPES[i.name] = parts.map((p) => p.name)
}

/** 일반 조합 재료 한글명 */
export const BASIC_COMPONENT_NAMES: string[] = [...new Set(Object.values(ITEM_RECIPES).flat())]

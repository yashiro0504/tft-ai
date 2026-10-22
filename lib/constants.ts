import { findChampion, findItem, findTrait, normalizeTftId } from './gameData'
import { findAnyChampionName, findAnyItemName, findAnyTraitName } from './gameNames'

export { normalizeTftId }

/**
 * LoL Data Dragon 버전 — 소환사 프로필 아이콘·데모 데이터의 LoL 초상화에만 쓴다.
 * TFT 기물·시너지·아이템 이름과 아이콘은 게임 기준 DB(lib/gameData)에서 읽는다.
 */
export const DDRAGON_VERSION = '16.17.1'

export interface TranslatedItem {
  name: string
  iconUrl: string
}

export interface TranslatedTrait {
  name: string
  iconUrl: string
}

export interface TranslatedChamp {
  name: string
  imgUrl: string
  /** 현재 세트 기물이 아니어서 코스트를 모르면 undefined */
  cost: number | undefined
}

/** 현재 세트 기물 초상화 URL (덱 데이터처럼 이름만 있는 키도 받는다). 현재 세트가 아니면 null */
export function championPortraitUrl(id: string | null | undefined): string | null {
  return findChampion(id)?.icon || null
}

/** 기물 코스트 (1~5). 현재 세트 기물이 아니면 undefined */
export function getChampionCost(id: string): number | undefined {
  return findChampion(id)?.cost
}

export function translateChampion(id: string): TranslatedChamp {
  if (!id) return { name: '알 수 없음', imgUrl: '', cost: undefined }

  const current = findChampion(id)
  if (current) return { name: current.name, imgUrl: current.icon, cost: current.cost }

  // 이전 세트 기물 (데모 데이터 등)
  const any = findAnyChampionName(id)
  if (any) return { name: any.name, imgUrl: any.icon, cost: any.cost && any.cost <= 5 ? any.cost : undefined }

  return { name: normalizeTftId(id), imgUrl: '', cost: undefined }
}

export function translateItem(id: string): TranslatedItem {
  if (!id) return { name: '', iconUrl: '' }

  const entry = findItem(id) ?? findAnyItemName(id)
  if (entry) return { name: entry.name, iconUrl: entry.icon }

  // 이름표에 없는 상징(Emblem): 시너지 이름으로 짓는다
  const cleanId = id.replace(/^(TFT\d*|DA)_(\d+_)?(Item_)?/i, '')
  if (/Emblem/i.test(cleanId)) {
    const traitKey = cleanId.replace(/Emblem(Item)?$/i, '').trim()
    return { name: `${translateTrait(traitKey).name || traitKey} 상징`, iconUrl: '' }
  }

  return { name: cleanId, iconUrl: '' }
}

export function translateTrait(id: string): TranslatedTrait {
  if (!id) return { name: '', iconUrl: '' }

  const entry = findTrait(id) ?? findAnyTraitName(id)
  if (entry) return { name: entry.name, iconUrl: entry.icon }

  return { name: normalizeTftId(id), iconUrl: '' }
}

import decksData from './decksData.json'
import metaStatsData from './metaStats.json'
import { tierFromAvgPlacement } from './meta'

/**
 * 메타 덱(보드 조합) — 롤체지지 추천 덱을 정규화한 decksData.json 을
 * 우리 실측 메타 통계(lib/metaStats.json)와 결합한다.
 */

interface RawUnitItem {
  key: string
  name: string
  iconUrl: string
}

interface RawUnit {
  lolchessKey: string
  name: string
  cost: number | null
  star: number
  /** 보드 슬롯 인덱스 (0~27, 4행×7열) */
  index: number | null
  imgUrl: string
  matchedKey: string | null
  traits: string[]
  items: RawUnitItem[]
}

interface RawDeck {
  id: string
  name: string
  gold: number | null
  unitCost: number
  unitCount: number
  traits: { key: string; name: string; iconUrl: string; count: number }[]
  units: RawUnit[]
}

const DATA = decksData as unknown as {
  generatedAt: string
  source: string
  sourceUrl?: string
  patch: string | null
  deckCount: number
  unitMatchRate: number
  decks: RawDeck[]
}

const CHAMPS = ((metaStatsData as unknown as Record<string, unknown>).champions || {}) as Record<
  string,
  { avgPlacement: number; top4Rate?: number; sampleSize?: number }
>

export interface DeckUnitStat {
  avgPlacement: number
  top4Rate: number
  sampleSize: number
}

export interface DeckUnitView extends RawUnit {
  stat?: DeckUnitStat
}

export interface DeckView {
  id: string
  name: string
  gold: number | null
  unitCost: number
  traits: RawDeck['traits']
  units: DeckUnitView[]
  /** 실측 가중 평균등수 (매칭된 기물만, 표본 가중) */
  avgPlacement: number | null
  top4Rate: number | null
  /** 실측 통계가 있는 기물 비율 (0~1) */
  coverage: number
  sampleSize: number
  tier: string
  /** 대표 캐리(아이템 3개 또는 최고 코스트) */
  carryKey: string | null
}

export interface DeckMetaInfo {
  generatedAt: string
  source: string
  patch: string | null
  deckCount: number
  unitMatchRate: number
}

export function getDeckMetaInfo(): DeckMetaInfo {
  return {
    generatedAt: DATA.generatedAt,
    source: DATA.source,
    patch: DATA.patch,
    deckCount: DATA.deckCount,
    unitMatchRate: DATA.unitMatchRate,
  }
}

function computeDeck(deck: RawDeck): DeckView {
  let weight = 0
  let placeSum = 0
  let top4Sum = 0
  let matchedUnits = 0
  let sampleSize = 0

  const units: DeckUnitView[] = deck.units.map((u) => {
    const stat = u.matchedKey ? CHAMPS[u.matchedKey] : undefined
    if (stat && typeof stat.avgPlacement === 'number') {
      const w = Math.max(1, stat.sampleSize || 0)
      weight += w
      placeSum += stat.avgPlacement * w
      top4Sum += (stat.top4Rate || 0) * w
      sampleSize += stat.sampleSize || 0
      matchedUnits += 1
      return {
        ...u,
        stat: {
          avgPlacement: stat.avgPlacement,
          top4Rate: stat.top4Rate || 0,
          sampleSize: stat.sampleSize || 0,
        },
      }
    }
    return { ...u }
  })

  const avgPlacement = weight > 0 ? Math.round((placeSum / weight) * 100) / 100 : null
  const top4Rate = weight > 0 ? top4Sum / weight : null
  const coverage = deck.units.length ? matchedUnits / deck.units.length : 0

  // 캐리: 아이템 3개 장착 유닛 → 없으면 최고 코스트
  const withItems = units.filter((u) => u.items.length >= 2).sort((a, b) => b.items.length - a.items.length)
  const carry = withItems[0] || [...units].sort((a, b) => (b.cost || 0) - (a.cost || 0))[0]

  return {
    id: deck.id,
    name: deck.name,
    gold: deck.gold,
    unitCost: deck.unitCost,
    traits: deck.traits,
    units,
    avgPlacement,
    top4Rate,
    coverage,
    sampleSize,
    tier: avgPlacement != null ? tierFromAvgPlacement(avgPlacement) : '-',
    carryKey: carry ? carry.matchedKey ?? carry.lolchessKey : null,
  }
}

/** 실측 평균등수 오름차순 (통계 없는 덱은 뒤로) */
export function getDeckViews(): DeckView[] {
  return DATA.decks.map(computeDeck).sort((a, b) => {
    if (a.avgPlacement == null && b.avgPlacement == null) return b.unitCost - a.unitCost
    if (a.avgPlacement == null) return 1
    if (b.avgPlacement == null) return -1
    return a.avgPlacement - b.avgPlacement
  })
}

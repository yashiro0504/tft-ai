import decksData from './decksData.json'
import metaStatsData from './metaStats.json'
import { tierFromAvgPlacement } from './meta'
import { set18PortraitUrl } from './constants'

/**
 * 메타 덱(구성) — lib/decksData.json 을 정규화한다.
 * 데이터는 Riot 래더 실제 최종 보드를 묶어 만든다(scripts/buildDecksFromBoards.js).
 * 덱 수치(평균 등수·TOP4·1등·판수)는 그 덱 보드들의 실제 결과다.
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
  /** 시너지 최대 단계(breakpoint max)를 넘는 선택 기물 — 시너지 count 에서 제외 */
  flex?: boolean
  /** 이 덱 보드 중 이 기물을 쓴 비율 (실측 덱만) */
  usage?: number
}

interface RawDeck {
  id: string
  name: string
  gold: number | null
  unitCost: number
  unitCount: number
  traits: { key: string; name: string; iconUrl: string; count: number }[]
  units: RawUnit[]
  avgPlacement?: number
  top4Rate?: number
  carryKey?: string | null
  /** 래더 실측 덱이면 채워진다 (scripts/buildDecksFromBoards.js) */
  /** 이 덱 보드들의 레벨 중앙값 */
  level?: number
  games?: number
  /** 전체 보드 중 이 덱 비율 (0~1) */
  playRate?: number
  /** 1등 비율 (0~1) */
  winRate?: number
  /** 1~8등 횟수 */
  placementDist?: number[]
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
  /** 래더 실측 덱이면 채워진다 (scripts/buildDecksFromBoards.js) */
  /** 이 덱 보드들의 레벨 중앙값 */
  level?: number
  games?: number
  /** 전체 보드 중 이 덱 비율 (0~1) */
  playRate?: number
  /** 1등 비율 (0~1) */
  winRate?: number
  /** 1~8등 횟수 */
  placementDist?: number[]
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

  const units: DeckUnitView[] = deck.units.map((raw) => {
    // 정적 덱 데이터의 초상화를 세트18 전용 아트로 교체
    const u = { ...raw, imgUrl: set18PortraitUrl(raw.matchedKey ?? raw.lolchessKey) ?? raw.imgUrl }
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

  // 실측 덱: 그 덱 보드들의 실제 결과를 그대로 쓴다 (기물 평균으로 다시 계산하지 않는다)
  const measured = typeof deck.games === 'number' && typeof deck.avgPlacement === 'number'
  const avgPlacement = measured
    ? (deck.avgPlacement as number)
    : weight > 0
      ? Math.round((placeSum / weight) * 100) / 100
      : null
  const top4Rate = measured ? (deck.top4Rate ?? null) : weight > 0 ? top4Sum / weight : null
  const coverage = measured ? 1 : deck.units.length ? matchedUnits / deck.units.length : 0

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
    sampleSize: measured ? (deck.games as number) : sampleSize,
    tier: avgPlacement != null ? tierFromAvgPlacement(avgPlacement) : '-',
    carryKey: measured && deck.carryKey ? deck.carryKey : carry ? carry.matchedKey ?? carry.lolchessKey : null,
    level: deck.level,
    games: deck.games,
    playRate: deck.playRate,
    winRate: deck.winRate,
    placementDist: deck.placementDist,
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

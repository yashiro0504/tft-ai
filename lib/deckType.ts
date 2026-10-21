import { AXIS_CONFIG } from './axisConfig'
import type { DeckType, DeckTypeInfo, SlimMatchData, SlimMatchUnit } from './types'

/**
 * 덱 유형 판정 (리롤형 / 표준형) — AI-EVAL 후속 1.
 *
 * TFT에서 같은 최종 보드라도 운영 방식이 다르다.
 * - 리롤형: 낮은 레벨에서 1·2코스트 3성을 여러 개 만들고 캐리를 3성으로 올리는 운영
 * - 표준형: 레벨을 올려 고코스트 보드를 채우는 운영
 *
 * 라운드별 리롤/레벨업 이력은 Riot Match-V1에 없으므로, **최종 보드의 3성 개수·3성 코스트·레벨**만으로
 * 보수적으로 판정한다. 판정에 필요한 최소 데이터가 없으면 'unknown'으로 두고 점수를 만들지 않는다.
 */

export const DECK_TYPE_LABEL: Record<DeckType, string> = {
  reroll: '리롤형',
  standard: '표준형',
  mixed: '혼합',
  unknown: '판정 불가',
}

/**
 * 덱의 실제 캐리 = 아이템을 가장 많이 든 기물, 동률이면 코스트 높은 쪽.
 * (아이템 축의 '최고 코스트 기물' 캐리와는 다르다 — 리롤 덱은 아이템을 든 저코스트가 캐리다.)
 */
export function boardCarry(units: SlimMatchUnit[]): SlimMatchUnit | undefined {
  return units
    .slice()
    .sort((a, b) => (b.items?.length ?? 0) - (a.items?.length ?? 0) || (b.rarity ?? 1) - (a.rarity ?? 1))[0]
}

export function detectDeckType(m: SlimMatchData): DeckTypeInfo {
  const cfg = AXIS_CONFIG.deckType
  const units = m.units || []
  const threeStarUnits = units.filter((u) => u.tier === 3)
  const costs = threeStarUnits.map((u) => u.rarity ?? 1).sort((a, b) => a - b)
  const lowCostThreeStars = costs.filter((c) => c <= cfg.lowCostMaxRarity).length
  const carry = boardCarry(units)
  const carryThreeStar = Boolean(carry && carry.tier === 3)
  const base = {
    threeStars: threeStarUnits.length,
    threeStarCosts: costs,
    lowCostThreeStars,
    carryThreeStar,
  }

  if (units.length < cfg.minUnits) {
    return {
      ...base,
      type: 'unknown',
      reason: `기물 ${units.length}개로 판정 불가 (최소 ${cfg.minUnits}개)`,
    }
  }
  if (!m.level) {
    return { ...base, type: 'unknown', reason: '레벨 정보 없음' }
  }

  const lowCostOk = lowCostThreeStars >= cfg.minLowCostThreeStars
  // 캐리 3성이 저코스트 3성 조건을 대신하려면 캐리 자체가 리롤 코스트여야 한다 (8레벨 4코 3성은 표준형).
  const rerollCarry = carryThreeStar && (carry?.rarity ?? 1) <= cfg.carryMaxRarity
  const reroll =
    threeStarUnits.length >= cfg.minThreeStars &&
    (lowCostOk || rerollCarry) &&
    m.level <= cfg.maxLevel

  const reason = `3성 ${threeStarUnits.length}개${costs.length ? `(${costs.join('·')}코)` : ''} · Lv.${m.level}${
    carryThreeStar ? ' · 캐리 3성' : ''
  }`

  return { ...base, type: reroll ? 'reroll' : 'standard', reason }
}

export function describeDeckType(info: DeckTypeInfo): string {
  return `${DECK_TYPE_LABEL[info.type]} — ${info.reason}`
}

export interface DeckTypeSummary {
  type: DeckType
  reroll: number
  standard: number
  unknown: number
  total: number
  line: string
}

/** 여러 경기(종합 분석)용 요약. 한 판이라도 유형이 섞이면 mixed. */
export function summarizeDeckTypes(matches: SlimMatchData[]): DeckTypeSummary {
  return summarizeDeckInfos(matches.map(detectDeckType))
}

/** 이미 판정한 결과로 요약한다 (같은 경기를 두 번 판정하지 않도록). */
export function summarizeDeckInfos(infos: DeckTypeInfo[]): DeckTypeSummary {
  const reroll = infos.filter((i) => i.type === 'reroll').length
  const standard = infos.filter((i) => i.type === 'standard').length
  const unknown = infos.filter((i) => i.type === 'unknown').length
  const total = infos.length
  const type: DeckType =
    reroll && standard ? 'mixed' : reroll ? 'reroll' : standard ? 'standard' : 'unknown'
  const line =
    total === 0
      ? '경기 데이터 없음 · 판정 불가'
      : total === 1
      ? describeDeckType(infos[0])
      : `리롤형 ${reroll}/${total}판 · 표준형 ${standard}/${total}판${
          unknown ? ` · 판정 불가 ${unknown}/${total}판` : ''
        }`
  return { type, reroll, standard, unknown, total, line }
}

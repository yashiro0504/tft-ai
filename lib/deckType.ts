import { AXIS_CONFIG } from './axisConfig'
import { entitySlug } from './entitySlug'
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

/** 탱커·하이브리드 아이템 (scripts/buildDecksFromBoards.js TANK_ITEMS·HYBRID_ITEMS 의 한글명) — 캐리 판별에서 세지 않는다 */
const NON_CARRY_ITEMS = new Set([
  '가고일 돌갑옷', '워모그의 갑옷', '수호자의 맹세', '정령의 형상', '적응형 투구', '태양불꽃 망토',
  '굳건한 심장', '용의 발톱', '저녁갑주', '덤불 조끼', '이온 충격기',
  '크라운가드', '거인의 결의', '스테락의 도전', '도적의 장갑',
])

const carryItemCount = (u: SlimMatchUnit) => (u.items || []).filter((n) => !NON_CARRY_ITEMS.has(n)).length

/**
 * 보드의 캐리 — 템포 점수(캐리 3성)·덱 유형 판정·덱 가이드·빈집 후보가 모두 이 정의를 쓴다.
 * 1) preferKey(유사 메타 덱의 carryKey)가 내 보드에 있으면 그 기물
 * 2) 캐리 아이템(탱커·하이브리드 제외)이 가장 많은 기물 → 동률이면 성급 높은 쪽 → 코스트 높은 쪽
 * (덱 빌더의 '딜템 최다 기물' 캐리와 같은 방향. 아이템 축의 '최고 코스트 기물'과는 다른 개념이다)
 */
export function boardCarry(units: SlimMatchUnit[], preferKey?: string | null): SlimMatchUnit | undefined {
  if (preferKey) {
    const slug = entitySlug('champion', preferKey)
    const hit = units.find((u) => entitySlug('champion', u.id) === slug)
    if (hit) return hit
  }
  return units
    .slice()
    .sort(
      (a, b) =>
        carryItemCount(b) - carryItemCount(a) ||
        (b.tier || 1) - (a.tier || 1) ||
        (b.rarity ?? 1) - (a.rarity ?? 1) ||
        (b.items?.length ?? 0) - (a.items?.length ?? 0)
    )[0]
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

  // 캐리를 이름으로 밝혀 둔다 — 템포의 '캐리 3성'이 어느 기물 이야기인지 프롬프트에서 헷갈리지 않게
  const reason = `3성 ${threeStarUnits.length}개${costs.length ? `(${costs.join('·')}코)` : ''} · Lv.${m.level}${
    carry ? ` · 캐리 ${carry.name} ${carry.tier || 1}성` : ''
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

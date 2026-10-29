import { AXIS_CONFIG } from './axisConfig'
import { entitySlug } from './entitySlug'
import { stageOfRound } from './quality'
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
 *
 * 리롤형의 성패는 '리롤 핵심 기물'(rerollCore — 딜템을 가장 많이 든 1~3코, 같으면 비싼 쪽. 7렙 3코 리롤이면 그 3코)의 3성이다.
 * - 1코 3성이 여럿이어도 핵심 3코가 2성이면 보드는 미완성이다 (2026-10-29 백승민#agent: 베이가 3성·카시오페아 2성 판이
 *   '캐리 3성 완성'으로 읽혀 템포 96, 코치가 "9렙을 못 갔다"고 진단했다).
 * - 3성을 하나도 못 만든 리롤 판(핵심 기물 2성 · Lv.7 이하 · 5스테이지+ 탈락 · 4·5코에 딜템 없음)도 리롤형(미완성)으로 본다.
 *   표준형으로 읽으면 "레벨이 낮다"가 처방이 되는데, 이 판의 문제는 레벨이 아니라 핵심 기물 3성이다.
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

/** 탱커·하이브리드 아이템인가 (캐리 판별에서 세지 않는 아이템) */
export const isTankItem = (name: string) => NON_CARRY_ITEMS.has(name)

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

/** 딜템 2개+를 든 기물 — '아이템 몰아준 기물'로 본다 (탱커·하이브리드 아이템 제외) */
const isItemized = (u: SlimMatchUnit) => carryItemCount(u) >= 2

/**
 * 리롤 핵심 기물 — 딜템 2개+를 든 1~3코스트 기물 중 딜템이 가장 많은 기물, 같으면 코스트가 높은 기물 → 성급.
 * boardCarry 와 달리 딜템이 같으면 성급보다 코스트를 먼저 본다: 베이가(1코 3성)·카시오페아(3코 2성)가 딜템 3개씩이면
 * 7렙 3코 리롤의 핵심은 카시오페아다. 리롤형 템포·핵심 장면이 이 기물의 3성 여부를 본다.
 */
export function rerollCore(units: SlimMatchUnit[]): SlimMatchUnit | undefined {
  const maxCost = AXIS_CONFIG.deckType.carryMaxRarity
  return units
    .filter((u) => isItemized(u) && (u.rarity ?? 1) <= maxCost)
    .sort(
      (a, b) =>
        Math.min(carryItemCount(b), 3) - Math.min(carryItemCount(a), 3) ||
        (b.rarity ?? 1) - (a.rarity ?? 1) ||
        (b.tier || 1) - (a.tier || 1)
    )[0]
}

/** 캐리 기물의 슬러그 (예: 'lux') — 기준선(lib/baselines)의 캐리별 칸 키. 보드가 비었으면 null */
export function boardCarryKey(units: SlimMatchUnit[]): string | null {
  const carry = boardCarry(units || [])
  return carry ? entitySlug('champion', carry.id) || null : null
}

export function detectDeckType(m: SlimMatchData): DeckTypeInfo {
  const cfg = AXIS_CONFIG.deckType
  const units = m.units || []
  const threeStarUnits = units.filter((u) => u.tier === 3)
  const costs = threeStarUnits.map((u) => u.rarity ?? 1).sort((a, b) => a - b)
  const lowCostThreeStars = costs.filter((c) => c <= cfg.lowCostMaxRarity).length
  const carry = boardCarry(units)
  const core = rerollCore(units)
  const base = {
    threeStars: threeStarUnits.length,
    threeStarCosts: costs,
    lowCostThreeStars,
    carryThreeStar: Boolean(carry && carry.tier === 3),
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
  // 리롤 핵심 기물(rerollCore)이 3성이면 3성이 그것 하나여도 리롤형이다 (7렙 3코 3성 한 장 보드).
  const rerollCarry = (Boolean(carry && carry.tier === 3) && (carry?.rarity ?? 1) <= cfg.carryMaxRarity) || core?.tier === 3
  const highItemized = units.some((u) => (u.rarity ?? 1) > cfg.carryMaxRarity && isItemized(u))
  const complete =
    m.level <= cfg.maxLevel &&
    ((threeStarUnits.length >= cfg.minThreeStars && (lowCostOk || rerollCarry)) || (core?.tier === 3 && !highItemized))
  // 3성을 못 만든 리롤 판: 핵심 기물 2성 · 낮은 레벨 · 늦은 탈락 · 4·5코에 딜템 없음
  const stage = stageOfRound(m.lastRound)
  const incomplete =
    !complete &&
    Boolean(core && (core.tier || 1) === 2) &&
    !highItemized &&
    m.level <= cfg.incompleteMaxLevel &&
    stage >= cfg.incompleteMinStage
  const reroll = complete || incomplete

  // 리롤형이면 3성 기준 = 리롤 핵심 기물 (없으면 캐리). 표준형은 캐리 그대로.
  const target = reroll && core ? core : carry
  const targetThreeStar = Boolean(target && target.tier === 3)
  const targetText = target
    ? reroll && core
      ? ` · 핵심 ${target.name}(${target.rarity ?? 1}코) ${target.tier || 1}성${targetThreeStar ? '' : ' — 3성 미완성'}`
      : ` · 캐리 ${target.name} ${target.tier || 1}성`
    : ''
  // 캐리를 이름으로 밝혀 둔다 — 템포의 '캐리 3성'이 어느 기물 이야기인지 프롬프트에서 헷갈리지 않게
  const reason = `3성 ${threeStarUnits.length}개${costs.length ? `(${costs.join('·')}코)` : ''} · Lv.${m.level}${targetText}`

  return {
    ...base,
    carryThreeStar: targetThreeStar,
    ...(reroll && core ? { core: { name: core.name, cost: core.rarity ?? 1, tier: core.tier || 1 } } : {}),
    ...(incomplete ? { incomplete: true } : {}),
    type: reroll ? 'reroll' : 'standard',
    reason,
  }
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

import {
  getMetaSectionInfo,
  getChampionRankings,
  getTraitRankings,
  getItemRankings,
  getComboRankings,
  getCompSets,
  hasMetaStats,
} from './meta'
import { translateChampion, translateTrait, translateItem, getChampionCost } from './constants'
import { getDeckViews, getDeckMetaInfo, type DeckView } from './decks'
import type {
  TftMetaResponse,
  MetaChampRanking,
  MetaTraitRanking,
  MetaItemRanking,
  MetaComboRanking,
  MetaCompRanking,
  MetaDeckRanking,
} from './types'

/** 덱 뷰 → 응답 모양 (JSON 덱 · DB 덱 공용) */
/**
 * @param opts.withGuide 래더 덱 가이드(guide)를 포함할지. AI 프롬프트 전용이라 공개 응답(/meta·/api/tft/decks)에는 넣지 않는다
 *   (덱 59개 기준 약 64KB — 모바일 초기 로딩에 그대로 붙는다).
 */
export function toMetaDeck(d: DeckView, opts: { withGuide?: boolean } = {}): MetaDeckRanking {
  return {
    id: d.id,
    name: d.name,
    gold: d.gold,
    unitCost: d.unitCost,
    traits: d.traits,
    units: d.units.map((u) => ({
      key: u.matchedKey ?? u.lolchessKey,
      name: u.name,
      cost: u.cost,
      star: u.star,
      index: u.index,
      imgUrl: u.imgUrl,
      items: u.items,
      flex: u.flex,
      stat: u.stat,
    })),
    avgPlacement: d.avgPlacement,
    top4Rate: d.top4Rate,
    coverage: d.coverage,
    sampleSize: d.sampleSize,
    tier: d.tier,
    carryKey: d.carryKey,
    level: d.level,
    games: d.games,
    playRate: d.playRate,
    winRate: d.winRate,
    placementDist: d.placementDist,
    ...(opts.withGuide && d.guide ? { guide: d.guide } : {}),
  }
}

/**
 * /api/tft/meta 응답과 /meta 페이지가 공유하는 순수 빌더.
 * (빌드 타임 JSON만 읽으므로 어디서 호출해도 부작용이 없다.)
 */
export function buildMetaPayload(): TftMetaResponse {
  const info = getMetaSectionInfo()
  const hasMeta = !info.sample && info.hasMeta

  const champions: MetaChampRanking[] = hasMeta
    ? getChampionRankings().map((c) => {
        const t = translateChampion(c.key)
        return {
          key: c.key,
          name: t.name,
          imgUrl: t.imgUrl,
          avgPlacement: c.avgPlacement,
          top4Rate: c.top4Rate ?? 0,
          sampleSize: c.sampleSize,
          avgTier: c.avgTier ?? 1,
          threeStarRate: c.threeStarRate ?? 0,
          prevRank: c.prevRank,
          rankDelta: c.rankDelta,
          avgDelta: c.avgDelta,
          cost: getChampionCost(c.key),
        }
      })
    : []

  const traits: MetaTraitRanking[] = hasMeta
    ? getTraitRankings(3).map((t2) => {
        const t = translateTrait(t2.key)
        return {
          key: t2.key,
          name: t.name,
          iconUrl: t.iconUrl,
          avgPlacement: t2.avgPlacement,
          top4Rate: t2.top4Rate ?? 0,
          sampleSize: t2.sampleSize,
          avgTier: t2.avgTier ?? 1,
          prevRank: t2.prevRank,
          rankDelta: t2.rankDelta,
          avgDelta: t2.avgDelta,
        }
      })
    : []

  const items: MetaItemRanking[] = hasMeta
    ? getItemRankings().map((i) => {
        const t = translateItem(i.key)
        return {
          key: i.key,
          name: t.name,
          iconUrl: t.iconUrl,
          avgPlacement: i.avgPlacement,
          top4Rate: i.top4Rate ?? 0,
          sampleSize: i.sampleSize,
          prevRank: i.prevRank,
          rankDelta: i.rankDelta,
          avgDelta: i.avgDelta,
        }
      })
    : []

  // 조합 키: `${champ}|${item}` (BIS 근거)
  const combos: MetaComboRanking[] = hasMeta
    ? getComboRankings(5).map((cb) => {
        const [champKey = '', ...rest] = cb.key.split('|')
        const itemKey = rest.join('|')
        const ct = translateChampion(champKey)
        const it = translateItem(itemKey)
        return {
          key: cb.key,
          champKey,
          itemKey,
          champName: ct.name,
          champImgUrl: ct.imgUrl,
          itemName: it.name,
          itemIconUrl: it.iconUrl,
          avgPlacement: cb.avgPlacement,
          top4Rate: cb.top4Rate ?? 0,
          sampleSize: cb.sampleSize,
        }
      })
    : []

  // 메타 조합: 기물 + BIS 아이템 세트 (평균등수 낮은 순)
  const comps: MetaCompRanking[] = hasMeta
    ? getCompSets(3, 10).map((cp) => {
        const ct = translateChampion(cp.champKey)
        return {
          key: cp.champKey,
          name: ct.name,
          imgUrl: ct.imgUrl,
          cost: getChampionCost(cp.champKey),
          avgPlacement: cp.avgPlacement,
          top4Rate: cp.top4Rate,
          sampleSize: cp.sampleSize,
          avgTier: cp.avgTier ?? 1,
          threeStarRate: cp.threeStarRate ?? 0,
          prevRank: cp.prevRank,
          rankDelta: cp.rankDelta,
          avgDelta: cp.avgDelta,
          items: cp.items.map((it) => {
            const t = translateItem(it.itemKey)
            return {
              key: it.key,
              name: t.name,
              iconUrl: t.iconUrl,
              avgPlacement: it.avgPlacement,
              top4Rate: it.top4Rate,
              sampleSize: it.sampleSize,
            }
          }),
        }
      })
    : []

  // 메타 덱(보드 조합): 롤체지지 추천 덱 + 실측 통계 결합
  const decks: MetaDeckRanking[] = getDeckViews().map((d) => toMetaDeck(d))

  return {
    success: true,
    hasMeta,
    patch: info.patch,
    source: info.source,
    generatedAt: info.generatedAt,
    prevGeneratedAt: info.prevGeneratedAt,
    hasAugmentMeta: hasMetaStats(),
    champions,
    traits,
    items,
    combos,
    comps,
    decks,
    deckMeta: getDeckMetaInfo(),
  }
}

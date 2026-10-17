import { NextRequest, NextResponse } from 'next/server'
import {
  getMetaSectionInfo,
  getChampionRankings,
  getTraitRankings,
  getItemRankings,
  getComboRankings,
} from '@/lib/meta'
import { translateChampion, translateTrait, translateItem, getChampionCost } from '@/lib/constants'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/cache'
import { rateLimitGuard, handleApiError } from '@/lib/apiUtils'
import type {
  TftMetaResponse,
  MetaChampRanking,
  MetaTraitRanking,
  MetaItemRanking,
  MetaComboRanking,
} from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tft/meta
 * lib/metaStats.json 의 실측 수집 메타(챔피언/시너지/아이템/조합)를
 * 한글 이름 + 이미지로 번역해 랭킹 형태로 반환한다.
 *
 * NOTE: 증강은 Riot 세트18 미제공으로 비어 있을 수 있다(hasAugmentMeta).
 */
export async function GET(req: NextRequest) {
  try {
    const limited = rateLimitGuard(req, 'meta', 60, 60_000)
    if (limited) return limited

    const cacheKey = 'meta:rankings'
    const cached = cacheGet<TftMetaResponse>(cacheKey)
    if (cached) return NextResponse.json(cached)

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

    const response: TftMetaResponse = {
      success: true,
      hasMeta,
      patch: info.patch,
      source: info.source,
      generatedAt: info.generatedAt,
      prevGeneratedAt: info.prevGeneratedAt,
      hasAugmentMeta: false,
      champions,
      traits,
      items,
      combos,
    }

    cacheSet(cacheKey, response, CACHE_TTL.SEARCH)
    return NextResponse.json(response)
  } catch (err) {
    return handleApiError(err, 'meta')
  }
}
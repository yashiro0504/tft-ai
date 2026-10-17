import { NextRequest, NextResponse } from 'next/server'
import {
  getMetaSectionInfo,
  getChampionRankings,
  getTraitRankings,
  getItemRankings,
  getComboRankings,
  getCompSets,
} from '@/lib/meta'
import { translateChampion, translateTrait, translateItem, getChampionCost } from '@/lib/constants'
import { getDeckViews, getDeckMetaInfo } from '@/lib/decks'
import { cacheGetWithSource, cacheSet, CACHE_TTL } from '@/lib/cache'
import { elapsedMs, errorFields, incrMetric, logEvent } from '@/lib/observability'
import { rateLimitGuard, handleApiError } from '@/lib/apiUtils'
import type {
  TftMetaResponse,
  MetaChampRanking,
  MetaTraitRanking,
  MetaItemRanking,
  MetaComboRanking,
  MetaCompRanking,
  MetaDeckRanking,
} from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * 이 엔드포인트는 빌드 타임 JSON(lib/metaStats.json, lib/decksData.json)만 읽어
 * 응답을 만든다. 따라서 CDN 캐시가 안전하다.
 * - s-maxage=300: 5분간 엣지 캐시 (Riot/LLM 호출 없음, 순수 정적 데이터)
 * - stale-while-revalidate=3600: 만료 후 최대 1시간은 낡은 응답을 즉시 주고 백그라운드 갱신
 * - 인메모리 memo: 웜 인스턴스에서 JSON 재가공 비용까지 제거
 */
const META_MEMO_TTL_MS = (() => {
  const parsed = Number(process.env.META_MEMO_TTL_MS)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5 * 60_000
})()

const META_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
} as const

let metaMemo: { value: TftMetaResponse; expiresAt: number } | null = null

function metaJson(payload: TftMetaResponse): NextResponse {
  return NextResponse.json(payload, { headers: META_CACHE_HEADERS })
}

/**
 * GET /api/tft/meta
 * lib/metaStats.json 의 실측 수집 메타(챔피언/시너지/아이템/조합)를
 * 한글 이름 + 이미지로 번역해 랭킹 형태로 반환한다.
 *
 * NOTE: 증강은 Riot 세트18 미제공으로 비어 있을 수 있다(hasAugmentMeta).
 */
export async function GET(req: NextRequest) {
  const startedAt = Date.now()
  try {
    const limited = rateLimitGuard(req, 'meta', 60, 60_000)
    if (limited) return limited

    const now = Date.now()
    if (metaMemo && metaMemo.expiresAt > now) {
      incrMetric('cache.hit.meta_memo')
      logEvent('info', 'api_meta', { ms: elapsedMs(startedAt), cacheSource: 'memo' })
      return metaJson(metaMemo.value)
    }

    const cacheKey = 'meta:rankings'
    const cached = await cacheGetWithSource<TftMetaResponse>(cacheKey)
    if (cached) {
      incrMetric(`cache.hit.meta_${cached.source}`)
      metaMemo = { value: cached.value, expiresAt: now + META_MEMO_TTL_MS }
      logEvent('info', 'api_meta', { ms: elapsedMs(startedAt), cacheSource: cached.source })
      return metaJson(cached.value)
    }

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
    const deckViews = getDeckViews()
    const decks: MetaDeckRanking[] = deckViews.map((d) => ({
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
        stat: u.stat,
      })),
      avgPlacement: d.avgPlacement,
      top4Rate: d.top4Rate,
      coverage: d.coverage,
      sampleSize: d.sampleSize,
      tier: d.tier,
      carryKey: d.carryKey,
    }))

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
      comps,
      decks,
      deckMeta: getDeckMetaInfo(),
    }

    await cacheSet(cacheKey, response, CACHE_TTL.SEARCH)
    metaMemo = { value: response, expiresAt: Date.now() + META_MEMO_TTL_MS }
    logEvent('info', 'api_meta', {
      ms: elapsedMs(startedAt),
      cacheSource: 'miss',
      champions: champions.length,
      decks: decks.length,
    })
    return metaJson(response)
  } catch (err) {
    logEvent('error', 'api_meta_failed', { ms: elapsedMs(startedAt), ...errorFields(err) })
    return handleApiError(err, 'meta')
  }
}
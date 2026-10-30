import type { TftMetaResponse } from './types'

/**
 * `/meta` 초기 SSR 용 슬림 payload.
 *
 * 기본 탭(덱)만 서버에서 렌더링하고, 나머지 탭(BIS/기물/시너지/아이템)은
 * 클라이언트에서 처음 전환할 때 `/api/tft/meta` 로 지연 로딩한다.
 * (전체 payload 588KB → 덱 전용 약 131KB)
 */
export function toDecksOnly(data: TftMetaResponse): TftMetaResponse {
  return {
    ...withoutLegacyDeckMeta(data),
    view: 'decks',
    champions: [],
    traits: [],
    items: [],
    combos: [],
    comps: [],
    decks: data.decks.map((deck) => ({
      ...deck,
      units: deck.units.map((unit) => ({
        key: unit.key,
        name: unit.name,
        cost: unit.cost,
        star: unit.star,
        index: unit.index,
        imgUrl: unit.imgUrl,
        items: unit.items.map((item) => ({
          key: item.key,
          name: item.name,
          iconUrl: item.iconUrl,
        })),
      })),
    })),
  }
}

/**
 * `deckMeta`(래더 JSON 덱 50개 · 1,083판)는 화면이 쓰는 `decksMeta`(덱 성적표와 같은 스냅샷)와 값이 달라 혼동된다
 * (2026-10-30 지시문 5-6). withDeckSnapshot 이 폴백 decksMeta 를 만든 뒤에는 응답에서 뺀다.
 */
export function withoutLegacyDeckMeta(data: TftMetaResponse): TftMetaResponse {
  const { deckMeta: _legacy, ...rest } = data
  void _legacy
  return rest
}

/**
 * 메타 첫 화면용 덱 요약 (2026-10-30 지시문 3) — 스냅샷 정보 + 덱 목록 표에 필요한 값만.
 * id · 이름 · 티어 · 평균등수 · TOP4 · 표본 · 픽률 · 시너지 · 구성 아이콘. 기물 아이템·덱 가이드·기물별 통계는 뺀다
 * (전체 /api/tft/meta 약 1.07MB → 덱 요약). 덱 상세(아이템)는 `view=decks`, 기물·아이템·조합 탭은 전체 응답을 탭을 열 때 받는다.
 */
export function toDeckSummary(data: TftMetaResponse): TftMetaResponse {
  return {
    ...withoutLegacyDeckMeta(data),
    view: 'summary',
    champions: [],
    traits: [],
    items: [],
    combos: [],
    comps: [],
    decks: data.decks.map((deck) => ({
      id: deck.id,
      name: deck.name,
      gold: deck.gold,
      unitCost: deck.unitCost,
      traits: deck.traits,
      units: deck.units.map((unit) => ({
        key: unit.key,
        name: unit.name,
        cost: unit.cost,
        star: unit.star,
        index: unit.index,
        imgUrl: unit.imgUrl,
        items: [],
        ...(unit.flex ? { flex: true } : {}),
      })),
      avgPlacement: deck.avgPlacement,
      top4Rate: deck.top4Rate,
      coverage: deck.coverage,
      sampleSize: deck.sampleSize,
      tier: deck.tier,
      carryKey: deck.carryKey,
      ...(deck.games != null ? { games: deck.games } : {}),
      ...(deck.playRate != null ? { playRate: deck.playRate } : {}),
      ...(deck.level != null ? { level: deck.level } : {}),
    })),
  }
}

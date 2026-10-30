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
 * 스냅샷 정보만 (2026-10-30 2차 지시문 5-3) — 덱 목록은 view=decks 한 번으로 받는다.
 * 예전 요약에는 덱 100개가 다시 들어 있어 첫 화면이 같은 덱을 두 번 받았다. 이제 decksMeta(패치·티어·판수·갱신 시각)만 준다.
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
    decks: [],
  }
}

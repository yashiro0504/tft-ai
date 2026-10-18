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
    ...data,
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

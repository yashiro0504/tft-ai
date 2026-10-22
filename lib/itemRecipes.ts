import { BASIC_COMPONENT_NAMES, ITEM_RECIPES } from './gameData'

/**
 * 아이템 재료 단위 매칭 — 빈집 메타 덱 후보(lib/comparisonFacts)용.
 *
 * Riot 데이터에는 라운드별 재료 획득·조합 시점이 없고 최종 완성템만 있다. 완성템끼리 비교하면
 * "다른 기물을 위해 일찍 조합한 아이템" 때문에 불공정하므로, 최종 아이템을 기본 재료로 풀어
 * "같은 재료였다면 무엇을 만들 수 있었나"만 본다. (조합을 되돌릴 수 없다는 점은 반영하지 못한다)
 * 조합법은 게임 기준 DB(lib/gameData — 일반 재료 8종으로 만드는 완성템)에서 읽는다.
 */

const RECIPES = ITEM_RECIPES
const COMPONENTS = new Set<string>(BASIC_COMPONENT_NAMES)

/** 아이템 → 기본 재료. 재료 자체면 [자신], 조합법이 없으면(상징·유물·찬란한 아이템) null */
export function componentsOf(item: string): string[] | null {
  if (COMPONENTS.has(item)) return [item]
  return RECIPES[item] ?? null
}

/** 최종 아이템들을 기본 재료 묶음(중복 허용)으로 푼다. 풀 수 없는 아이템은 건너뛴다 */
export function componentPool(items: string[]): string[] {
  return items.flatMap((it) => componentsOf(it) ?? [])
}

/** 조합법이 있는 완성템인가 (재료 단위 매칭 대상) */
export function isCraftable(item: string): boolean {
  return Boolean(RECIPES[item])
}

/**
 * targets(완성템) 중 pool(재료)로 동시에 만들 수 있는 최대 묶음. 순서·재료 공유를 모두 시도한다.
 * 결과는 targets 의 순서를 따른다. (캐리 아이템은 3개 이하라 전수 탐색으로 충분하다)
 */
export function bestBuildable(targets: string[], pool: string[]): string[] {
  const craftable = targets.filter(isCraftable)
  let best: number[] = []
  const search = (i: number, left: string[], picked: number[]) => {
    if (picked.length > best.length) best = [...picked]
    if (i >= craftable.length) return
    const need = RECIPES[craftable[i]]
    const rest = [...left]
    const ok = need.every((c) => {
      const at = rest.indexOf(c)
      if (at < 0) return false
      rest.splice(at, 1)
      return true
    })
    if (ok) search(i + 1, rest, [...picked, i])
    search(i + 1, left, picked)
  }
  search(0, pool, [])
  return best.map((i) => craftable[i])
}

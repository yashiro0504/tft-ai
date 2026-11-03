import lite from './gameData.lite.json'
import { buildIndex, exactKeys, looseKeys, lookup, normChamp, type Named } from './gameIds'

/**
 * 가벼운 게임 사실 (클라이언트 공용) — 기물 슬러그·칸 수, 시너지 단계표.
 *
 * lib/gameData.json 과 같은 빌드(scripts/buildGameData.js)가 만든 요약본(lib/gameData.lite.json, 16KB)을 읽는다.
 * 클라이언트 컴포넌트가 닿는 모듈(LabUI · MatchCard · keyMoments · coaching · boardSlots)은 이쪽을 쓰고,
 * 설명·아이템·아이콘이 필요한 서버 코드는 lib/gameData 를 쓴다. 조회 규칙은 둘 다 lib/gameIds 로 같다.
 */

interface LiteChampion extends Named {
  cost: number
  slots: number
  /** 시너지 한글명 */
  traits: string[]
}

interface LiteTrait extends Named {
  breakpoints: number[]
}

/** 현재 세트 번호 (Riot tft_set_number) — 이전 시즌 판을 분석에서 뺀다 (lib/queue) */
export const CURRENT_SET: number = (lite as unknown as { set: number }).set

/**
 * 현재 세트의 첫 패치 (예: '16.23'). scripts/buildGameData.js 가 세트가 바뀐 빌드에서 기록한다 — 모르면 null.
 * 이보다 앞선 패치의 집계·플레이북은 이전 세트 것이라 현재 세트 덱에 붙이지 않는다 (lib/playbook · docs/SEASON-TRANSITION.md).
 */
export const SET_FIRST_PATCH: string | null = (lite as unknown as { setFirstPatch?: string | null }).setFirstPatch ?? null

/** 패치 문자열을 비교 가능한 수로 ('16.21' → 16021, 형식이 다르면 -1) */
export function patchOrdinal(p: string | null | undefined): number {
  const m = /^(\d+)\.(\d+)$/.exec(String(p ?? ''))
  return m ? Number(m[1]) * 1000 + Number(m[2]) : -1
}

/** 이 패치가 현재 세트 패치인가 (세트 첫 패치를 모르면 숫자 패치는 모두 현재 세트로 본다) */
export function isCurrentSetPatch(p: string | null | undefined): boolean {
  const n = patchOrdinal(p)
  if (n < 0) return false
  return SET_FIRST_PATCH ? n >= patchOrdinal(SET_FIRST_PATCH) : true
}

/** 게임 데이터 패치 (예: '16.21') */
export const GAME_VERSION: string = (lite as unknown as { gameVersion: string }).gameVersion

/** 레벨별 상점 확률(%) — [레벨 1, 레벨 2, …] 마다 [1코, 2코, 3코, 4코, 5코]. 조회는 lib/shopOdds */
export const SHOP_ODDS: number[][] = (lite as unknown as { shopOdds?: number[][] }).shopOdds ?? []

const CHAMPIONS = (lite as unknown as { champions: LiteChampion[] }).champions
const TRAITS = (lite as unknown as { traits: LiteTrait[] }).traits

const CHAMP_INDEX = buildIndex(CHAMPIONS, exactKeys)
const CHAMP_LOOSE = buildIndex(CHAMPIONS, looseKeys)
/** 현재 세트 시너지 한글명 (덱 이름 앞의 시너지를 떼어 낼 때 — 긴 이름 먼저) */
export const TRAIT_NAMES: string[] = TRAITS.map((t) => t.name).sort((a, b) => b.length - a.length)

const TRAIT_INDEX = buildIndex(TRAITS, exactKeys)
const TRAIT_LOOSE = buildIndex(TRAITS, looseKeys)

/** 현재 세트 기물 상세 페이지 슬러그 */
export const CURRENT_CHAMPION_SLUGS = new Set(CHAMPIONS.map((c) => c.slug))

/** 현재 세트 상점 기물인가 (소환수·복제체처럼 기물 목록에 없는 id 는 false) */
export function isKnownChampion(id: string | null | undefined): boolean {
  return Boolean(lookup(CHAMP_INDEX, CHAMP_LOOSE, id, normChamp))
}

/** 기물이 차지하는 보드 칸 (장로 드래곤 2, 모르면 1) */
export function championSlots(id: string | null | undefined): number {
  return lookup(CHAMP_INDEX, CHAMP_LOOSE, id, normChamp)?.slots ?? 1
}

/** 기물의 시너지 한글명 (모르면 빈 배열) */
export function championTraitsOf(id: string | null | undefined): string[] {
  return lookup(CHAMP_INDEX, CHAMP_LOOSE, id, normChamp)?.traits ?? []
}

/** 시너지 정식 한글명 — 키·영문명·옛 별칭도 받는다 (모르면 null) */
export function traitNameOf(idOrName: string): string | null {
  return lookup(TRAIT_INDEX, TRAIT_LOOSE, idOrName, normChamp)?.name ?? null
}

/** 시너지 단계 인원 — 키·영문명·한글명·옛 별칭 어느 쪽으로도 (모르면 빈 배열) */
export function traitBreakpointsOf(idOrName: string): number[] {
  return lookup(TRAIT_INDEX, TRAIT_LOOSE, idOrName, normChamp)?.breakpoints ?? []
}

/** 시너지 한글명 → 단계 인원. 단계가 없는 특수 시너지(일월식)는 넣지 않는다 */
export function traitBreakpointMap(): Record<string, number[]> {
  return Object.fromEntries(TRAITS.filter((t) => t.breakpoints.length).map((t) => [t.name, t.breakpoints]))
}

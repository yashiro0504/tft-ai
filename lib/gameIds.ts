/**
 * 게임 id 정규화·조회 규칙 (데이터 없음 — lib/gameData · lib/gameFacts 공용).
 *
 * 조회 순서: Riot apiName 정확히 일치(DA_18_Azir) → 접두사·세트 꼬리를 뗀 키(azir, KogMaw18_AD → kogmaw)
 * → 소문자 → 띄어쓰기 제거. 통계 키·덱 데이터 키·한글명 어느 쪽으로 와도 같은 항목을 찾는다.
 */

/**
 * id 정규화 — 세트 접두사·꼬리를 뗀 키.
 * DA_18_Kobuko → Kobuko, DA_Vi18 → Vi, DA_Lux18_Base → Lux, Nidalee18_AP → Nidalee, DA_18_GnarSmall → Gnar
 */
export function normalizeTftId(id: string): string {
  if (!id) return ''
  return id
    .replace(/^TFT\d*_/i, '')
    .replace(/^DA_\d*_/i, '')
    .replace(/^DA_/i, '')
    .replace(/^TFTTutorial_/i, '')
    .replace(/_Base$/i, '')
    .replace(/Base$/i, '')
    .replace(/_(AP|AD)$/i, '')
    .replace(/\d+$/i, '')
    .replace(/Small$/i, '')
    .trim()
}

/** 아이템 id 정규화 — TFT_Item_ · DA_ 접두사를 뗀 소문자 키 */
export function normalizeItemId(id: string): string {
  return String(id || '')
    .replace(/^TFT\d*_Item_/i, '')
    .replace(/^DA_\d*_Item_/i, '')
    .replace(/^DA_Item_/i, '')
    .replace(/^DA_\d*_/i, '')
    .replace(/^DA_/i, '')
    .replace(/^TFT_Item_/i, '')
    .replace(/^Item_/i, '')
    .trim()
    .toLowerCase()
}

export const lower = (s: string | undefined) => (s ? s.toLowerCase() : undefined)
/** 한글명 띄어쓰기 차이 흡수 ('거물의갑옷' = '거물의 갑옷') */
export const compact = (s: string | undefined) => (s ? s.replace(/\s+/g, '') : undefined)
export const normChamp = (s: string) => normalizeTftId(s).toLowerCase()

/** 키 → 항목. 먼저 넣은 키가 이긴다 (정확한 apiName 이 정규화 키보다 앞선다) */
export function buildIndex<T>(entries: T[], keysOf: (e: T) => (string | undefined)[]): Map<string, T> {
  const index = new Map<string, T>()
  for (const e of entries) {
    for (const k of keysOf(e)) {
      if (k && !index.has(k)) index.set(k, e)
    }
  }
  return index
}

/** 기물·시너지 공통 색인 키: 정확한 키(apiName · 한글명) / 느슨한 키(정규화 · 슬러그 · 영문명 · 별칭 · 띄어쓰기 제거) */
export interface Named {
  apiName: string
  slug: string
  name: string
  nameEn?: string
  aliases?: string[]
}
export const exactKeys = (e: Named) => [e.apiName, e.name]
export const looseKeys = (e: Named) => [
  normChamp(e.apiName),
  e.slug,
  lower(e.nameEn),
  compact(lower(e.nameEn)),
  ...(e.aliases ?? []).map(lower),
  compact(e.name),
]

/** 정확한 키 → 정규화 키 → 소문자 → 띄어쓰기 제거 순으로 찾는다 */
export function lookup<T>(
  exact: Map<string, T>,
  loose: Map<string, T>,
  id: string | null | undefined,
  normalize: (s: string) => string
): T | undefined {
  if (!id) return undefined
  const hit = exact.get(id)
  if (hit) return hit
  for (const k of [normalize(id), id.toLowerCase(), compact(id)]) {
    const found = k ? loose.get(k) : undefined
    if (found) return found
  }
  return undefined
}

/**
 * 기물·아이템·시너지 상세 페이지 URL 슬러그 (클라이언트·서버 공용, 데이터 import 없음).
 *
 * 수집 키는 소스마다 접두사·세트 번호가 달라서(예: 'Lux18_Base', 'DA_18_Greenfather', 'DA_Emerald18')
 * 접두사·구분자·세트 꼬리를 떼어 안정적인 소문자 슬러그로 만든다.
 *   /champions/lux · /traits/greenfather · /items/guinsoosragebladeradiant
 */
export type EntityKind = 'champion' | 'item' | 'trait'

export const ENTITY_PATH: Record<EntityKind, string> = {
  champion: '/champions',
  item: '/items',
  trait: '/traits',
}

/** app/components/metaShared.ts normKey 와 같은 규칙 */
function baseKey(value: string): string {
  return String(value || '')
    .replace(/^DA_\d*_/i, '')
    .replace(/^DA_/i, '')
    .replace(/^TFT\d*_Item_/i, '')
    .replace(/^TFT_Item_/i, '')
    .replace(/^TFT\d*_/i, '')
    .replace(/^Item_/i, '')
    .replace(/[_\s-]/g, '')
    .toLowerCase()
}

export function entitySlug(kind: EntityKind, key: string): string {
  const k = baseKey(key)
  // 기물: 'lux18base' → 'lux', 'gnar18' → 'gnar' (AP/AD 같은 변형 꼬리는 남긴다: 'gromp18ap' → 'gromp18ap')
  if (kind === 'champion') return k.replace(/\d+base$/, '').replace(/\d+$/, '')
  // 시너지: 'emerald18' → 'emerald'
  if (kind === 'trait') return k.replace(/\d+$/, '')
  return k
}

export function entityHref(kind: EntityKind, key: string): string {
  return `${ENTITY_PATH[kind]}/${encodeURIComponent(entitySlug(kind, key))}`
}

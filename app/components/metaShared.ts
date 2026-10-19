/** 메타 대시보드/상세 모달 공용 유틸 */

export type ItemClass = 'all' | 'normal' | 'radiant' | 'artifact' | 'emblem'

export const ITEM_CLASSES: ItemClass[] = ['all', 'normal', 'radiant', 'artifact', 'emblem']

export const ITEM_CLASS_LABEL: Record<ItemClass, string> = {
  all: '전체',
  normal: '일반',
  radiant: '찬란한',
  artifact: '유물',
  emblem: '상징',
}

/** 아이템 키 기준 분류 (Riot 키 규칙: Emblem / _Radiant / Artifact_) */
export function classifyItem(key: string): Exclude<ItemClass, 'all'> {
  const k = String(key || '').toLowerCase()
  if (k.includes('emblem')) return 'emblem'
  if (k.includes('radiant')) return 'radiant'
  if (k.includes('artifact')) return 'artifact'
  return 'normal'
}

/** 접두사/구분자를 제거해 서로 다른 데이터 소스의 키를 비교한다. */
export function normKey(value: string) {
  return String(value || '')
    .replace(/^DA_\d*_/i, '')
    .replace(/^DA_/i, '')
    .replace(/^TFT\d*_Item_/i, '')
    .replace(/^TFT_Item_/i, '')
    .replace(/^Item_/i, '')
    .replace(/[_\s-]/g, '')
    .toLowerCase()
}

export type ModalTarget =
  | { type: 'champion'; key: string }
  | { type: 'item'; key: string }
  | { type: 'trait'; key: string }

export type Tier = 'S' | 'A' | 'B' | 'C' | 'D'

/** 평균등수 분포 기준 상대 티어 (절대 임계값 대신 상위 퍼센타일) */
export function assignTiers(avgs: number[]): Tier[] {
  const order = avgs.map((a, i) => ({ a, i })).sort((x, y) => x.a - y.a)
  const out: Tier[] = new Array(avgs.length).fill('D')
  const total = order.length || 1
  order.forEach((it, idx) => {
    const p = idx / total
    out[it.i] = p < 0.1 ? 'S' : p < 0.3 ? 'A' : p < 0.6 ? 'B' : p < 0.85 ? 'C' : 'D'
  })
  return out
}

export function tierClass(tier: string) {
  const t = (tier || '').toUpperCase()
  return ['S', 'A', 'B', 'C', 'D'].includes(t) ? `rk-tier rk-t${t}` : 'rk-tier rk-tC'
}

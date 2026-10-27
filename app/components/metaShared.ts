import { PLACEMENT_SD } from '@/lib/statsShared'

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

/** 아무 정보가 없을 때의 평균등수 (8명 평균) */
const BASE_PLACEMENT = 4.5
/** 당기는 세기 범위 · 표 행이 너무 적어 분산을 못 구할 때의 값 */
const SHRINK_K_MIN = 5
const SHRINK_K_MAX = 200
const SHRINK_K_DEFAULT = 30

/**
 * 표본 수를 반영한 추정 평균등수 (경험적 베이즈 수축): (n·평균 + k·4.5) / (n + k).
 * 표본이 적은 행일수록 4.5등 쪽으로 당겨, 30판짜리 3.17등이 177판짜리 3.58등보다 확실히 낫다고 보지 않게 한다.
 * k = 한 판 등수 분산(2.29²) ÷ 행들 사이 실제 차이의 분산 — 표 안 평균들의 분산에서 표본 오차 몫을 빼서 구한다.
 * 행끼리 차이가 큰 표(덱, k≈18)는 덜 당기고, 차이가 작은 표(아이템, k≈110)는 많이 당긴다.
 */
export function shrinkPlacements(rows: { avg: number; sample: number }[]): number[] {
  const ok = rows.filter((r) => r.sample > 0 && Number.isFinite(r.avg))
  let k = SHRINK_K_DEFAULT
  if (ok.length >= 3) {
    const mean = ok.reduce((s, r) => s + r.avg, 0) / ok.length
    const variance = ok.reduce((s, r) => s + (r.avg - mean) ** 2, 0) / (ok.length - 1)
    const noise = ok.reduce((s, r) => s + PLACEMENT_SD ** 2 / r.sample, 0) / ok.length
    const real = variance - noise
    k = real > 0 ? Math.min(SHRINK_K_MAX, Math.max(SHRINK_K_MIN, PLACEMENT_SD ** 2 / real)) : SHRINK_K_MAX
  }
  return rows.map((r) => (r.sample > 0 ? (r.sample * r.avg + k * BASE_PLACEMENT) / (r.sample + k) : BASE_PLACEMENT))
}

/**
 * 표본 충분한 행끼리만 상대 티어를 매긴다 (표본 부족은 '-').
 * 순위는 추정 평균등수(shrinkPlacements) 기준. group 이 있으면 같은 group 안에서만 비교한다 (기물: 코스트별).
 */
export function assignSampleTiers(rows: { avg: number; sample: number; group?: string | number }[], min: number): (Tier | '-')[] {
  const out: (Tier | '-')[] = rows.map(() => '-')
  const okIdx = rows.map((_, i) => i).filter((i) => rows[i].sample >= min)
  // 당기는 세기는 표 전체에서 구하고, 티어만 group 안에서 나눈다 (group 하나는 행이 적어 분산이 흔들린다)
  const est = shrinkPlacements(okIdx.map((i) => rows[i]))
  const groups = new Map<string | number | undefined, number[]>()
  okIdx.forEach((i, k) => {
    const g = groups.get(rows[i].group) ?? []
    g.push(k)
    groups.set(rows[i].group, g)
  })
  for (const members of groups.values()) {
    const tiers = assignTiers(members.map((k) => est[k]))
    members.forEach((k, j) => {
      out[okIdx[k]] = tiers[j]
    })
  }
  return out
}

const TIER_ORDER: Record<Tier | '-', number> = { S: 0, A: 1, B: 2, C: 3, D: 4, '-': 5 }

/** 티어 순 (S 먼저, 표본 부족 '-' 마지막) */
export function tierRank(tier: Tier | '-'): number {
  return TIER_ORDER[tier]
}

export function tierClass(tier: string) {
  const t = (tier || '').toUpperCase()
  return ['S', 'A', 'B', 'C', 'D'].includes(t) ? `rk-tier rk-t${t}` : 'rk-tier rk-tC'
}

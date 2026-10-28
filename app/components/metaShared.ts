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

const TIERS: Tier[] = ['S', 'A', 'B', 'C', 'D']
/**
 * 티어 경계에서 '같은 티어'로 볼 차이 = 두 추정값 차이의 표준오차 × 이 값.
 * ±1 표준오차(1.0)로 묶으면 2026-10-27 마스터+ 덱 84개 중 43개가 한 티어씩 올라가 B티어가 사라졌다 —
 * 수축 추정값끼리는 차이가 작아 거의 모든 경계가 '겹침'이 된다. 0.25 는 경계의 근소한 차이만 묶는다 (8개).
 */
export const TIER_BOUNDARY_Z = 0.25
const percentileTier = (p: number): Tier => (p < 0.1 ? 'S' : p < 0.3 ? 'A' : p < 0.6 ? 'B' : p < 0.85 ? 'C' : 'D')

/**
 * 평균등수 분포 기준 상대 티어 (절대 임계값 대신 상위 퍼센타일).
 * - 값이 같은 행은 같은 티어 (예전엔 3.68등 두 덱이 순서만으로 S·A 로 갈렸다)
 * - sds(추정값의 표준오차)를 주면 경계 바로 아래 행이 위 티어 마지막 행과 근소한 차이(TIER_BOUNDARY_Z)면 위 티어로 올린다.
 *   기준은 위 티어의 '원래' 마지막 행이라 올린 행을 타고 줄줄이 올라가지 않는다. 경계에서 이어진 행만 본다.
 */
export function assignTiers(avgs: number[], sds?: number[]): Tier[] {
  const order = avgs.map((a, i) => ({ a, i })).sort((x, y) => x.a - y.a)
  const total = order.length || 1
  const own = order.map((_, idx) => percentileTier(idx / total))
  /** 퍼센타일 티어별 원래 마지막 행 */
  const lastOf = new Map<Tier, { a: number; i: number }>()
  order.forEach((it, idx) => lastOf.set(own[idx], it))
  const out: Tier[] = new Array(avgs.length).fill('D')
  order.forEach((it, idx) => {
    out[it.i] = own[idx]
    if (!idx) return
    const prev = order[idx - 1]
    const up = out[prev.i]
    if (it.a === prev.a) {
      out[it.i] = up
      return
    }
    // 앞 행이 바로 위 티어일 때만 (경계에서 이어진 행). 올린 행 다음도 보지만 기준은 원래 마지막 행이다
    const anchor = lastOf.get(up)
    if (!sds || !anchor || TIERS.indexOf(up) !== TIERS.indexOf(own[idx]) - 1) return
    if (it.a - anchor.a < TIER_BOUNDARY_Z * Math.hypot(sds[it.i] ?? 0, sds[anchor.i] ?? 0)) out[it.i] = up
  })
  return out
}

/** 덱 티어 수 범위 · 한 티어에 몰려도 되는 덱 비율 상한 (2026-10-28 재평가: S1·B17 로 뭉쳤다) */
export const DECK_TIER_MIN = 3
export const DECK_TIER_MAX = 5
export const DECK_TIER_MAX_SHARE = 0.5

/**
 * 덱 티어 (화면 설명 DECK_TIER_RULE 과 같은 계산 — 설명만 보고 손으로 셀 수 있게, 2026-10-28 16시 재확인 P2):
 * 1. 평균등수 순(같으면 오차가 작은 = 판 수 많은 덱 먼저)으로 늘어놓고 위에서부터 차례로 본다. 첫 덱이 S티어의 기준 덱.
 * 2. 다음 덱의 '평균 ± 오차' 구간이 지금 티어 기준 덱의 구간과 겹치고, 지금 티어가 한도(덱 N개의 50% = ⌊N/2⌋개)를
 *    아직 안 채웠으면 같은 티어. 아니면 그 덱부터 새 티어이고 그 덱이 새 기준 덱이다 (이웃끼리 줄줄이 잇지 않는다 — 연쇄 비교 X).
 *    예전엔 몰린 티어를 '가운데 절반에서 차이가 가장 큰 곳'에서 다시 나눠, 18개 중 9번째(50%)인 아리가 B로 밀렸다.
 * 3. 티어가 5개를 넘으면 경계 평균등수 차이가 가장 작은 이웃 두 티어를 합친다 (합쳐도 한도 안인 곳 먼저, 같으면 합친 티어가 작은 쪽).
 * 4. 티어가 3개 미만이면 가장 큰 티어를 이웃 평균등수 차이가 가장 큰 곳에서 둘로 나눈다.
 * 위 티어부터 S·A·B·C·D. sds = 화면의 오차(2.29/√n).
 */
export function assignSeparatedTiers(avgs: number[], sds: number[]): Tier[] {
  const order = avgs.map((a, i) => ({ a, s: sds[i] ?? 0, i })).sort((x, y) => x.a - y.a || x.s - y.s)
  const n = order.length
  if (!n) return []
  const cap = deckTierCap(n)
  /** 티어 = order 위치 [시작, 끝) */
  let groups: [number, number][] = []
  let start = 0
  for (let p = 1; p <= n; p++) {
    const anchor = order[start]
    if (p === n || p - start >= cap || order[p].a - anchor.a > order[p].s + anchor.s) {
      groups.push([start, p])
      start = p
    }
  }
  const gapBefore = (p: number) => order[p].a - order[p - 1].a
  while (groups.length > DECK_TIER_MAX) {
    const joins = groups.slice(1).map(([s, e], j) => ({ k: j, d: gapBefore(s), size: e - groups[j][0] }))
    const pool = joins.some((j) => j.size <= cap) ? joins.filter((j) => j.size <= cap) : joins
    const { k } = pool.reduce((a, b) => (b.d < a.d || (b.d === a.d && b.size < a.size) ? b : a))
    groups = [...groups.slice(0, k), [groups[k][0], groups[k + 1][1]], ...groups.slice(k + 2)]
  }
  while (groups.length < DECK_TIER_MIN) {
    const big = groups.reduce((b, g, k) => (g[1] - g[0] > groups[b][1] - groups[b][0] ? k : b), 0)
    const [from, to] = groups[big]
    if (to - from < 2) break
    let at = from + 1
    for (let p = from + 2; p < to; p++) if (gapBefore(p) > gapBefore(at)) at = p
    groups = [...groups.slice(0, big), [from, at], [at, to], ...groups.slice(big + 1)]
  }
  const out: Tier[] = new Array(avgs.length).fill('D')
  groups.forEach(([from, to], k) => {
    for (let p = from; p < to; p++) out[order[p].i] = TIERS[Math.min(k, TIERS.length - 1)]
  })
  return out
}

/** 한 티어에 들어갈 수 있는 덱 수 = 덱 N개의 50% (⌊N/2⌋, 최소 1) — 18개면 9개까지 */
export function deckTierCap(n: number): number {
  return Math.max(1, Math.floor(n * DECK_TIER_MAX_SHARE))
}

/** 덱 탭 화면 설명 — assignSeparatedTiers 와 같은 규칙 (짧은 칩 · 자세한 툴팁) */
export const DECK_TIER_RULE_SHORT = '티어 = 기준 덱과 오차가 겹치면 같은 티어 · 3~5개 · 한 티어 50% 이하(차면 다음 티어)'
export const DECK_TIER_RULE = [
  '평균등수 순으로 늘어놓고 위에서부터 차례로 봅니다. 각 티어의 첫 덱이 기준 덱이고, 다음 덱의 평균 ± 오차(2.29/√n) 구간이 기준 덱 구간과 겹치면 같은 티어입니다.',
  `겹치지 않거나, 겹쳐도 그 티어가 이미 티어를 매기는 덱 수의 ${DECK_TIER_MAX_SHARE * 100}%(18개면 ${deckTierCap(18)}개)를 채웠으면 그 덱부터 새 티어이고 그 덱이 새 기준 덱입니다.`,
  `티어가 ${DECK_TIER_MAX}개를 넘으면 경계 평균등수 차이가 가장 작은 이웃 두 티어를 합치고(합쳐도 ${DECK_TIER_MAX_SHARE * 100}% 이하인 곳 먼저), ${DECK_TIER_MIN}개 미만이면 가장 큰 티어를 이웃 평균등수 차이가 가장 큰 곳에서 둘로 나눕니다.`,
  '위 티어부터 S·A·B·C·D.',
].join(' ')

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
  const k = shrinkStrength(rows)
  return rows.map((r) => (r.sample > 0 ? (r.sample * r.avg + k * BASE_PLACEMENT) / (r.sample + k) : BASE_PLACEMENT))
}

/** 수축 추정값의 표준오차 ≈ 2.29/√(n+k) — 표본이 적을수록 크다 (티어 경계 판단용) */
export function shrunkPlacementSds(rows: { avg: number; sample: number }[]): number[] {
  const k = shrinkStrength(rows)
  return rows.map((r) => PLACEMENT_SD / Math.sqrt(Math.max(r.sample, 0) + k))
}

/** 당기는 세기 k = 한 판 등수 분산 ÷ 행들 사이 실제 차이의 분산 (shrinkPlacements 설명 참고) */
function shrinkStrength(rows: { avg: number; sample: number }[]): number {
  const ok = rows.filter((r) => r.sample > 0 && Number.isFinite(r.avg))
  let k = SHRINK_K_DEFAULT
  if (ok.length >= 3) {
    const mean = ok.reduce((s, r) => s + r.avg, 0) / ok.length
    const variance = ok.reduce((s, r) => s + (r.avg - mean) ** 2, 0) / (ok.length - 1)
    const noise = ok.reduce((s, r) => s + PLACEMENT_SD ** 2 / r.sample, 0) / ok.length
    const real = variance - noise
    k = real > 0 ? Math.min(SHRINK_K_MAX, Math.max(SHRINK_K_MIN, PLACEMENT_SD ** 2 / real)) : SHRINK_K_MAX
  }
  return k
}

/**
 * 표본 충분한 행끼리만 상대 티어를 매긴다 (표본 부족은 '-').
 * 순위는 추정 평균등수(shrinkPlacements) 기준. group 이 있으면 같은 group 안에서만 비교한다 (기물: 코스트별).
 * 같은 값은 같은 티어, 경계에서 위 티어와 오차 안이면 위 티어 (assignTiers).
 * separated: 기준 덱과 오차가 겹치면 같은 티어 · 3~5개 · 한 티어 50% 이하, 차면 다음 티어 (assignSeparatedTiers — 덱 탭, 화면 평균등수 기준)
 */
export function assignSampleTiers(
  rows: { avg: number; sample: number; group?: string | number }[],
  min: number,
  { separated = false }: { separated?: boolean } = {}
): (Tier | '-')[] {
  const out: (Tier | '-')[] = rows.map(() => '-')
  const okIdx = rows.map((_, i) => i).filter((i) => rows[i].sample >= min)
  // 당기는 세기는 표 전체에서 구하고, 티어만 group 안에서 나눈다 (group 하나는 행이 적어 분산이 흔들린다)
  const est = shrinkPlacements(okIdx.map((i) => rows[i]))
  const sds = shrunkPlacementSds(okIdx.map((i) => rows[i]))
  const groups = new Map<string | number | undefined, number[]>()
  okIdx.forEach((i, k) => {
    const g = groups.get(rows[i].group) ?? []
    g.push(k)
    groups.set(rows[i].group, g)
  })
  for (const members of groups.values()) {
    // 덱 탭은 화면에 보이는 평균등수 ± 2.29/√n 그대로 비교한다 (설명 문구와 같은 계산)
    const tiers = separated
      ? assignSeparatedTiers(
          members.map((k) => rows[okIdx[k]].avg),
          members.map((k) => PLACEMENT_SD / Math.sqrt(rows[okIdx[k]].sample))
        )
      : assignTiers(
          members.map((k) => est[k]),
          members.map((k) => sds[k])
        )
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

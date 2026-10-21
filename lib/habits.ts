import { scoringSample } from './quality'
import {
  duplicateGroups,
  emptySlotCount,
  ITEMS_ON_WEAK_MIN,
  nearBreakpoints,
  oneStarCarry,
  sameCompGap,
  weakItems,
  type KeyMoment,
} from './keyMoments'
import type { SlimMatchData } from './types'

/**
 * 여러 판 반복 습관 — 핵심 장면(lib/keyMoments)을 최근 경기마다 측정해 반복되는 것만 남긴다.
 * 한 판의 최종 보드는 운인지 실수인지 구분이 안 되지만, 같은 장면이 여러 판 반복되면 습관으로 말할 수 있다.
 * 초반 종료 판은 빼고 센다 (scoringSample). 등수 비교("있던 판 평균 N등 / 없던 판 M등")는 서술 통계다 — 원인이 아니다.
 */
export interface Habit extends KeyMoment {
  /** 습관이 나온 판 수 / 집계 판 수 */
  count: number
  of: number
}

/** 집계 판이 이보다 적으면 습관을 말하지 않는다 */
export const HABIT_MIN_MATCHES = 3
/** 습관으로 볼 최소 판 수 · 비율 */
export const HABIT_MIN_COUNT = 2
export const HABIT_MIN_RATE = 0.3
/** 1명 모자란 시너지는 흔해서(픽스처 38판 중 25판, 실전 10판 중 9판) 이 비율 이상 + 있던 판이 확실히 나쁠 때만 */
const NEAR_BREAKPOINT_MIN_RATE = 0.6
/** requireHarm 감지기: 있던 판 평균 등수가 없던 판보다 이만큼 이상 나빠야 습관으로 본다 */
const HARM_MARGIN = 0.5
export const HABITS_MAX = 3
/** 이 장면이 있던 판이 없던 판보다 평균 이만큼 이상 좋은 등수면 교정할 습관이 아니다 (이 유저에겐 해가 되지 않은 패턴) */
const BETTER_WITH_HABIT_MARGIN = 0.5

const round1 = (n: number) => Math.round(n * 10) / 10
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** "타릭 3회, 아이번 2회" — 많이 나온 순 상위 n개 */
function tally(names: string[], n = 3): string {
  const c = new Map<string, number>()
  for (const x of names) c.set(x, (c.get(x) || 0) + 1)
  return [...c]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} ${v}회`)
    .join(', ')
}

/** 습관이 있던 판 / 없던 판 평균 등수 (양쪽 모두 있을 때만) */
function placementSplit(sample: SlimMatchData[], hit: Set<SlimMatchData>): { with: number; without: number } | null {
  const yes = sample.filter((m) => hit.has(m)).map((m) => m.placement)
  const no = sample.filter((m) => !hit.has(m)).map((m) => m.placement)
  return yes.length && no.length ? { with: round1(avg(yes)), without: round1(avg(no)) } : null
}

interface Detector {
  kind: KeyMoment['kind']
  title: string
  minRate?: number
  /** 흔한 장면이라 "있던 판이 확실히 나빴을 때"만 습관으로 본다 (등수 비교 불가면 제외) */
  requireHarm?: boolean
  /** 판별 측정값 (해당 없으면 null) */
  measure: (m: SlimMatchData) => unknown | null
  /** 해당 판들의 측정값으로 사실 줄 본문 */
  describe: (hits: { m: SlimMatchData; v: never }[]) => string
}

const DETECTORS: Detector[] = [
  {
    kind: 'sameComp',
    title: '같은 구성 상위 상대보다 낮은 성급',
    measure: sameCompGap,
    describe: (hits) => {
      const gs = hits.map((h) => h.v as NonNullable<ReturnType<typeof sameCompGap>>)
      const names = gs.flatMap((g) => g.behind.map((b) => b.name))
      return `나보다 높은 등수의 같은 구성 상대보다 코어 성급이 낮았음${names.length ? ` — 자주 밀린 기물: ${tally(names)}` : ''} · 2성 이상 평균 ${round1(
        avg(gs.map((g) => g.mine2))
      )}개 vs ${round1(avg(gs.map((g) => g.theirs2)))}개`
    },
  },
  {
    kind: 'duplicateCopies',
    title: '같은 기물 1성을 여러 장 올림',
    measure: (m) => {
      const d = duplicateGroups(m)
      return d.length ? d : null
    },
    describe: (hits) =>
      `최종 보드에 같은 기물 1성을 2장 이상 올림 (${tally(hits.flatMap((h) => (h.v as ReturnType<typeof duplicateGroups>).map((g) => g.name)))})`,
  },
  {
    kind: 'itemsOnWeak',
    title: '좋은 아이템이 1성 기물에',
    measure: (m) => {
      const w = weakItems(m)
      return w.count >= ITEMS_ON_WEAK_MIN || w.radiant.length ? w : null
    },
    describe: (hits) => {
      const ws = hits.map((h) => h.v as ReturnType<typeof weakItems>)
      const radiant = ws.filter((w) => w.radiant.length).length
      return `아이템이 1성 기물에 몰림 (판당 평균 ${round1(avg(ws.map((w) => w.count)))}개 / 전체 ${round1(avg(ws.map((w) => w.total)))}개)${
        radiant ? ` · 찬란한 아이템이 1성 기물에 간 판 ${radiant}회` : ''
      }`
    },
  },
  {
    kind: 'carryOneStar',
    title: '캐리가 1성으로 끝남',
    measure: oneStarCarry,
    describe: (hits) => `아이템 든 캐리가 1성으로 끝남 (${tally(hits.map((h) => (h.v as NonNullable<ReturnType<typeof oneStarCarry>>).name))})`,
  },
  {
    kind: 'emptySlots',
    title: '보드 빈칸',
    measure: (m) => (emptySlotCount(m) > 0 ? emptySlotCount(m) : null),
    describe: (hits) => `레벨보다 기물이 적은 채 끝남 (평균 ${round1(avg(hits.map((h) => h.v as number)))}칸 비움)`,
  },
  {
    kind: 'nearBreakpoint',
    title: '1명 모자란 시너지',
    minRate: NEAR_BREAKPOINT_MIN_RATE,
    requireHarm: true,
    measure: (m) => {
      const n = nearBreakpoints(m)
      return n.length ? n : null
    },
    describe: (hits) =>
      `다음 단계까지 1명 남은 시너지로 끝남 (${tally(hits.flatMap((h) => (h.v as ReturnType<typeof nearBreakpoints>).map((x) => x.trait)))})`,
  },
]

/** 최근 경기에서 반복된 습관 (비율 높은 순, 최대 HABITS_MAX 개). 표본이 적으면 빈 배열. */
export function habitPatterns(matches: SlimMatchData[]): Habit[] {
  const { sample } = scoringSample((matches || []).filter((m) => m?.units?.length))
  if (sample.length < HABIT_MIN_MATCHES) return []
  const order = DETECTORS.map((d) => d.kind)
  return DETECTORS.flatMap((d) => {
    const hits = sample.flatMap((m) => {
      const v = d.measure(m)
      return v == null ? [] : [{ m, v: v as never }]
    })
    const rate = hits.length / sample.length
    if (hits.length < HABIT_MIN_COUNT || rate < (d.minRate ?? HABIT_MIN_RATE)) return []
    const split = placementSplit(sample, new Set(hits.map((h) => h.m)))
    if (split && split.with <= split.without - BETTER_WITH_HABIT_MARGIN) return []
    if (d.requireHarm && !(split && split.with >= split.without + HARM_MARGIN)) return []
    const splitText = split ? ` · 이 장면이 있던 판 평균 ${split.with}등 / 없던 판 ${split.without}등` : ''
    return [{ kind: d.kind, title: d.title, count: hits.length, of: sample.length, fact: `${hits.length}/${sample.length}판: ${d.describe(hits)}${splitText}` }]
  })
    .sort((a, b) => b.count / b.of - a.count / a.of || order.indexOf(a.kind) - order.indexOf(b.kind))
    .slice(0, HABITS_MAX)
}

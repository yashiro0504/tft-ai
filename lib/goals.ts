import { isEarlyGame } from './quality'
import { duplicateGroups, emptySlotCount, oneStarCarry, sameCompGap, weakItems, ITEMS_ON_WEAK_MIN, type KeyMoment } from './keyMoments'
import type { SlimMatchData } from './types'

/**
 * 연습 목표 — 핵심 장면/반복 습관을 "다음 N판 최종 보드 숫자 목표"로 바꾸고, 그 뒤 경기로 코드가 채점한다.
 * AI 의 연습 과제(drill) 문장은 자유 서술이라 채점할 수 없어서, 목표는 장면 종류에서 코드가 만든다.
 * 설정 시점(since) 이후에 끝난 경기만 센다 (초반 종료 판 제외).
 */
export type GoalKind = 'itemsOnWeak' | 'duplicateCopies' | 'carryOneStar' | 'emptySlots' | 'twoPlus'

export interface PracticeGoal {
  kind: GoalKind
  /** 측정 대상 (예: "1성 기물에 든 아이템") */
  label: string
  /** max = 값이 target 이하면 달성, min = 이상이면 달성 */
  dir: 'max' | 'min'
  target: number
  unit: string
  /** 목표를 만든 경기들의 평균값 (전후 비교용) */
  baseline: number
  /** 이 시각(게임 시작 시각, ms) 이후 경기만 채점한다 */
  since: number
  /** 채점할 경기 수 */
  games: number
  /** 목표를 만든 장면 제목 */
  source: string
}

export interface GoalGame {
  matchId: string
  placement: number
  value: number
  ok: boolean
}

export interface GoalProgress {
  games: GoalGame[]
  achieved: number
  done: boolean
  /** 채점한 경기 평균값 (없으면 null) */
  average: number | null
}

export const GOAL_GAMES = 3

const round1 = (n: number) => Math.round(n * 10) / 10
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const twoPlus = (m: SlimMatchData) => m.units.filter((u) => (u.tier || 1) >= 2).length

/** 목표 종류별 경기 측정값 */
export function measureGoal(kind: GoalKind, m: SlimMatchData): number {
  switch (kind) {
    case 'itemsOnWeak':
      return weakItems(m).count
    case 'duplicateCopies':
      return duplicateGroups(m).length
    case 'carryOneStar':
      return oneStarCarry(m) ? 1 : 0
    case 'emptySlots':
      return emptySlotCount(m)
    case 'twoPlus':
      return twoPlus(m)
  }
}

/**
 * 장면(또는 습관)에서 목표를 만든다. 목표로 바꿀 수 없는 장면(1명 모자란 시너지)은 null.
 * matches: 장면을 뽑은 경기들 (단일 분석이면 그 한 판).
 */
export function goalFromMoment(moment: Pick<KeyMoment, 'kind' | 'title'>, matches: SlimMatchData[]): PracticeGoal | null {
  const source = matches.filter((m) => m?.units?.length)
  if (!source.length) return null
  const since = Math.max(...source.map((m) => m.gameDatetime || 0))
  const base = { since, games: GOAL_GAMES, source: moment.title }
  const baselineOf = (kind: GoalKind) => round1(avg(source.map((m) => measureGoal(kind, m))))
  switch (moment.kind) {
    case 'itemsOnWeak':
      return { ...base, kind: 'itemsOnWeak', label: '1성 기물에 든 아이템', dir: 'max', target: ITEMS_ON_WEAK_MIN - 1, unit: '개', baseline: baselineOf('itemsOnWeak') }
    case 'duplicateCopies':
      return { ...base, kind: 'duplicateCopies', label: '같은 기물 1성을 여러 장 올린 묶음', dir: 'max', target: 0, unit: '개', baseline: baselineOf('duplicateCopies') }
    case 'carryOneStar':
      return { ...base, kind: 'carryOneStar', label: '1성으로 끝난 캐리', dir: 'max', target: 0, unit: '명', baseline: baselineOf('carryOneStar') }
    case 'emptySlots':
      return { ...base, kind: 'emptySlots', label: '최종 보드 빈칸', dir: 'max', target: 0, unit: '칸', baseline: baselineOf('emptySlots') }
    case 'sameComp': {
      // 같은 구성 상위 상대의 2성 수를 목표로 (보드 칸·레벨을 넘지 않게)
      const gaps = source.map(sameCompGap).filter((g): g is NonNullable<ReturnType<typeof sameCompGap>> => Boolean(g))
      const mine = baselineOf('twoPlus')
      const theirs = gaps.length ? Math.round(avg(gaps.map((g) => g.theirs2))) : Math.ceil(mine) + 2
      const cap = Math.max(...source.map((m) => m.level || 0), 1)
      return { ...base, kind: 'twoPlus', label: '2성 이상 기물', dir: 'min', target: Math.min(Math.max(theirs, Math.ceil(mine) + 1), cap), unit: '개', baseline: mine }
    }
    default:
      return null
  }
}

/** "1성 기물에 든 아이템 2개 이하" */
export function goalText(g: PracticeGoal): string {
  if (g.kind === 'carryOneStar') return '캐리를 1성으로 끝내지 않기'
  if (g.target === 0 && g.dir === 'max') return `${g.label} 0${g.unit}`
  return `${g.label} ${g.target}${g.unit} ${g.dir === 'max' ? '이하' : '이상'}`
}

/** 설정 이후 경기로 채점 (오래된 경기부터 games 판) */
export function evaluateGoal(g: PracticeGoal, matches: SlimMatchData[]): GoalProgress {
  const after = (matches || [])
    .filter((m) => (m.gameDatetime || 0) > g.since && m?.units?.length && !isEarlyGame(m))
    .sort((a, b) => (a.gameDatetime || 0) - (b.gameDatetime || 0))
    .slice(0, g.games)
  const games = after.map((m) => {
    const value = measureGoal(g.kind, m)
    return { matchId: m.matchId, placement: m.placement, value, ok: g.dir === 'max' ? value <= g.target : value >= g.target }
  })
  return {
    games,
    achieved: games.filter((x) => x.ok).length,
    done: games.length >= g.games,
    average: games.length ? round1(avg(games.map((x) => x.value))) : null,
  }
}

/** 브라우저 저장 키 (소환사별) */
export function goalStorageKey(gameName: string, tagLine: string): string {
  return `tftlab-goal:${gameName.trim().toLowerCase()}#${tagLine.trim().toLowerCase()}`
}

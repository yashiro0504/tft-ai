import type { GameBaselines, StageBaseline } from './baselines'
import { boardValue } from './boardValue'
import { boardCarry, boardCarryKey } from './deckType'
import { stageOfRound } from './quality'
import type { SlimMatchUnit } from './types'

/**
 * 원본 보드 → lib/gameBaselines.json (scripts/buildBaselines.js · 테스트 공용, 서버 전용).
 * 앱이 경기를 읽는 것과 같은 함수(stageOfRound · boardValue · boardCarryKey)로 묶어서, 조회 키가 어긋나지 않게 한다.
 */
export interface BaselineBoard {
  placement: number
  level: number
  /** '5-2' 형식 (lib/summarize formatTftRound) */
  lastRound: string
  units: SlimMatchUnit[]
}

export const BASELINE_MIN_SAMPLE = { stage: 100, carryStage: 40 }

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function summarize(rows: { level: number; value: number }[]): StageBaseline {
  return {
    n: rows.length,
    level: median(rows.map((r) => r.level)),
    boardValue: Math.round(median(rows.map((r) => r.value))),
  }
}

export function buildGameBaselines(
  boards: BaselineBoard[],
  meta: { source: string; patch: string | null; tierMin: string; matches: number; generatedAt: string },
  minSample = BASELINE_MIN_SAMPLE
): GameBaselines {
  const byStage = new Map<number, { level: number; value: number }[]>()
  const byCarry = new Map<string, { name: string; rows: Map<number, { level: number; value: number }[]> }>()
  let used = 0
  for (const b of boards) {
    const stage = stageOfRound(b.lastRound)
    if (!stage || !b.level || !b.units?.length) continue
    used++
    const row = { level: b.level, value: boardValue(b.units) }
    if (!byStage.has(stage)) byStage.set(stage, [])
    byStage.get(stage)!.push(row)
    const key = boardCarryKey(b.units)
    if (!key) continue
    if (!byCarry.has(key)) byCarry.set(key, { name: boardCarry(b.units)?.name || key, rows: new Map() })
    const c = byCarry.get(key)!
    if (!c.rows.has(stage)) c.rows.set(stage, [])
    c.rows.get(stage)!.push(row)
  }

  const stages = (m: Map<number, { level: number; value: number }[]>, min: number) =>
    Object.fromEntries(
      [...m.entries()]
        .filter(([, rows]) => rows.length >= min)
        .sort((a, b) => a[0] - b[0])
        .map(([stage, rows]) => [String(stage), summarize(rows)])
    )

  const carries = [...byCarry.entries()]
    .map(([key, c]) => ({ key, name: c.name, n: [...c.rows.values()].reduce((s, r) => s + r.length, 0), byStage: stages(c.rows, minSample.carryStage) }))
    .filter((c) => Object.keys(c.byStage).length > 0)
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key))

  return {
    source: meta.source,
    patch: meta.patch,
    tierMin: meta.tierMin,
    generatedAt: meta.generatedAt,
    matches: meta.matches,
    boards: used,
    minSample,
    byStage: stages(byStage, minSample.stage),
    byCarry: Object.fromEntries(carries.map(({ key, name, n, byStage: s }) => [key, { name, n, byStage: s }])),
  }
}

/** 쓰기 전 상식 검사 — 깨진 값이 매일 자동 커밋으로 들어가지 않게. 문제 목록 (없으면 빈 배열) */
export function validateGameBaselines(b: GameBaselines): string[] {
  const problems: string[] = []
  const cells: [string, StageBaseline][] = [
    ...Object.entries(b.byStage).map(([s, c]) => [`스테이지 ${s}`, c] as [string, StageBaseline]),
    ...Object.entries(b.byCarry).flatMap(([k, c]) =>
      Object.entries(c.byStage).map(([s, cell]) => [`${k} 스테이지 ${s}`, cell] as [string, StageBaseline])
    ),
  ]
  for (const [label, c] of cells) {
    if (!(c.level >= 1 && c.level <= 10)) problems.push(`${label}: 레벨 ${c.level}`)
    if (!(c.boardValue > 0 && c.boardValue < 1000)) problems.push(`${label}: 보드 가치 ${c.boardValue}`)
  }
  if (!Object.keys(b.byStage).length) problems.push('스테이지 기준선이 하나도 없음')
  return problems
}

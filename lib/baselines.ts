import data from './gameBaselines.json'
import { AXIS_CONFIG } from './axisConfig'

/**
 * 스테이지 기준 레벨·보드 가치 — 경제·템포·완성도 축의 "이 스테이지면 보통 이 정도" 기준 (클라이언트 공용, 작은 JSON).
 *
 * lib/gameBaselines.json 은 scripts/buildBaselines.js 가 Supabase 원본 보드(마스터+)에서 매일 만든다.
 * 같은 탈락 스테이지 보드들의 중앙값이다. 경기 데이터는 최종 보드뿐이라, 그 스테이지에서 탈락한 보드의 모습이다
 * (살아남은 보드의 그 시점 레벨은 Riot 데이터에 없다).
 *
 * 조회 순서: 같은 캐리(lib/deckType boardCarryKey) × 스테이지 → 스테이지 전체 → axisConfig.json 의 손 표(폴백).
 * 각 칸은 표본 하한(minSample)을 넘은 것만 파일에 들어 있다.
 */
export interface StageBaseline {
  /** 이 칸의 보드 수 */
  n: number
  /** 레벨 중앙값 */
  level: number
  /** 보드 가치 중앙값(G, lib/boardValue) */
  boardValue: number
}

export interface GameBaselines {
  source: string
  patch: string | null
  tierMin: string
  generatedAt: string | null
  matches: number
  boards: number
  minSample: { stage: number; carryStage: number }
  byStage: Record<string, StageBaseline>
  byCarry: Record<string, { name: string; n: number; byStage: Record<string, StageBaseline> }>
}

export const GAME_BASELINES = data as unknown as GameBaselines

export type BaselineSource = 'carry' | 'stage' | 'config'

/** 실측 칸 (캐리 × 스테이지 → 스테이지). 없으면 null */
export function measuredCell(
  stage: number,
  carryKey?: string | null,
  baselines: GameBaselines = GAME_BASELINES
): { cell: StageBaseline; source: Exclude<BaselineSource, 'config'> } | null {
  const key = String(stage)
  const carry = carryKey ? baselines.byCarry[carryKey]?.byStage[key] : undefined
  if (carry) return { cell: carry, source: 'carry' }
  const all = baselines.byStage[key]
  return all ? { cell: all, source: 'stage' } : null
}

/** 탈락 스테이지의 기준 레벨 (실측 → axisConfig.expectedLevelByStage) */
export function baselineLevel(stage: number, carryKey?: string | null, baselines: GameBaselines = GAME_BASELINES): number {
  const hit = measuredCell(stage, carryKey, baselines)
  if (hit) return hit.cell.level
  const table = AXIS_CONFIG.expectedLevelByStage
  return table[String(Math.max(stage, 1))] ?? table.default
}

/** 탈락 스테이지의 기준 보드 가치(G) (실측 → axisConfig economy.expectedBoardValueByStage) */
export function baselineBoardValue(stage: number, carryKey?: string | null, baselines: GameBaselines = GAME_BASELINES): number {
  const hit = measuredCell(stage, carryKey, baselines)
  if (hit) return hit.cell.boardValue
  const table = AXIS_CONFIG.axes.economy.expectedBoardValueByStage
  return table[String(Math.max(stage, 2))] ?? table.default
}

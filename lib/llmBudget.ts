/**
 * LLM 일일 예산 가드.
 *
 * LLM 호출 1건마다 추정 비용(USD)을 누적하고, 일일 상한을 넘으면
 * 제공자 호출을 건너뛰고 결정론적 폴백 리포트를 반환하게 한다.
 *
 * - Redis 설정 시 전역(인스턴스 공유) 예산, 미설정 시 인메모리(인스턴스별).
 * - 기본 상한 3 USD/일. `LLM_DAILY_BUDGET_USD=0` 이면 가드 비활성(무제한).
 * - 단가는 대략치이므로 제공자 콘솔의 하드 스펜드 리밋을 반드시 함께 설정할 것.
 */
import { kstDayWindow, secondsUntilReset } from './dayWindow'
import { redisConfigured, redisGet, redisExpire, redisIncrBy } from './redisRest'

const BUDGET_USD = (() => {
  const raw = Number(process.env.LLM_DAILY_BUDGET_USD)
  if (!Number.isFinite(raw)) return 3
  return Math.max(0, raw)
})()

const BUDGET_MICROS = Math.round(BUDGET_USD * 1_000_000)

let memory = { day: '', micros: 0 }

export interface LlmBudgetStatus {
  enabled: boolean
  budgetUsd: number
  spentUsd: number
  exceeded: boolean
}

function redisKey(day: string): string {
  return `llm:spend:${day}`
}

async function readSpentMicros(day: string): Promise<number> {
  if (redisConfigured()) {
    const raw = await redisGet(redisKey(day))
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed))
  }
  if (memory.day !== day) return 0
  return memory.micros
}

function addToMemory(day: string, micros: number): void {
  if (memory.day !== day) memory = { day, micros: 0 }
  memory.micros += micros
}

export async function getLlmBudgetStatus(): Promise<LlmBudgetStatus> {
  const { key: day } = kstDayWindow()
  const spentMicros = await readSpentMicros(day)
  return {
    enabled: BUDGET_USD > 0,
    budgetUsd: BUDGET_USD,
    spentUsd: Math.round(spentMicros) / 1_000_000,
    exceeded: BUDGET_USD > 0 && spentMicros >= BUDGET_MICROS,
  }
}

/** 호출 후 추정 비용을 누적한다. 실패해도 예외를 던지지 않는다. */
export async function addLlmSpendUsd(usd: number): Promise<void> {
  if (!(usd > 0)) return
  const micros = Math.max(1, Math.round(usd * 1_000_000))
  const { key: day } = kstDayWindow()

  addToMemory(day, micros)

  if (redisConfigured()) {
    const total = await redisIncrBy(redisKey(day), micros)
    if (total !== null) await redisExpire(redisKey(day), secondsUntilReset())
  }
}

/**
 * 일일 윈도우 계산 (KST 고정).
 *
 * 한국 사용자 기준으로 자정에 쿼터가 초기화되도록 UTC+9 고정 오프셋을 쓴다.
 * (한국은 DST가 없으므로 고정 오프셋으로 충분하다.)
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export interface DayWindow {
  /** YYYY-MM-DD (KST) */
  key: string
  /** 다음 자정(KST)의 UTC epoch ms */
  resetAt: number
}

export function kstDayWindow(now: Date = new Date()): DayWindow {
  const kst = new Date(now.getTime() + KST_OFFSET_MS)
  const year = kst.getUTCFullYear()
  const month = kst.getUTCMonth()
  const day = kst.getUTCDate()

  const startUtc = Date.UTC(year, month, day) - KST_OFFSET_MS
  return {
    key: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    resetAt: startUtc + DAY_MS,
  }
}

/** 다음 리셋까지 남은 초 (최소 1초) */
export function secondsUntilReset(now: Date = new Date()): number {
  return Math.max(1, Math.ceil((kstDayWindow(now).resetAt - now.getTime()) / 1000))
}

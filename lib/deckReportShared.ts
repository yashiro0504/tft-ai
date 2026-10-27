/**
 * 내 덱 성적표의 타입·상수 — 화면(브라우저 번들)용 가벼운 모듈.
 * 계산(lib/deckReport)은 메타 덱 데이터·통계 로더를 끌어오므로 서버에서만 import 한다.
 */
export interface DeckReportRow {
  name: string
  games: number
  /** 내 평균 등수 */
  avgPlacement: number
  top4: number
  /** 메타 덱 평균 등수 (없으면 null) */
  metaAvg: number | null
  /** 내 평균 − 메타 평균 (음수 = 메타보다 잘함) */
  delta: number | null
  /** 판정: 판수가 적거나 메타 표본이 적으면 null */
  verdict: 'good' | 'even' | 'bad' | null
}

export interface DeckReport {
  rows: DeckReportRow[]
  /** 메타 덱과 비슷하지 않은 판 (자체 조합) */
  unmatched: { games: number; avgPlacement: number | null }
  /** 집계한 판 수 (초반 종료 제외) */
  total: number
}

/**
 * 판정을 내리는 최소 판 수. 판 수가 적으면 내 평균 등수 오차(2.29/√판수)가 커서
 * 2판이면 ±1.6등 — 메타와 1등 차이도 운으로 설명된다. 최근 10~20판 중 4판 이상이면 주력 덱으로 본다.
 */
export const DECK_REPORT_MIN_GAMES = 4

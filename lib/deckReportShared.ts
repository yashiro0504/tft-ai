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
  /** 메타 덱 표본 (판) — DECK_REPORT_MIN_SAMPLE 미만이면 메타 평균은 참고용 */
  metaSample: number
}

/** 메타 평균의 출처 — 메타 랭킹 페이지와 같은 getDecks 결과 (같은 패치·티어·수집 시각) */
export interface DeckReportMeta {
  source: 'db' | 'json'
  patch?: string
  /** 티어 필터 화면 이름 (예: '마스터+') */
  tier?: string
  updatedAt?: string
}

export interface DeckReport {
  rows: DeckReportRow[]
  /** 메타 덱과 비슷하지 않은 판 (자체 조합) */
  unmatched: { games: number; avgPlacement: number | null }
  /** 초반 종료라 덱으로 묶지 않은 판 (기물이 적어 덱을 판정할 수 없다) */
  early: number
  /** 분석 경기 수 = 덱별 판수 합 + unmatched.games + early (화면의 '최근 N경기'와 같다) */
  total: number
  /** 메타 평균의 출처 (없으면 출처 줄을 숨긴다) */
  meta?: DeckReportMeta
}

/** 메타 덱 표본이 이보다 적으면 판정하지 않고 메타 평균을 '참고용'으로 표시한다 (comparisonFacts DECK_REFERENCE_SAMPLE 과 같은 값) */
export const DECK_REPORT_MIN_SAMPLE = 30

/**
 * 판정을 내리는 최소 판 수. 판 수가 적으면 내 평균 등수 오차(2.29/√판수)가 커서
 * 2판이면 ±1.6등 — 메타와 1등 차이도 운으로 설명된다. 최근 10~20판 중 4판 이상이면 주력 덱으로 본다.
 */
export const DECK_REPORT_MIN_GAMES = 4

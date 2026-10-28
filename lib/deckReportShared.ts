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
  /** 초반 종료(3스테이지 전 탈락)라 덱으로 묶지 않은 판 */
  early: number
  /** 늦게 끝났는데 보드 기물이 적게 잡혀(보드 데이터 불완전) 덱을 판정하지 않은 판 */
  incomplete: number
  /** 분석 경기 수 = 덱별 판수 합 + unmatched.games + early + incomplete (화면의 '최근 N경기'와 같다) */
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

/** 갱신 시각 KST 'MM.DD HH:mm' (서버·브라우저가 같은 문자열을 그리게 시간대 고정) */
const SNAPSHOT_TIME_FMT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function snapshotTime(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const parts = Object.fromEntries(SNAPSHOT_TIME_FMT.formatToParts(d).map((p) => [p.type, p.value]))
  return `${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`
}

/**
 * 메타 덱 스냅샷 출처 한 줄 — 메타 랭킹 페이지 머리말과 덱 성적표가 같은 함수로 그린다
 * (예: "KR 랭크 마스터+ 집계 · 패치 16.21 · 10.28 09:29 갱신")
 */
export function metaSnapshotLabel(meta: DeckReportMeta): string {
  const base = meta.source === 'db' ? (meta.tier ? `KR 랭크 ${meta.tier} 집계` : 'KR 랭크 집계') : '챌린저 래더 표본'
  const updated = snapshotTime(meta.updatedAt)
  return [base, meta.patch ? `패치 ${meta.patch}` : '', updated ? `${updated} 갱신` : ''].filter(Boolean).join(' · ')
}

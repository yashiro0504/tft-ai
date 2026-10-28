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
  /** 메타 덱 표본 (판) — DECK_REPORT_MIN_SAMPLE 미만이면 메타 랭킹 티어에 안 들어가므로 '메타 표본 없음'으로 보여 주고 비교하지 않는다 */
  metaSample: number
}

/** 메타 평균의 출처 — 메타 랭킹 페이지와 같은 getDecks 결과 (같은 패치·티어·수집 시각) */
export interface DeckReportMeta {
  source: 'db' | 'json'
  patch?: string
  /** 티어 필터 화면 이름 (예: '마스터+') */
  tier?: string
  updatedAt?: string
  /** 표본 규모 (판) — 메타 페이지 머리말 */
  matches?: number
  /** DB 집계 대신 래더 JSON 을 쓴 이유 (getDecks fallbackReason) — SNAPSHOT_FAILURE_REASONS 면 스냅샷 생성 실패 */
  fallbackReason?: string
}

/** 이 사유로 JSON 폴백이면 '스냅샷 생성 실패' — 두 화면이 같은 데이터라고 말하지 않고 각자 갱신 시각만 보여 준다 */
export const SNAPSHOT_FAILURE_REASONS = ['db_error', 'empty']

export function snapshotFailed(meta?: Pick<DeckReportMeta, 'source' | 'fallbackReason'>): boolean {
  return !!meta && meta.source === 'json' && SNAPSHOT_FAILURE_REASONS.includes(meta.fallbackReason ?? '')
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

/** 메타 덱 표본이 이보다 적으면 (메타 랭킹 덱 티어 MIN_SAMPLE.deck 미만) 메타 평균을 쓰지 않고 '메타 표본 없음'으로 표시한다 (comparisonFacts DECK_REFERENCE_SAMPLE 과 같은 값) */
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

/** JSON 래더 표본의 수집 범위 — scripts/collectLadderBoards.js 가 챌린저 → 그마 → 마스터 LP 상위 선수 판을 모은다 */
export const JSON_LADDER_SCOPE = 'KR 마스터+ 래더'
export const JSON_LADDER_SCOPE_DETAIL = 'KR 챌린저·그랜드마스터·마스터 LP 상위 선수의 최근 랭크 판 (하루 1회 수집)'

/**
 * 수집 범위 · 표본 수 — 메타 페이지 배지·덱 탭 칩·덱 성적표가 모두 이 함수 하나로 그린다 (2026-10-28: 'KR 챌린저 래더 · 292판' 과 'KR 랭크 마스터+ 집계' 가 갈렸다)
 * 예: "KR 랭크 마스터+" · "12,345판"
 */
export function metaScopeLabel(meta: Pick<DeckReportMeta, 'source' | 'tier'>): string {
  return meta.source === 'db' ? `KR 랭크 ${meta.tier ?? '전체'}` : JSON_LADDER_SCOPE
}

export function metaMatchesLabel(meta: Pick<DeckReportMeta, 'matches'>): string {
  return meta.matches ? `${meta.matches.toLocaleString('ko-KR')}판` : ''
}

/**
 * 메타 덱 스냅샷 출처 한 줄 — 메타 랭킹 페이지 머리말과 덱 성적표가 같은 함수로 그린다
 * (예: "KR 랭크 마스터+ · 12,345판 · 패치 16.21 · 10.28 09:29 갱신")
 */
export function metaSnapshotLabel(meta: DeckReportMeta): string {
  const updated = snapshotTime(meta.updatedAt)
  return [
    metaScopeLabel(meta),
    metaMatchesLabel(meta),
    meta.patch && /^\d/.test(meta.patch) ? `패치 ${meta.patch}` : '',
    updated ? `${updated} 갱신` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

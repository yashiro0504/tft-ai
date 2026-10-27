import type { TftRankInfo } from './types'

/**
 * TFT 랭크 표시용 헬퍼 (서버/클라이언트 공용, 순수 함수).
 *
 * - 티어 색상은 Tailwind 클래스 문자열을 **정적으로** 나열한다. (동적 조합은 purge 대상에서 빠짐)
 * - 라이트/다크 테마 모두에서 읽히도록 배경은 반투명 + 테두리 + 진한 텍스트 조합을 쓴다.
 */

const TIER_LABEL_KO: Record<string, string> = {
  IRON: '아이언',
  BRONZE: '브론즈',
  SILVER: '실버',
  GOLD: '골드',
  PLATINUM: '플래티넘',
  EMERALD: '에메랄드',
  DIAMOND: '다이아몬드',
  MASTER: '마스터',
  GRANDMASTER: '그랜드마스터',
  CHALLENGER: '챌린저',
}

/** MASTER 이상은 단일 티어(IV~I 구분 없음) */
const APEX_TIERS = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER'])

interface TierStyle {
  /** 티어명 텍스트 색 */
  text: string
  /** 배지 테두리 + 배경 */
  chip: string
  /** 좌측 강조 바 (카드용) */
  bar: string
}

const TIER_STYLES: Record<string, TierStyle> = {
  IRON: { text: 'text-slate-500', chip: 'border-slate-400/40 bg-slate-500/10', bar: 'bg-slate-400' },
  BRONZE: { text: 'text-amber-700', chip: 'border-amber-700/40 bg-amber-700/10', bar: 'bg-amber-700' },
  SILVER: { text: 'text-slate-600', chip: 'border-slate-500/40 bg-slate-500/10', bar: 'bg-slate-500' },
  GOLD: { text: 'text-amber-600', chip: 'border-amber-500/50 bg-amber-500/10', bar: 'bg-amber-500' },
  PLATINUM: { text: 'text-teal-600', chip: 'border-teal-500/50 bg-teal-500/10', bar: 'bg-teal-500' },
  EMERALD: { text: 'text-emerald-600', chip: 'border-emerald-500/50 bg-emerald-500/10', bar: 'bg-emerald-500' },
  DIAMOND: { text: 'text-sky-600', chip: 'border-sky-500/50 bg-sky-500/10', bar: 'bg-sky-500' },
  MASTER: { text: 'text-purple-600', chip: 'border-purple-500/50 bg-purple-500/10', bar: 'bg-purple-500' },
  GRANDMASTER: { text: 'text-rose-600', chip: 'border-rose-500/50 bg-rose-500/10', bar: 'bg-rose-500' },
  CHALLENGER: { text: 'text-cyan-600', chip: 'border-cyan-500/50 bg-cyan-500/10', bar: 'bg-cyan-500' },
}

const UNRANKED_STYLE: TierStyle = {
  text: 'text-muted',
  chip: 'border-line/20 bg-elev/5',
  bar: 'bg-slate-400/40',
}

export function rankTierStyle(rank: TftRankInfo | null | undefined): TierStyle {
  if (!rank) return UNRANKED_STYLE
  return TIER_STYLES[rank.tier] ?? UNRANKED_STYLE
}

/** "골드 II" / "챌린저" / "배치 중" */
export function formatRankLabel(rank: TftRankInfo | null | undefined): string {
  if (!rank) return '배치 중'
  const tier = TIER_LABEL_KO[rank.tier] ?? rank.tier
  if (APEX_TIERS.has(rank.tier)) return tier
  return `${tier} ${rank.rank}`
}

/** "45 LP" */
export function formatRankLp(rank: TftRankInfo | null | undefined): string {
  if (!rank) return '-'
  return `${rank.leaguePoints} LP`
}

/**
 * 시즌 TOP4 비율(%) — 표본이 없으면 null.
 * Riot TFT 리그 API 의 wins 는 1등이 아니라 TOP4(순방) 횟수, losses 는 5~8등 횟수다.
 * 그래서 "승"·"승률"이라고 쓰면 옆의 '1등' 지표와 헷갈린다 (2026-10-27).
 */
export function rankWinRate(rank: TftRankInfo | null | undefined): number | null {
  if (!rank) return null
  const total = rank.wins + rank.losses
  if (total <= 0) return null
  return Math.round((rank.wins / total) * 100)
}

/** "TOP4 32 · 하위 28" (wins = TOP4 횟수 — rankWinRate 참고) */
export function formatRankRecord(rank: TftRankInfo | null | undefined): string {
  if (!rank) return '-'
  return `TOP4 ${rank.wins} · 하위 ${rank.losses}`
}

/** OG 이미지 등 텍스트 전용 문맥용 한 줄 요약 */
export function formatRankSummary(rank: TftRankInfo | null | undefined): string {
  if (!rank) return '배치 중'
  const label = formatRankLabel(rank)
  const winRate = rankWinRate(rank)
  const lp = `${rank.leaguePoints} LP`
  return winRate === null ? `${label} · ${lp}` : `${label} · ${lp} · TOP4 ${winRate}%`
}

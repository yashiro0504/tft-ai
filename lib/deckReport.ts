import { metaExecution, mostSimilarDeck, META_EXECUTION_MARGIN, type DeckFact } from './comparisonFacts'
import { isEarlyGame } from './quality'
import { getDecks } from './tftStats'
import { DEFAULT_FILTER, PLACEMENT_SD } from './statsShared'
import { logEvent, errorFields } from './observability'
import type { SlimMatchData } from './types'
import { DECK_REPORT_MIN_GAMES, type DeckReport, type DeckReportRow } from './deckReportShared'
import { analyzableMatches } from './queue'

export { DECK_REPORT_MIN_GAMES, type DeckReport, type DeckReportRow } from './deckReportShared'

/**
 * 내 덱 성적표 — 최근 경기를 가장 비슷한 메타 덱(lib/comparisonFacts.mostSimilarDeck)으로 묶어
 * 내 평균 등수와 그 덱의 메타 평균 등수를 비교한다 (AI 미사용).
 * "이 덱은 나한테 맞는다/안 맞는다"는 판수가 적으면 운이 크니, DECK_REPORT_MIN_GAMES 판 이상이고
 * 차이가 판수 오차(deckVerdictMargin)보다 클 때만 판정한다.
 * 덱 데이터(약 660KB)는 서버에서만 읽는다 — 결과만 화면에 내려 보낸다. 화면은 lib/deckReportShared 의 타입만 쓴다.
 */
/** 메타 평균 표본이 이보다 적은 덱은 판정하지 않는다 (comparisonFacts DECK_REFERENCE_SAMPLE 과 같은 값) */
const DECK_REPORT_MIN_SAMPLE = 30

/** 판정 기준 차이: 1등 이상이면서 내 평균의 오차(2.29/√판수)보다 커야 한다 (4판이면 1.15등) */
export function deckVerdictMargin(games: number): number {
  return Math.max(META_EXECUTION_MARGIN, PLACEMENT_SD / Math.sqrt(Math.max(games, 1)))
}

const round2 = (n: number) => Math.round(n * 100) / 100
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export function buildDeckReport(matches: SlimMatchData[], decks: DeckFact[]): DeckReport {
  const sample = (matches || []).filter((m) => m?.units?.length && !isEarlyGame(m))
  const groups = new Map<string, { deck: DeckFact; placements: number[] }>()
  const unmatched: number[] = []
  for (const m of sample) {
    const hit = metaExecution(m, decks)?.deck ?? mostSimilarDeck(m, decks)?.deck
    if (!hit) {
      unmatched.push(m.placement)
      continue
    }
    const g = groups.get(hit.name) ?? { deck: hit, placements: [] }
    g.placements.push(m.placement)
    groups.set(hit.name, g)
  }
  const rows: DeckReportRow[] = [...groups.values()].map(({ deck, placements }) => {
    const mine = round2(avg(placements))
    const metaAvg = deck.avgPlacement != null && Number.isFinite(deck.avgPlacement) ? round2(deck.avgPlacement) : null
    const delta = metaAvg == null ? null : round2(mine - metaAvg)
    const judged = delta != null && placements.length >= DECK_REPORT_MIN_GAMES && deck.sampleSize >= DECK_REPORT_MIN_SAMPLE
    const margin = deckVerdictMargin(placements.length)
    return {
      name: deck.name,
      games: placements.length,
      avgPlacement: mine,
      top4: placements.filter((p) => p <= 4).length,
      metaAvg,
      delta,
      verdict: !judged ? null : delta <= -margin ? 'good' : delta >= margin ? 'bad' : 'even',
    }
  })
  rows.sort((a, b) => b.games - a.games || (a.delta ?? 0) - (b.delta ?? 0))
  return { rows, unmatched: { games: unmatched.length, avgPlacement: unmatched.length ? round2(avg(unmatched)) : null }, total: sample.length }
}

/** 서버: 기본 필터(현재 패치·기본 티어)의 메타 덱으로 성적표를 만든다. 덱 데이터를 못 읽으면 null (화면은 카드를 숨긴다) */
export async function loadDeckReport(matches: SlimMatchData[]): Promise<DeckReport | null> {
  try {
    const { decks } = await getDecks({ patch: DEFAULT_FILTER.patch, tier: DEFAULT_FILTER.tier })
    return buildDeckReport(analyzableMatches(matches), decks)
  } catch (err) {
    logEvent('warn', 'deck_report_failed', errorFields(err))
    return null
  }
}

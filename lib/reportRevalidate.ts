import type { CoachingAxisKey, MetaCoachFeedback, SlimMatchData } from './types'
import { fixEnglishTerms, fixPlacementWording, validateFeedbackGrounding } from './grounding'
import { deckComparisonFor, mapFeedbackStrings } from './llm'
import { validateDerivedClaims, validateEmblemItemAdvice, validateStructuredAdvice } from './adviceCheck'
import {
  HELD_ITEM_NAMES,
  REVALIDATOR_VERSION,
  numericDrill,
  feedbackTexts,
  repairEntityErrors,
  validateAdviceAndCounts,
  validateEntityFacts,
  validateTraitRelations,
} from './semanticGrounding'

/**
 * 캐시된 리포트 다시 검사 (2026-10-30 지시문 1-5) — 보여 줄 때 현재 버전의 검증기를 다시 돌리고 실패 문장을 고치거나 지운다.
 * LLM 호출 없음 · 횟수 차감 없음 (캐시 적중 경로에서만 부른다). 캐시에 든 원본은 바꾸지 않고, 보여 줄 응답만 바꾼다.
 *
 * - 프롬프트(사실 블록)가 캐시에 없어서 사실 문자열이 필요한 검사(보드에 없는 이름·근거 미확인 수치)는 다시 돌리지 않는다.
 *   경기 데이터만으로 되는 검사(성급·아이템 소유·시너지 단계·조합법·조언 모순·보드 수치·기물–시너지 관계)를 돌린다.
 * - 지운 문장의 수치는 근거 검증 분모·분자에서 함께 뺀다 (수리 전 리포트는 100% 였으므로 둘 다 같은 수만큼 준다).
 * - grounding.revalidated 가 현재 버전이면 그대로 둔다 (새로 만든 리포트는 finalize 가 이미 같은 검증기로 고쳤다).
 */
export function revalidateReport(fb: MetaCoachFeedback, matches: SlimMatchData[]): MetaCoachFeedback {
  if (!fb || !matches.length || fb.grounding?.revalidated === REVALIDATOR_VERSION) return fb
  const verdicts = Object.fromEntries((fb.plan?.axes || []).map((a) => [a.key, a.verdict])) as Partial<Record<CoachingAxisKey, string>>
  const texts = feedbackTexts(fb, verdicts)
  const advice = validateAdviceAndCounts(texts, matches)
  const relation = validateTraitRelations(texts, matches, { coreUnits: fb.deckComparison?.coreUnits })
  // 구조화된 조언(있으면)·상징 칸 아이템 조언·BIS 일치 수·파생 수치·본인 레벨 (2026-10-30 2차 지시문 2·3·6)
  const single = fb.mode !== 'multi' && matches.length === 1 ? matches[0] : null
  const structured = validateStructuredAdvice(fb.advice, texts, single, { bis: fb.deckComparison?.bis })
  const emblem = validateEmblemItemAdvice(texts, single, HELD_ITEM_NAMES)
  const derived = validateDerivedClaims(texts, single, fb.deckComparison?.bis)
  const errors = [...validateEntityFacts(texts, matches), ...advice.errors, ...relation.errors, ...structured.errors, ...emblem.errors, ...derived.errors]
  const stats = { fixed: 0, deleted: 0 }
  const repaired = repairEntityErrors({ fb, verdicts }, errors, { dropEmpty: true, stats })
  const worded = mapFeedbackStrings(repaired.fb, (t) => {
    const out = fixEnglishTerms(fixPlacementWording(t))
    if (out !== t) stats.fixed++
    return out
  })
  const plan = fb.plan
    ? { ...fb.plan, axes: fb.plan.axes.map((a) => ({ ...a, verdict: repaired.verdicts[a.key] ? fixEnglishTerms(repaired.verdicts[a.key] as string) : undefined })) }
    : fb.plan
  const g = fb.grounding
  // 지운 문장에 들어 있던 수치 주장 수 (사실 없이 세면 모든 주장이 total 로 잡힌다)
  const removedClaims = Math.max(0, validateFeedbackGrounding(fb, '').total - validateFeedbackGrounding(worded, '').total)
  const grounding = g
    ? {
        ...g,
        total: Math.max(0, g.total - removedClaims),
        supported: Math.max(0, g.supported - removedClaims),
        entityErrors: [...(g.entityErrors || []), ...errors],
        relationsChecked: relation.checked + structured.checked + emblem.checked,
        repair: g.repair ? { ...g.repair, fixed: g.repair.fixed + stats.fixed, deleted: g.repair.deleted + stats.deleted } : undefined,
        revalidated: REVALIDATOR_VERSION,
      }
    : g
  // 다음 3판 목표에 숫자 기준이 없으면 코드 목표 (2026-10-30 2차 지시문 6-2)
  const lecture = worded.lecture && !/\d/.test(worded.lecture.drill || '') ? { ...worded.lecture, drill: numericDrill(matches, fb.plan?.focus) } : worded.lecture
  return { ...worded, lecture, plan, grounding }
}

/**
 * 캐시 적중 경로 공용 (경기 분석·종합 분석 1판) — 비교 섹션이 없거나 옛 형식(BIS 세트 대조 없음)이면 코드로 다시 붙이고 (2026-10-30 2차 지시문 5-1),
 * 현재 검증기로 다시 검사한다. LLM 호출·횟수 차감 없음. 비교 섹션을 못 만들면(DB 오류 등) 원래 리포트대로 검사만 한다.
 */
export async function prepareCachedReport(fb: MetaCoachFeedback, matches: SlimMatchData[]): Promise<MetaCoachFeedback> {
  if (!fb || !matches.length) return fb
  let out = fb
  const single = fb.mode !== 'multi' && matches.length === 1
  const dc = fb.deckComparison
  if (single && (!dc || (!dc.skipped && !dc.bis))) {
    try {
      const fresh = await deckComparisonFor(matches[0])
      if (fresh) out = { ...fb, deckComparison: fresh, grounding: fb.grounding ? { ...fb.grounding, revalidated: undefined } : fb.grounding }
    } catch {
      /* 비교 섹션 없이 검사만 */
    }
  }
  return revalidateReport(out, matches)
}

import type { CoachingAxisKey, MetaCoachFeedback, SlimMatchData } from './types'
import { fixEnglishTerms, fixPlacementWording, validateFeedbackGrounding } from './grounding'
import { mapFeedbackStrings } from './llm'
import {
  REVALIDATOR_VERSION,
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
  const errors = [...validateEntityFacts(texts, matches), ...advice.errors, ...relation.errors]
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
        relationsChecked: relation.checked,
        repair: g.repair ? { ...g.repair, fixed: g.repair.fixed + stats.fixed, deleted: g.repair.deleted + stats.deleted } : undefined,
        revalidated: REVALIDATOR_VERSION,
      }
    : g
  return { ...worded, plan, grounding }
}

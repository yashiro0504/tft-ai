import type { GroundingReport, MetaCoachFeedback } from './types'

/**
 * AI 리포트 신뢰성 계층: LLM이 쓴 '수치 주장'이 프롬프트에 제공된 사실 데이터에
 * 실제로 존재하는지 코드로 대조한다. (환각/창작 수치 탐지)
 */

const CLAIM_WITH_UNIT = /(\d+(?:\.\d+)?)\s*(등|명|골드|G|%|단계|성|코|코스트|라운드|초|분|판)/g
const SLASH_100_CLAIM = /(\d+(?:\.\d+)?)\s*\/\s*100/g
const DECIMAL_CLAIM = /(?<![\d.])(\d+\.\d{1,2})(?![\d.])/g
const NUMBER_TOKEN = /(\d+(?:\.\d+)?)/g

function norm(raw: string): string {
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  return String(Math.round(n * 100) / 100)
}

/** 사실 텍스트에서 숫자 집합을 만든다. (소수 2자리 + 정수 반올림 값 허용) */
export function collectFactNumbers(facts: string): Set<string> {
  const set = new Set<string>()
  for (const m of facts.matchAll(NUMBER_TOKEN)) {
    const raw = m[1]
    set.add(norm(raw))
    const n = Number(raw)
    if (Number.isFinite(n)) set.add(String(Math.round(n)))
  }
  return set
}

/** 리포트에서 검증 대상 수치 주장만 추출 (단위 수치 + 소수) */
export function extractClaims(text: string): string[] {
  const claims: string[] = []
  for (const m of text.matchAll(CLAIM_WITH_UNIT)) claims.push(`${m[1]}${m[2]}`)
  for (const m of text.matchAll(SLASH_100_CLAIM)) claims.push(`${m[1]}/100`)
  for (const m of text.matchAll(DECIMAL_CLAIM)) claims.push(m[1])
  return [...new Set(claims)].filter((claim) => {
    const n = Number(claim.match(/\d+(?:\.\d+)?/)?.[0] || '0')
    return !(n >= 2000 && n <= 2100) // 연도(2026 등)는 제외
  })
}

/**
 * LLM 리포트의 수치 주장을 제공된 사실(프롬프트)과 대조한다.
 * - 단위 수치(등/명/%/G/라운드/성/코)와 소수(3.44)만 검증 대상
 * - 사실 텍스트에 없는 수치는 unsupported 로 기록
 */
export function validateFeedbackGrounding(
  feedback: MetaCoachFeedback,
  facts: string
): GroundingReport {
  const factNumbers = collectFactNumbers(facts)
  const text = [
    feedback.overview,
    feedback.contestAnalysis,
    feedback.itemAnalysis,
    feedback.synergyAnalysis,
    feedback.economyAnalysis,
    ...(feedback.improvements || []),
    ...(feedback.actionPlan || []),
  ]
    .filter(Boolean)
    .join('\n')

  const claims = extractClaims(text)
  const unsupported: string[] = []
  let supported = 0

  for (const claim of claims) {
    const numRaw = claim.match(/\d+(?:\.\d+)?/)?.[0] || ''
    if (numRaw && factNumbers.has(norm(numRaw))) supported++
    else unsupported.push(claim)
  }

  const total = claims.length
  return {
    score: total === 0 ? 100 : Math.round((supported / total) * 100),
    total,
    supported,
    unsupported,
  }
}

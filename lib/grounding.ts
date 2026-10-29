import type { GroundingReport, MetaCoachFeedback } from './types'
import { GAME_CHAMPIONS, GAME_TRAITS } from './gameData'
import { ALL_SET_TRAIT_NAMES } from './gameNames'

/**
 * AI 리포트 신뢰성 계층: LLM이 쓴 '수치 주장'이 프롬프트에 제공된 사실 데이터에
 * 실제로 존재하는지 코드로 대조한다. (환각/창작 수치 탐지)
 *
 * 수치뿐 아니라 다른 세트의 시너지명·존재하지 않는 코스트도 경고로 남긴다.
 */

/** 모든 세트 시너지명 (게임 기준 DB 이름표). 2글자 이름은 평범한 단어와 겹쳐 뺀다 */
const ALL_TRAIT_NAMES = new Set(ALL_SET_TRAIT_NAMES.filter((n) => n.length >= 3))

/** 현재 세트 시너지명 — 이 이름들은 등장만 해도 시너지 언급으로 본다. */
const CURRENT_TRAIT_NAMES = new Set(GAME_TRAITS.map((t) => t.name))

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 다른 세트 시너지명은 '2라운드'·'효율성'·'마법사'처럼 평범한 단어가 많아,
 * 시너지 문맥일 때만 시너지 언급으로 본다.
 *  - 숫자+이름: "4마법사", "3 결투가" (이름이 숫자로 시작하면 "12라운드" 오인을 막기 위해 제외)
 *  - 이름+시너지/특성: "결투가 시너지", "효율성 특성" (앞 글자가 단어 일부면 제외)
 * 현재 세트 이름은 패턴 없이(null) 등장 자체로 본다. 긴 이름부터 검사한다("비전 마법사" → "마법사").
 */
const TRAIT_CHECKS: Array<[string, RegExp | null]> = [...ALL_TRAIT_NAMES]
  .sort((a, b) => b.length - a.length)
  .map((name) => {
    if (CURRENT_TRAIT_NAMES.has(name)) return [name, null]
    const esc = escapeRegExp(name)
    const withCount = /^\d/.test(name) ? '' : `(?<![\\d.])\\d+\\s*${esc}|`
    return [name, new RegExp(`${withCount}(?<![가-힣A-Za-z0-9])${esc}\\s*(?:시너지|특성)`)]
  })

const CURRENT_CHAMP_NAMES = new Set(GAME_CHAMPIONS.map((c) => c.name).filter((n) => n.length >= 3))

function collectEntityWarnings(text: string, facts: string): string[] {
  const warnings = new Set<string>()

  // TFT 기물 코스트는 1~5만 존재한다.
  for (const m of text.matchAll(/(\d+)\s*코스트/g)) {
    const n = Number(m[1])
    if (n > 5) warnings.add(`존재하지 않는 코스트: ${n}코스트`)
  }

  // 다른 세트 시너지명을 끌어다 쓰는 경우 (예: 결투가 — 세트18에 없음)
  // 확인한 이름은 지워서, 그 안에 든 짧은 이름이 다시 걸리지 않게 한다.
  let rest = text
  for (const [name, pattern] of TRAIT_CHECKS) {
    if (!rest.includes(name)) continue
    const mentioned = pattern ? pattern.test(rest) : true
    if (mentioned && !facts.includes(name)) warnings.add(`제공되지 않은 시너지명: ${name}`)
    rest = rest.split(name).join('§')
  }

  // 사실 데이터에 없는 기물명을 새로 만들어 쓰는 경우
  for (const name of CURRENT_CHAMP_NAMES) {
    if (text.includes(name) && !facts.includes(name)) warnings.add(`제공되지 않은 기물명: ${name}`)
  }

  return [...warnings]
}

const CLAIM_WITH_UNIT = /(?<![\d-])(\d+(?:\.\d+)?)\s*(등|명|골드|G|%|단계|성|코|코스트|라운드|초|분|판)/g
const SLASH_100_CLAIM = /(\d+(?:\.\d+)?)\s*\/\s*100/g
const DECIMAL_CLAIM = /(?<![\d.])(\d+\.\d{1,2})(?![\d.])/g
const NUMBER_TOKEN = /(\d+(?:\.\d+)?)/g

/**
 * 프롬프트에 없어도 되는 TFT 공통 규칙 상수 (단위 포함 주장 단위로 허용).
 * - 골드: 리롤 2, 경험치 구매 4, 최대 이자 5, 이자 구간 10~50
 * - 성: 1~3성 / 코스트: 1~5 / 명: 로비 8명
 * LLM이 계산한 값(0.6G 등)이나 점수(50/100)는 여기 넣지 않는다 — 그대로 미확인으로 남긴다.
 */
const RULE_CONSTANT_CLAIMS = new Set([
  ...[2, 4, 5, 10, 20, 30, 40, 50].map((n) => `${n}골드`),
  ...[1, 2, 3].map((n) => `${n}성`),
  ...[1, 2, 3, 4, 5].map((n) => `${n}코스트`),
  '8명',
])

const UNIT_ALIAS: Record<string, string> = { G: '골드', 코: '코스트' }

function isRuleConstant(claim: string): boolean {
  const m = claim.match(/^(\d+(?:\.\d+)?)(.*)$/)
  if (!m) return false
  return RULE_CONSTANT_CLAIMS.has(`${norm(m[1])}${UNIT_ALIAS[m[2]] ?? m[2]}`)
}

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

function isSupportedClaim(claim: string, factNumbers: Set<string>): boolean {
  const numRaw = claim.match(/\d+(?:\.\d+)?/)?.[0] || ''
  return Boolean(numRaw && factNumbers.has(norm(numRaw))) || isRuleConstant(claim)
}

/** 근거 검증 대상 서술 문자열 (validateFeedbackGrounding · repairUnsupportedClaims 가 같은 범위를 본다) */
function groundedTexts(feedback: MetaCoachFeedback): Array<string | undefined> {
  return [
    feedback.overview,
    feedback.contestAnalysis,
    feedback.itemAnalysis,
    feedback.synergyAnalysis,
    feedback.economyAnalysis,
    feedback.lecture?.concept,
    feedback.lecture?.why,
    feedback.lecture?.evidence,
    feedback.lecture?.alternative,
    feedback.lecture?.drill,
    ...(feedback.lecture?.checklist || []),
    ...(feedback.lecture?.moments || []).flatMap((x) => [x.why, x.fix]),
    ...(feedback.actions || []),
    // 이 덱의 정석과 비교 (코드 산출 — 플레이북 수치가 프롬프트 사실과 같은지 함께 검사)
    ...(feedback.deckComparison?.items || []).map((r) => r.text),
    feedback.deckComparison?.skipped,
    // 스키마 v1 필드 (이전 형식 응답)
    ...(feedback.improvements || []),
    ...(feedback.actionPlan || []),
  ]
}

/** 리포트 수리 기록 — 화면 '근거 검증' 상세에 그대로 보인다 */
export interface RepairStats {
  fixed: number
  deleted: number
}

/**
 * 근거를 확인하지 못한 수치가 든 문장을 보내기 전에 고친다 (사용자에게 보이는 리포트는 항상 100%).
 *  1) 미확인 수치가 괄호 안에만 있으면 괄호를 뺀다 → 고침
 *  2) 아니면 문장을 지운다 → 삭제 (배열 항목이 비면 항목을 뺀다)
 *  3) 단일 필드가 통째로 비게 되면: dropEmpty 면 비운다(호출부가 코드 문장으로 채운다) → 삭제,
 *     아니면 미확인 수치만 빼서 남긴다 → 고침
 * 원본은 바꾸지 않는다.
 */
export function repairUnsupportedClaims(
  feedback: MetaCoachFeedback,
  facts: string,
  stats: RepairStats,
  { dropEmpty = false }: { dropEmpty?: boolean } = {}
): MetaCoachFeedback {
  const factNumbers = collectFactNumbers(facts)
  const bad = (text: string) => extractClaims(text).filter((c) => !isSupportedClaim(c, factNumbers))

  const fixText = (str: string | undefined, inArray: boolean): string | undefined => {
    if (!str || !bad(str).length) return str
    // 문장 경계(마침표·물음표·느낌표 뒤 공백, 줄바꿈)를 남겨 둔 채 문장 단위로 본다. "3.44"·"Lv.8" 의 점은 경계가 아니다
    const parts = str.split(/((?<=[.!?])\s+|\n+)/)
    let fixed = 0
    let deleted = 0
    const out: string[] = []
    for (let i = 0; i < parts.length; i += 2) {
      let sentence = parts[i]
      const sep = parts[i + 1] ?? ''
      if (bad(sentence).length) {
        const trimmed = sentence
          .replace(/\s*[(（][^()（）]*[)）]/g, (m) => (bad(m).length ? '' : m))
          .replace(/[ \t]{2,}/g, ' ')
        if (trimmed.trim() && !bad(trimmed).length) {
          sentence = trimmed
          fixed++
        } else {
          deleted++
          continue
        }
      }
      if (sentence.trim()) out.push(sentence, sep)
    }
    const joined = out.join('').trim()
    if (joined) {
      stats.fixed += fixed
      stats.deleted += deleted
      return joined
    }
    if (inArray || dropEmpty) {
      stats.deleted += deleted
      return inArray ? undefined : ''
    }
    // 단일 필드: 빈 섹션 대신 미확인 수치만 뺀다
    let stripped = str
    for (const claim of bad(str)) {
      const m = claim.match(/^(\d+(?:\.\d+)?)(.*)$/)
      if (!m) continue
      // 수치 뒤 조사까지 뺀다 ("87%로 강합니다" → "강합니다")
      stripped = stripped.replace(new RegExp(`(?<![\\d.])${escapeRegExp(m[1])}\\s*${escapeRegExp(m[2])}(?:으로|로|의|은|는|이|가|에)?`, 'g'), '')
    }
    stats.fixed++
    return stripped.replace(/\s*[(（]\s*[)）]/g, '').replace(/[ \t]{2,}/g, ' ').trim()
  }
  const fixList = (list: string[] | undefined) =>
    list ? list.map((x) => fixText(x, true)).filter((x): x is string => Boolean(x)) : list

  const l = feedback.lecture
  const dc = feedback.deckComparison
  return {
    ...feedback,
    overview: fixText(feedback.overview, false) ?? feedback.overview,
    contestAnalysis: fixText(feedback.contestAnalysis, false),
    itemAnalysis: fixText(feedback.itemAnalysis, false),
    synergyAnalysis: fixText(feedback.synergyAnalysis, false),
    economyAnalysis: fixText(feedback.economyAnalysis, false),
    ...(l
      ? {
          lecture: {
            ...l,
            concept: fixText(l.concept, false) ?? l.concept,
            why: fixText(l.why, false) ?? l.why,
            evidence: fixText(l.evidence, false) ?? l.evidence,
            alternative: fixText(l.alternative, false) ?? l.alternative,
            drill: fixText(l.drill, false) ?? l.drill,
            checklist: fixList(l.checklist) ?? [],
            ...(l.moments ? { moments: l.moments.map((x) => ({ ...x, why: fixText(x.why, false) ?? '', fix: fixText(x.fix, false) ?? '' })) } : {}),
          },
        }
      : {}),
    ...(feedback.actions ? { actions: fixList(feedback.actions) } : {}),
    // 코드가 만든 비교 문장 — 사실과 안 맞으면 항목을 뺀다
    ...(dc
      ? {
          deckComparison: {
            ...dc,
            items: dc.items.filter((r) => {
              if (!bad(r.text).length) return true
              stats.deleted++
              return false
            }),
          },
        }
      : {}),
    ...(feedback.improvements ? { improvements: fixList(feedback.improvements) } : {}),
    ...(feedback.actionPlan ? { actionPlan: fixList(feedback.actionPlan) } : {}),
  }
}

/**
 * 로비 등수 표현 정리: 1등은 탈락하지 않으므로 '탈락한 1등'은 '1등 플레이어', 나머지는 'N등(탈락)'.
 */
export function fixPlacementWording(text: string): string {
  return text
    .replace(/탈락한\s*1\s*등(?:\s*(?:플레이어|유저))?/g, '1등 플레이어')
    .replace(/탈락한\s*([2-8])\s*등(?!\s*\()/g, '$1등(탈락)')
}

/**
 * LLM 리포트의 수치 주장을 제공된 사실(프롬프트)과 대조한다.
 * - 단위 수치(등/명/%/G/라운드/성/코)와 소수(3.44)만 검증 대상
 * - 사실 텍스트에 없는 수치는 unsupported 로 기록 (TFT 규칙 상수는 예외)
 */
export function validateFeedbackGrounding(
  feedback: MetaCoachFeedback,
  facts: string
): GroundingReport {
  const factNumbers = collectFactNumbers(facts)
  const text = groundedTexts(feedback)
    .filter(Boolean)
    .join('\n')

  const claims = extractClaims(text)
  const unsupported: string[] = []
  let supported = 0

  for (const claim of claims) {
    if (isSupportedClaim(claim, factNumbers)) supported++
    else unsupported.push(claim)
  }

  const total = claims.length
  return {
    score: total === 0 ? 100 : Math.round((supported / total) * 100),
    total,
    supported,
    unsupported,
    warnings: collectEntityWarnings(text, facts),
  }
}

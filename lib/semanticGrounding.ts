import type { EntityFactError, MetaCoachFeedback, SlimMatchData } from './types'

/**
 * 의미(엔티티 사실) 검증 — 숫자·이름 접지(lib/grounding)가 잡지 못하는
 * "피들스틱·르블랑·오른 모두 3성"(피들스틱은 1성) 같은 성급·아이템 소유·시너지 단계 오류를 찾는다.
 *
 * - 이름은 경기 데이터에 실제로 있는 기물·아이템·시너지만 쓰고, 긴 이름부터 매칭한다(부분 문자열 충돌 방지).
 * - 주어가 분명한 표현만 검사한다: "<기물>[·<기물>…] (모두) N성", "3성 N개", "<기물>의/에 <아이템>", "<시너지> N단계".
 *   "3성작", "2성 굳히기", "2성 이상 4개" 같은 일반 표현과 상대·로비 1등 이야기는 건너뛴다.
 * - 처방·목표 문장("3성 1개를 확보하세요", "~해야 합니다", "목표", "금지")은 사실 주장이 아니므로 건너뛴다.
 *   (baseline 18회 재채점에서 오탐 8건이 전부 이 유형이었다)
 * - multi 모드에서는 여러 판 중 하나라도 맞으면 통과(어느 판 이야기인지 문장만으로 알 수 없다).
 * - 한계: 의미 오류를 "줄이는" 평가 지표다. 모든 오류를 보장하지 않는다.
 */

interface Span {
  start: number
  end: number
  name: string
}

/** 텍스트에서 이름 위치 (긴 이름 우선, 겹치지 않게) */
function findNames(text: string, names: string[]): Span[] {
  const sorted = [...new Set(names.filter((n) => n && n.length >= 2))].sort((a, b) => b.length - a.length)
  const taken: boolean[] = new Array(text.length).fill(false)
  const spans: Span[] = []
  for (const name of sorted) {
    let from = 0
    while (true) {
      const i = text.indexOf(name, from)
      if (i < 0) break
      from = i + 1
      // 한글 이름 뒤에 바로 한글 이름 글자가 이어지면 다른 단어의 일부일 수 있다 (예: "오른" vs "오른쪽")
      const after = text.slice(i + name.length, i + name.length + 1)
      if (/^쪽/.test(after)) continue
      let free = true
      for (let k = i; k < i + name.length; k++) if (taken[k]) free = false
      if (!free) continue
      for (let k = i; k < i + name.length; k++) taken[k] = true
      spans.push({ start: i, end: i + name.length, name })
    }
  }
  return spans.sort((a, b) => a.start - b.start)
}

/** 문장 분리 (마침표·물음표·느낌표·줄바꿈). 숫자 소수점은 자르지 않는다 */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[^\d][.!?。])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 상대·로비 비교 문장 (사용자 보드 사실이 아님). "2등은 …, 4등도 …" 처럼 다른 순위가 주어인 문장 포함 */
const OPPONENT_RE = /상대|경쟁자|로비\s*[1-8]등|1등\s*(?:플레이어|유저)|다른\s*플레이어|상위\s*(?:보드|유저|플레이어)|[1-8]등(?:은|는|도|이|의)\s/

/** 처방·목표·가정 문장 (최종 보드에 대한 사실 주장이 아님) */
const PRESCRIPTIVE_RE = /세요|십시오|하라|해야|했어야|줬어야|합시다|목표|금지|권장|노리세요|만들어야|다면|라면|이면\s|일\s*때|할\s*때|\d-\d\s*까지|(?:확보|달성|완성)\s*[.!]?$/

/** 기물 목록 사이 구분자 / 목록과 "N성" 사이 허용 문구 */
const LIST_SEP_RE = /^\s*(?:[·,、/]|와|과|및|그리고)\s*$/
const STAR_GAP_RE = /^\s*(?:(?:은|는|이|가|을|를|도|의)\s*)?(?:(?:모두|전부|다|각각|이미|이)\s*)?$/

/** "N성" 뒤가 일반 표현인지 (3성작 · 2성+ · 2성 이상 · 3성 5개 · 2성 굳히기 …) */
function isGenericStar(after: string): boolean {
  return /^(?:작|\+|\s*이상|\s*이하|\s*\d|\s*개|\s*밀도|\s*비율|\s*굳히|\s*확정|\s*우선|\s*유닛|\s*기물)/.test(after)
}

export function validateEntityFacts(texts: string[], matches: SlimMatchData[]): EntityFactError[] {
  if (!matches.length) return []
  const errors: EntityFactError[] = []
  const seen = new Set<string>()
  const push = (e: EntityFactError) => {
    const k = `${e.type}|${e.text}|${e.expected}`
    if (seen.has(k)) return
    seen.add(k)
    errors.push(e)
  }

  // 이름 → 실제 값 (여러 판이면 가능한 값 모두)
  const stars = new Map<string, Set<number>>()
  const owners = new Map<string, Set<string>>()
  const traitTiers = new Map<string, Set<number>>()
  const threeStarCounts = new Set<number>()
  const items = new Set<string>()
  for (const m of matches) {
    for (const u of m.units) {
      if (!stars.has(u.name)) stars.set(u.name, new Set())
      stars.get(u.name)!.add(u.tier)
      if (!owners.has(u.name)) owners.set(u.name, new Set())
      for (const it of u.items) {
        owners.get(u.name)!.add(it)
        items.add(it)
      }
    }
    for (const t of m.traits) {
      if (!traitTiers.has(t.name)) traitTiers.set(t.name, new Set())
      traitTiers.get(t.name)!.add(t.tier)
    }
    threeStarCounts.add(m.units.filter((u) => u.tier === 3).length)
  }
  if (matches.length > 1) threeStarCounts.add(matches.reduce((s, m) => s + m.units.filter((u) => u.tier === 3).length, 0))

  const unitNames = [...stars.keys()]
  const itemNames = [...items]
  const traitNames = [...traitTiers.keys()]

  for (const text of texts) {
    for (const s of sentences(text)) {
      if (OPPONENT_RE.test(s) || PRESCRIPTIVE_RE.test(s)) continue
      const units = findNames(s, unitNames)

      // 1) 기물 성급: "<기물>[·<기물>…] (모두) N성"
      for (const m of s.matchAll(/([1-3])성/g)) {
        const at = m.index ?? 0
        if (isGenericStar(s.slice(at + m[0].length))) continue
        const star = Number(m[1])
        const before = units.filter((u) => u.end <= at)
        if (!before.length) continue
        const last = before[before.length - 1]
        if (!STAR_GAP_RE.test(s.slice(last.end, at))) continue
        // 바로 앞 기물부터 구분자로 이어진 목록을 거슬러 올라간다
        const subject: Span[] = [last]
        for (let i = before.length - 2; i >= 0; i--) {
          if (!LIST_SEP_RE.test(s.slice(before[i].end, subject[0].start))) break
          subject.unshift(before[i])
        }
        for (const u of subject) {
          const actual = stars.get(u.name)!
          if (!actual.has(star)) {
            push({ type: 'unit_star', text: s, expected: `${u.name} ${[...actual].join('/')}성`, actual: `${u.name} ${star}성` })
          }
        }
      }

      // 2) 3성 개수: "3성 N개"
      for (const m of s.matchAll(/3성\s*(\d+)\s*개/g)) {
        // "3성 1개 이상/미만/없이", "3성 3개 확보 시점에·확보 시·확보까지만" 은 기준값이지 개수 주장이 아니다
        const after = s.slice((m.index ?? 0) + m[0].length)
        if (/^\s*(?:이상|이하|미만|초과|없이|가\s*되면)/.test(after)) continue
        if (/^\s*(?:를|을)?\s*(?:확보|만들|완성)?\s*(?:한|할|하는)?\s*(?:시점|시(?=\s|$|,)|시에|까지|전|후|하면|되면)/.test(after)) continue
        const n = Number(m[1])
        if (!threeStarCounts.has(n)) {
          push({ type: 'three_star_count', text: s, expected: `3성 ${[...threeStarCounts].join('/')}개`, actual: `3성 ${n}개` })
        }
      }

      // 3) 아이템 소유: "<기물>의/에/에게/가 든 <아이템>[·<아이템>…]"
      const itemSpans = findNames(s, itemNames)
      for (const u of units) {
        const rest = s.slice(u.end)
        const lead = rest.match(/^\s*(?:의|에게?|이\s*든|가\s*든|이\s*가진|가\s*가진|에\s*장착한|에게\s*준|이\s*착용한|가\s*착용한)\s*/)
        if (!lead) continue
        let pos = u.end + lead[0].length
        while (true) {
          const it = itemSpans.find((x) => x.start === pos)
          if (!it) break
          if (!owners.get(u.name)!.has(it.name)) {
            const had = [...owners.get(u.name)!]
            push({ type: 'item_owner', text: s, expected: `${u.name}: ${had.length ? had.join('·') : '아이템 없음'}`, actual: `${u.name}의 ${it.name}` })
          }
          const sep = s.slice(it.end).match(/^\s*(?:[·,、/]|와|과|및)\s*/)
          if (!sep) break
          pos = it.end + sep[0].length
        }
      }

      // 4) 시너지 단계: "<시너지> N단계" / "<시너지>(N단계"
      for (const t of findNames(s, traitNames)) {
        const m = s.slice(t.end).match(/^\s*\(?\s*([1-9])\s*단계/)
        if (!m) continue
        const tier = Number(m[1])
        const actual = traitTiers.get(t.name)!
        if (!actual.has(tier)) {
          push({ type: 'trait_tier', text: s, expected: `${t.name} ${[...actual].join('/')}단계`, actual: `${t.name} ${tier}단계` })
        }
      }
    }
  }
  return errors
}

/** 리포트에서 검사할 서술 문자열 (점수·등급 등 코드 값 제외) */
export function feedbackTexts(fb: Partial<MetaCoachFeedback>, axisVerdicts?: Record<string, string | undefined>): string[] {
  const out: string[] = []
  const add = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) out.push(v)
    else if (Array.isArray(v)) v.forEach(add)
  }
  add(fb.playstyle)
  add(fb.overview)
  add(fb.actions)
  // 스키마 v1 필드 (이전 형식 응답·캐시)
  add(fb.contestAnalysis)
  add(fb.itemAnalysis)
  add(fb.synergyAnalysis)
  add(fb.economyAnalysis)
  add(fb.improvements)
  add(fb.actionPlan)
  if (fb.lecture) {
    const l = fb.lecture
    ;[l.concept, l.why, l.evidence, l.alternative, l.drill, l.checklist].forEach(add)
  }
  if (axisVerdicts) Object.values(axisVerdicts).forEach(add)
  return out
}

/* ───────────── 강의 규칙 위반 (프롬프트 규칙 준수 평가) ───────────── */

export type CoachingRuleType =
  /** 리롤형인데 레벨이 낮다/올려야 한다고 지적 */
  | 'rerollLevelBlame'
  /** 운영도가 '메타 평균 수준'인데 메타 평균보다 못했다고 서술 */
  | 'metaEvenAsWeakness'
  /** 덱 선택을 "갔어야 했다"로 단정 */
  | 'deckMustClaim'
  /** 빈집 후보 줄이 없는데 빈집 덱을 추천 */
  | 'openDeckInvented'
  /** 피봇·덱 전환 시점(라운드)을 단정 */
  | 'pivotTiming'

export interface CoachingRuleViolation {
  type: CoachingRuleType
  text: string
}

const REROLL_LEVEL_BLAME_RE = /레벨(?:이|은)?\s*(?:너무\s*)?(?:낮|부족|모자)|레벨업(?:이|을)?\s*(?:늦|부족)|(?:레벨|렙)을?\s*(?:더\s*)?(?:올려야|올렸어야|높였어야|높여야)/
/** "리롤형이라 레벨이 낮은 건 문제가 아니다" 같은 정상 해설 */
const REROLL_EXCUSE_RE = /리롤(?:형|덱)?(?:이라|이므로|이니|에서는|은|는)|문제(?:가|는)?\s*아니|괜찮|정상/
const META_WEAK_RE = /메타\s*(?:덱\s*)?평균(?:보다|에\s*비해|에)?\s*(?:[^.!?\n]{0,12})?(?:못|낮|부진|뒤처|밑돌|아쉬)/
const DECK_MUST_RE = /(?:갔어야|가야\s*했|탔어야|타야\s*했|선택했어야|골랐어야|잡았어야)/
const OPEN_DECK_RE = /빈집\s*(?:메타\s*)?덱/
const PIVOT_TIMING_RE = /(?:피봇|갈아타|덱\s*전환|전환(?:했|해야|했어야))[^.!?\n]{0,20}\d-\d|\d-\d[^.!?\n]{0,20}(?:피봇|갈아타|덱\s*전환)/

/**
 * 프롬프트 규칙(덱 유형·메타 덱 운영도·빈집 후보) 위반 문장. 사전식 휴리스틱이라 평가 지표로 쓴다 (리포트를 막지 않는다).
 * facts = 모델에 준 프롬프트(사실 블록 포함) — 후보 줄·운영도 판정 유무를 여기서 읽는다.
 */
export function validateCoachingRules(
  texts: string[],
  ctx: { facts: string; deckType?: string; mode: 'single' | 'multi' }
): CoachingRuleViolation[] {
  const out: CoachingRuleViolation[] = []
  const hasOpenLine = ctx.facts.includes('빈집 메타 덱 후보')
  const metaEven = ctx.mode === 'single' && ctx.facts.includes('운영도: 메타 평균 수준')
  for (const text of texts) {
    for (const s of sentences(text)) {
      if (ctx.deckType === 'reroll' && REROLL_LEVEL_BLAME_RE.test(s) && !REROLL_EXCUSE_RE.test(s)) out.push({ type: 'rerollLevelBlame', text: s })
      if (metaEven && META_WEAK_RE.test(s)) out.push({ type: 'metaEvenAsWeakness', text: s })
      if (DECK_MUST_RE.test(s) && /덱|빈집/.test(s)) out.push({ type: 'deckMustClaim', text: s })
      if (!hasOpenLine && OPEN_DECK_RE.test(s)) out.push({ type: 'openDeckInvented', text: s })
      if (PIVOT_TIMING_RE.test(s)) out.push({ type: 'pivotTiming', text: s })
    }
  }
  return out
}

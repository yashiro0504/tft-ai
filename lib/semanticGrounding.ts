import type { EntityFactError, MetaCoachFeedback, SlimMatchData } from './types'
import { costOdds } from './shopOdds'
import { BASIC_COMPONENT_NAMES, GAME_CHAMPIONS, GAME_ITEMS } from './gameData'
import { validateItemRecipes } from './itemRecipes'
import { boardCounts } from './boardStats'
import { boardCarry, detectDeckType } from './deckType'
import { traitNameOf } from './gameFacts'

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
    // 'B.F. 대검' 의 마침표는 문장 끝이 아니다 (대문자 한 글자 + 마침표)
    .split(/(?<=[^\dA-Z][.!?。])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 상대·로비 비교 문장 (사용자 보드 사실이 아님). "2등은 …, 4등도 …" 처럼 다른 순위가 주어인 문장 포함 */
const OPPONENT_RE = /상대|경쟁자|로비\s*[1-8]등|1등\s*(?:플레이어|유저)|다른\s*플레이어|상위\s*(?:보드|유저|플레이어)|[1-8]등(?:은|는|도|이|의)\s/

/** 처방·목표·가정 문장 (최종 보드에 대한 사실 주장이 아님) */
const PRESCRIPTIVE_RE = /세요|십시오|하라|해야|했어야|줬어야|합시다|목표|금지|권장|노리세요|만들어야|다면|라면|이면\s|일\s*때|할\s*때|\d-\d\s*까지|(?:확보|달성|완성)\s*[.!]?$/

/** 시너지 단계 뒤 같은 절에 오면 목표 단계다 (열린다·켜진다·올린다·까지·노린다) */
const TIER_TARGET_RE = /열리|열립|열린|열려|켜지|켜집|켜진|켜져|올라가|올라갑|올릴|올리|올려|까지|노리|노려|노릴/

/** 기물 목록 사이 구분자 / 목록과 "N성" 사이 허용 문구 */
const LIST_SEP_RE = /^\s*(?:[·,、/]|와|과|및|그리고)\s*$/
const STAR_GAP_RE = /^\s*(?:(?:은|는|이|가|을|를|도|의)\s*)?(?:(?:모두|전부|다|각각|이미|이)\s*)?$/

/**
 * "N성" 뒤가 일반 표현인지 (3성작 · 2성+ · 2성 이상 · 3성 5개 · 2성 굳히기 …)
 * 또는 올릴 목표인지 ("1성 피들스틱을 2성으로 올리는" — 시너지를 받치는 기물은 빼지 말고 올리라는 조언이라 자주 나온다).
 * "1성으로 마감했다" 같은 사실 주장은 그대로 검사한다.
 */
function isGenericStar(after: string): boolean {
  return /^(?:작|\+|\s*이상|\s*이하|\s*\d|\s*개|\s*밀도|\s*비율|\s*굳히|\s*확정|\s*우선|\s*유닛|\s*기물|으로\s*(?:올리|올려|올릴|올린|만들|키우|키워|키울))/.test(after)
}

/**
 * '오른(쪽)'·'세트(18)'·'나르(다)'는 평범한 낱말과 겹쳐 이름 검사에서 뺀다.
 * 나머지 기물·완성 아이템 이름은 게임 데이터 전체에서 찾는다 (보드에 없는 이름을 잡아야 하므로 경기 데이터만으로는 안 된다).
 */
const AMBIGUOUS_NAMES = new Set(['오른', '세트', '나르'])
const ALL_CHAMP_NAMES = new Set(GAME_CHAMPIONS.map((c) => c.name).filter((n) => n && !AMBIGUOUS_NAMES.has(n)))
const COMPONENTS = new Set(BASIC_COMPONENT_NAMES)
/** 기물이 드는 아이템만 (재료·소모품 제외 — "재조합기를 쓰세요"는 보드 사실이 아니다) */
const ALL_ITEM_NAMES = new Set(
  GAME_ITEMS.filter((i) => i.kind !== 'component' && i.kind !== 'consumable')
    .map((i) => i.name)
    .filter((n) => n && n.length >= 3 && !COMPONENTS.has(n))
)
const ALL_NAMES = [...ALL_CHAMP_NAMES, ...ALL_ITEM_NAMES]

/**
 * 내 보드가 아닌 대상(메타 덱·통계·로비 상대·빈집·가이드·BIS·계열)을 밝힌 문장, 또는 조합·교체·조건("~가 잡히면") 같은 가정·제안.
 * "니달리 없이도 …"처럼 아무 맥락 없이 보드에 없는 기물을 쓴 문장은 여기에 걸리지 않는다.
 * 저장된 모델 응답 284개(이름 2,206개)에 돌려 걸린 문장은 가정문 1개였다 → 조건(…면) 추가 후 0개.
 */
const REFERENCE_RE = /메타|통계|전환|피봇|피벗|평균|덱|가이드|빈집|랭커|상위|추천|BIS|채용|대신|교체|조합|재료|만들|슬램|먼저|우선|넣|추가|가능|수\s*있|계열|[가-힣]면\s/

/**
 * 내 최종 보드(여러 판이면 어느 판이든)에 없는 기물·아이템을 쓴 문장 (2026-10-27: 렝가 보드 리포트의 "니달리 없이도…").
 * - 사실 데이터(프롬프트)에도 없는 이름 → 지어낸 이름이라 오류
 * - 사실에는 있는 이름(메타 통계·덱 가이드·로비 상대 …) → 그 맥락을 밝힌 문장·처방·상대 문장만 통과
 * 반환: 오류 + 확인한 이름 수 (화면의 '이름 N개 확인')
 */
export function validateBoardNames(texts: string[], matches: SlimMatchData[], facts: string): { errors: EntityFactError[]; checked: number } {
  const errors: EntityFactError[] = []
  if (!matches.length) return { errors, checked: 0 }
  const onBoard = new Set<string>()
  const held = new Set<string>()
  for (const m of matches) {
    for (const u of m.units) {
      onBoard.add(u.name)
      for (const it of u.items) held.add(it)
    }
  }
  const seen = new Set<string>()
  let checked = 0
  for (const text of texts) {
    for (const s of sentences(text)) {
      const contextual = OPPONENT_RE.test(s) || PRESCRIPTIVE_RE.test(s) || REFERENCE_RE.test(s)
      for (const sp of findNames(s, ALL_NAMES)) {
        const isUnit = ALL_CHAMP_NAMES.has(sp.name)
        if ((isUnit ? onBoard.has(sp.name) : held.has(sp.name)) || (contextual && facts.includes(sp.name))) {
          checked++
          continue
        }
        const k = `${s}|${sp.name}`
        if (seen.has(k)) continue
        seen.add(k)
        errors.push({
          type: isUnit ? 'unit_absent' : 'item_absent',
          text: s,
          expected: facts.includes(sp.name) ? `${sp.name}: 내 보드에 없음 (메타·상대 맥락 없이 언급)` : `${sp.name}: 경기·메타 데이터에 없음`,
          actual: sp.name,
        })
      }
    }
  }
  return { errors, checked }
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
        // "한 칸을 채워야 처형자 3단계 또는 지옥불 2단계가 열립니다" — 채운 뒤의 목표 단계지 지금 보드 주장이 아니다 (같은 절 안에서만 본다)
        if (TIER_TARGET_RE.test(s.slice(t.end + m[0].length).split(/[,.]/)[0])) continue
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

/* ───────────── 조합법 · 조언-데이터 모순 · 보드 수치 (2026-10-28) ───────────── */

/** 아이템을 더 주라는 조언 ("무한의 대검을 추가로 맞춰 캐리 아이템 3개를 채우기") */
const ITEM_FILL_RE =
  /(?:아이템|템)[^.!?\n]{0,15}(?:채우|채워(?!진|져)|채울|더\s*(?:맞|주|넣|몰)|추가)|추가로\s*[^.!?\n]{0,20}(?:맞춰|맞추|맞출|만들|넣|주|장착)|몰아\s*주|몰아줘|몰아주/
/** "활성 시너지 3개" · "시너지 3개" (기준값 "시너지 3개 이상" 은 제외) */
const TRAIT_COUNT_RE = /(?<!주력\s?|핵심\s?|메인\s?|상대\s?)(활성\s*시너지|시너지)\s*(\d+)\s*개(?!\s*(?:이상|이하|미만|초과|를\s*목표|까지))/g
/** "캐리 아이템 3개" */
const CARRY_ITEM_COUNT_RE = /캐리\s*(?:아이템|템)\s*(\d)\s*개(?!\s*(?:이상|이하|미만|초과|를\s*목표|까지))/g

/**
 * 리포트 문장을 경기 데이터와 대조한다 (근거 검증 단계).
 * - item_recipe: "아이템 + 조합 재료"가 아이템 데이터(lib/gameData)와 다름 → 재료를 데이터 값으로 교체 (못 바꾸면 삭제)
 * - advice_conflict: 이미 아이템 3개를 든 기물(또는 캐리)에 아이템을 더 채우라는 조언 → 문장 삭제
 * - count_mismatch: "활성 시너지 N개"·"캐리 아이템 N개"가 카드 값(lib/boardStats)과 다름 → 값 교체 (단일 경기만)
 * - lobby_mismatch: 로비 다른 등수의 레벨·시너지 인원/단계·시너지 단계 합이 로비 데이터와 다름 → 값 교체 (단일 경기 · validateLobbyClaims)
 * checkedRecipes = 대조한 조합법 주장 수 (근거 검증 분모에 더한다) · checkedLobby = 대조한 로비 수치 수
 */
export function validateAdviceAndCounts(
  texts: string[],
  matches: SlimMatchData[]
): { errors: EntityFactError[]; checkedRecipes: number; checkedLobby?: number } {
  const errors: EntityFactError[] = []
  const all = texts.flatMap(sentences)
  const recipes = validateItemRecipes(all)
  // 잘못된 재료 구간을 데이터의 재료로 바꾼다 (예: '곡궁+주문력' → '연습용 장갑 + 쓸데없이 큰 지팡이')
  for (const r of recipes.errors) errors.push({ type: 'item_recipe', text: r.text, expected: r.right, actual: r.wrong })
  if (!matches.length) return { errors, checkedRecipes: recipes.checked }

  // 기물별 아이템 수 — 여러 판이면 모든 판에서 3개 이상일 때만 '가득 참'
  const itemCounts = new Map<string, number[]>()
  for (const m of matches) for (const u of m.units) itemCounts.set(u.name, [...(itemCounts.get(u.name) ?? []), u.items?.length ?? 0])
  const full = (name: string) => (itemCounts.get(name) ?? []).every((n) => n >= 3) && itemCounts.has(name)
  const carries = matches.map((m) => boardCarry(m.units || []))
  const carryFull = carries.every((c) => c && (c.items?.length ?? 0) >= 3)
  const unitNames = [...itemCounts.keys()]
  const single = matches.length === 1 ? matches[0] : null
  const counts = single ? boardCounts(single) : null
  const carry = single ? carries[0] : undefined
  // 리롤형 판에서 캐리가 아닌 4~5코스트 기물 (아이템을 몰아줄 대상이 아니다 — v13 아이템 축과 같은 기준)
  const rerollNonCarryHigh = new Set<string>()
  matches.forEach((m, i) => {
    if (detectDeckType(m).type !== 'reroll') return
    for (const u of m.units) if ((u.rarity ?? 1) >= 4 && u.name !== carries[i]?.name) rerollNonCarryHigh.add(u.name)
  })

  for (const s of all) {
    if (ITEM_FILL_RE.test(s) && !OPPONENT_RE.test(s)) {
      const named = findNames(s, unitNames).map((x) => x.name)
      const offCarry = named.filter((n) => rerollNonCarryHigh.has(n))
      if (offCarry.length && offCarry.length === named.length) {
        errors.push({
          type: 'advice_conflict',
          text: s,
          expected: `리롤형 — ${offCarry.join('·')}은(는) 캐리가 아님 (캐리 ${[...new Set(carries.map((c) => c?.name).filter(Boolean))].join('·')})`,
          actual: '캐리가 아닌 고코스트 기물에 아이템 조언',
        })
        continue
      }
      const target = named.length ? named.every(full) : /캐리/.test(s) && carryFull
      if (target) {
        const who = named.length ? named : carries.map((c) => c?.name).filter(Boolean)
        errors.push({
          type: 'advice_conflict',
          text: s,
          expected: `${[...new Set(who)].join('·')}: 이미 아이템 3개 — 더 채울 칸 없음`,
          actual: '아이템 추가 조언',
        })
      }
    }
    if (!counts || OPPONENT_RE.test(s) || PRESCRIPTIVE_RE.test(s)) continue
    for (const m of s.matchAll(TRAIT_COUNT_RE)) {
      if (Number(m[2]) !== counts.activeTraits) {
        errors.push({ type: 'count_mismatch', text: s, expected: `${m[1]} ${counts.activeTraits}개`, actual: m[0] })
      }
    }
    if (carry) {
      for (const m of s.matchAll(CARRY_ITEM_COUNT_RE)) {
        const n = carry.items?.length ?? 0
        if (Number(m[1]) !== n) errors.push({ type: 'count_mismatch', text: s, expected: `캐리 아이템 ${n}개`, actual: m[0] })
      }
    }
  }
  if (single?.lobbyParticipants?.length) {
    const lobby = validateLobbyClaims(all, single)
    errors.push(...lobby.errors)
    return { errors, checkedRecipes: recipes.checked, checkedLobby: lobby.checked }
  }
  return { errors, checkedRecipes: recipes.checked }
}

/** "같은 로비 1등은", "3등 협곡야수는" — 로비 등수 언급 */
const LOBBY_PLACE_RE = /(?:같은\s*)?(?:로비\s*)?([1-8])등(?:은|는|이|의|도|과|와)?/g
/** 등수 언급 뒤에서 이 표현이 나오면 그 등수 이야기가 끝난다 (내 보드 · 비교 대상 전환) */
const LOBBY_CLAUSE_END_RE = /(?:^|[\s,(])(?:나|내|저|제|본인)(?:는|가|의|\s)|\bvs\b|보다|반면|[;。]/
const LOBBY_TIER_SUM_RE = /시너지\s*단계\s*(?:합|총합)(?:은|는|이|가|도)?\s*(\d{1,2})/g
const LOBBY_TRAIT_RE = /([가-힣A-Za-z]{2,})(?:은|는|이|가|도)?\s*(\d{1,2})\s*명(?:으로|이고|에)?(?:\s*(\d)\s*단계)?/g
const LOBBY_LEVEL_RE = /(?:Lv\.?\s*|레벨\s*)(\d{1,2})|(\d{1,2})\s*레벨/g
/** 시너지 이름 끝에 붙은 조사 */
const stripParticle = (s: string) => s.replace(/(?:은|는|이|가|도|의)$/, '')

/**
 * 로비 비교 수치 검증 (2026-10-28 머지 후 재평가 P2-7) — "같은 로비 1등은 시너지 단계 합 12", "3등 협곡야수는 7명으로 3단계",
 * "2등은 Lv.9" 처럼 다른 등수 보드의 수치를 로비 데이터(lobbyParticipants)와 대조한다. 틀리면 데이터 값으로 바꾼다.
 * 등수 언급 뒤 같은 절(내 보드 이야기·'보다'·'vs' 전까지, 40자 안)의 수치만 그 등수 것으로 본다.
 * 시너지 단계 합 = 켠 시너지 단계(tier>0)의 합 — 비교 사실(lib/comparisonFacts)·6축 진단과 같은 정의.
 */
export function validateLobbyClaims(texts: string[], m: SlimMatchData): { errors: EntityFactError[]; checked: number } {
  const errors: EntityFactError[] = []
  let checked = 0
  const lobby = m.lobbyParticipants || []
  for (const s of texts) {
    const places = [...s.matchAll(LOBBY_PLACE_RE)]
    places.forEach((pm, i) => {
      const p = lobby.find((x) => x.placement === Number(pm[1]))
      if (!p) return
      const from = (pm.index ?? 0) + pm[0].length
      let clause = s.slice(from, Math.min(places[i + 1]?.index ?? s.length, from + 40))
      const cut = LOBBY_CLAUSE_END_RE.exec(clause)
      if (cut) clause = clause.slice(0, cut.index)
      const traits = (p.traits || []).filter((t) => (t.tier ?? 0) > 0)
      for (const x of clause.matchAll(LOBBY_TIER_SUM_RE)) {
        checked++
        const sum = traits.reduce((a, t) => a + (t.tier || 0), 0)
        if (Number(x[1]) !== sum) errors.push({ type: 'lobby_mismatch', text: s, expected: x[0].replace(/\d{1,2}$/, String(sum)), actual: x[0] })
      }
      for (const x of clause.matchAll(LOBBY_TRAIT_RE)) {
        const name = traitNameOf(stripParticle(x[1]))
        if (!name) continue
        checked++
        const t = (p.traits || []).find((tr) => traitNameOf(tr.name) === name)
        const count = t?.count ?? 0
        const tier = t?.tier ?? 0
        const countOk = Number(x[2]) === count
        const tierOk = x[3] == null || Number(x[3]) === tier
        if (countOk && tierOk) continue
        const fixed = x[0].replace(/(\d{1,2})(\s*명)/, `${count}$2`).replace(/(\d)(\s*단계)$/, `${tier}$2`)
        errors.push({ type: 'lobby_mismatch', text: s, expected: fixed, actual: x[0] })
      }
      for (const x of clause.matchAll(LOBBY_LEVEL_RE)) {
        checked++
        const said = Number(x[1] ?? x[2])
        if (said !== p.level) errors.push({ type: 'lobby_mismatch', text: s, expected: x[0].replace(String(said), String(p.level)), actual: x[0] })
      }
    })
  }
  return { errors, checked }
}

/**
 * 검증기가 잡은 의미 오류를 사용자에게 보내기 전에 고친다.
 * - 데이터 값이 하나로 정해지고 문장에 틀린 표현("주문술사 4단계")이 그대로 있으면 맞는 값으로 바꾼다.
 * - 그 밖(여러 판이라 값이 여럿, "A·B 모두 3성" 처럼 표현이 흩어짐, 아이템 소유 오류)은 문장을 지운다.
 * - 문장을 지워 문자열이 비면: 배열 항목은 빼고, 단일 필드는 원문을 둔다(빈 섹션보다 낫다 — 오류는 grounding 에 남는다).
 *   dropEmpty 면 단일 필드도 비운다 (호출부가 코드 문장으로 채운다 — AI 리포트 finalize).
 * - stats 를 주면 고친 문장·지운 문장 수를 더한다.
 * 문자열·배열·객체를 깊게 돌며 오류 문장이 들어 있는 문자열만 바꾼다. 원본은 바꾸지 않는다.
 */
export function repairEntityErrors<T>(
  value: T,
  errors: EntityFactError[],
  opts: { dropEmpty?: boolean; stats?: { fixed: number; deleted: number } } = {}
): T {
  if (!errors.length) return value
  // 문장별 교체문 ('' = 지움). 같은 문장에 오류가 여럿이면 하나라도 못 고칠 때 지운다
  const bySentence = new Map<string, string>()
  for (const e of errors) {
    const current = bySentence.has(e.text) ? bySentence.get(e.text)! : e.text
    const fixable =
      !['item_owner', 'unit_absent', 'item_absent', 'advice_conflict'].includes(e.type) && !e.expected.includes('/') && current.includes(e.actual)
    bySentence.set(e.text, fixable ? current.split(e.actual).join(e.expected) : '')
  }
  const touched = new Set<string>()

  const fixString = (str: string): string => {
    let out = str
    for (const [sentence, fixed] of bySentence) {
      if (!out.includes(sentence)) continue
      touched.add(sentence)
      out = out.split(sentence).join(fixed)
    }
    return out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  }

  const walk = (v: unknown, inArray: boolean): unknown => {
    if (typeof v === 'string') {
      if (![...bySentence.keys()].some((x) => v.includes(x))) return v
      const out = fixString(v)
      if (out) return out
      return inArray ? undefined : opts.dropEmpty ? '' : v
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, true)).filter((x) => x !== undefined)
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) o[k] = walk(x, false)
      return o
    }
    return v
  }
  const result = walk(value, false) as T
  if (opts.stats) {
    for (const sentence of touched) {
      if (bySentence.get(sentence)) opts.stats.fixed++
      else opts.stats.deleted++
    }
  }
  return result
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
    for (const x of l.moments || []) [x.why, x.fix].forEach(add)
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
  /** 덱 가이드 '채용률'을 조합(슬램) 순서의 근거로 사용 */
  | 'guideOrderClaim'
  /** 레벨별 상점 확률을 게임 데이터 표와 다르게 인용 ("8레벨 4코 확률 22%") */
  | 'shopOddsMismatch'

export interface CoachingRuleViolation {
  type: CoachingRuleType
  text: string
}

const REROLL_LEVEL_BLAME_RE = /레벨(?:이|은)?\s*(?:너무\s*)?(?:낮|부족|모자)|레벨업(?:이|을)?\s*(?:늦|부족)|(?:레벨|렙)을?\s*(?:더\s*)?(?:올려|올리|올렸|높여|높이|높였)/
/** "리롤형이라 레벨이 낮은 건 문제가 아니다" 같은 정상 해설 */
const REROLL_EXCUSE_RE = /리롤(?:형|덱)?(?:이라|이므로|이니|에서는|은|는)|문제(?:가|는)?\s*아니|괜찮|정상/
const META_WEAK_RE = /메타\s*(?:덱\s*)?평균(?:보다|에\s*비해|에)?\s*(?:[^.!?\n]{0,12})?(?:못|낮|부진|뒤처|밑돌|아쉬)/
const DECK_MUST_RE = /(?:갔어야|가야\s*했|탔어야|타야\s*했|선택했어야|골랐어야|잡았어야)/
/** '로비가 안 탄 메타 덱'(2026-10-27 이전 이름 '빈집 메타 덱' — 경합 등급 '빈집'과 겹쳐 바꿨다) */
const OPEN_DECK_RE = /(?:빈집|로비가\s*안\s*탄)\s*(?:메타\s*)?덱/
const GUIDE_ORDER_RE = /채용(?:률)?[^.!?\n]{0,40}(?:먼저|우선|선(?:슬램|조합))|(?:먼저|우선)[^.!?\n]{0,40}채용(?:률)?/
const PIVOT_TIMING_RE =
  /(?:피봇|갈아타|덱\s*전환|전환(?:했|해야|했어야))[^.!?\n]{0,20}\d-\d|\d-\d[^.!?\n]{0,20}(?:피봇|갈아타|덱\s*전환)|(?:비틀|피봇|갈아타)[^.!?\n]{0,15}(?:신호|시점|타이밍|순간)|(?:시점|타이밍|순간)[^.!?\n]{0,15}(?:비틀|피봇|갈아타)/
/** "Lv.8 … 4코스트 … 30%" / "8레벨 4코 확률 30%" — 레벨·코스트·확률이 한 구절에 있는 상점 확률 인용 */
const SHOP_ODDS_CLAIM_RE = /(?:Lv\.?\s*(\d{1,2})|(\d{1,2})\s*레벨)[^.!?\n]{0,15}?([1-5])\s*코(?:스트)?[^.!?\n%]{0,12}?(\d{1,3})\s*%/g

/** 문장 속 상점 확률 인용 중 게임 데이터 표(lib/shopOdds)와 다른 것 */
function shopOddsMismatches(s: string): string[] {
  const out: string[] = []
  for (const m of s.matchAll(SHOP_ODDS_CLAIM_RE)) {
    const level = Number(m[1] ?? m[2])
    const cost = Number(m[3])
    const claimed = Number(m[4])
    const actual = costOdds(level, cost)
    if (level >= 1 && level <= 11 && claimed !== actual) out.push(`Lv.${level} ${cost}코 ${claimed}% (표: ${actual}%)`)
  }
  return out
}

/** 부정·불가 서술 ("후보가 없었습니다", "데이터로 알 수 없습니다", "~라는 뜻은 아닙니다") — 주장형 규칙에서 제외 */
const NEGATED_RE = /없었|없습니다|없다|없음|없어|않|아닙니다|아니다|아닌|알\s*수\s*없|모릅|모른/

/**
 * 프롬프트 규칙(덱 유형·메타 덱 운영도·빈집 후보) 위반 문장. 사전식 휴리스틱이라 평가 지표로 쓴다 (리포트를 막지 않는다).
 * '위반 0'은 이 휴리스틱 기준일 뿐이다 — 알려진 미탐·오탐은 scripts/testSemanticGrounding.js 에 문장으로 고정해 둔다.
 * facts = 모델에 준 프롬프트(사실 블록 포함) — 후보 줄·운영도 판정 유무를 여기서 읽는다.
 */
export function validateCoachingRules(
  texts: string[],
  ctx: { facts: string; deckType?: string; mode: 'single' | 'multi' }
): CoachingRuleViolation[] {
  const out: CoachingRuleViolation[] = []
  const hasOpenLine = ctx.facts.includes('로비가 안 탄 메타 덱 후보') || ctx.facts.includes('빈집 메타 덱 후보')
  const metaEven = ctx.mode === 'single' && ctx.facts.includes('운영도: 메타 평균 수준')
  const hasGuide = ctx.facts.includes('덱 가이드')
  for (const text of texts) {
    for (const s of sentences(text)) {
      if (ctx.deckType === 'reroll' && REROLL_LEVEL_BLAME_RE.test(s) && !REROLL_EXCUSE_RE.test(s)) out.push({ type: 'rerollLevelBlame', text: s })
      if (metaEven && META_WEAK_RE.test(s)) out.push({ type: 'metaEvenAsWeakness', text: s })
      if (shopOddsMismatches(s).length) out.push({ type: 'shopOddsMismatch', text: s })
      // 아래 주장형 규칙은 부정·불가 서술이면 위반이 아니다
      if (NEGATED_RE.test(s)) continue
      if (DECK_MUST_RE.test(s) && /덱|빈집/.test(s)) out.push({ type: 'deckMustClaim', text: s })
      if (!hasOpenLine && OPEN_DECK_RE.test(s)) out.push({ type: 'openDeckInvented', text: s })
      if (PIVOT_TIMING_RE.test(s)) out.push({ type: 'pivotTiming', text: s })
      if (hasGuide && GUIDE_ORDER_RE.test(s)) out.push({ type: 'guideOrderClaim', text: s })
    }
  }
  return out
}

/* ───────────── 다음 3게임 목표(drill) — 이미 달성한 기준 금지 ───────────── */

const LEVEL_MENTION_RE = /(?:Lv\.?\s*|레벨\s*)(\d{1,2})/g
const TWO_STAR_TARGET_RE = /2성(?:\s*이상)?\s*(?:기물\s*)?(\d{1,2})\s*(?:개|명)/g

/**
 * 한 판 리포트의 "다음 3게임 목표"가 이번 판에 이미 달성한 기준(최종 Lv.8 인데 "Lv.8 도달")이면 바꾼다.
 * - 본문 조언(장면 fix·대안·체크리스트·행동)에 이번 판보다 높은 레벨 목표가 있으면 그 기준으로 다시 쓴다 (본문 Lv.9 ↔ 목표 Lv.9).
 * - 없으면 fallback(코드 문장)으로 바꾼다.
 * 달성하지 않은 기준이면 null (그대로 둔다).
 */
export function fixDrillTarget(drill: string, m: SlimMatchData, bodyTexts: string[], fallback: string): string | null {
  const levels = [...drill.matchAll(LEVEL_MENTION_RE)].map((x) => Number(x[1])).filter((n) => n >= 3 && n <= 10)
  const levelDone = levels.some((n) => n <= m.level)
  const twoStars = m.units.filter((u) => (u.tier || 1) >= 2).length
  const starDone = [...drill.matchAll(TWO_STAR_TARGET_RE)].some((x) => Number(x[1]) <= twoStars)
  if (!levelDone && !starDone) return null
  const bodyLevel = bodyTexts
    .flatMap((t) => [...t.matchAll(LEVEL_MENTION_RE)].map((x) => Number(x[1])))
    .find((n) => n > m.level && n <= 10)
  if (bodyLevel) return `다음 3판은 최종 레벨 ${bodyLevel} 이상으로 마무리하기 (이번 판 최종 Lv.${m.level})`
  return fallback === drill ? null : fallback
}

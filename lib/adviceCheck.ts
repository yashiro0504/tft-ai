import type { DeckBisCheck, EntityFactError, SlimMatchData, StructuredAdvice } from './types'
import { buildBoardTable, removalLosses, unitHasTrait, type BoardTable } from './boardTable'
import { traitNameOf } from './gameFacts'
import { REMOVE_AFTER_RE, findNames, sentences } from './semanticGrounding'

/**
 * 구조화된 조언 검사 (2026-10-30 2차 지시문 2) — 정규식으로 문장을 찾는 대신, LLM 이 개선 포인트·강의 조언과 함께 내는
 * advice JSON(lib/types StructuredAdvice)을 보드 표(lib/boardTable)와 대조한다.
 *
 * - replace_unit: 빼는 기물이 target_trait 을 가지면 실패 · 빼서 꺼지거나 내려가는 다인원 시너지가 있으면 실패
 * - target_tier: 이미 그 단계 이상이면 실패
 * - add_trait_units: 더 넣을 인원이 실제 다음 단계(또는 target_tier)까지 필요한 인원과 다르면 실패
 * - change_items: 상징을 빼서 켜진 시너지가 내려가면 실패 (상징 칸은 '유지' 대상 · 지시문 3-4) ·
 *   BIS 세트가 추천 조건(50판 · 덱 평균보다 표준오차 이상 좋음)을 못 채웠는데 그 세트로 바꾸라고 하면 실패 (지시문 3-3)
 * - 일관성: 같은 기물에 keep_unit 과 replace_unit 이 함께 있으면 replace 실패 (아이템도 keep_items ↔ change_items)
 * 실패한 조언은 quote 문장(없으면 그 기물을 빼는 문장)을 지운다 (repairEntityErrors · trait_relation).
 * checked = 대조한 조언 수 — 근거 검증의 '관계 N개 검사'에 더한다.
 */

const EMBLEM_SUFFIX = ' 상징'

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

const ACTIONS: StructuredAdvice['action'][] = ['replace_unit', 'keep_unit', 'add_trait_units', 'change_items', 'keep_items', 'level_up', 'other']

/** LLM 응답의 advice 배열 → 형식이 맞는 항목만 */
export function parseStructuredAdvice(raw: unknown): StructuredAdvice[] {
  if (!Array.isArray(raw)) return []
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : undefined)
  return raw
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
    .map((x) => {
      const action = (ACTIONS as string[]).includes(String(x.action)) ? (x.action as StructuredAdvice['action']) : 'other'
      const a: StructuredAdvice = { action }
      const fields: [keyof StructuredAdvice, unknown][] = [
        ['quote', str(x.quote)],
        ['remove', str(x.remove)],
        ['unit', str(x.unit)],
        ['target_trait', str(x.target_trait)],
        ['target_tier', num(x.target_tier)],
        ['count', num(x.count)],
        ['remove_item', str(x.remove_item)],
        ['add_item', str(x.add_item)],
        ['level', num(x.level)],
      ]
      for (const [k, v] of fields) if (v !== undefined) (a as unknown as Record<string, unknown>)[k] = v
      return a
    })
    .slice(0, 12)
}

/** 조언이 가리키는 리포트 문장 — quote 를 포함하는 문장, 없으면 기물 이름 + 빼기 표현이 있는 문장 */
function sentencesFor(a: StructuredAdvice, texts: string[], unit?: string): string[] {
  const all = texts.flatMap(sentences)
  if (a.quote) {
    const q = norm(a.quote)
    const hit = all.filter((s) => norm(s).includes(q) || (q.length >= 8 && q.includes(norm(s))))
    if (hit.length) return hit
  }
  if (!unit) return []
  return all.filter((s) => findNames(s, [unit]).some((sp) => (a.action === 'replace_unit' ? REMOVE_AFTER_RE.test(s.slice(sp.end)) : true)))
}

function traitOf(table: BoardTable, name?: string) {
  const t = name ? traitNameOf(name) ?? name : null
  return t ? table.traits.find((x) => x.name === t) ?? null : null
}

/** 상징을 빼면 그 시너지 단계가 내려가는가 */
function emblemDrop(table: BoardTable, emblem: string): { trait: string; from: number; to: number } | null {
  const tn = traitNameOf(emblem.slice(0, -EMBLEM_SUFFIX.length))
  const t = tn ? table.traits.find((x) => x.name === tn) : null
  if (!t || !t.stage) return null
  let to = 0
  t.breakpoints.forEach((b, i) => {
    if (t.count - 1 >= b) to = i + 1
  })
  return to < t.stage ? { trait: t.name, from: t.stage, to } : null
}

export function validateStructuredAdvice(
  advice: StructuredAdvice[] | undefined,
  texts: string[],
  match: SlimMatchData | null,
  opts: { bis?: DeckBisCheck | null } = {}
): { errors: EntityFactError[]; checked: number } {
  const errors: EntityFactError[] = []
  let checked = 0
  if (!advice?.length || !match) return { errors, checked }
  const table = buildBoardTable(match)
  const onBoard = (n?: string) => Boolean(n && table.units.some((u) => u.name === n))
  const seen = new Set<string>()
  const fail = (a: StructuredAdvice, unit: string | undefined, expected: string, actual: string) => {
    const targets = sentencesFor(a, texts, unit)
    // 문장을 못 찾은 조언도 검출 기록은 남긴다 (리포트 문자열과 겹치지 않는 표기라 수리는 하지 않는다)
    for (const text of targets.length ? targets : [a.quote ?? `[조언 ${a.action}] ${[unit, a.target_trait].filter(Boolean).join(' · ')}`]) {
      const k = `${text}|${expected}`
      if (seen.has(k)) continue
      seen.add(k)
      errors.push({ type: 'trait_relation', text, expected, actual })
    }
  }

  const keepUnits = new Set(advice.filter((a) => a.action === 'keep_unit' && a.unit).map((a) => a.unit as string))
  const keepItems = new Set(advice.filter((a) => a.action === 'keep_items' && a.unit).map((a) => `${a.unit}|${a.remove_item ?? a.add_item ?? '*'}`))

  for (const a of advice) {
    // 목표 단계 — 이미 그 단계 이상이면 목표가 아니다
    if (a.target_trait && a.target_tier != null && a.action !== 'keep_unit') {
      const t = traitOf(table, a.target_trait)
      if (t) {
        checked++
        if (t.stage >= a.target_tier) fail(a, a.remove ?? a.unit, `${t.name}: 이미 ${t.stage}단계(${t.count}명)`, `${t.name} ${a.target_tier}단계 목표`)
      }
    }

    if (a.action === 'replace_unit') {
      const name = a.remove ?? a.unit
      if (!onBoard(name)) continue
      checked++
      const trait = a.target_trait ? traitNameOf(a.target_trait) ?? a.target_trait : null
      if (trait && unitHasTrait(table, name as string, trait)) {
        fail(a, name, `${name}: ${trait} 기물 — 빼면 ${trait} 인원이 준다`, `${name}을(를) 빼고 ${trait} 올리기`)
        continue
      }
      const losses = removalLosses(table, name as string)
      if (losses.length) {
        fail(a, name, `${name}: 빼면 ${losses.join('·')} 꺼짐/하락`, `${name} 교체`)
        continue
      }
      if (keepUnits.has(name as string)) fail(a, name, `${name}: 같은 리포트에서 유지하라고 함`, `${name} 교체`)
    }

    if (a.action === 'add_trait_units') {
      const t = traitOf(table, a.target_trait)
      if (!t || a.count == null) continue
      checked++
      const target = a.target_tier != null ? t.breakpoints[a.target_tier - 1] : t.breakpoints.find((b) => b > t.count)
      if (target == null) {
        fail(a, undefined, `${t.name}: 이미 최고 단계(${t.count}명)`, `${t.name} ${a.count}명 추가`)
        continue
      }
      const need = target - t.count
      if (need !== a.count) fail(a, undefined, `${t.name}: ${t.count}명 → 다음 단계 ${target}명까지 ${need}명`, `${t.name} ${a.count}명 추가`)
    }

    if (a.action === 'change_items') {
      const u = table.units.find((x) => x.name === a.unit)
      if (!u) continue
      checked++
      const emblems = u.items.filter((it) => it.endsWith(EMBLEM_SUFFIX))
      // 빼는 아이템이 상징이거나, 3칸이 다 찼는데 빼는 아이템을 밝히지 않았고 상징이 켜진 시너지를 받칠 때
      const dropped = a.remove_item?.endsWith(EMBLEM_SUFFIX)
        ? emblemDrop(table, a.remove_item)
        : !a.remove_item && u.items.length >= 3 && !(a.add_item ?? '').endsWith(EMBLEM_SUFFIX)
          ? emblems.map((e) => emblemDrop(table, e)).find(Boolean) ?? null
          : null
      if (dropped) {
        fail(a, a.unit, `${u.name}: 상징을 빼면 ${dropped.trait} ${dropped.from}→${dropped.to}단계 (상징 칸은 유지)`, `${u.name} 아이템 교체`)
        continue
      }
      const bis = opts.bis
      if (bis && bis.unit === u.name && !bis.recommend && a.add_item && bis.items.includes(a.add_item)) {
        fail(a, a.unit, `${bis.unit}: ${bis.label}가 덱 평균보다 뚜렷이 좋지 않음 — 아이템 변경 근거 없음`, `${u.name} ${bis.label}로 교체`)
        continue
      }
      if (keepItems.has(`${u.name}|${a.remove_item ?? '*'}`) || keepItems.has(`${u.name}|*`)) {
        fail(a, a.unit, `${u.name}: 같은 리포트에서 아이템을 유지하라고 함`, `${u.name} 아이템 교체`)
      }
    }
  }
  return { errors, checked }
}

/**
 * 문장 검사 (구조화 출력이 없는 캐시 리포트용) — 상징을 든 3칸 꽉 찬 기물에게 새 아이템을 만들라는 조언.
 * "카르마에게 보석 건틀릿을 만들어 BIS 3개를 맞춘다"(카르마 = 라바돈·푸른 파수꾼·처형자 상징) → 상징을 빼야 하고 처형자 3→2.
 */
export function validateEmblemItemAdvice(texts: string[], match: SlimMatchData | null, itemNames: string[]): { errors: EntityFactError[]; checked: number } {
  const errors: EntityFactError[] = []
  let checked = 0
  if (!match) return { errors, checked }
  const table = buildBoardTable(match)
  const full = table.units.filter((u) => u.items.length >= 3 && u.items.some((it) => it.endsWith(EMBLEM_SUFFIX)))
  if (!full.length) return { errors, checked }
  const GIVE_RE = /만들어|만들고|만들면|맞춰|맞추|맞출|장착|넣어|넣고|주고|줘서|쥐여|들려/
  for (const s of texts.flatMap(sentences)) {
    for (const u of full) {
      const at = s.indexOf(u.name)
      if (at < 0) continue
      const rest = s.slice(at + u.name.length)
      if (!/^\s*(?:에게|한테|의|에)/.test(rest) || !GIVE_RE.test(rest)) continue
      const fresh = findNames(rest, itemNames).map((x) => x.name).filter((it) => !u.items.includes(it) && !it.endsWith(EMBLEM_SUFFIX))
      if (!fresh.length) continue
      const drop = u.items.filter((it) => it.endsWith(EMBLEM_SUFFIX)).map((e) => emblemDrop(table, e)).find(Boolean)
      checked++
      if (drop) errors.push({ type: 'trait_relation', text: s, expected: `${u.name}: 3칸이 차 있어 상징을 빼야 함 → ${drop.trait} ${drop.from}→${drop.to}단계`, actual: `${u.name}에게 ${fresh[0]}` })
    }
  }
  return { errors, checked }
}

/* ───────────── 파생 수치·BIS·본인 레벨 (2026-10-30 2차 지시문 3·6) ───────────── */

const KOR_NUM: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8 }
const numOf = (x: string) => (/^\d+$/.test(x) ? Number(x) : KOR_NUM[x] ?? NaN)
/** 본인 보드 이야기가 아닌 문장 (상대·로비·목표·가정) */
const NOT_MINE_RE = /상대|로비|[1-8]등\s*\(|[1-8]등(?:은|는|도|이|의|보다)\s|1등\s*플레이어|세요|목표|이상|까지|올리|올려|도달|노리|노려|만들|하면|라면|다면|였다면|했다면/

/**
 * - BIS 일치 수: "BIS 일치율 0/3" · "BIS … 중 N개 일치"가 비교 섹션(deckComparison.bis)과 다르면 그 값으로 고친다 (요약·개선 포인트·비교 섹션이 같은 값)
 * - 차이 수치: 한 문장에 "A 대 B"와 "N단계 부족/차이"가 함께 있으면 N 이 |A − B| 인지 확인 ("단계 합 6 대 10 … 두 단계 부족" → 4단계)
 * - 본인 레벨: 본인 보드 이야기에서 "최종 레벨 N"·"Lv.N에서"가 내 최종 레벨과 다르면 지운다 (상대 레벨을 본인 것처럼 쓴 문장)
 */
export function validateDerivedClaims(
  texts: string[],
  match: SlimMatchData | null,
  bis?: DeckBisCheck | null
): { errors: EntityFactError[]; checked: number } {
  const errors: EntityFactError[] = []
  let checked = 0
  for (const s of texts.flatMap(sentences)) {
    if (bis && bis.slots) {
      for (const m of s.matchAll(/BIS[^.!?\n]{0,25}?일치(?:율)?\s*:?\s*(\d)\s*\/\s*(\d)/g)) {
        checked++
        if (Number(m[1]) !== bis.matched || Number(m[2]) !== bis.slots) {
          const actual = m[0]
          errors.push({ type: 'bis_count', text: s, expected: actual.replace(/(\d)\s*\/\s*(\d)\s*$/, `${bis.matched}/${bis.slots}`), actual })
        }
      }
      for (const m of s.matchAll(/(BIS[^.!?\n]{0,40}?중\s*)(\d)(\s*개\s*일치)/g)) {
        checked++
        if (Number(m[2]) !== bis.matched) errors.push({ type: 'bis_count', text: s, expected: `${m[1]}${bis.matched}${m[3]}`, actual: m[0] })
      }
    }
    // 추천 조건(50판 · 덱 평균보다 표준오차 이상 좋음)을 못 채운 세트로 바꾸라는 조언은 지운다 (지시문 3-3)
    if (bis && !bis.recommend && /BIS|자주\s*쓰는\s*조합/.test(s) && /맞추|맞춰|맞출|바꾸|바꿔|교체|만들어|만들고|따라/.test(s) && !/중\s*\d\s*개\s*일치/.test(s)) {
      checked++
      errors.push({ type: 'advice_conflict', text: s, expected: `${bis.label} 평균 ${bis.setAvg ?? '-'}등(${bis.setGames}판) — 덱 평균 ${bis.deckAvg ?? '-'}등보다 뚜렷이 좋지 않음`, actual: `${bis.label}로 아이템 변경 추천` })
      continue
    }
    const pair = s.match(/(\d+)\s*(?:대|vs\.?|:)\s*(\d+)/)
    const gap = s.match(/(한|두|세|네|다섯|여섯|일곱|여덟|\d+)\s*단계\s*(?:부족|차이|적|낮|뒤)/)
    if (pair && gap && !/\d\s*-\s*\d/.test(pair[0])) {
      checked++
      const diff = Math.abs(Number(pair[1]) - Number(pair[2]))
      if (numOf(gap[1]) !== diff) errors.push({ type: 'count_mismatch', text: s, expected: `${diff}단계`, actual: (gap[0].match(/^.*?단계/) as RegExpMatchArray)[0] })
    }
    if (match && !NOT_MINE_RE.test(s)) {
      for (const m of s.matchAll(/최종\s*(?:레벨|Lv\.?)\s*(\d{1,2})|(?:레벨|Lv\.?)\s*(\d{1,2})\s*에서/g)) {
        const lv = Number(m[1] ?? m[2])
        checked++
        if (lv !== match.level) errors.push({ type: 'level_mismatch', text: s, expected: `내 최종 레벨 ${match.level}`, actual: m[0] })
      }
    }
  }
  return { errors, checked }
}

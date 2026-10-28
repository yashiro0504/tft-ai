import { BASIC_COMPONENT_NAMES, ITEM_RECIPES } from './gameData'

/**
 * 아이템 재료 단위 매칭 — 빈집 메타 덱 후보(lib/comparisonFacts)용.
 *
 * Riot 데이터에는 라운드별 재료 획득·조합 시점이 없고 최종 완성템만 있다. 완성템끼리 비교하면
 * "다른 기물을 위해 일찍 조합한 아이템" 때문에 불공정하므로, 최종 아이템을 기본 재료로 풀어
 * "같은 재료였다면 무엇을 만들 수 있었나"만 본다. (조합을 되돌릴 수 없다는 점은 반영하지 못한다)
 * 조합법은 게임 기준 DB(lib/gameData — 일반 재료 8종으로 만드는 완성템)에서 읽는다.
 */

const RECIPES = ITEM_RECIPES
const COMPONENTS = new Set<string>(BASIC_COMPONENT_NAMES)

/** 아이템 → 기본 재료. 재료 자체면 [자신], 조합법이 없으면(상징·유물·찬란한 아이템) null */
export function componentsOf(item: string): string[] | null {
  if (COMPONENTS.has(item)) return [item]
  return RECIPES[item] ?? null
}

/** 최종 아이템들을 기본 재료 묶음(중복 허용)으로 푼다. 풀 수 없는 아이템은 건너뛴다 */
export function componentPool(items: string[]): string[] {
  return items.flatMap((it) => componentsOf(it) ?? [])
}

/** 조합법이 있는 완성템인가 (재료 단위 매칭 대상) */
export function isCraftable(item: string): boolean {
  return Boolean(RECIPES[item])
}

/**
 * targets(완성템) 중 pool(재료)로 동시에 만들 수 있는 최대 묶음. 순서·재료 공유를 모두 시도한다.
 * 결과는 targets 의 순서를 따른다. (캐리 아이템은 3개 이하라 전수 탐색으로 충분하다)
 */
export function bestBuildable(targets: string[], pool: string[]): string[] {
  const craftable = targets.filter(isCraftable)
  let best: number[] = []
  const search = (i: number, left: string[], picked: number[]) => {
    if (picked.length > best.length) best = [...picked]
    if (i >= craftable.length) return
    const need = RECIPES[craftable[i]]
    const rest = [...left]
    const ok = need.every((c) => {
      const at = rest.indexOf(c)
      if (at < 0) return false
      rest.splice(at, 1)
      return true
    })
    if (ok) search(i + 1, rest, [...picked, i])
    search(i + 1, left, picked)
  }
  search(0, pool, [])
  return best.map((i) => craftable[i])
}

/* ───────────── 조합법 사실 (AI 프롬프트 · 근거 검증) ───────────── */

/**
 * 재료를 부르는 흔한 표현 → 정식 재료 이름. AI 가 "곡궁+주문력" 처럼 줄여 쓰므로 검증은 별칭까지 읽는다.
 * (보석 건틀릿 = 연습용 장갑 + 쓸데없이 큰 지팡이. "곡궁+주문력"은 구인수의 격노검이다 — 2026-10-28 백승민#agent 리포트)
 */
const COMPONENT_ALIASES: Array<[RegExp, string]> = [
  [/쓸데없이\s*큰\s*지팡이|큰\s*지팡이|지팡이|주문력|AP/g, '쓸데없이 큰 지팡이'],
  [/B\.?F\.?\s*대검|대검|공격력|AD/g, 'B.F. 대검'],
  [/여신의\s*눈물|눈물|마나/g, '여신의 눈물'],
  [/음전자\s*망토|망토|마법\s*저항력|마저/g, '음전자 망토'],
  [/쇠사슬\s*조끼|조끼|방어력|갑옷/g, '쇠사슬 조끼'],
  [/거인의\s*허리띠|허리띠|벨트|체력/g, '거인의 허리띠'],
  [/곡궁|공격\s*속도|공속/g, '곡궁'],
  [/연습용\s*장갑|장갑/g, '연습용 장갑'],
]

const RECIPE_JOIN_RE = /^\s*(?:\+|＋|와|과|랑|이랑|및|·|,|、)\s*$/
const RECIPE_MARK_RE = /재료|조합|만들|만듭|만드|\+|＋|=/

interface ComponentMention {
  start: number
  end: number
  name: string
}

/** 문장 안 재료 언급 (긴 표현 우선, 겹치지 않게) */
function componentMentions(s: string): ComponentMention[] {
  const out: ComponentMention[] = []
  for (const [re, name] of COMPONENT_ALIASES) {
    for (const m of s.matchAll(re)) {
      const start = m.index ?? 0
      const end = start + m[0].length
      if (out.some((x) => start < x.end && end > x.start)) continue
      out.push({ start, end, name })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/** 텍스트에 나온 조합 아이템의 조합법 줄 (AI 프롬프트용 — 조합법은 AI 가 만들지 않고 게임 데이터에서 넣는다) */
export function recipeFactsFor(text: string, limit = 24): string {
  const names = Object.keys(RECIPES)
    .filter((n) => text.includes(n))
    .slice(0, limit)
  if (!names.length) return ''
  return [
    '[아이템 조합법 — 게임 데이터(Community Dragon), 이 표에 없는 조합법은 쓰지 마라]',
    ...names.map((n) => `- ${n} = ${RECIPES[n].join(' + ')}`),
  ].join('\n')
}

export interface RecipeMismatch {
  /** 오류 문장 */
  text: string
  item: string
  /** 데이터의 조합법 */
  expected: string
  /** 리포트가 쓴 재료 */
  actual: string
  /** 문장 안 잘못된 재료 구간 (예: "곡궁+주문력") — 이 구간을 right 로 바꾸면 고쳐진다 */
  wrong: string
  /** 데이터의 재료 (예: "연습용 장갑 + 쓸데없이 큰 지팡이") */
  right: string
}

/**
 * 리포트 문장의 "아이템 + 조합 재료" 를 아이템 데이터와 대조한다.
 * 아이템 이름 바로 뒤(다음 아이템 이름 전, 40자 안)에 재료가 2개 이상 나오면 조합법 주장으로 보고 앞 2개를 비교한다.
 * checked = 대조한 조합법 주장 수 (근거 검증 분모)
 */
export function validateItemRecipes(sentences: string[]): { errors: RecipeMismatch[]; checked: number } {
  const errors: RecipeMismatch[] = []
  let checked = 0
  const items = Object.keys(RECIPES).sort((a, b) => b.length - a.length)
  for (const s of sentences) {
    const spans: ComponentMention[] = []
    for (const name of items) {
      let from = 0
      while (true) {
        const at = s.indexOf(name, from)
        if (at < 0) break
        const end = at + name.length
        if (!spans.some((x) => at < x.end && end > x.start)) spans.push({ start: at, end, name })
        from = end
      }
    }
    spans.sort((a, b) => a.start - b.start)
    if (!spans.length) continue
    // 아이템 이름 안의 재료 표현("보석 건틀릿"의 '장갑' 등)은 재료 언급이 아니다
    const mentions = componentMentions(s).filter((c) => !spans.some((x) => c.start < x.end && c.end > x.start))
    spans.forEach((sp, i) => {
      const stop = Math.min(spans[i + 1]?.start ?? s.length, sp.end + 40)
      const parts = mentions.filter((c) => c.start >= sp.end && c.end <= stop).slice(0, 2)
      if (parts.length < 2) return
      // 조합법 주장일 때만: 두 재료가 +·와/과·랑 등으로 이어지고, 문장에 재료·조합 표시가 있어야 한다
      // ("가고일 돌갑옷으로 방어력과 체력을 올리세요" 같은 능력치 서술은 건너뛴다)
      if (!RECIPE_JOIN_RE.test(s.slice(parts[0].end, parts[1].start))) return
      if (!RECIPE_MARK_RE.test(s.slice(sp.start, stop + 4))) return
      checked++
      const want = [...RECIPES[sp.name]].sort().join('+')
      const got = parts.map((p) => p.name).sort().join('+')
      if (want !== got) {
        errors.push({
          text: s,
          item: sp.name,
          expected: `${sp.name} = ${RECIPES[sp.name].join(' + ')}`,
          actual: `${sp.name} = ${parts.map((p) => p.name).join(' + ')}`,
          wrong: s.slice(parts[0].start, parts[1].end),
          right: RECIPES[sp.name].join(' + '),
        })
      }
    })
  }
  return { errors, checked }
}

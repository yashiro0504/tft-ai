/**
 * 덱 플레이북 (2026-10-29 지시문 4) — 덱 클러스터와 같은 보드·같은 스냅샷으로 덱별 정석 수치를 계산해 deck_playbook 에 저장한다.
 *
 * 원칙
 *  - 모든 수치는 tftlab 매치 보드에서 계산한다. 외부 가이드 사이트 글·표는 수집·저장·번역하지 않는다 (링크는 lib/playbookLinks.json 의 URL 만).
 *  - Riot TFT 매치 API 에는 라운드별 레벨·골드·배치가 없다 → 레벨은 최종 level 과 탈락 last_round 로만 본다. 배치·라운드 타이밍 팁은 만들지 않는다.
 *  - 메타 페이지(stat_comp)와 같은 snapshot_id 로 저장한다 — 플레이북 sample_n·BIS 가 메타 페이지 덱과 어긋나지 않게.
 *  - 팁 문장은 LLM 이 필드 JSON 만 보고 쓰고, 근거 검증(lib/grounding)을 통과한 문장만 남긴다. 3개 미만이면 tips 를 비운다.
 *
 * 생성 범위: 덱 표본 300판+ 전체 · 100~299판 core_units·carry_bis 만 · 100판 미만 생성 안 함.
 * 수치 단위: 비율은 정수 %(…_pct), 평균등수는 소수 둘째 자리 — 팁·리포트에 나오는 숫자가 저장값과 글자 그대로 같게.
 */
require('../_ts')
const { buildRows } = require('./builds')
const { norm, statKey, champInfo, itemInfo, traitInfo, isRealUnit } = require('../buildDecksFromBoards')
const { formatTftRound } = require('../../lib/summarize')
const { collectFactNumbers, extractClaims } = require('../../lib/grounding')
const LINKS = require('../../lib/playbookLinks.json')

const PLAYBOOK_FULL_MIN = 300
const PLAYBOOK_PARTIAL_MIN = 100
const CORE_USAGE = 0.8
const FLEX_MIN_USAGE = 0.3
const FLEX_SIDE_MIN = 50
const AUGMENT_MIN = 30
const TRAIT_TIER_MIN = 20
const TIPS_MIN = 3
const TIPS_MAX = 5
/** 2: 생존 편향 보정(adjusted_delta) · 팁 말투 '~하세요' (2026-10-30 2차 지시문 4·6-4) — 이전 버전 팁은 앱이 읽지 않는다 (lib/playbook PLAYBOOK_TIPS_MIN_VERSION) */
const PLAYBOOK_VERSION = 2
/** 탈락 구간별 비교에서 한쪽 구간 표본 하한 — 이보다 적으면 그 구간은 뺀다 */
const STRATUM_MIN = 10
const PLACEMENT_SD = 2.29

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
const avg2 = (sum, n) => (n ? Math.round((sum / n) * 100) / 100 : null)
const placeAvg = (boards) => avg2(boards.reduce((s, b) => s + b.placement, 0), boards.length)

/** 보드에서 덱 기물 키(norm) → 그 기물 (소환물 제외, 같은 기물 2개면 별 높은 쪽) */
function unitMap(board) {
  const m = new Map()
  for (const u of board.units || []) {
    const k = norm(u.id)
    if (!isRealUnit(k)) continue
    const prev = m.get(k)
    if (!prev || (u.star || 1) > (prev.star || 1)) m.set(k, u)
  }
  return m
}

/** 탈락 구간 (last_round 기준) — 4스테이지 이하 / 5스테이지 / 6스테이지 이상 */
function stratumOf(b) {
  const stage = Number(String(formatTftRound(b.last_round || 0)).split('-')[0])
  if (!Number.isFinite(stage) || stage <= 4) return 'le4'
  return stage === 5 ? 's5' : 'ge6'
}

/**
 * 생존 편향 보정 차이 (2026-10-30 2차 지시문 4) — 오래 산 판일수록 기물·시너지 단계가 많이 모이므로 "있을 때 − 없을 때" 평균등수 차이를
 * 그대로 쓰면 기물의 효과가 아니라 '일찍 탈락한 판에 없었다'는 사실이 섞인다. 같은 탈락 구간끼리 차이를 내고 판수로 가중 평균한다.
 * 한쪽이라도 구간 표본이 STRATUM_MIN 미만이면 그 구간은 뺀다. 남는 구간이 없으면 null.
 * adjusted_delta < 0 = 이 쪽(a)이 같은 스테이지까지 산 판끼리 비교해 평균등수가 낮다(좋다). adjusted_se = 표준오차.
 */
function stratifiedDelta(a, b) {
  const groups = new Map()
  for (const [side, list] of [['a', a], ['b', b]]) {
    for (const x of list) {
      const k = stratumOf(x)
      const g = groups.get(k) || { a: [], b: [] }
      g[side].push(x.placement)
      groups.set(k, g)
    }
  }
  let wSum = 0
  let dSum = 0
  let varSum = 0
  for (const g of groups.values()) {
    if (g.a.length < STRATUM_MIN || g.b.length < STRATUM_MIN) continue
    const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length
    const w = g.a.length + g.b.length
    wSum += w
    dSum += w * (mean(g.a) - mean(g.b))
    varSum += w * w * PLACEMENT_SD * PLACEMENT_SD * (1 / g.a.length + 1 / g.b.length)
  }
  if (!wSum) return null
  const r2 = (x) => Math.round(x * 100) / 100
  return { adjusted_delta: r2(dSum / wSum), adjusted_se: r2(Math.sqrt(varSum) / wSum), adjusted_n: wSum }
}

/** 보정 후 차이가 표준오차보다 큰가 (아니면 '효과가 뚜렷하지 않음' — 팁을 만들지 않는다) */
const isClear = (x) => Boolean(x) && x.adjusted_delta != null && Math.abs(x.adjusted_delta) > x.adjusted_se

/** 메타 덱 snapshot_id — 메타 페이지(lib/tftStats getMetaDeckSnapshot)와 같은 규칙 (lib/playbook snapshotIdOf) */
function snapshotIdOf(patch, tierMin, updatedAt) {
  const t = typeof updatedAt === 'number' ? updatedAt : Date.parse(updatedAt)
  return `${patch}|${String(tierMin).toUpperCase()}|${Number.isFinite(t) ? t : 0}`
}

/**
 * 덱 1개의 플레이북 수치.
 * @param deck buildDecks 의 deck (toDeck 결과)
 * @param members 이 덱으로 묶인 보드 [{ match_id, placement, level, last_round, units: [{ id, star, items }], traits: [{ id, units, style }], augments? }]
 * @param deckOfBoard (match_id, placement) → 그 보드가 묶인 덱 id (같은 로비 경쟁자 수)
 */
function computePlaybook(deck, members, { deckOfBoard = () => null } = {}) {
  const n = members.length
  const full = n >= PLAYBOOK_FULL_MIN
  const maps = members.map(unitMap)
  const top = members.filter((b) => b.placement <= 4)
  const bottom = members.filter((b) => b.placement > 4)
  const idOf = new Map()
  const count = new Map()
  maps.forEach((m) =>
    m.forEach((u, k) => {
      count.set(k, (count.get(k) || 0) + 1)
      if (!idOf.has(k)) idOf.set(k, u.id)
    })
  )
  const unitInfo = (k) => {
    const info = champInfo(idOf.get(k))
    return { key: statKey(idOf.get(k)), name: info.name, cost: info.cost }
  }
  const indexOf = new Map(members.map((b, i) => [b, i]))
  const starRate = (k, boards, star) => {
    const idx = boards.map((b) => indexOf.get(b))
    const has = idx.filter((i) => maps[i].has(k))
    return { n: has.length, pct: pct(has.filter((i) => (maps[i].get(k).star || 1) >= star).length, has.length) }
  }

  // core_units: 보드의 80% 이상에 들어가는 기물 + ★2/★3 비율
  const coreKeys = [...count.entries()].filter(([, c]) => c / n >= CORE_USAGE).sort((a, b) => b[1] - a[1]).map(([k]) => k)
  const core_units = coreKeys.map((k) => {
    const has = maps.filter((m) => m.has(k))
    return {
      ...unitInfo(k),
      usage_pct: pct(has.length, n),
      star2_pct: pct(has.filter((m) => (m.get(k).star || 1) === 2).length, has.length),
      star3_pct: pct(has.filter((m) => (m.get(k).star || 1) >= 3).length, has.length),
      star_avg: avg2(has.reduce((s, m) => s + (m.get(k).star || 1), 0), has.length),
    }
  })

  // carry_bis: 메타 덱에서 아이템을 드는 기물(= 메타 페이지 덱 카드의 아이템 3개) + 그 기물의 3개 세트 상위 3 (기존 BIS 로직 buildRows)
  const builds = buildRows(members, { minGames: 5, maxPerUnit: 3 })
  const carry_bis = (deck.units || [])
    .filter((u) => (u.items || []).length)
    .map((u) => {
      const k = u.lolchessKey || norm(u.matchedKey)
      // 이 기물을 든 판 중 세트를 그대로 든 판 vs 다른 아이템을 든 판 — 탈락 구간별 보정 차이
      const setKey = (items) => [...(items || [])].filter(Boolean).sort().join(',')
      const carried = members.map((b, i) => ({ b, key: maps[i].has(k) ? setKey(maps[i].get(k).items) : null })).filter((x) => x.key !== null)
      const sets = builds
        .filter((r) => norm(r.unit) === k)
        .slice(0, 3)
        .map((r) => {
          const key = r.items.join(',')
          const withSet = carried.filter((x) => x.key === key).map((x) => x.b)
          const others = carried.filter((x) => x.key !== key).map((x) => x.b)
          return { items: r.items.map((id) => itemInfo(id).name), games: r.games, avg: avg2(r.placement_sum, r.games), ...(stratifiedDelta(withSet, others) || {}) }
        })
      return { key: u.matchedKey, name: u.name, items: u.items.map((it) => it.name), sets }
    })

  const out = {
    deck_key: deck.id,
    deck_name: deck.name,
    sample_n: n,
    avg: placeAvg(members),
    scope: full ? 'full' : 'partial',
    core_units,
    carry_bis,
    three_star: null,
    flex_units: null,
    traits: null,
    level_profile: null,
    elim_profile: null,
    contested: null,
    augments: null,
  }
  if (!full) return out

  // three_star: 핵심 기물 ★3 달성률 TOP4 vs 5~8등 (★3 이 한 번이라도 나온 기물만, TOP4 달성률 높은 순 3개)
  out.three_star = coreKeys
    .map((k) => {
      const t = starRate(k, top, 3)
      const b = starRate(k, bottom, 3)
      return { ...unitInfo(k), top4_pct: t.pct, bottom_pct: b.pct, top4_n: t.n, bottom_n: b.n }
    })
    .filter((x) => x.top4_pct > 0 || x.bottom_pct > 0)
    .sort((a, b) => b.top4_pct - a.top4_pct)
    .slice(0, 3)

  // flex_units: 등장률 30~79%, 있을 때/없을 때 평균등수 (양쪽 50판 이상)
  out.flex_units = [...count.entries()]
    .filter(([, c]) => c / n >= FLEX_MIN_USAGE && c / n < CORE_USAGE)
    .map(([k, c]) => {
      const withB = members.filter((_, i) => maps[i].has(k))
      const without = members.filter((_, i) => !maps[i].has(k))
      if (withB.length < FLEX_SIDE_MIN || without.length < FLEX_SIDE_MIN) return null
      const w = placeAvg(withB)
      const wo = placeAvg(without)
      // with_avg·without_avg·diff 는 단순 비교(내부 참고용) — 화면·팁·리포트는 adjusted_delta 만 쓴다
      return {
        ...unitInfo(k),
        usage_pct: pct(c, n),
        with_avg: w,
        without_avg: wo,
        diff: Math.round((w - wo) * 100) / 100,
        with_n: withB.length,
        without_n: without.length,
        ...(stratifiedDelta(withB, without) || { adjusted_delta: null, adjusted_se: null, adjusted_n: 0 }),
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.adjusted_delta ?? 9) - (b.adjusted_delta ?? 9))

  // traits: 자주 쓰는 시너지(켜진 보드 수 순 4개) × 인원별 보드 비율 · 평균등수 (20판 이상)
  const traitBoards = new Map()
  members.forEach((b) => {
    for (const t of b.traits || []) {
      if (!(t.style > 0)) continue
      const name = traitInfo(t.id).name
      const byCount = traitBoards.get(name) || new Map()
      const list = byCount.get(t.units) || []
      list.push(b)
      byCount.set(t.units, list)
      traitBoards.set(name, byCount)
    }
  })
  out.traits = [...traitBoards.entries()]
    .map(([name, byCount]) => ({ name, boards: [...byCount.values()].reduce((s, l) => s + l.length, 0), byCount }))
    .sort((a, b) => b.boards - a.boards)
    .slice(0, 4)
    .map(({ name, boards, byCount }) => ({
      name,
      active_pct: pct(boards, n),
      // 인원별 평균(avg)은 단순 집계(내부 참고용) — 바로 아래 인원과의 차이는 탈락 구간별 보정값(adjusted_delta)
      tiers: [...byCount.entries()]
        .filter(([, l]) => l.length >= TRAIT_TIER_MIN)
        .sort((a, b) => a[0] - b[0])
        .map(([units, l], i, arr) => ({
          units,
          pct: pct(l.length, n),
          avg: placeAvg(l),
          n: l.length,
          ...(i > 0 ? { vs_units: arr[i - 1][0], ...(stratifiedDelta(l, arr[i - 1][1]) || { adjusted_delta: null, adjusted_se: null }) } : {}),
        })),
    }))

  // level_profile: TOP4 최종 레벨 분포 + 덱 유형 (리롤: ★3 기물 코스트 / 빌드업: Lv.8 이상 비율)
  const levelDist = (boards) => {
    const m = {}
    for (const b of boards) if (b.level) m[b.level] = (m[b.level] || 0) + 1
    return Object.fromEntries(Object.entries(m).sort((a, b) => Number(a[0]) - Number(b[0])).map(([lv, c]) => [lv, pct(c, boards.length)]))
  }
  const reroll = (out.three_star || []).filter((x) => (x.cost || 9) <= 3 && x.top4_pct >= 40)
  out.level_profile = {
    top4_n: top.length,
    top4_level_pct: levelDist(top),
    deck_type: reroll.length ? 'reroll' : 'buildup',
    reroll_costs: [...new Set(reroll.map((x) => x.cost))].sort(),
    top4_lv8plus_pct: pct(top.filter((b) => b.level >= 8).length, top.length),
  }

  // elim_profile: 5~8등의 탈락 라운드 분포(상위 5개)와 라운드별 탈락 레벨 분포
  const byStage = new Map()
  for (const b of bottom) {
    const stage = formatTftRound(b.last_round || 0)
    const list = byStage.get(stage) || []
    list.push(b)
    byStage.set(stage, list)
  }
  out.elim_profile = {
    bottom_n: bottom.length,
    level_pct: levelDist(bottom),
    stages: [...byStage.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5)
      .map(([stage, l]) => ({ stage, pct: pct(l.length, bottom.length), n: l.length, lv7minus_pct: pct(l.filter((b) => b.level <= 7).length, l.length) })),
  }

  // contested: 같은 로비에 같은 덱이 2명 이상일 때 vs 1명일 때
  const solo = []
  const shared = []
  for (const b of members) {
    const others = (b.lobby || []).filter((o) => o.placement !== b.placement && deckOfBoard(b.match_id, o.placement) === deck.id).length
    ;(others > 0 ? shared : solo).push(b)
  }
  out.contested = { solo_n: solo.length, solo_avg: placeAvg(solo), contested_n: shared.length, contested_avg: placeAvg(shared) }

  // augments: 보드에 증강이 있을 때만 (지금 DB 보드에는 없다 → null)
  const withAug = members.filter((b) => Array.isArray(b.augments) && b.augments.length)
  if (withAug.length) {
    const aug = new Map()
    for (const b of withAug) for (const a of new Set(b.augments)) aug.set(a, [...(aug.get(a) || []), b])
    out.augments = [...aug.entries()]
      .filter(([, l]) => l.length >= AUGMENT_MIN)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 8)
      .map(([name, l]) => ({ name, pick_pct: pct(l.length, withAug.length), avg: placeAvg(l), n: l.length }))
  }
  return out
}

/** 팁 프롬프트·근거 검증 대상 필드 (tips·external_links·식별자 제외) */
const TIP_FIELDS = ['core_units', 'carry_bis', 'three_star', 'flex_units', 'traits', 'level_profile', 'elim_profile', 'contested', 'augments']

/**
 * 팁 프롬프트·근거 검증에 쓰는 필드 값. 평균등수 비교(flex_units · traits · carry_bis 세트)는 생존 편향 보정값만 남기고,
 * 보정 후 차이가 표준오차 이내인 항목은 뺀다 — 단순 비교값(7.33 같은)이 팁 근거가 되지 않게 (2026-10-30 2차 지시문 4-2·4-3).
 * 보정 차이는 크기(adjusted_gap, 양수)로도 준다 — "약 N등 차이" 문장의 숫자를 검증할 수 있게.
 */
function tipFacts(pb) {
  const gap = (x) => ({ adjusted_delta: x.adjusted_delta, adjusted_gap: Math.abs(x.adjusted_delta), adjusted_se: x.adjusted_se })
  const view = {
    ...pb,
    flex_units: pb.flex_units ? pb.flex_units.filter(isClear).map((f) => ({ name: f.name, usage_pct: f.usage_pct, ...gap(f) })) : null,
    traits: pb.traits
      ? pb.traits.map((t) => ({
          name: t.name,
          active_pct: t.active_pct,
          tiers: t.tiers.map((x) => ({ units: x.units, pct: x.pct, n: x.n, ...(x.vs_units != null && isClear(x) ? { vs_units: x.vs_units, ...gap(x) } : {}) })),
        }))
      : null,
    carry_bis: (pb.carry_bis || []).map((c) => ({
      name: c.name,
      items: c.items,
      sets: (c.sets || []).map((x) => ({ items: x.items, games: x.games, ...(isClear(x) ? gap(x) : {}) })),
    })),
  }
  return Object.fromEntries(TIP_FIELDS.filter((k) => view[k] != null).map((k) => [k, view[k]]))
}

/** 금지: 배치 조언 · 라운드별 운영 타이밍 · 아이템 조합식 (조합식은 아이템 DB 에서 따로 붙인다) */
const BANNED_TIP_RE = [
  /배치|자리|위치|앞줄|뒷줄|코너|구석|포지션/,
  /\d-\d\s*(?:까지|전에|이전에|부터|에\s*(?:레벨|리롤|올리|올려|사|모아))|타이밍|라운드(?:에|마다|별)/,
  /\+|=|조합식|조합법|재료/,
  // 생존 편향이 섞인 단순 비교 형식 — "있으면 X등, 없으면 Y등" (2026-10-30 2차 지시문 4-4)
  /있으면[^!?\n]{0,30}없으면|있을\s*때[^!?\n]{0,30}없을\s*때|넣으면[^!?\n]{0,30}빼면/,
]
/** 팁 말투 — 리포트("~하세요")와 같게 (2026-10-30 2차 지시문 6-4) */
const TIP_ENDING_RE = /세요[.!]?$/

/**
 * 팁 근거 검증 — 기존 근거 검증기(lib/grounding)로 팁의 숫자를 evidence 필드 값과 대조한다 (반올림 허용).
 * 통과: 숫자 1개 이상 · 모든 수치 주장이 evidence 필드에 있음 · evidence 가 실제 필드 · 금지 패턴 없음.
 */
function validateTip(tip, pb) {
  if (!tip || typeof tip.text !== 'string' || !Array.isArray(tip.evidence) || !tip.evidence.length) return { ok: false, reason: 'shape' }
  const text = tip.text.trim()
  if (BANNED_TIP_RE.some((re) => re.test(text))) return { ok: false, reason: 'banned' }
  if (!TIP_ENDING_RE.test(text)) return { ok: false, reason: 'ending' }
  const facts0 = tipFacts(pb)
  if (tip.evidence.some((k) => !TIP_FIELDS.includes(k) || facts0[k] == null)) return { ok: false, reason: 'evidence_field' }
  // 등수 구간·별·레벨 이름표(TOP4 · 5~8등 · ★3 · Lv.8)는 범주 이름이지 통계 수치가 아니다 — 지우고 남은 숫자만 대조한다
  const stats = text.replace(/TOP\s*4|(?<![\d.])[1-8]\s*~\s*[1-8]\s*등|(?<![\d.])[1-8]등\s*(?:플레이어)?(?=\s|$|[,.·])|★\s*[1-3]|Lv\.?\s*\d{1,2}/gi, ' ')
  const claims = extractClaims(stats)
  const numbers = stats.match(/\d+(?:\.\d+)?/g) || []
  if (!numbers.length) return { ok: false, reason: 'no_number' }
  const facts = collectFactNumbers(JSON.stringify(tip.evidence.map((k) => facts0[k])))
  const plain = numbers.map((x) => String(Math.round(Number(x) * 100) / 100))
  const missing = [...claims.map((c) => String(Math.round(Number(c.match(/\d+(?:\.\d+)?/)[0]) * 100) / 100)), ...plain].filter((x) => !facts.has(x))
  if (missing.length) return { ok: false, reason: `unsupported:${missing.join(',')}` }
  return { ok: true }
}

function tipPrompt(pb) {
  return `너는 TFT 덱 데이터 분석가다. 아래 JSON 은 tftlab 이 KR 마스터+ 랭크 판에서 계산한 "${pb.deck_name}" 덱(${pb.sample_n}판)의 수치다.
이 JSON 만 근거로 이 덱을 잘 굴리는 팁 ${TIPS_MIN}~${TIPS_MAX}개를 한국어 한 문장씩 써라.

규칙
- 팁마다 JSON 에 있는 숫자를 1개 이상 그대로 인용하라 (비율은 %, 평균등수는 소수 둘째 자리). JSON 에 없는 숫자는 쓰지 마라.
- 팁마다 근거 필드 키 배열 evidence 를 붙여라 (예: ["three_star", "level_profile"]). 인용한 숫자는 모두 evidence 필드 안에 있어야 한다.
- 배치(자리·위치) 조언, 라운드별 운영 타이밍(몇 라운드까지 레벨 등), 아이템 조합식(A + B)은 쓰지 마라. 라운드별 레벨·골드·배치 기록은 데이터에 없다.
- 레벨은 최종 레벨(level_profile)과 탈락 라운드(elim_profile)로만 이야기하라.
- 기물·시너지·아이템 세트의 평균등수 차이는 adjusted_gap(같은 스테이지까지 산 판끼리 비교한 차이)만 써라.
  형식: "같은 스테이지까지 산 판끼리 비교하면 약 N등 차이". "있으면 X등, 없으면 Y등"처럼 두 평균을 나란히 쓰지 마라.
- 문장은 "~하세요"로 끝내라 (예: "…을 우선하세요").

출력: {"tips":[{"text":"...","evidence":["..."]}]} JSON 만.

${JSON.stringify(tipFacts(pb))}`
}

async function callTipLlm(prompt, { fetchImpl = fetch, apiKey = process.env.DEEPSEEK_API_KEY } = {}) {
  if (!apiKey) return null
  const res = await fetchImpl(`${process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.PLAYBOOK_TIP_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 900,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!res.ok) throw new Error(`DeepSeek ${res.status}`)
  const data = await res.json()
  return JSON.parse(data?.choices?.[0]?.message?.content || '{}')
}

/** 팁 생성 + 검증. 남은 팁이 3개 미만이면 [] (화면에는 수치만) */
async function generateTips(pb, { llm = callTipLlm, log = console } = {}) {
  if (pb.scope !== 'full') return { tips: [], rejected: [] }
  let raw
  try {
    raw = await llm(tipPrompt(pb))
  } catch (e) {
    log.warn?.(`  플레이북 팁 생성 실패 (${pb.deck_name}): ${e.message}`)
    return { tips: [], rejected: [] }
  }
  const tips = []
  const rejected = []
  for (const t of (raw?.tips || []).slice(0, TIPS_MAX + 2)) {
    const v = validateTip(t, pb)
    if (v.ok && tips.length < TIPS_MAX) tips.push({ text: t.text.trim(), evidence: t.evidence })
    else rejected.push({ text: t?.text, reason: v.reason || 'over_max' })
  }
  return { tips: tips.length >= TIPS_MIN ? tips : [], rejected }
}

/** 외부 링크: 수동 매핑(lib/playbookLinks.json)의 source·url 만. 덱 단위(패치 무관) — 세트가 바뀌면 다시 매핑 */
function externalLinks(deckKey) {
  const list = (LINKS.decks && LINKS.decks[deckKey]) || []
  return list.filter((l) => l && typeof l.source === 'string' && /^https:\/\//.test(l.url || '')).map((l) => ({ source: l.source, url: l.url }))
}

/**
 * 스냅샷 1개의 플레이북 행들.
 * @param decks buildDecks(...).decks — [{ deck, members }]
 */
async function buildPlaybookRows(decks, { patch, snapshotId, llm, log = console } = {}) {
  // (match_id, placement) → 덱 id · 같은 판 보드 목록 (로비 경쟁자)
  const deckOf = new Map()
  const lobbies = new Map()
  for (const { deck, members } of decks) {
    for (const b of members || []) {
      deckOf.set(`${b.match_id}|${b.placement}`, deck.id)
      const l = lobbies.get(b.match_id) || []
      l.push({ placement: b.placement })
      lobbies.set(b.match_id, l)
    }
  }
  const rows = []
  for (const { deck, members } of decks) {
    if (!members || members.length < PLAYBOOK_PARTIAL_MIN) continue
    const withLobby = members.map((b) => ({ ...b, lobby: lobbies.get(b.match_id) || [] }))
    const pb = computePlaybook(deck, withLobby, { deckOfBoard: (m, p) => deckOf.get(`${m}|${p}`) ?? null })
    const { tips, rejected } = await generateTips(pb, { llm, log })
    if (rejected.length) log.log?.(`  플레이북 ${deck.name}: 팁 ${tips.length}개 저장 · ${rejected.length}개 버림 (${rejected.map((r) => r.reason).join(', ')})`)
    rows.push({ ...pb, patch, snapshot_id: snapshotId, tips, external_links: externalLinks(deck.id), version: PLAYBOOK_VERSION })
  }
  return rows
}

module.exports = {
  PLAYBOOK_FULL_MIN,
  PLAYBOOK_PARTIAL_MIN,
  TIP_FIELDS,
  computePlaybook,
  validateTip,
  generateTips,
  buildPlaybookRows,
  externalLinks,
  snapshotIdOf,
  tipPrompt,
  tipFacts,
  stratifiedDelta,
  PLAYBOOK_VERSION,
}

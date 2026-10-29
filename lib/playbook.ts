import type { DeckComparison, DeckComparisonRow, SlimMatchData } from './types'
import { entitySlug } from './entitySlug'
import { mostSimilarDeck, type DeckFact } from './comparisonFacts'

/**
 * 덱 플레이북 (2026-10-29 지시문 4) — 읽기·비교 쪽. 계산·저장은 scripts/collect/playbook.js (수집기 배치).
 *
 * - 메타 페이지와 같은 스냅샷(snapshot_id)의 플레이북을 고른다. 새 패치 표본이 300판 미만이면 이전 패치 플레이북을 라벨과 함께 쓴다.
 * - AI 리포트 "이 덱의 정석과 비교"는 코드가 계산한 비교표 행으로만 만든다 (LLM 에게 계산을 맡기지 않는다).
 *   항목 문장도 코드가 비교표 행에서 그대로 만들어, 리포트 수치가 플레이북 값과 글자 그대로 같다.
 */

export const PLAYBOOK_FULL_MIN = 300
export const PLAYBOOK_PARTIAL_MIN = 100
export const DECK_COMPARISON_MAX = 3
export const DECK_COMPARISON_SKIPPED = '표본 부족으로 덱 기준 비교 생략'

export interface PlaybookUnit {
  key: string
  name: string
  cost?: number | null
}
export interface DeckPlaybook {
  patch: string
  tier_min?: string
  deck_key: string
  deck_name: string
  snapshot_id: string
  sample_n: number
  avg: number | null
  scope: 'full' | 'partial'
  core_units: (PlaybookUnit & { usage_pct: number; star2_pct: number; star3_pct: number; star_avg: number | null })[]
  carry_bis: { key: string; name: string; items: string[]; sets: { items: string[]; games: number; avg: number | null }[] }[]
  three_star: (PlaybookUnit & { top4_pct: number; bottom_pct: number; top4_n: number; bottom_n: number })[] | null
  flex_units: (PlaybookUnit & { usage_pct: number; with_avg: number; without_avg: number; diff: number; with_n: number; without_n: number })[] | null
  traits: { name: string; active_pct: number; tiers: { units: number; pct: number; avg: number | null; n: number }[] }[] | null
  level_profile: { top4_n: number; top4_level_pct: Record<string, number>; deck_type: 'reroll' | 'buildup'; reroll_costs: number[]; top4_lv8plus_pct: number } | null
  elim_profile: { bottom_n: number; level_pct: Record<string, number>; stages: { stage: string; pct: number; n: number; lv7minus_pct: number }[] } | null
  contested: { solo_n: number; solo_avg: number | null; contested_n: number; contested_avg: number | null } | null
  augments: { name: string; pick_pct: number; avg: number | null; n: number }[] | null
  tips: { text: string; evidence: string[] }[]
  external_links: { source: string; url: string }[]
}

/** 메타 덱 snapshot_id — scripts/collect/playbook.js snapshotIdOf 와 같은 규칙 ('{patch}|{TIER}|{updated_at epoch ms}') */
export function snapshotIdOf(patch: string, tierMin: string, updatedAt: string | number | undefined | null): string {
  const t = typeof updatedAt === 'number' ? updatedAt : Date.parse(String(updatedAt ?? ''))
  return `${patch}|${String(tierMin).toUpperCase()}|${Number.isFinite(t) ? t : 0}`
}

/** 패치 내림차순 비교 ('16.21' > '16.9') */
function patchNum(p: string): number {
  const m = /^(\d+)\.(\d+)$/.exec(p)
  return m ? Number(m[1]) * 1000 + Number(m[2]) : -1
}

/**
 * 쓸 플레이북 고르기.
 * 1. 지금 메타 스냅샷과 같은 snapshot_id 행이 300판 이상이면 그것.
 * 2. 아니면(새 패치 표본 300판 미만) 더 이전 패치의 300판 이상 행 + "이전 패치(16.21) 기준" 라벨.
 * 3. 그것도 없으면 지금 스냅샷 행(100~299판, core_units·carry_bis 만).
 * 지금 스냅샷과 다른 같은 패치 행(갱신 사이 오래된 행)은 쓰지 않는다 — 메타 페이지와 수치가 어긋나지 않게.
 */
export function choosePlaybook(rows: DeckPlaybook[], current: { snapshotId: string; patch: string } | null): { playbook: DeckPlaybook; label?: string } | null {
  if (!current) return null
  const now = rows.find((r) => r.snapshot_id === current.snapshotId)
  if (now && now.sample_n >= PLAYBOOK_FULL_MIN) return { playbook: now }
  const older = rows
    .filter((r) => patchNum(r.patch) >= 0 && patchNum(r.patch) < patchNum(current.patch) && r.sample_n >= PLAYBOOK_FULL_MIN)
    .sort((a, b) => patchNum(b.patch) - patchNum(a.patch))[0]
  if (older) return { playbook: older, label: `이전 패치(${older.patch}) 기준` }
  if (now && now.sample_n >= PLAYBOOK_PARTIAL_MIN) return { playbook: now }
  return null
}

const slug = (k: string) => entitySlug('champion', k)
const f2 = (n: number | null | undefined) => (n == null ? '-' : n.toFixed(2))

/**
 * 비교표 — 경기 1판 × 플레이북 (코드 계산). 행마다 문장(text)과 우선순위(severity: 클수록 먼저, 0 = 정석대로).
 * @param competitors 같은 로비에서 같은 덱으로 판정된 상대 수
 */
export function comparePlaybook(m: SlimMatchData, pb: DeckPlaybook, competitors = 0): DeckComparisonRow[] {
  const rows: DeckComparisonRow[] = []
  const mine = new Map(m.units.map((u) => [slug(u.id), u]))

  // 1) 코어 기물 누락 · 핵심 기물 별 수 vs 덱 평균
  const core = pb.core_units || []
  if (core.length) {
    const missing = core.filter((u) => !mine.has(slug(u.key)))
    const starGap = core
      .filter((u) => mine.has(slug(u.key)) && u.star_avg != null)
      .map((u) => ({ u, mine: mine.get(slug(u.key))!.tier || 1 }))
      .filter((x) => x.mine < Math.round(x.u.star_avg as number))
      .sort((a, b) => (b.u.star_avg as number) - b.mine - ((a.u.star_avg as number) - a.mine))[0]
    if (missing.length) {
      rows.push({
        id: 'core_units',
        severity: 3,
        text: `코어 기물 ${core.length}개 중 ${missing.length}개가 없었습니다 (${missing.map((u) => `${u.name}: 이 덱 보드의 ${u.usage_pct}%가 채용`).join(', ')})`,
      })
    } else if (starGap) {
      rows.push({
        id: 'core_units',
        severity: 2,
        text: `${starGap.u.name} ★${starGap.mine} — 이 덱의 ${starGap.u.name} 평균 ★${f2(starGap.u.star_avg)} (★2 ${starGap.u.star2_pct}% · ★3 ${starGap.u.star3_pct}%)`,
      })
    } else {
      rows.push({ id: 'core_units', severity: 0, text: `코어 기물 ${core.length}개를 모두 썼고 별 수도 이 덱 평균 이상입니다` })
    }
  }

  // 2) 캐리 아이템 vs BIS (일치 개수 · 그 BIS 세트 평균등수)
  for (const c of pb.carry_bis || []) {
    const u = mine.get(slug(c.key))
    if (!u || !c.items.length) continue
    const hit = c.items.filter((it) => u.items.includes(it)).length
    const set = c.sets?.[0]
    const setText = set ? ` · BIS 세트(${set.items.join('·')}) 평균 ${f2(set.avg)}등 · ${set.games}판` : ''
    rows.push({
      id: 'carry_bis',
      severity: hit >= Math.min(3, c.items.length) ? 0 : 3 - hit,
      text: `${c.name} 아이템이 이 덱 BIS ${c.items.length}개(${c.items.join('·')}) 중 ${hit}개 일치${setText}`,
    })
    break
  }
  if (pb.scope !== 'full') return rows

  // 3) 최종 레벨·탈락 라운드 vs level_profile·elim_profile
  if (m.placement > 4 && pb.elim_profile) {
    const st = pb.elim_profile.stages.find((s) => s.stage === m.lastRound)
    if (st) {
      rows.push({
        id: 'elim_profile',
        severity: m.level <= 7 && st.lv7minus_pct < 50 ? 2 : 1,
        text: `같은 덱 5~8등 중 ${st.stage} 탈락 ${st.pct}% · 그중 Lv.7 이하 ${st.lv7minus_pct}% — 이번 판은 ${st.stage} 탈락 Lv.${m.level}`,
      })
    }
  } else if (m.placement <= 4 && pb.level_profile) {
    const lp = pb.level_profile
    const share = lp.top4_level_pct[String(m.level)] ?? 0
    rows.push({
      id: 'level_profile',
      severity: lp.deck_type === 'buildup' && m.level < 8 && lp.top4_lv8plus_pct >= 50 ? 1 : 0,
      text:
        lp.deck_type === 'reroll'
          ? `리롤 덱(★3 ${lp.reroll_costs.join('·')}코) — TOP4 최종 Lv.${m.level} 비율 ${share}%`
          : `빌드업 덱 — TOP4의 ${lp.top4_lv8plus_pct}%가 최종 Lv.8 이상, 이번 판 Lv.${m.level}`,
    })
  }

  // 4) 평균등수를 깎는 대체 기물을 썼는지 (있을 때 − 없을 때 평균등수 > 0)
  const bad = (pb.flex_units || []).filter((f) => f.diff > 0 && mine.has(slug(f.key))).sort((a, b) => b.diff - a.diff)[0]
  if (bad) {
    rows.push({
      id: 'flex_units',
      severity: 2,
      text: `${bad.name}를 썼습니다 — 이 덱에서 ${bad.name}가 있을 때 평균 ${f2(bad.with_avg)}등(${bad.with_n}판) · 없을 때 ${f2(bad.without_avg)}등(${bad.without_n}판)`,
    })
  }

  // 5) 같은 로비 같은 덱 경쟁자 수 vs contested 성적
  const ct = pb.contested
  if (ct && ct.contested_n > 0 && ct.solo_n > 0) {
    rows.push({
      id: 'contested',
      severity: competitors > 0 && (ct.contested_avg ?? 0) > (ct.solo_avg ?? 0) ? 2 : 0,
      text:
        competitors > 0
          ? `같은 로비에 같은 덱 ${competitors}명 — 이 덱은 경쟁자가 있을 때 평균 ${f2(ct.contested_avg)}등(${ct.contested_n}판) · 혼자일 때 ${f2(ct.solo_avg)}등(${ct.solo_n}판)`
          : `같은 로비에 같은 덱 없음 — 이 덱은 혼자일 때 평균 ${f2(ct.solo_avg)}등(${ct.solo_n}판) · 경쟁자가 있을 때 ${f2(ct.contested_avg)}등(${ct.contested_n}판)`,
    })
  }
  return rows
}

/** 같은 로비에서 이 덱으로 판정된 상대 수 (덱 판정은 덱 성적표·AI 비교와 같은 mostSimilarDeck) */
export function sameDeckCompetitors(m: SlimMatchData, deckName: string, decks: DeckFact[]): number {
  return (m.lobbyParticipants || []).filter((p) => !p.isUser && mostSimilarDeck(p, decks)?.deck.name === deckName).length
}

/**
 * 리포트 "이 덱의 정석과 비교" 섹션. 항목은 비교표 행 최대 3개(문제 큰 순, 같으면 표 순서).
 * 덱 표본이 100판 미만(플레이북 없음)이면 섹션 대신 한 줄(skipped).
 */
export function buildDeckComparison(
  m: SlimMatchData,
  deck: { id?: string; name: string; sampleSize: number },
  chosen: { playbook: DeckPlaybook; label?: string } | null,
  competitors = 0
): DeckComparison {
  if (!chosen || deck.sampleSize < PLAYBOOK_PARTIAL_MIN) return { deckName: deck.name, sample: deck.sampleSize, items: [], skipped: DECK_COMPARISON_SKIPPED }
  const pb = chosen.playbook
  const rows = comparePlaybook(m, pb, competitors)
  const order = new Map(rows.map((r, i) => [r, i]))
  const items = [...rows].sort((a, b) => b.severity - a.severity || order.get(a)! - order.get(b)!).slice(0, DECK_COMPARISON_MAX)
  return {
    deckName: pb.deck_name,
    sample: pb.sample_n,
    patch: pb.patch,
    snapshotId: pb.snapshot_id,
    label: chosen.label,
    items,
    rows,
    tips: pb.tips?.map((t) => t.text) ?? [],
    externalLinks: (pb.external_links || []).filter((l) => /^https:\/\//.test(l.url)).map((l) => ({ source: l.source, url: l.url })),
  }
}

/** 프롬프트 블록 — 비교표 전체 (코드 산출, 근거 검증 사실에 플레이북 수치가 들어가게) */
export function deckComparisonFacts(c: DeckComparison | null | undefined): string {
  if (!c) return ''
  if (c.skipped) return `[이 덱의 정석과 비교 — 코드 산출]\n- ${c.deckName}: ${c.skipped} (덱 표본 ${c.sample}판)`
  return [
    `[이 덱의 정석과 비교 — 코드 산출, tftlab ${c.deckName} ${c.sample}판 플레이북${c.label ? ` · ${c.label}` : ''}]`,
    ...(c.rows ?? c.items).map((r) => `- ${r.text}`),
    '※ 이 비교표는 리포트에 코드가 그대로 붙인다. 본문에서 인용할 때도 수치를 바꾸지 말고, 원인으로 단정하지 마라.',
  ].join('\n')
}

import { cache } from 'react'
import { GAME_CHAMPIONS, findChampion, findTrait, type GameChampion } from './gameData'
import { buildMetaPayload } from './metaPayload'
import { getDeckViews } from './decks'
import { getDecks, getStats } from './tftStats'
import { DEFAULT_FILTER, MIN_SAMPLE, filterLabel, placementMargin, type StatSource, type TierFilter } from './statsShared'
import { entitySlug, type EntityKind } from './entitySlug'
import type {
  MetaChampRanking,
  MetaComboRanking,
  MetaDeckRanking,
  MetaItemRanking,
  MetaTraitRanking,
} from './types'

/**
 * 기물·아이템·시너지 상세 페이지 데이터 (서버 전용).
 *
 * - 통계는 메타 대시보드와 같은 소스: DB 집계(최신 패치 · 마스터+ · 7일) → 없으면 빌드 타임 JSON.
 * - 기물 ↔ 시너지 연결은 게임 기준 DB(lib/gameData)에서 읽는다. 통계 키·덱 데이터 키·한글명 어느 쪽으로도 찾는다.
 */

const traitNameOf = (id: string) => findTrait(id)?.name ?? id
/** 시너지 페이지: 이 기물이 해당 시너지에 속하는가 */
const champHasTrait = (c: GameChampion, name: string, slug: string) =>
  c.traits.some((id) => traitNameOf(id) === name || entitySlug('trait', id) === slug)

export interface EntityStat {
  avgPlacement: number
  top4Rate: number
  sampleSize: number
  margin: number | null
  lowSample: boolean
  winRate?: number
  pickRate?: number
  /** 같은 종류 안 순위 (표본 충분한 항목 기준, 1부터) */
  rank: number | null
  rankOf: number
}

export interface EntityLink {
  kind: EntityKind
  slug: string
  name: string
  img: string
  /** 보조 표시 (예: '2.85위 · 120판') */
  stat?: { avgPlacement: number; top4Rate: number; sampleSize: number; lowSample: boolean }
  note?: string
}

export interface EntityDeck {
  id: string
  name: string
  tier?: string
  avgPlacement: number | null
  top4Rate: number | null
  sampleSize: number
  /** /deck/[id] 로 열 수 있는 덱 (JSON 정적 덱 · DB 덱은 patch/tier 쿼리로 해석) */
  linkable: boolean
  /** Supabase stat_comp 집계 덱 */
  fromDb: boolean
  /** DB 덱의 패치·티어 필터 (덱 페이지가 같은 집계 덱을 열도록 링크에 싣는다) */
  patch?: string
  tierMin?: TierFilter
  /** 덱 페이지 경로 (DB 덱은 ?patch=&tier= 포함) */
  href: string
}

export interface EntityPageData {
  kind: EntityKind
  slug: string
  key: string
  name: string
  img: string
  /** 기물 코스트 / 아이템 분류 등 */
  badge?: string
  stat: EntityStat | null
  source: StatSource
  filterText: string
  minSample: number
  /** 기물: BIS 아이템 · 아이템: 잘 쓰는 기물 · 시너지: 소속 기물 */
  related: EntityLink[]
  relatedTitle: string
  /** 기물: 소속 시너지 */
  tags: EntityLink[]
  decks: EntityDeck[]
}

type Row = { key: string; name: string; avgPlacement: number; top4Rate: number; sampleSize: number; lowSample?: boolean; margin?: number | null; winRate?: number; pickRate?: number }

function toStat(row: Row, all: Row[]): EntityStat {
  const ranked = all.filter((r) => !r.lowSample).sort((a, b) => a.avgPlacement - b.avgPlacement)
  const idx = ranked.findIndex((r) => r.key === row.key)
  return {
    avgPlacement: row.avgPlacement,
    top4Rate: row.top4Rate,
    sampleSize: row.sampleSize,
    margin: row.margin ?? placementMargin(row.sampleSize),
    lowSample: Boolean(row.lowSample),
    winRate: row.winRate,
    pickRate: row.pickRate,
    rank: idx >= 0 ? idx + 1 : null,
    rankOf: ranked.length,
  }
}

const statOf = (r: { avgPlacement: number; top4Rate: number; sampleSize: number; lowSample?: boolean }) => ({
  avgPlacement: r.avgPlacement,
  top4Rate: r.top4Rate,
  sampleSize: r.sampleSize,
  lowSample: Boolean(r.lowSample),
})

/** 표본 충분 → 평균등수 낮은 순, 통계 없는 항목은 맨 뒤 */
const byAvg = <T extends { avgPlacement: number | null; lowSample?: boolean }>(a: T, b: T) =>
  Number(Boolean(a.lowSample)) - Number(Boolean(b.lowSample)) || (a.avgPlacement ?? 99) - (b.avgPlacement ?? 99)

/** 대시보드와 같은 기본 필터로 기물·아이템·시너지·조합·덱을 한 번에 (요청 단위 캐시) */
const loadAll = cache(async () => {
  const [units, items, traits, combos, decks] = await Promise.all([
    getStats('unit', DEFAULT_FILTER),
    getStats('item', DEFAULT_FILTER),
    getStats('trait', DEFAULT_FILTER),
    getStats('unit_item', DEFAULT_FILTER),
    getDecks({ patch: DEFAULT_FILTER.patch, tier: DEFAULT_FILTER.tier }),
  ])
  const source: StatSource = units.source
  const filterText =
    source === 'db' && units.filter
      ? filterLabel(units.filter)
      : `${units.patch ? units.patch.replace(/^set(\d+)$/i, '세트 $1').replace(/^(\d+\.\d+)$/, '패치 $1') : '최근'} 래더 표본 스냅샷`
  return {
    source,
    filterText,
    units: units.rows as (MetaChampRanking & Row)[],
    items: items.rows as (MetaItemRanking & Row)[],
    traits: traits.rows as (MetaTraitRanking & Row)[],
    combos: combos.rows as (MetaComboRanking & Row)[],
    decks: decks.decks as (MetaDeckRanking & { lowSample?: boolean })[],
    deckSource: decks.source,
    deckFilter: decks.filter,
    minSample: { unit: units.minSample, item: items.minSample, trait: traits.minSample, combo: combos.minSample },
  }
})

const linkableDeckIds = cache(() => new Set(getDeckViews().map((d) => d.id)))

function deckLinks(
  {
    decks,
    deckSource,
    deckFilter,
  }: { decks: (MetaDeckRanking & { lowSample?: boolean })[]; deckSource: StatSource; deckFilter: { patch: string; tier: TierFilter } | null },
  match: (d: MetaDeckRanking) => boolean
): EntityDeck[] {
  const ids = linkableDeckIds()
  const fromDb = deckSource === 'db' && Boolean(deckFilter)
  const query = fromDb && deckFilter ? `?patch=${deckFilter.patch}&tier=${deckFilter.tier}` : ''
  return decks
    .filter(match)
    .sort(byAvg)
    .slice(0, 6)
    .map((d) => ({
      id: d.id,
      name: d.name,
      tier: d.tier,
      avgPlacement: d.avgPlacement,
      top4Rate: d.top4Rate,
      sampleSize: d.sampleSize,
      // DB 덱은 /deck/[id]?patch=&tier= 가 stat_comp 에서 같은 덱을 연다 (UI 스프린트 S1)
      linkable: fromDb || ids.has(d.id),
      fromDb,
      patch: fromDb ? deckFilter?.patch : undefined,
      tierMin: fromDb ? deckFilter?.tier : undefined,
      href: `/deck/${d.id}${query}`,
    }))
}

async function championPage(slug: string): Promise<EntityPageData | null> {
  const all = await loadAll()
  const row = all.units.find((r) => entitySlug('champion', r.key) === slug)
  const ct = findChampion(row ? row.name : slug)
  if (!row && !ct) return null
  const name = row?.name ?? ct!.name
  const cost = row?.cost ?? ct?.cost

  const bis = all.combos
    .filter((c) => entitySlug('champion', c.champKey) === slug)
    .sort(byAvg)
    .slice(0, 8)
    .map((c): EntityLink => ({
      kind: 'item',
      slug: entitySlug('item', c.itemKey),
      name: c.itemName,
      img: c.itemIconUrl,
      stat: statOf(c),
    }))

  const traitKeyByName = new Map(all.traits.map((t) => [t.name, t]))
  const tags = (ct?.traits ?? []).map((id): EntityLink => {
    const tName = traitNameOf(id)
    const t = traitKeyByName.get(tName)
    return {
      kind: 'trait',
      slug: t ? entitySlug('trait', t.key) : entitySlug('trait', id),
      name: tName,
      img: t?.iconUrl ?? findTrait(id)?.icon ?? '',
    }
  })

  return {
    kind: 'champion',
    slug,
    key: row?.key ?? slug,
    name,
    img: row?.imgUrl ?? ct?.icon ?? '',
    badge: cost ? `${cost}코스트` : undefined,
    stat: row ? toStat(row, all.units) : null,
    source: all.source,
    filterText: all.filterText,
    minSample: all.minSample.unit,
    related: bis,
    relatedTitle: '추천 아이템 (평균등수 순)',
    tags,
    decks: deckLinks(all, (d) => d.units.some((u) => entitySlug('champion', u.key) === slug || u.name === name)),
  }
}

async function itemPage(slug: string): Promise<EntityPageData | null> {
  const all = await loadAll()
  const row = all.items.find((r) => entitySlug('item', r.key) === slug)
  const combos = all.combos.filter((c) => entitySlug('item', c.itemKey) === slug)
  if (!row && !combos.length) return null
  const name = row?.name ?? combos[0].itemName
  const img = row?.iconUrl ?? combos[0].itemIconUrl

  const holders = combos
    .sort(byAvg)
    .slice(0, 8)
    .map((c): EntityLink => ({
      kind: 'champion',
      slug: entitySlug('champion', c.champKey),
      name: c.champName,
      img: c.champImgUrl,
      stat: statOf(c),
    }))

  const kindLabel = /emblem/i.test(row?.key ?? '') ? '상징' : /radiant/i.test(row?.key ?? '') ? '찬란한 아이템' : /artifact/i.test(row?.key ?? '') ? '유물' : undefined

  return {
    kind: 'item',
    slug,
    key: row?.key ?? slug,
    name,
    img,
    badge: kindLabel,
    stat: row ? toStat(row, all.items) : null,
    source: all.source,
    filterText: all.filterText,
    minSample: all.minSample.item,
    related: holders,
    relatedTitle: '이 아이템을 잘 쓰는 기물',
    tags: [],
    decks: deckLinks(all, (d) => d.units.some((u) => (u.items ?? []).some((it) => entitySlug('item', it.key) === slug))),
  }
}

async function traitPage(slug: string): Promise<EntityPageData | null> {
  const all = await loadAll()
  // 덱 데이터는 롤체지지 이름('eldritch'), 통계는 Riot 이름('blackthorn')을 써서 같은 시너지가 두 슬러그를 가진다.
  // 옛 키·영문명으로 들어오면 게임 기준 DB 별칭으로 통계 행을 찾고, 페이지 슬러그(canonical)는 통계 쪽으로 맞춘다.
  const alias = findTrait(slug)
  const row =
    all.traits.find((r) => entitySlug('trait', r.key) === slug) ??
    (alias ? all.traits.find((r) => r.name === alias.name) : undefined)
  const trait = row ? findTrait(row.name) : alias
  if (!row && !trait) return null
  const name = row?.name ?? trait!.name
  slug = row ? entitySlug('trait', row.key) : slug

  const unitByName = new Map(all.units.map((u) => [u.name, u]))
  // 형태 변형(럭스 (검은 가시) 등)은 본체로 뽑는 기물이라 목록에서 뺀다
  const members = GAME_CHAMPIONS.filter((c) => !c.variantOf && champHasTrait(c, name, slug))
    .map((c): EntityLink => {
      const u = unitByName.get(c.name)
      return {
        kind: 'champion',
        slug: u ? entitySlug('champion', u.key) : entitySlug('champion', c.name),
        name: c.name,
        img: u?.imgUrl ?? c.icon,
        stat: u ? statOf(u) : undefined,
        note: `${c.cost}코`,
      }
    })
    .sort((a, b) => Number(a.note?.[0] ?? 0) - Number(b.note?.[0] ?? 0) || a.name.localeCompare(b.name, 'ko'))

  return {
    kind: 'trait',
    slug,
    key: row?.key ?? slug,
    name,
    img: row?.iconUrl ?? trait?.icon ?? '',
    badge: members.length ? `기물 ${members.length}명` : undefined,
    stat: row ? toStat(row, all.traits) : null,
    source: all.source,
    filterText: all.filterText,
    minSample: all.minSample.trait,
    related: members,
    relatedTitle: '이 시너지의 기물 (코스트 순)',
    tags: [],
    decks: deckLinks(all, (d) => d.traits.some((t) => entitySlug('trait', t.key) === slug || t.name === name)),
  }
}

/** Next.js 가 이미 디코딩한 params 에 '%' 가 남아 있으면 decodeURIComponent 가 URIError 를 던진다 → 원문 그대로 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export const getEntityPage = cache(async (kind: EntityKind, slug: string): Promise<EntityPageData | null> => {
  const s = safeDecode(slug).toLowerCase()
  if (!/^[a-z0-9]{1,60}$/.test(s)) return null
  if (kind === 'champion') return championPage(s)
  if (kind === 'item') return itemPage(s)
  return traitPage(s)
})

/** 빌드 타임 정적 경로 · 사이트맵용 (JSON 스냅샷 기준, 표본 충분한 항목만) */
export function listEntitySlugs(kind: EntityKind): string[] {
  const p = buildMetaPayload()
  const rows =
    kind === 'champion'
      ? p.champions.filter((r) => r.sampleSize >= MIN_SAMPLE.unit).map((r) => r.key)
      : kind === 'item'
        ? p.items.filter((r) => r.sampleSize >= MIN_SAMPLE.item).map((r) => r.key)
        : p.traits.filter((r) => r.sampleSize >= MIN_SAMPLE.trait).map((r) => r.key)
  return [...new Set(rows.map((k) => entitySlug(kind, k)))].filter((s) => /^[a-z0-9]{1,60}$/.test(s))
}

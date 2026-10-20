import { cache } from 'react'
import championTraits from './championTraits.json'
import { buildMetaPayload } from './metaPayload'
import { getDeckViews } from './decks'
import { getDecks, getStats } from './tftStats'
import { DEFAULT_FILTER, MIN_SAMPLE, filterLabel, placementMargin, type StatSource } from './statsShared'
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
 * - 기물 ↔ 시너지 연결은 lib/championTraits.json 의 **한글 이름**으로 맞춘다.
 *   (통계 키는 'DA_AluneUniqueTrait18', 기물 데이터는 'attuned' 처럼 내부 이름이 서로 달라 이름이 유일한 공통 키다)
 */

interface CtChampion {
  name: string
  cost: number
  imgUrl: string
  traits: string[]
}
const CT = championTraits as unknown as {
  champions: Record<string, CtChampion>
  traits: Record<string, { name: string; iconUrl: string }>
}
const CT_CHAMPS = Object.values(CT.champions)
/** 기물 데이터의 시너지 id 는 대소문자가 섞여 있다 ('Executioner' ↔ traits.executioner) */
const ctTrait = (id: string) => CT.traits[id] ?? CT.traits[id.toLowerCase()]
const traitNameOf = (id: string) => ctTrait(id)?.name ?? id
/** 시너지 페이지: 이 기물이 해당 시너지에 속하는가 (이름이 소스마다 달라 슬러그도 함께 비교 — 예: 라이벌/경쟁자) */
const champHasTrait = (c: CtChampion, name: string, slug: string) =>
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
  /** /deck/[id] 정적 페이지가 있는 덱만 링크 */
  linkable: boolean
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
    minSample: { unit: units.minSample, item: items.minSample, trait: traits.minSample, combo: combos.minSample },
  }
})

const linkableDeckIds = cache(() => new Set(getDeckViews().map((d) => d.id)))

function deckLinks(decks: (MetaDeckRanking & { lowSample?: boolean })[], match: (d: MetaDeckRanking) => boolean): EntityDeck[] {
  const ids = linkableDeckIds()
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
      linkable: ids.has(d.id),
    }))
}

function ctChampionByName(name: string): CtChampion | undefined {
  return CT_CHAMPS.find((c) => c.name === name)
}

async function championPage(slug: string): Promise<EntityPageData | null> {
  const all = await loadAll()
  const row = all.units.find((r) => entitySlug('champion', r.key) === slug)
  const ct = row ? ctChampionByName(row.name) : CT.champions[slug]
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
      img: t?.iconUrl ?? ctTrait(id)?.iconUrl ?? '',
    }
  })

  return {
    kind: 'champion',
    slug,
    key: row?.key ?? slug,
    name,
    img: row?.imgUrl ?? ct?.imgUrl ?? '',
    badge: cost ? `${cost}코스트` : undefined,
    stat: row ? toStat(row, all.units) : null,
    source: all.source,
    filterText: all.filterText,
    minSample: all.minSample.unit,
    related: bis,
    relatedTitle: '추천 아이템 (평균등수 순)',
    tags,
    decks: deckLinks(all.decks, (d) => d.units.some((u) => entitySlug('champion', u.key) === slug || u.name === name)),
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
    decks: deckLinks(all.decks, (d) => d.units.some((u) => (u.items ?? []).some((it) => entitySlug('item', it.key) === slug))),
  }
}

async function traitPage(slug: string): Promise<EntityPageData | null> {
  const all = await loadAll()
  // 덱 데이터는 롤체지지 이름('eldritch'), 통계는 Riot 이름('blackthorn')을 써서 같은 시너지가 두 슬러그를 가진다.
  // 기물 데이터의 시너지 id 로 들어오면 한글 이름으로 통계 행을 찾고, 페이지 슬러그(canonical)는 통계 쪽으로 맞춘다.
  const aliasId = Object.keys(CT.traits).find((id) => id === slug)
  const row =
    all.traits.find((r) => entitySlug('trait', r.key) === slug) ??
    (aliasId ? all.traits.find((r) => r.name === CT.traits[aliasId].name) : undefined)
  const ctId = row ? Object.keys(CT.traits).find((id) => CT.traits[id].name === row.name) : aliasId
  if (!row && !ctId) return null
  const name = row?.name ?? traitNameOf(ctId!)
  slug = row ? entitySlug('trait', row.key) : slug

  const unitByName = new Map(all.units.map((u) => [u.name, u]))
  const members = CT_CHAMPS.filter((c) => champHasTrait(c, name, slug))
    .map((c): EntityLink => {
      const u = unitByName.get(c.name)
      return {
        kind: 'champion',
        slug: u ? entitySlug('champion', u.key) : entitySlug('champion', c.name),
        name: c.name,
        img: u?.imgUrl ?? c.imgUrl,
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
    img: row?.iconUrl ?? (ctId ? CT.traits[ctId].iconUrl : ''),
    badge: members.length ? `기물 ${members.length}명` : undefined,
    stat: row ? toStat(row, all.traits) : null,
    source: all.source,
    filterText: all.filterText,
    minSample: all.minSample.trait,
    related: members,
    relatedTitle: '이 시너지의 기물 (코스트 순)',
    tags: [],
    decks: deckLinks(all.decks, (d) => d.traits.some((t) => entitySlug('trait', t.key) === slug || t.name === name)),
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

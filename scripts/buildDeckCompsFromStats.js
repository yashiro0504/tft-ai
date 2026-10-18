/**
 * Riot 실측 통계 → 추천 덱 프리뷰 생성기
 *
 * 목적:
 *  - 현재 lib/decksData.json 은 외부 사이트(롤체지지) 추천 덱을 정규화한 데이터다.
 *  - 상업화 전에는 "우리 표본"으로 덱을 구성해야 한다.
 *  - 이 스크립트는 라이브 파일을 건드리지 않고 lib/decksData.preview.json 만 생성한다.
 *
 * 데이터 소스:
 *  - lib/metaStats.json      : Riot 래더 표본 집계(기물/아이템/조합)
 *  - lib/tftData.json        : 이름/아이콘(Data Dragon)
 *  - lib/championTraits.json : 기물→시너지 "사실 관계" 매핑 (큐레이션 덱 미사용)
 *
 * 사용법:
 *  node scripts/buildDeckCompsFromStats.js            # lib/decksData.preview.json
 *  node scripts/buildDeckCompsFromStats.js --write    # lib/decksData.json (라이브 교체)
 *  MIN_CARRY_SAMPLE=150 MAX_DECKS=20 node scripts/buildDeckCompsFromStats.js
 */
const fs = require('fs')
const path = require('path')

const stats = require('../lib/metaStats.json')
const tftData = require('../lib/tftData.json')
const reference = require('../lib/championTraits.json')

const WRITE_LIVE = process.argv.includes('--write') || process.env.WRITE_LIVE === '1'

const MIN_CARRY_SAMPLE = Number(process.env.MIN_CARRY_SAMPLE || 200)
const MIN_ITEM_SAMPLE = Number(process.env.MIN_ITEM_SAMPLE || 20)
const MIN_UNIT_SAMPLE = Number(process.env.MIN_UNIT_SAMPLE || 50)
const MAX_DECKS = Number(process.env.MAX_DECKS || 24)
const UNITS_PER_DECK = Number(process.env.UNITS_PER_DECK || 8)

const r2 = (x) => Math.round(x * 100) / 100

/** 세트 접두사/접미사 제거 (constants.ts normalizeTftId 와 동일한 목적) */
function norm(id) {
  return String(id || '')
    .replace(/^TFT\d*_/i, '')
    .replace(/^DA_\d*_/i, '')
    .replace(/^DA_/i, '')
    .replace(/^TFTTutorial_/i, '')
    .replace(/_Base$/i, '')
    .replace(/Base$/i, '')
    .replace(/_(AP|AD)$/i, '')
    .replace(/\d+$/i, '')
    .toLowerCase()
}

const champMap = tftData.champMap || {}
const traitMap = tftData.traitMap || {}
const itemMap = tftData.itemMap || {}

/** 정규화 키 → 메타 엔트리 역인덱스 (DA_18_/TFT18_ 등 접두사 흡수) */
function buildLookup(map) {
  const lookup = new Map()
  for (const [key, value] of Object.entries(map || {})) {
    const normalized = norm(key)
    if (normalized && !lookup.has(normalized)) lookup.set(normalized, value)
  }
  return lookup
}

/** championTraits 의 시너지 한글명/아이콘 (DDragon 에 없는 시너지 보완용) */
function buildTraitRefMap() {
  const map = new Map()
  for (const [key, entry] of Object.entries(reference.traits || {})) {
    if (key && !map.has(key)) map.set(key, { name: entry.name, iconUrl: entry.iconUrl })
  }
  return map
}

const champLookup = buildLookup(champMap)
const traitLookup = buildLookup(traitMap)
const itemLookup = buildLookup(itemMap)
const traitRefMap = buildTraitRefMap()

function champMeta(key) {
  return champLookup.get(norm(key)) || champMap[key] || null
}

function traitMeta(key) {
  return traitLookup.get(norm(key)) || traitMap[key] || traitRefMap.get(norm(key)) || null
}

function itemMeta(key) {
  return itemLookup.get(norm(key)) || itemMap[key] || null
}

/** 기물 → 시너지/코스트 참조 맵 (championTraits 의 사실 관계만 사용) */
function buildReferenceMap() {
  const map = new Map()
  for (const [key, entry] of Object.entries(reference.champions || {})) {
    if (!key) continue
    map.set(key, {
      key,
      name: entry.name || champMeta(key)?.name || key,
      cost: entry.cost ?? null,
      imgUrl: champMeta(key)?.iconUrl || entry.imgUrl || '',
      traits: new Set(entry.traits || []),
    })
  }
  return map
}

/** metaStats champions 를 참조 맵과 결합 */
function buildChampionPool(refMap) {
  const pool = []
  for (const [rawKey, stat] of Object.entries(stats.champions || {})) {
    if (!stat || typeof stat.avgPlacement !== 'number') continue
    if ((stat.sampleSize || 0) < MIN_UNIT_SAMPLE) continue

    const key = norm(rawKey)
    const ref = refMap.get(key)
    const meta = champMeta(rawKey) || champMeta(key)

    pool.push({
      key,
      rawKey,
      name: meta?.name || ref?.name || rawKey,
      imgUrl: meta?.iconUrl || ref?.imgUrl || '',
      cost: typeof ref?.cost === 'number' ? ref.cost : null,
      traits: [...(ref?.traits || [])],
      avgPlacement: stat.avgPlacement,
      top4Rate: stat.top4Rate || 0,
      sampleSize: stat.sampleSize || 0,
      threeStarRate: stat.threeStarRate || 0,
      avgTier: stat.avgTier || 1,
    })
  }
  return pool.sort((a, b) => a.avgPlacement - b.avgPlacement)
}

/** 기물별 BIS 아이템 (조합 통계에서 상위 3개) */
function buildBisMap() {
  const map = new Map()
  for (const [key, stat] of Object.entries(stats.combos || {})) {
    const sep = key.indexOf('|')
    if (sep <= 0) continue
    if (!stat || typeof stat.avgPlacement !== 'number') continue
    if ((stat.sampleSize || 0) < MIN_ITEM_SAMPLE) continue

    const carryKey = norm(key.slice(0, sep))
    const itemKey = key.slice(sep + 1)
    // 상징(엠블럼)은 BIS 코어템이 아니므로 제외
    if (/emblem/i.test(itemKey)) continue
    const list = map.get(carryKey) || []
    list.push({
      itemKey,
      avgPlacement: stat.avgPlacement,
      top4Rate: stat.top4Rate || 0,
      sampleSize: stat.sampleSize || 0,
    })
    map.set(carryKey, list)
  }
  for (const list of map.values()) list.sort((a, b) => a.avgPlacement - b.avgPlacement)
  return map
}

function traitCounts(units) {
  const counts = new Map()
  for (const unit of units) {
    for (const trait of unit.traits) counts.set(trait, (counts.get(trait) || 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
}

function tierFromAvgPlacement(avg) {
  if (avg <= 3.95) return 'S'
  if (avg <= 4.15) return 'A'
  if (avg <= 4.4) return 'B'
  if (avg <= 4.65) return 'C'
  return 'D'
}

function buildDeck(carry, pool, bisMap) {
  const shared = (unit) => unit.traits.filter((trait) => carry.traits.includes(trait)).length

  const mates = pool
    .filter((unit) => unit.key !== carry.key)
    .map((unit) => ({ unit, shared: shared(unit) }))
    .sort((a, b) => {
      if (b.shared !== a.shared) return b.shared - a.shared
      return a.unit.avgPlacement - b.unit.avgPlacement
    })
    .slice(0, Math.max(0, UNITS_PER_DECK - 1))
    .map((entry) => entry.unit)

  const members = [carry, ...mates]
  const traits = traitCounts(members)
    .slice(0, 4)
    .map(([trait, count]) => {
      const meta = traitMeta(trait)
      return { key: trait, name: meta?.name || trait, iconUrl: meta?.iconUrl || '', count }
    })

  const primaryFromTraits =
    traits.find((trait) => carry.traits.includes(trait.key)) || traits[0] || null
  const primary =
    primaryFromTraits ||
    (carry.traits[0]
      ? { key: carry.traits[0], name: traitMeta(carry.traits[0])?.name || carry.traits[0] }
      : null)

  const bis = (bisMap.get(carry.key) || [])
    .filter((entry) => itemMeta(entry.itemKey))
    .slice(0, 3)
    .map((entry) => {
    const meta = itemMeta(entry.itemKey)
    return {
      key: entry.itemKey,
      name: meta?.name || norm(entry.itemKey),
      iconUrl: meta?.iconUrl || '',
      stat: {
        avgPlacement: entry.avgPlacement,
        top4Rate: entry.top4Rate,
        sampleSize: entry.sampleSize,
      },
    }
  })

  const units = members.map((unit) => ({
    lolchessKey: unit.key,
    name: unit.name,
    cost: unit.cost,
    star: unit.key === carry.key ? (unit.threeStarRate >= 0.15 ? 3 : 2) : 2,
    // 보드 좌표는 디자인/UX 확정 후 별도 규칙으로 채운다.
    index: null,
    imgUrl: unit.imgUrl,
    matchedKey: unit.rawKey,
    traits: unit.traits,
    items: unit.key === carry.key ? bis : [],
    stat: {
      avgPlacement: unit.avgPlacement,
      top4Rate: unit.top4Rate,
      sampleSize: unit.sampleSize,
    },
  }))

  const unitCost = units.reduce((sum, unit) => sum + (unit.cost || 0), 0)

  return {
    id: `auto-${carry.key}`,
    name: `${primary?.name || '메타'} ${carry.name}`,
    gold: null,
    unitCost,
    unitCount: units.length,
    traits,
    units,
    avgPlacement: carry.avgPlacement,
    top4Rate: carry.top4Rate,
    coverage: 1,
    sampleSize: carry.sampleSize,
    tier: tierFromAvgPlacement(carry.avgPlacement),
    carryKey: carry.rawKey,
  }
}

function main() {
  const refMap = buildReferenceMap()
  const pool = buildChampionPool(refMap)
  const bisMap = buildBisMap()

  const withTraits = pool.filter((unit) => unit.traits.length > 0)
  const carries = withTraits.filter(
    (unit) =>
      (unit.cost === null || (unit.cost >= 2 && unit.cost <= 5)) &&
      unit.sampleSize >= MIN_CARRY_SAMPLE
  )

  const decks = []
  const seen = new Set()

  for (const carry of carries) {
    if (decks.length >= MAX_DECKS) break
    const deck = buildDeck(carry, pool, bisMap)
    // 유닛 6개 미만이거나 활성 시너지가 2개 미만이면 덱으로 보기 어렵다.
    if (deck.units.length < 6 || deck.traits.length < 2) continue

    const signature = deck.units.map((unit) => unit.lolchessKey).sort().join(',')
    if (seen.has(signature)) continue
    seen.add(signature)
    decks.push(deck)
  }

  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'riot-meta-aggregate',
    sourceUrl: null,
    patch: stats.patch || 'unknown',
    traitReference: reference.source,
    deckCount: decks.length,
    unitMatchRate: pool.length ? r2(withTraits.length / pool.length) : 0,
    decks,
  }

  const outPath = path.join(
    __dirname,
    '..',
    'lib',
    WRITE_LIVE ? 'decksData.json' : 'decksData.preview.json'
  )
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8')

  console.log(`✅ ${WRITE_LIVE ? '라이브 교체' : '프리뷰 생성'} → ${outPath}`)
  console.log(`   후보 기물 ${pool.length}종 (시너지 매핑 ${withTraits.length}종) · 캐리 후보 ${carries.length}종`)
  console.log(`   생성 덱 ${decks.length}개 · 패치 ${output.patch}`)
  decks.slice(0, 5).forEach((deck) => {
    console.log(`   - ${deck.name} [${deck.tier}] 평균 ${deck.avgPlacement}위 · ${deck.units.length}유닛 · ${deck.unitCost}코`)
  })
  if (!WRITE_LIVE) {
    console.log('\n※ 라이브 데이터(lib/decksData.json)는 변경하지 않았습니다.')
  }
}

main()


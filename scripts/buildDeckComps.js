/**
 * 메타 사이트(롤체지지) 추천 덱 → lib/decksData.json 생성
 *
 * 롤체지지 메타 페이지의 SSR 데이터(__NEXT_DATA__)에서 추천 덱(유닛·성급·아이템)을
 * 추출해 보드 조합 데이터로 정규화한다. 아이콘/한글 이름은 사이트 참조 테이블을 쓰고,
 * 우리 메타 통계에 존재하는 기물은 우리 키/아이콘으로 치환한다.
 *
 * 사용법:
 *   node scripts/buildDeckComps.js
 *   META_API=http://localhost:3000/api/tft/meta node scripts/buildDeckComps.js
 *
 * 결과: lib/decksData.json (커밋 대상)
 */
const fs = require('fs')
const path = require('path')
const { loadEnv } = require('./_env')
loadEnv()

const SOURCE_URL = process.env.LOLCHESS_URL || 'https://lolchess.gg/meta?hl=ko'
const META_API = process.env.META_API || 'http://localhost:3000/api/tft/meta'
const OUT = path.join(__dirname, '..', 'lib', 'decksData.json')
require('./_ts')
const { findItem } = require('../lib/gameData')

/** lolchess 아이템 키/인게임 키 → 게임 기준 DB 아이콘 (실패 시 lolchess 아이콘) */
function resolveItemIcon(lolchessItem) {
  if (!lolchessItem) return ''
  const candidates = [lolchessItem.key, lolchessItem.ingameKey]
    .filter(Boolean)
    .flatMap((raw) => {
      const cleaned = String(raw)
        .replace(/^TFT\d*_Item_/i, '')
        .replace(/^DA_\d*_Item_/i, '')
        .replace(/^DA_Item_/i, '')
        .replace(/^DA_\d*_/i, '')
        .replace(/^DA_/i, '')
      return [raw, cleaned]
    })
  for (const cand of candidates) {
    const hit = findItem(cand)
    if (hit?.icon) return hit.icon
  }
  return lolchessItem.imageUrl || ''
}

/** 보드 구성이 아닌 요약/가이드 덱 제외 */
const SKIP_PATTERNS = ['요약', '사다리', '팀 구성']

const norm = (s) => String(s || '').replace(/\s|\(|\)|ㆍ|·/g, '').trim()

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.text()
}

function parseNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!m) throw new Error('__NEXT_DATA__ 를 찾지 못했습니다 (사이트 구조 변경?)')
  return JSON.parse(m[1])
}

/** 우리 메타 통계의 한글 기물명 → 키 매핑 (있으면 통계 연결 정확도↑) */
async function fetchOurChampions() {
  try {
    const res = await fetch(META_API)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const map = new Map()
    for (const c of json.champions || []) {
      map.set(norm(c.name), { key: c.key, imgUrl: c.imgUrl, cost: c.cost })
    }
    console.log(`  우리 메타 기물 ${map.size}종 로드 (${META_API})`)
    return map
  } catch (e) {
    console.warn(`  ⚠ 메타 API 를 불러오지 못했습니다 (${e.message}) — 통계 연결 없이 진행`)
    return new Map()
  }
}

async function main() {
  console.log(`롤체지지 메타 페이지 수집: ${SOURCE_URL}`)
  const html = await fetchHtml(SOURCE_URL)
  const next = parseNextData(html)
  const queries = next.props?.pageProps?.dehydratedState?.queries || []

  const findData = (needle) => {
    const q = queries.find((x) => JSON.stringify(x.queryKey || '').includes(needle))
    return q?.state?.data
  }

  const champRefs = findData('championRefs')
  const traitRefs = findData('traitsRefs')
  const itemRefs = findData('itemRefs')
  const guideData = findData('getGuideDecks')
  if (!champRefs || !guideData) throw new Error('롤체지지 데이터 구조가 예상과 다릅니다.')

  const champByKey = new Map((champRefs.champions || []).map((c) => [c.key, c]))
  const traitByKey = new Map((traitRefs?.traits || []).map((t) => [t.key, t]))
  const itemByKey = new Map((itemRefs?.items || []).map((i) => [i.key, i]))
  console.log(
    `  참조: 기물 ${champByKey.size} · 시너지 ${traitByKey.size} · 아이템 ${itemByKey.size} · 추천덱 ${guideData.guideDecks.length}`
  )

  const ours = await fetchOurChampions()
  const patchMatch = html.match(/v(1[6-9]\.\d+[a-z]?)/i)
  const patch = patchMatch ? patchMatch[1] : null

  const decks = []
  const seen = new Set()

  for (const d of guideData.guideDecks) {
    const slots = d.data?.slots || []
    if (slots.length < 6) continue
    if (SKIP_PATTERNS.some((p) => String(d.name || '').includes(p))) continue

    // 유닛 중복 제거 (같은 기물 2슬롯은 1개로, 성급은 높은 값 유지)
    const unitMap = new Map()
    for (const s of slots) {
      if (!s?.champion) continue
      const prev = unitMap.get(s.champion)
      if (!prev) {
        unitMap.set(s.champion, {
          champion: s.champion,
          star: s.star || 1,
          items: s.items || [],
          index: typeof s.index === 'number' ? s.index : null,
        })
      } else {
        prev.star = Math.max(prev.star, s.star || 1)
        if ((prev.items || []).length === 0 && (s.items || []).length) prev.items = s.items
      }
    }

    const units = []
    for (const u of unitMap.values()) {
      const ref = champByKey.get(u.champion)
      const oursHit = ref ? ours.get(norm(ref.name)) : undefined
      const seenItems = new Set()
      const items = []
      for (const key of u.items || []) {
        if (!key || seenItems.has(key)) continue
        seenItems.add(key)
        if (items.length >= 3) break
        const ir = itemByKey.get(key)
        items.push({
          key,
          name: ir?.name || key,
          iconUrl: resolveItemIcon(ir),
        })
      }
      units.push({
        lolchessKey: u.champion,
        name: ref?.name || u.champion,
        cost: ref?.cost?.[0] ?? null,
        star: u.star,
        index: u.index,
        imgUrl: oursHit?.imgUrl || ref?.imageUrl || '',
        matchedKey: oursHit?.key || null,
        traits: (ref?.traits || []).slice(),
        items,
      })
    }
    if (units.length < 6) continue

    // 덱 시너지 집계 (2개 이상 겹치는 것만)
    const traitCounts = new Map()
    for (const u of units) for (const t of u.traits) traitCounts.set(t, (traitCounts.get(t) || 0) + 1)
    const traits = [...traitCounts.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([key, count]) => ({
        key,
        name: traitByKey.get(key)?.name || key,
        iconUrl: traitByKey.get(key)?.imageUrl || '',
        count,
      }))

    // 동일 기물 구성 덱 중복 제거
    const signature = units.map((u) => u.lolchessKey).sort().join('|')
    if (seen.has(signature)) continue
    seen.add(signature)

    decks.push({
      id: d.teamBuilderKey || `deck-${decks.length + 1}`,
      name: d.name,
      gold: d.cost ?? null,
      unitCost: units.reduce((s, u) => s + (u.cost || 0), 0),
      unitCount: units.length,
      traits,
      units,
    })
  }

  const totalUnits = decks.reduce((s, d) => s + d.units.length, 0)
  const matched = decks.reduce((s, d) => s + d.units.filter((u) => u.matchedKey).length, 0)
  const unknown = new Set()
  decks.forEach((d) => d.units.forEach((u) => !u.matchedKey && unknown.add(u.name)))

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'lolchess.gg 추천 메타 덱',
    sourceUrl: SOURCE_URL,
    patch,
    deckCount: decks.length,
    unitMatchRate: totalUnits ? Math.round((matched / totalUnits) * 100) : 0,
    decks,
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf-8')

  console.log(`\n✅ 저장 → ${OUT}`)
  console.log(`   덱 ${decks.length}개 · 유닛 ${totalUnits}개 (메타 통계 매칭 ${matched}개, ${out.unitMatchRate}%)`)
  if (unknown.size) console.log(`   미매칭 기물: ${[...unknown].join(', ')}`)
  decks.slice(0, 10).forEach((d) =>
    console.log(
      `   - ${d.name} (${d.unitCount}유닛/${d.unitCost}코) · ${d.traits.map((t) => `${t.name} ${t.count}`).join(', ')}`
    )
  )
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`)
  process.exit(1)
})

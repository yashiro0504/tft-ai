/**
 * 메타 통계 집계 스크립트 v2 (챔피언/시너지/아이템/조합 성적 포함)
 *
 * Riot 공식 API는 집계 통계를 제공하지 않으므로, 실제 매치 표본을 수집해 자체 집계한다.
 *
 * 수집 항목 (Riot API 제공 데이터 기준):
 *  - augments : 증강 통계 (⚠️ 세트 18 매치는 Riot이 미제공 → 빈 값 유지 가능)
 *  - champions: 챔피언(기물) 티어 — avgPlacement/top4Rate/avgTier/threeStarRate
 *  - traits   : 시너지 티어 — avgPlacement/top4Rate/avgTier
 *  - items    : 아이템 성적 — avgPlacement/top4Rate
 *  - combos   : 챔피언+아이템 조합(BIS 근거) — avgPlacement/top4Rate
 *
 * 사용법:
 *   RIOT_API_KEY=RGAPI-xxxx node scripts/buildMetaStats.js "닉네임#KR1" "닉네임2#KR1"
 *   또는: SEEDS="닉네임#KR1,닉네임2#KR1" node scripts/buildMetaStats.js
 *
 * 출력: lib/metaStats.json (version=2, source="riot-sample", sample=false)
 *
 * 환경변수:
 *  - MATCHES_PER_SEED(기본 20), SLEEP_MS(기본 1200), CONCURRENCY(기본 1)
 *  - MIN_SAMPLE(증강 기본 20), MIN_SAMPLE_CHAMP/TRAIT/ITEM(기본 10), MIN_SAMPLE_COMBO(기본 8)
 *  - ⚠️ Riot 개발 키는 24시간마다 만료됩니다. (장기 수집은 프로덕션 키 권장)
 */
const fs = require('fs')
const path = require('path')

const { loadEnv, getSeeds, printKeyHelp } = require('./_env')
loadEnv()

const RIOT_API_KEY = process.env.RIOT_API_KEY || ''
const REGION = process.env.RIOT_REGION || 'asia'
const CHECK_ONLY = process.argv.includes('--check')
const MATCHES_PER_SEED = Number(process.env.MATCHES_PER_SEED || 20)
const SLEEP_MS = Number(process.env.SLEEP_MS || 1200)
const MIN_SAMPLE = Number(process.env.MIN_SAMPLE || 20)
const MIN_SAMPLE_CHAMP = Number(process.env.MIN_SAMPLE_CHAMP || 10)
const MIN_SAMPLE_TRAIT = Number(process.env.MIN_SAMPLE_TRAIT || 10)
const MIN_SAMPLE_ITEM = Number(process.env.MIN_SAMPLE_ITEM || 10)
const MIN_SAMPLE_COMBO = Number(process.env.MIN_SAMPLE_COMBO || 8)
const CONCURRENCY = Number(process.env.CONCURRENCY || 1)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const r2 = (x) => Math.round(x * 100) / 100
const r3 = (x) => Math.round(x * 1000) / 1000

let lastRequestTime = 0

// 요청 간 최소 간격(ms). 래더 대량 수집 시 RIOT_MIN_INTERVAL_MS 로 낮춰 사용한다.
const MIN_INTERVAL = Number(process.env.RIOT_MIN_INTERVAL_MS || 1200)

async function riotGet(url) {
  const now = Date.now()
  const elapsed = now - lastRequestTime
  if (elapsed < MIN_INTERVAL) await sleep(MIN_INTERVAL - elapsed)

  for (let attempt = 0; attempt < 5; attempt++) {
    lastRequestTime = Date.now()
    const res = await fetch(url, { headers: { 'X-Riot-Token': RIOT_API_KEY } })
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after') || 2)
      console.warn(`  429 rate limit -> ${ra}s 대기`)
      await sleep((ra + 1) * 1000)
      continue
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Riot API ${res.status}: 키가 만료되었거나 무효합니다 (개발 키는 24시간마다 만료)`)
    }
    if (!res.ok) throw new Error(`Riot API ${res.status} ${res.statusText} :: ${url}`)
    return res.json()
  }
  throw new Error(`Riot API 재시도 초과 :: ${url}`)
}


async function getAccount(gameName, tagLine) {
  const u = `https://${REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  return riotGet(u)
}
async function getMatchIds(puuid, count) {
  return riotGet(`https://${REGION}.api.riotgames.com/tft/match/v1/matches/by-puuid/${puuid}/ids?count=${count}`)
}
async function getMatch(id) {
  return riotGet(`https://${REGION}.api.riotgames.com/tft/match/v1/matches/${id}`)
}

/** lib/summarize.ts cleanName() 과 동일한 정규화 (증강용) */
function cleanName(id) {
  if (!id) return ''
  return String(id)
    .replace(/^TFT\d*_/i, '')
    .replace(/^Item_/i, '')
    .replace(/Augment_/i, '')
    .replace(/_/g, ' ')
    .trim()
}

/** 증강 필드 후보 (Riot 스키마 변경 대응) */
const AUGMENT_FIELDS = ['augments', 'augment_names', 'augmentNames', 'augment']

/** 참가자 객체에서 증강 이름 배열을 최대한 방어적으로 추출한다. */
function extractAugmentNames(participant) {
  for (const field of AUGMENT_FIELDS) {
    const value = participant && participant[field]
    if (Array.isArray(value)) {
      return value
        .map((entry) => {
          if (typeof entry === 'string') return entry
          if (entry && typeof entry === 'object') return entry.name || entry.id || entry.augmentName || ''
          return ''
        })
        .filter(Boolean)
    }
    if (typeof value === 'string' && value) return [value]
  }
  return []
}

/** 참가자 객체에 증강 관련 필드가 존재하는지 */
function hasAugmentField(participant) {
  return AUGMENT_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(participant || {}, field)
  )
}

/**
 * 증강 수집 진단 문자열.
 * 0건일 때 "코드 미구현"인지 "Riot 데이터 부재"인지 구분하기 위한 로그.
 */
function describeAugmentDiagnostics(state) {
  const participants = state.augParticipants || 0
  const fieldPresent = state.augFieldPresent || 0
  const nonEmpty = state.augNonEmptyParticipants || 0
  const slots = state.augSlots || 0

  let hint = ''
  if (participants > 0 && fieldPresent === 0) {
    hint = 'Riot 응답에 증강 필드 자체가 없습니다. (스키마 변경 또는 해당 세트 미제공)'
  } else if (fieldPresent > 0 && nonEmpty === 0) {
    hint = '증강 필드는 있으나 값이 모두 비어 있습니다. (해당 세트 증강 미운영 가능성)'
  } else if (slots === 0) {
    hint = '증강 슬롯이 수집되지 않았습니다.'
  }

  return {
    text: `참가자 ${participants}명 · 필드 존재 ${fieldPresent}명 · 값 있음 ${nonEmpty}명 · 슬롯 ${slots}개`,
    hint,
  }
}

/** lib/constants.ts normalizeTftId() 와 동일한 기물 ID 정규화 */
function normalizeChampId(id) {
  if (!id) return ''
  return String(id)
    .replace(/^TFT\d*_/i, '')
    .replace(/^DA_\d*_/i, '')
    .replace(/^DA_/i, '')
    .replace(/^TFTTutorial_/i, '')
    .replace(/\d+$/i, '')
    .replace(/Small$/i, '')
    .trim()
}

/** 수집 상태 초기화 */
function createState() {
  return {
    aug: {},     // name      -> { games, placementSum, top4 }
    champs: {},  // normId    -> { games, placementSum, top4, tierSum, threeStar }
    traits: {},  // traitName -> { games, placementSum, top4, tierSum }
    items: {},   // item      -> { games, placementSum, top4 }
    combos: {},  // champ|item-> { games, placementSum, top4 }
    augSlots: 0,
    augParticipants: 0,
    augFieldPresent: 0,
    augNonEmptyParticipants: 0,
    patch: 'unknown',
  }
}

function bump(map, key, placement) {
  const e = (map[key] = map[key] || { games: 0, placementSum: 0, top4: 0 })
  e.games++
  e.placementSum += placement
  if (placement <= 4) e.top4++
}

/** 매치 1개에서 모든 통계 수집 (증강/기물/시너지/아이템/조합) */
function aggregateMatch(match, state) {
  if (match?.info?.tft_set_number) state.patch = `set${match.info.tft_set_number}`

  for (const p of match?.info?.participants || []) {
    const placement = p.placement

    // 1) 증강 — 필드명/값 형태가 달라도 추출하고, 진단 카운터를 함께 기록한다.
    state.augParticipants++
    if (hasAugmentField(p)) state.augFieldPresent++
    const augmentNames = extractAugmentNames(p)
    if (augmentNames.length > 0) state.augNonEmptyParticipants++
    for (const raw of augmentNames) {
      const name = cleanName(raw)
      if (!name) continue
      state.augSlots++
      bump(state.aug, name, placement)
    }

    // 2) 기물 + 아이템 + 조합(BIS 근거)
    for (const u of p.units || []) {
      const norm = normalizeChampId(u.character_id)
      if (!norm) continue
      const c = (state.champs[norm] = state.champs[norm] || {
        games: 0, placementSum: 0, top4: 0, tierSum: 0, threeStar: 0,
      })
      c.games++
      c.placementSum += placement
      if (placement <= 4) c.top4++
      c.tierSum += u.tier || 1
      if (u.tier === 3) c.threeStar++

      for (const item of u.itemNames || []) {
        if (!item) continue
        bump(state.items, item, placement)
        bump(state.combos, `${norm}|${item}`, placement)
      }
    }

    // 3) 시너지
    for (const t of p.traits || []) {
      if (!t.tier_current || t.tier_current <= 0) continue
      const tr = (state.traits[t.name] = state.traits[t.name] || {
        games: 0, placementSum: 0, top4: 0, tierSum: 0,
      })
      tr.games++
      tr.placementSum += placement
      if (placement <= 4) tr.top4++
      tr.tierSum += t.tier_current
    }
  }
}

/** 단일 소환사의 매치에서 통계 수집 */
async function collectSeed(seed, seen, state) {
  const [gameName, tagLine = 'KR1'] = seed.split('#')
  let account
  try {
    account = await getAccount(gameName, tagLine)
  } catch (e) {
    console.warn(`  skip ${seed}: ${e.message}`)
    return { newMatches: 0, error: e.message }
  }
  await sleep(SLEEP_MS)

  let ids = []
  try {
    ids = await getMatchIds(account.puuid, MATCHES_PER_SEED)
  } catch (e) {
    console.warn(`  matchIds ${seed}: ${e.message}`)
    return { newMatches: 0, error: e.message }
  }
  await sleep(SLEEP_MS)

  let newMatches = 0
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)

    let match
    try {
      match = await getMatch(id)
    } catch (e) {
      console.warn(`  match ${id}: ${e.message}`)
      continue
    }
    newMatches++
    aggregateMatch(match, state)
    await sleep(SLEEP_MS)
  }
  return { newMatches, error: null }
}

/** 내부 통계 맵 -> 출력 스탯 객체 */
function baseStats(e) {
  return {
    avgPlacement: r2(e.placementSum / e.games),
    top4Rate: r3(e.top4 / e.games),
    sampleSize: e.games,
  }
}

function buildOutput(state) {
  const augments = {}
  for (const [name, e] of Object.entries(state.aug)) {
    if (e.games < MIN_SAMPLE) continue
    augments[name] = {
      ...baseStats(e),
      pickRate: r3(e.games / Math.max(state.augSlots, 1)),
    }
  }

  const champions = {}
  for (const [name, e] of Object.entries(state.champs)) {
    if (e.games < MIN_SAMPLE_CHAMP) continue
    champions[name] = {
      ...baseStats(e),
      avgTier: r2(e.tierSum / e.games),
      threeStarRate: r3(e.threeStar / e.games),
    }
  }

  const traits = {}
  for (const [name, e] of Object.entries(state.traits)) {
    if (e.games < MIN_SAMPLE_TRAIT) continue
    traits[name] = {
      ...baseStats(e),
      avgTier: r2(e.tierSum / e.games),
    }
  }

  const items = {}
  for (const [name, e] of Object.entries(state.items)) {
    if (e.games < MIN_SAMPLE_ITEM) continue
    items[name] = baseStats(e)
  }

  const combos = {}
  for (const [key, e] of Object.entries(state.combos)) {
    if (e.games < MIN_SAMPLE_COMBO) continue
    combos[key] = baseStats(e)
  }

  return { augments, champions, traits, items, combos }
}


/**
 * 이전 수집본 대비 순위/평균등수 변동을 계산해 각 항목에 붙인다.
 *  - rankDelta > 0 : 순위 상승 (예: 5위 → 3위 = +2)
 *  - avgDelta  > 0 : 평균등수 개선 (낮을수록 좋으므로 이전 - 현재)
 */
function attachDeltas(result, prev) {
  if (!prev) return result
  for (const section of ['champions', 'traits', 'items']) {
    const cur = result[section] || {}
    const old = prev[section] || {}
    const prevRanks = {}
    Object.keys(old)
      .filter((k) => typeof old[k]?.avgPlacement === 'number')
      .sort((a, b) => old[a].avgPlacement - old[b].avgPlacement)
      .forEach((k, i) => {
        prevRanks[k] = i + 1
      })

    Object.keys(cur)
      .sort((a, b) => cur[a].avgPlacement - cur[b].avgPlacement)
      .forEach((k, i) => {
        const entry = cur[k]
        const prevEntry = old[k]
        if (!prevEntry || typeof prevEntry.avgPlacement !== 'number') {
          entry.prevRank = null
          entry.rankDelta = null
          entry.avgDelta = null
          return
        }
        entry.prevRank = prevRanks[k] ?? null
        entry.rankDelta = prevRanks[k] ? prevRanks[k] - (i + 1) : null
        entry.avgDelta = Math.round((prevEntry.avgPlacement - entry.avgPlacement) * 100) / 100
      })
  }
  result.prevGeneratedAt = prev.generatedAt
  return result
}

/** 기존 메타 파일 읽기 (없으면 null) */
function readPrevStats(outPath) {
  try {
    return JSON.parse(fs.readFileSync(outPath, 'utf-8'))
  } catch (e) {
    return null
  }
}

/** 이전 수집본을 data/metaHistory/YYYY-MM-DD.json 으로 보관 */
function archiveSnapshot(prev) {
  if (!prev || !prev.generatedAt) return
  try {
    const dir = path.join(__dirname, '..', 'data', 'metaHistory')
    fs.mkdirSync(dir, { recursive: true })
    const day = String(prev.generatedAt).slice(0, 10)
    const file = path.join(dir, `${day}.json`)
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(prev, null, 2), 'utf-8')
  } catch (e) {
    /* 아카이브 실패는 무시 */
  }
}

async function main() {
  if (!RIOT_API_KEY) {
    printKeyHelp()
    process.exitCode = 1
    return
  }
  const seeds = getSeeds()
  if (seeds.length === 0) {
    console.error('사용법: SEEDS="닉네임#KR1,닉네임2#KR1" node scripts/buildMetaStats.js')
    console.error('   또는: node scripts/buildMetaStats.js "닉네임#KR1" "닉네임2#KR1"')
    process.exitCode = 1
    return
  }

  console.log(`\n🚀 메타 데이터 수집 시작 (v2)`)
  console.log(`   소환사 수: ${seeds.length}명 / 매치/소환사: ${MATCHES_PER_SEED}판 / 동시 수집: ${CONCURRENCY}명`)
  console.log(`   수집 항목: 챔피언·시너지·아이템·조합(+증강)`)

  // 0) 키 유효성 사전 점검
  try {
    const [g, t = 'KR1'] = seeds[0].split('#')
    const acc = await getAccount(g, t)
    console.log(`✅ 키 확인 OK — 샘플 계정: ${acc.gameName}#${acc.tagLine}\n`)
    if (CHECK_ONLY) {
      console.log('(--check 모드: 수집 없이 종료)')
      return
    }
  } catch (e) {
    console.error(`❌ 키/계정 확인 실패: ${e.message}`)
    printKeyHelp()
    process.exitCode = 1
    return
  }

  const state = createState()
  const seen = new Set()

  if (CONCURRENCY <= 1) {
    for (const seed of seeds) {
      const result = await collectSeed(seed, seen, state)
      if (result.error) console.log(`  ${seed}: 실패 (${result.error})`)
      else console.log(`  ✔ ${seed}: ${result.newMatches}건 수집 (누적 ${seen.size}건)`)
    }
  } else {
    for (let i = 0; i < seeds.length; i += CONCURRENCY) {
      const batch = seeds.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(batch.map((seed) => collectSeed(seed, seen, state)))
      results.forEach((r, idx) => {
        const seed = batch[idx]
        if (r.status === 'rejected') console.log(`  ❌ ${seed}: ${r.reason.message}`)
        else if (r.value.error) console.log(`  ⏭ ${seed}: 실패 (${r.value.error})`)
        else console.log(`  ✔ ${seed}: ${r.value.newMatches}건 수집 (누적 ${seen.size}건)`)
      })
      if (i + CONCURRENCY < seeds.length) await sleep(SLEEP_MS)
    }
  }

  const { augments, champions, traits, items, combos } = buildOutput(state)

  if (Object.keys(augments).length === 0) {
    const diag = describeAugmentDiagnostics(state)
    console.warn(`\n⚠️ 증강 통계 0건 — ${diag.text}`)
    if (diag.hint) console.warn(`   원인 추정: ${diag.hint}`)
  }

  const total =
    Object.keys(augments).length + Object.keys(champions).length +
    Object.keys(traits).length + Object.keys(items).length + Object.keys(combos).length

  if (total === 0) {
    console.warn('\n⚠️ 수집된 통계가 0개입니다. 기존 lib/metaStats.json 을 유지합니다.')
    return
  }

  const result = {
    version: '2',
    patch: state.patch,
    source: 'riot-sample',
    sample: false,
    generatedAt: new Date().toISOString(),
    baselineAvgPlacement: 4.5,
    augments,
    champions,
    traits,
    items,
    combos,
  }

  const outPath = path.join(__dirname, '..', 'lib', 'metaStats.json')
  // 이전 수집본 대비 순위 변동 계산 + 스냅샷 보관
  const prevStats = readPrevStats(outPath)
  attachDeltas(result, prevStats)
  archiveSnapshot(prevStats)
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8')

  console.log(`\n✅ 저장 완료 → ${outPath}`)
  console.log(`   총 수집 매치: ${seen.size}건 / 총 증강 슬롯: ${state.augSlots}건`)
  console.log(`   챔피언: ${Object.keys(champions).length}종 | 시너지: ${Object.keys(traits).length}종 | 아이템: ${Object.keys(items).length}종 | 조합: ${Object.keys(combos).length}건 | 증강: ${Object.keys(augments).length}종`)
  console.log(`   증강 진단: ${describeAugmentDiagnostics(state).text}`)
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}

module.exports = {
  createState,
  aggregateMatch,
  buildOutput,
  extractAugmentNames,
  hasAugmentField,
  describeAugmentDiagnostics,
  riotGet,
  sleep,
  normalizeChampId,
  r2,
  r3,
  attachDeltas,
  readPrevStats,
  archiveSnapshot,
}

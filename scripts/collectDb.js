/**
 * 데이터 플랫폼 v2 — Phase A 수집기 (Riot → Supabase)
 *
 * 한 번 실행하면:
 *  1) 시드 갱신 (SEED_REFRESH_HOURS 마다): 챌린저·그마 전원 + 마스터 LP 상위 MASTER_LIMIT 명
 *  2) 실패했던 판 재시도
 *  3) 시드별 새 매치 ID(startTime 커서) → DB 에 없는 판만 상세 조회 → 매치+보드 8행 적재 (멱등)
 *  4) 일별 집계: 이번 실행에 들어온(또는 티어가 바뀐) (game_date, patch, tier_bucket) 조합만 다시 계산
 *     하루 1회(DECK_REFRESH_HOURS)는 원본의 모든 조합을 다시 계산하고, 최신 패치 덱 클러스터(stat_comp)를 다시 만든다
 *  5) 원본 정리: 최근 KEEP_PATCHES 개 패치만 남김 (무료 플랜 500MB 대응, 집계는 영구)
 * MAX_MINUTES 가 지나거나 MAX_MATCHES 를 채우면 멈춘다. 다음 실행이 커서부터 이어 간다.
 *
 * 사용법:
 *   node scripts/collectDb.js                 # Supabase 적재 (SUPABASE_SERVICE_ROLE_KEY 필요)
 *   node scripts/collectDb.js --dry-run       # 메모리 저장소로 실제 Riot 호출만 검증 (DB 쓰기 없음)
 *   node scripts/collectDb.js --rollup-only   # Riot 호출 없이 집계 전체 재계산 + 덱 클러스터 (0006 적용 직후 1회)
 *
 * 환경변수 (기본값):
 *   RIOT_API_KEY, RIOT_REGION=asia, RIOT_PLATFORM=kr
 *   NEXT_PUBLIC_SUPABASE_URL (또는 SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, TFT_SEED_KEY(32자+)
 *   RIOT_MIN_INTERVAL_MS=1250   개발 키 기준. 프로덕션 키는 34 (한도 60%)
 *   MAX_MINUTES=50 · MAX_MATCHES=200(무료 플랜: 시간당 200판 ≈ 패치당 6.4만 판 ≈ 170MB, 실측 2.6KB/판) · SEED_TIERS=challenger,grandmaster,master · MASTER_LIMIT=1000
 *   SEED_REFRESH_HOURS=20 · IDS_PER_SEED=20 · NEW_SEED_LOOKBACK_DAYS=2 · KEEP_PATCHES=1 · MAX_RAW_MB=400
 *   SET_NUMBER=18 · RANKED_QUEUE=1100 · DECK_REFRESH_HOURS=20 · COMP_MIN_GAMES=8
 */
const crypto = require('crypto')
const { loadEnv } = require('./_env')
loadEnv()

const { createRiotClient, getLeague, getMatchIds, getMatch, KeyError, NotFoundError } = require('./collect/riot')
const { collectDictKeys, normalizeMatch, patchFromDdragon, patchForTime, TIER_RANK } = require('./collect/normalize')
const { createSupabaseStore, createMemoryStore } = require('./collect/store')
const { createSeedCrypto } = require('./collect/seedCrypto')
const { comboKey, parseComboKey } = require('./collect/rollup')
const { rebuildComps } = require('./collect/decks')

const env = (name, def) => process.env[name] ?? def
const num = (name, def) => {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : def
}

const DRY_RUN = process.argv.includes('--dry-run')
const ROLLUP_ONLY = process.argv.includes('--rollup-only')
const CFG = {
  region: env('RIOT_REGION', 'asia'),
  platform: env('RIOT_PLATFORM', 'kr'),
  minIntervalMs: num('RIOT_MIN_INTERVAL_MS', 1250),
  maxMinutes: num('MAX_MINUTES', 50),
  maxMatches: num('MAX_MATCHES', 200),
  seedTiers: env('SEED_TIERS', 'challenger,grandmaster,master')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  masterLimit: num('MASTER_LIMIT', 1000),
  seedRefreshHours: num('SEED_REFRESH_HOURS', 20),
  idsPerSeed: num('IDS_PER_SEED', 20),
  lookbackDays: num('NEW_SEED_LOOKBACK_DAYS', 2),
  keepPatches: num('KEEP_PATCHES', 1),
  maxRawMb: num('MAX_RAW_MB', 400),
  setNumber: num('SET_NUMBER', 18),
  rankedQueue: num('RANKED_QUEUE', 1100),
  deckRefreshHours: num('DECK_REFRESH_HOURS', 20),
}
/** 덱 클러스터는 원본 1패치를 다 읽으므로 남은 시간이 이보다 적으면 다음 실행으로 미룬다 */
const DECK_JOB_MIN_MS = 5 * 60 * 1000
/** 시드 커서와 실제 판 시각 사이 여유 (startTime 기준이 판 시작인지 끝인지와 무관하게 놓치지 않게) */
const CURSOR_OVERLAP_MS = 60 * 60 * 1000

/** Data Dragon 최신 버전 → 패치 달력에 기록하고 달력을 돌려준다 */
async function syncPatchCalendar(store, log) {
  try {
    const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json')
    const versions = await res.json()
    const patch = patchFromDdragon(versions?.[0])
    if (patch) await store.notePatch(patch, versions[0])
  } catch (e) {
    log.warn(`  Data Dragon 버전 조회 실패 (기존 패치 달력 사용): ${e.message}`)
  }
  return store.loadPatches()
}

function makeStore() {
  if (DRY_RUN) return createMemoryStore()
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) return null
  return createSupabaseStore({ url, serviceRoleKey })
}

async function refreshSeeds({ riot, store, seedCrypto, log }) {
  const rows = []
  const now = new Date().toISOString()
  for (const tier of CFG.seedTiers) {
    try {
      let list = await getLeague(riot, CFG.platform, tier)
      if (tier === 'master') list = list.slice(0, CFG.masterLimit)
      for (const e of list) {
        rows.push({
          puuid_hash: seedCrypto.hash(e.puuid),
          puuid_enc: seedCrypto.encrypt(e.puuid),
          platform: CFG.platform,
          tier: tier.toUpperCase(),
          lp: e.lp,
          refreshed_at: now,
        })
      }
      log.log(`  시드 ${tier}: ${list.length}명`)
    } catch (e) {
      if (e instanceof KeyError) throw e
      log.warn(`  시드 ${tier} 조회 실패: ${e.message}`)
    }
  }
  if (rows.length) {
    // 같은 선수가 두 리그에 잡히면(승강 직후) 높은 티어를 쓴다
    const best = new Map()
    for (const r of rows) {
      const prev = best.get(r.puuid_hash)
      if (!prev || TIER_RANK[r.tier] > TIER_RANK[prev.tier]) best.set(r.puuid_hash, r)
    }
    await store.upsertSeeds([...best.values()])
    await store.pruneStaleSeeds(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
  }
  return rows.length
}

/**
 * 4) 일별 집계 갱신.
 *  - 매 실행: dirty 조합(이번 실행에 적재·티어 상향된 판의 (game_date, patch, tier_bucket))만 다시 계산
 *  - 최신 패치 덱 클러스터가 DECK_REFRESH_HOURS 보다 오래됐으면(하루 1회): 원본의 모든 조합 + 덱 클러스터
 * 0006 마이그레이션 전이거나 실패해도 수집 결과는 그대로 두고 경고만 남긴다 (다음 일 1회 전체 재계산이 메운다).
 */
async function refreshAggregates({ store, dirty, deadline, log, force = false }) {
  const out = { combos: 0, comps: null, latestPatch: null, error: null }
  try {
    const raw = await store.rawCombos()
    const latest = raw.reduce((best, c) => (!best || c.game_date > best.game_date ? c : best), null)
    out.latestPatch = latest?.patch ?? null
    const compsAt = out.latestPatch ? await store.compsUpdatedAt(out.latestPatch) : Date.now()
    const daily = force || Date.now() - compsAt > CFG.deckRefreshHours * 60 * 60 * 1000

    const keys = new Set(dirty)
    if (daily) for (const c of raw) keys.add(comboKey(c.game_date, c.patch, c.tier_bucket))
    for (const key of [...keys].sort()) {
      const c = parseComboKey(key)
      await store.refreshRollup(c.game_date, c.patch, c.tier_bucket)
      out.combos++
    }
    if (keys.size) log.log(`  집계 갱신: ${keys.size}개 조합${daily ? ' (일 1회 전체 재계산)' : ''}`)

    if (daily && out.latestPatch) {
      if (force || deadline - Date.now() > DECK_JOB_MIN_MS) out.comps = await rebuildComps(store, out.latestPatch, { log })
      else log.log('  덱 클러스터: 남은 시간이 부족해 다음 실행으로 미룸')
    }
  } catch (e) {
    out.error = e.message
    log.warn(`⚠️  집계 실패 — supabase/migrations/0006_tft_rollups.sql 적용 여부를 확인하세요: ${e.message}`)
  }
  return out
}

/** 집계가 성공했을 때만 원본을 정리한다 */
function shouldPrune(aggregates) {
  return Boolean(aggregates) && !aggregates.error
}

/** --rollup-only: Riot 호출 없이 원본 전체로 집계·덱 클러스터를 다시 만든다 */
async function rollupOnly(store, log) {
  await store.loadDict()
  const agg = await refreshAggregates({ store, dirty: new Set(), deadline: Infinity, log, force: true })
  if (agg.error) process.exitCode = 1
  log.log(`완료 · 집계 ${agg.combos}개 조합 · 최신 패치 ${agg.latestPatch ?? '-'}`)
  return { store, aggregates: agg }
}

async function main({ log = console } = {}) {
  const startedAt = Date.now()
  const deadline = startedAt + CFG.maxMinutes * 60 * 1000
  if (ROLLUP_ONLY) {
    const store = makeStore()
    if (!store) {
      log.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다')
      process.exitCode = 1
      return
    }
    return rollupOnly(store, log)
  }
  const key = process.env.RIOT_API_KEY
  if (!key) {
    log.error('RIOT_API_KEY 가 필요합니다')
    process.exitCode = 1
    return
  }

  const store = makeStore()
  if (!store) {
    // 시크릿을 아직 넣지 않은 저장소에서 워크플로가 실패로 보이지 않게 한다
    log.log('ℹ️  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없어 수집을 건너뜁니다. (--dry-run 으로 Riot 호출만 검증 가능)')
    return
  }
  const seedSecret = process.env.TFT_SEED_KEY || (DRY_RUN ? crypto.randomBytes(48).toString('base64') : '')
  const seedCrypto = createSeedCrypto(seedSecret)
  const riot = createRiotClient({ key, minIntervalMs: CFG.minIntervalMs, log })

  const stats = { matches_added: 0, matches_skipped: 0, failures: 0, riot_calls: 0, note: '' }
  /** 이번 실행에 바뀐 집계 조합 (comboKey) */
  const dirty = new Set()
  let aggregates = null
  const runId = await store.startRun()
  log.log(`수집 시작 (${store.kind}${DRY_RUN ? ' · 드라이런' : ''}) · 최대 ${CFG.maxMinutes}분 / ${CFG.maxMatches}판 · 간격 ${CFG.minIntervalMs}ms`)

  try {
    await store.loadDict()
    const calendar = await syncPatchCalendar(store, log)
    const patchAt = (gameAtMs) => patchForTime(calendar, gameAtMs)
    log.log(`  패치 달력: ${calendar.map((p) => p.patch).sort().join(', ') || '(비어 있음)'}`)

    // 0) 용량 가드 (무료 플랜)
    let sizeMb = await store.rawSizeMb()
    if (sizeMb > CFG.maxRawMb) {
      const removed = await store.prune(CFG.keepPatches)
      sizeMb = await store.rawSizeMb()
      log.warn(`  원본 ${sizeMb}MB > 한도 ${CFG.maxRawMb}MB → 정리 ${removed}판`)
      if (sizeMb > CFG.maxRawMb) {
        stats.note = `용량 한도 초과(${sizeMb}MB) — 수집 건너뜀`
        log.warn(`⚠️  ${stats.note}. KEEP_PATCHES 를 줄이거나 플랜을 올리세요.`)
        return
      }
    }

    // 1) 시드 갱신
    const refreshedAt = await store.seedsRefreshedAt()
    if (Date.now() - refreshedAt > CFG.seedRefreshHours * 60 * 60 * 1000) {
      log.log('시드 갱신')
      await refreshSeeds({ riot, store, seedCrypto, log })
    }

    const skippedThisRun = new Set()

    /** 판 1건 받아서 적재. 반환: 'added' | 'skipped' | 'failed' */
    async function fetchAndIngest(matchId, tierBucket, attempts = 0) {
      try {
        const raw = await getMatch(riot, CFG.region, matchId)
        const info = raw.info || {}
        if (info.tft_set_number !== CFG.setNumber || info.queue_id !== CFG.rankedQueue) {
          skippedThisRun.add(matchId)
          return { result: 'skipped' }
        }
        await store.ensureDict(collectDictKeys(raw))
        const norm = normalizeMatch(raw, { platform: CFG.platform, tierBucket, patchAt }, store.dictId)
        if (!norm) {
          skippedThisRun.add(matchId)
          return { result: 'skipped' }
        }
        const inserted = await store.ingest(norm.match, norm.boards)
        if (inserted) dirty.add(comboKey(norm.match.game_date, norm.match.patch, norm.match.tier_bucket))
        return { result: inserted ? 'added' : 'skipped', gameAt: info.game_datetime }
      } catch (e) {
        if (e instanceof KeyError) throw e
        if (e instanceof NotFoundError) {
          skippedThisRun.add(matchId)
          return { result: 'skipped' }
        }
        await store.recordFailure(matchId, tierBucket, e.message, attempts + 1)
        return { result: 'failed' }
      }
    }

    const tally = (r) => {
      if (r.result === 'added') stats.matches_added++
      else if (r.result === 'skipped') stats.matches_skipped++
      else stats.failures++
    }

    // 2) 실패 재시도
    for (const f of await store.failures(50)) {
      if (Date.now() > deadline) break
      tally(await fetchAndIngest(f.match_id, f.tier_bucket, f.attempts))
    }

    // 3) 시드 순회 (가장 오래 확인 안 한 선수부터)
    let seedsChecked = 0
    outer: while (Date.now() < deadline && stats.matches_added < CFG.maxMatches) {
      const batch = await store.nextSeeds(50)
      if (!batch.length) break
      for (const seed of batch) {
        if (Date.now() > deadline || stats.matches_added >= CFG.maxMatches) break outer
        const puuid = seedCrypto.decrypt(seed.puuid_enc)
        const since = seed.last_match_at
          ? new Date(seed.last_match_at).getTime() - CURSOR_OVERLAP_MS
          : Date.now() - CFG.lookbackDays * 24 * 60 * 60 * 1000
        let ids = []
        try {
          ids = await getMatchIds(riot, CFG.region, puuid, { startTimeSec: Math.floor(since / 1000), count: CFG.idsPerSeed })
        } catch (e) {
          if (e instanceof KeyError) throw e
          log.warn(`  매치 ID 조회 실패: ${e.message}`)
        }

        const existing = await store.existingMatches(ids)
        const higher = [...existing.entries()].filter(([, m]) => TIER_RANK[seed.tier] > TIER_RANK[m.tier_bucket])
        if (higher.length) {
          await store.raiseTier(
            higher.map(([id]) => id),
            seed.tier
          )
          // 판이 옮겨 간 양쪽 구간을 모두 다시 계산한다
          for (const [, m] of higher) {
            dirty.add(comboKey(m.game_date, m.patch, m.tier_bucket))
            dirty.add(comboKey(m.game_date, m.patch, seed.tier))
          }
        }

        let lastGameAt = seed.last_match_at ? new Date(seed.last_match_at).getTime() : 0
        for (const id of ids) {
          if (existing.has(id) || skippedThisRun.has(id)) continue
          if (Date.now() > deadline || stats.matches_added >= CFG.maxMatches) break
          const r = await fetchAndIngest(id, seed.tier)
          tally(r)
          if (r.gameAt) lastGameAt = Math.max(lastGameAt, r.gameAt)
        }
        await store.markSeedChecked(seed.puuid_hash, {
          checkedAt: new Date().toISOString(),
          lastMatchAt: lastGameAt ? new Date(lastGameAt).toISOString() : null,
        })
        seedsChecked++
        if (seedsChecked % 25 === 0) {
          log.log(
            `  진행: 시드 ${seedsChecked} · 새로 ${stats.matches_added}판 · 제외 ${stats.matches_skipped} · 실패 ${stats.failures} · 호출 ${riot.calls}`
          )
        }
      }
      if (batch.length < 50) break
    }

    // 4) 일별 집계 (원본 정리 전에: 정리될 패치의 마지막 판까지 집계에 남긴다)
    aggregates = await refreshAggregates({ store, dirty, deadline, log })

    // 5) 원본 정리 — 집계가 실패했으면 건너뛴다 (집계되지 않은 원본을 지우면 복구할 수 없다)
    if (shouldPrune(aggregates)) {
      const removed = await store.prune(CFG.keepPatches)
      if (removed) log.log(`  원본 정리: 이전 패치 ${removed}판 삭제 (최근 ${CFG.keepPatches}패치 보관)`)
    } else {
      stats.note = [stats.note, '집계 실패로 원본 정리를 건너뜀'].filter(Boolean).join(' · ')
      log.warn('  집계 실패 → 원본 정리를 건너뜁니다 (다음 실행에서 재시도)')
    }
  } catch (e) {
    stats.note = e.message
    if (e instanceof KeyError) log.error(`❌ ${e.message} — GitHub secret RIOT_API_KEY 를 확인하세요`)
    else log.error(e)
    process.exitCode = 1
  } finally {
    // 수집이 중간에 멈췄어도(키 만료 등) 이미 적재한 판은 집계에 넣는다
    if (!aggregates && dirty.size) aggregates = await refreshAggregates({ store, dirty, deadline: 0, log })
    if (aggregates?.error) stats.note = [stats.note, `집계 실패: ${aggregates.error}`].filter(Boolean).join(' · ').slice(0, 500)
    stats.riot_calls = riot.calls
    await store.finishRun(runId, stats).catch(() => {})
    const counts = await store.counts().catch(() => ({}))
    const sizeMb = await store.rawSizeMb().catch(() => '?')
    const mins = ((Date.now() - startedAt) / 60000).toFixed(1)
    log.log(
      `\n완료 ${mins}분 · 새로 ${stats.matches_added}판 · 제외 ${stats.matches_skipped} · 실패 ${stats.failures} · Riot 호출 ${riot.calls}회 (429 ${riot.throttled}회)`
    )
    log.log(`누적: 매치 ${counts.matches ?? '?'}판 · 시드 ${counts.seeds ?? '?'}명 · 원본 ${sizeMb}MB`)
  }
  return { store, stats, aggregates }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}

module.exports = { main, CFG, shouldPrune }

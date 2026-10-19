/**
 * 수집기 저장소.
 *  - createSupabaseStore : 실제 적재 (service role, supabase/migrations/0005_tft_stats.sql · 0006_tft_rollups.sql 필요)
 *  - createMemoryStore   : 드라이런·테스트용 (같은 규칙을 JS 로 흉내 낸다. 집계는 scripts/collect/rollup.js)
 *
 * 두 구현은 같은 메서드를 가진다. collectDb.js 는 어느 쪽인지 모른다.
 */
const { TIER_RANK } = require('./normalize')
const { rollupBoards, comboKey, parseComboKey } = require('./rollup')

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))
const dictKey = (kind, apiId) => `${kind}:${apiId}`

function createSupabaseStore({ url, serviceRoleKey }) {
  const { createClient } = require('@supabase/supabase-js')
  const db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const dict = new Map()
  const names = new Map() // id → api_id

  const must = ({ data, error }, what) => {
    if (error) throw new Error(`Supabase ${what}: ${error.message}`)
    return data
  }

  return {
    kind: 'supabase',

    async loadDict() {
      for (let from = 0; ; from += 1000) {
        const rows = must(await db.from('tft_dict').select('id, kind, api_id').range(from, from + 999), 'dict 조회')
        for (const r of rows) {
          dict.set(dictKey(r.kind, r.api_id), r.id)
          names.set(r.id, r.api_id)
        }
        if (rows.length < 1000) break
      }
      return dict.size
    },

    /** 없는 키만 넣고 id 를 받아 온다 */
    async ensureDict(keys) {
      const missing = []
      for (const [kind, set] of Object.entries(keys)) {
        for (const apiId of set) if (!dict.has(dictKey(kind, apiId))) missing.push({ kind, api_id: apiId })
      }
      if (!missing.length) return 0
      must(await db.from('tft_dict').upsert(missing, { onConflict: 'kind,api_id', ignoreDuplicates: true }), 'dict 추가')
      for (const kind of ['unit', 'item', 'trait']) {
        const ids = missing.filter((m) => m.kind === kind).map((m) => m.api_id)
        for (const part of chunk(ids, 200)) {
          if (!part.length) continue
          const rows = must(await db.from('tft_dict').select('id, kind, api_id').eq('kind', kind).in('api_id', part), 'dict 재조회')
          for (const r of rows) {
            dict.set(dictKey(r.kind, r.api_id), r.id)
            names.set(r.id, r.api_id)
          }
        }
      }
      return missing.length
    },

    dictId(kind, apiId) {
      const id = dict.get(dictKey(kind, apiId))
      if (id == null) throw new Error(`사전에 없는 키: ${kind}:${apiId} (ensureDict 누락)`)
      return id
    },

    /** id → Riot 문자열 ID (loadDict 이후) */
    dictName(id) {
      return names.get(id) ?? null
    },

    async loadPatches() {
      return must(await db.from('tft_patches').select('patch, ddragon_version, first_seen_at'), '패치 달력 조회')
    },

    /** 처음 보는 패치면 지금 시각으로 기록 (이미 있으면 그대로) */
    async notePatch(patch, ddragonVersion) {
      must(
        await db
          .from('tft_patches')
          .upsert({ patch, ddragon_version: ddragonVersion }, { onConflict: 'patch', ignoreDuplicates: true }),
        '패치 기록'
      )
    },

    async seedsRefreshedAt() {
      const rows = must(
        await db.from('tft_seed_players').select('refreshed_at').order('refreshed_at', { ascending: false }).limit(1),
        '시드 갱신 시각'
      )
      return rows[0] ? new Date(rows[0].refreshed_at).getTime() : 0
    },

    /** 리그 목록으로 시드를 갱신한다. checked_at / last_match_at 은 건드리지 않는다. */
    async upsertSeeds(rows) {
      for (const part of chunk(rows, 500)) {
        must(await db.from('tft_seed_players').upsert(part, { onConflict: 'puuid_hash' }), '시드 저장')
      }
    },

    async pruneStaleSeeds(olderThanIso) {
      must(await db.from('tft_seed_players').delete().lt('refreshed_at', olderThanIso), '오래된 시드 삭제')
    },

    async nextSeeds(limit) {
      return must(
        await db
          .from('tft_seed_players')
          .select('puuid_hash, puuid_enc, tier, last_match_at')
          .order('checked_at', { ascending: true, nullsFirst: true })
          .limit(limit),
        '시드 조회'
      )
    },

    async markSeedChecked(puuidHash, { checkedAt, lastMatchAt }) {
      const patch = { checked_at: checkedAt }
      if (lastMatchAt) patch.last_match_at = lastMatchAt
      must(await db.from('tft_seed_players').update(patch).eq('puuid_hash', puuidHash), '시드 커서 저장')
    },

    /** id → { tier_bucket, game_date, patch } (이미 받은 판) */
    async existingMatches(ids) {
      const out = new Map()
      for (const part of chunk(ids, 200)) {
        if (!part.length) continue
        const rows = must(
          await db.from('tft_matches').select('match_id, tier_bucket, game_date, patch').in('match_id', part),
          '기존 매치 조회'
        )
        for (const r of rows) out.set(r.match_id, { tier_bucket: r.tier_bucket, game_date: r.game_date, patch: r.patch })
      }
      return out
    },

    async ingest(match, boards) {
      return must(await db.rpc('tft_ingest_match', { p_match: match, p_boards: boards }), '매치 적재')
    },

    async raiseTier(ids, tier) {
      if (!ids.length) return 0
      return must(await db.rpc('tft_raise_tier', { p_match_ids: ids, p_tier: tier }), '티어 상향')
    },

    async failures(limit) {
      return must(
        await db.from('tft_fetch_failures').select('match_id, tier_bucket, attempts').lt('attempts', 3).limit(limit),
        '실패 목록'
      )
    },

    async recordFailure(matchId, tierBucket, message, attempts) {
      must(
        await db.from('tft_fetch_failures').upsert(
          {
            match_id: matchId,
            tier_bucket: tierBucket,
            attempts,
            last_error: String(message).slice(0, 300),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'match_id' }
        ),
        '실패 기록'
      )
    },

    async prune(keepPatches) {
      return must(await db.rpc('tft_prune_raw', { p_keep_patches: keepPatches }), '원본 정리')
    },

    async rawSizeMb() {
      return Number(must(await db.rpc('tft_raw_size_mb'), '용량 조회'))
    },

    async startRun() {
      const rows = must(await db.from('tft_collect_runs').insert({}).select('id'), '실행 기록 시작')
      return rows[0]?.id
    },

    async finishRun(id, stats) {
      if (!id) return
      must(
        await db
          .from('tft_collect_runs')
          .update({ finished_at: new Date().toISOString(), ...stats })
          .eq('id', id),
        '실행 기록 종료'
      )
    },

    async counts() {
      const m = await db.from('tft_matches').select('*', { count: 'exact', head: true })
      const s = await db.from('tft_seed_players').select('*', { count: 'exact', head: true })
      return { matches: m.count ?? 0, seeds: s.count ?? 0 }
    },

    /* ---- Phase B: 집계 (0006_tft_rollups.sql) ---- */

    /** (game_date, patch, tier_bucket) 한 조합을 원본에서 다시 계산. 반환: 보드 수 (-1 = 원본이 정리된 패치) */
    async refreshRollup(gameDate, patch, tierBucket) {
      return must(
        await db.rpc('tft_refresh_rollup', { p_game_date: gameDate, p_patch: patch, p_tier: tierBucket }),
        '집계 갱신'
      )
    },

    /** 원본에 있는 모든 조합 (하루 1회 전체 재계산용) */
    async rawCombos() {
      return must(await db.rpc('tft_raw_combos'), '원본 조합 조회')
    },

    /** 이 패치 덱 클러스터의 마지막 갱신 시각 (없으면 0) */
    async compsUpdatedAt(patch) {
      const rows = must(
        await db.from('stat_comp').select('updated_at').eq('patch', patch).order('updated_at', { ascending: false }).limit(1),
        '덱 갱신 시각'
      )
      return rows[0] ? new Date(rows[0].updated_at).getTime() : 0
    },

    /** 한 패치의 원본 보드 전부 (덱 클러스터 입력) */
    async loadBoardsForPatch(patch) {
      const out = []
      for (let from = 0; ; from += 1000) {
        const rows = must(
          await db
            .from('tft_boards')
            .select('match_id, placement, level, units, traits, tft_matches!inner(tier_bucket, patch)')
            .eq('tft_matches.patch', patch)
            .order('match_id', { ascending: true })
            .order('placement', { ascending: true })
            .range(from, from + 999),
          '보드 조회'
        )
        for (const r of rows) {
          const m = Array.isArray(r.tft_matches) ? r.tft_matches[0] : r.tft_matches
          out.push({ match_id: r.match_id, placement: r.placement, level: r.level, units: r.units, traits: r.traits, tier_bucket: m?.tier_bucket })
        }
        if (rows.length < 1000) break
      }
      return out
    },

    async replaceComps(patch, tierMin, rows) {
      return must(await db.rpc('tft_replace_comps', { p_patch: patch, p_tier_min: tierMin, p_rows: rows }), '덱 클러스터 저장')
    },
  }
}

function createMemoryStore() {
  const dict = new Map()
  let nextDictId = 1
  const seeds = new Map()
  const matches = new Map()
  const boards = new Map()
  const failures = new Map()
  const runs = []
  const patches = new Map()
  const rollups = new Map() // comboKey → rollupBoards 결과 (stat_*_daily 대신)
  const comps = new Map() // `${patch}|${tierMin}` → { rows, updatedAt }

  return {
    kind: 'memory',
    _state: { dict, seeds, matches, boards, failures, runs, patches, rollups, comps },

    async loadDict() {
      return dict.size
    },
    async ensureDict(keys) {
      let added = 0
      for (const [kind, set] of Object.entries(keys)) {
        for (const apiId of set) {
          const k = dictKey(kind, apiId)
          if (!dict.has(k)) {
            dict.set(k, nextDictId++)
            added++
          }
        }
      }
      return added
    },
    dictId(kind, apiId) {
      const id = dict.get(dictKey(kind, apiId))
      if (id == null) throw new Error(`사전에 없는 키: ${kind}:${apiId} (ensureDict 누락)`)
      return id
    },
    dictName(id) {
      for (const [k, v] of dict) if (v === id) return k.slice(k.indexOf(':') + 1)
      return null
    },
    async loadPatches() {
      return [...patches.values()]
    },
    async notePatch(patch, ddragonVersion) {
      if (!patches.has(patch)) patches.set(patch, { patch, ddragon_version: ddragonVersion, first_seen_at: new Date().toISOString() })
    },
    async seedsRefreshedAt() {
      let max = 0
      for (const s of seeds.values()) max = Math.max(max, new Date(s.refreshed_at).getTime())
      return max
    },
    async upsertSeeds(rows) {
      for (const r of rows) seeds.set(r.puuid_hash, { checked_at: null, last_match_at: null, ...seeds.get(r.puuid_hash), ...r })
    },
    async pruneStaleSeeds(olderThanIso) {
      for (const [k, s] of seeds) if (s.refreshed_at < olderThanIso) seeds.delete(k)
    },
    async nextSeeds(limit) {
      return [...seeds.values()]
        .sort((a, b) => (a.checked_at ? new Date(a.checked_at).getTime() : -1) - (b.checked_at ? new Date(b.checked_at).getTime() : -1))
        .slice(0, limit)
        .map(({ puuid_hash, puuid_enc, tier, last_match_at }) => ({ puuid_hash, puuid_enc, tier, last_match_at }))
    },
    async markSeedChecked(puuidHash, { checkedAt, lastMatchAt }) {
      const s = seeds.get(puuidHash)
      if (!s) return
      s.checked_at = checkedAt
      if (lastMatchAt) s.last_match_at = lastMatchAt
    },
    async existingMatches(ids) {
      const out = new Map()
      for (const id of ids) {
        const m = matches.get(id)
        if (m) out.set(id, { tier_bucket: m.tier_bucket, game_date: m.game_date, patch: m.patch })
      }
      return out
    },
    async ingest(match, rows) {
      if (matches.has(match.match_id)) return false
      matches.set(match.match_id, { ...match, collected_at: new Date().toISOString() })
      for (const b of rows) boards.set(`${b.match_id}:${b.placement}`, b)
      failures.delete(match.match_id)
      return true
    },
    async raiseTier(ids, tier) {
      let n = 0
      for (const id of ids) {
        const m = matches.get(id)
        if (m && TIER_RANK[tier] > TIER_RANK[m.tier_bucket]) {
          m.tier_bucket = tier
          n++
        }
      }
      return n
    },
    async failures(limit) {
      return [...failures.values()].filter((f) => f.attempts < 3).slice(0, limit)
    },
    async recordFailure(matchId, tierBucket, message, attempts) {
      failures.set(matchId, { match_id: matchId, tier_bucket: tierBucket, attempts, last_error: String(message) })
    },
    async prune(keepPatches) {
      const latest = new Map()
      for (const m of matches.values()) latest.set(m.patch, Math.max(latest.get(m.patch) || 0, new Date(m.game_at).getTime()))
      const keep = new Set([...latest.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.max(keepPatches, 1)).map(([p]) => p))
      let removed = 0
      for (const [id, m] of matches) {
        if (keep.has(m.patch)) continue
        matches.delete(id)
        for (const k of [...boards.keys()]) if (k.startsWith(`${id}:`)) boards.delete(k)
        removed++
      }
      return removed
    },
    async rawSizeMb() {
      return Math.round((JSON.stringify([...boards.values()]).length / 1024 / 1024) * 10) / 10
    },
    async startRun() {
      runs.push({ started_at: new Date().toISOString() })
      return runs.length
    },
    async finishRun(id, stats) {
      Object.assign(runs[id - 1] || {}, { finished_at: new Date().toISOString(), ...stats })
    },
    async counts() {
      return { matches: matches.size, seeds: seeds.size }
    },

    async refreshRollup(gameDate, patch, tierBucket) {
      if (![...matches.values()].some((m) => m.patch === patch)) return -1
      const ids = new Set()
      for (const m of matches.values()) {
        if (m.game_date === gameDate && m.patch === patch && m.tier_bucket === tierBucket) ids.add(m.match_id)
      }
      const rows = [...boards.values()].filter((b) => ids.has(b.match_id))
      const key = comboKey(gameDate, patch, tierBucket)
      if (!rows.length) {
        rollups.delete(key)
        return 0
      }
      rollups.set(key, rollupBoards(rows))
      return rows.length
    },
    async rawCombos() {
      const keys = new Set([...matches.values()].map((m) => comboKey(m.game_date, m.patch, m.tier_bucket)))
      return [...keys].map(parseComboKey)
    },
    async compsUpdatedAt(patch) {
      let max = 0
      for (const [k, v] of comps) if (k.startsWith(`${patch}|`)) max = Math.max(max, v.updatedAt)
      return max
    },
    async loadBoardsForPatch(patch) {
      const out = []
      for (const b of boards.values()) {
        const m = matches.get(b.match_id)
        if (m && m.patch === patch) out.push({ ...b, tier_bucket: m.tier_bucket })
      }
      return out
    },
    async replaceComps(patch, tierMin, rows) {
      comps.set(`${patch}|${tierMin}`, { rows, updatedAt: Date.now() })
      return rows.length
    },
  }
}

module.exports = { createSupabaseStore, createMemoryStore }

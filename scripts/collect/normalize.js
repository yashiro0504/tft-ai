/**
 * Riot 매치 응답 → tft_matches / tft_boards 행.
 * 닉네임·태그·PUUID 는 버린다. 문자열 ID 는 dict(kind, apiId) → 정수 로 압축한다.
 *
 * 보드는 고정 폭 smallint 배열이다 (jsonb 객체보다 약 4배 작다):
 *   units  = [기물, 성급, 아이템1, 아이템2, 아이템3] × 기물 수   (빈 아이템 = 0)
 *   traits = [시너지, 인원, 단계] × 활성 시너지 수
 */
const UNIT_STRIDE = 5
const TRAIT_STRIDE = 3

/** 배열 → [{ unit, star, items }] (집계·디버그용) */
function decodeUnits(arr) {
  const out = []
  for (let k = 0; k + UNIT_STRIDE <= arr.length; k += UNIT_STRIDE) {
    out.push({ unit: arr[k], star: arr[k + 1], items: arr.slice(k + 2, k + UNIT_STRIDE).filter(Boolean) })
  }
  return out
}

/** 배열 → [{ trait, units, tier }] */
function decodeTraits(arr) {
  const out = []
  for (let k = 0; k + TRAIT_STRIDE <= arr.length; k += TRAIT_STRIDE) out.push({ trait: arr[k], units: arr[k + 1], tier: arr[k + 2] })
  return out
}

const TIER_RANK = { EMERALD: 1, DIAMOND: 2, MASTER: 3, GRANDMASTER: 4, CHALLENGER: 5 }

/**
 * 예전 형식 "Linux Version 15.20.716.6066 (...) <Releases/15.20>" → "15.20".
 * 2026-10 현재 Riot 은 "TFT Unreal Version ?.?.?.?" 만 주므로 대부분 'unknown' → patchForTime 을 쓴다.
 */
function parsePatch(gameVersion) {
  const s = String(gameVersion || '')
  const m = /Version\s+(\d+)\.(\d+)/i.exec(s) || /Releases\/(\d+)\.(\d+)/i.exec(s)
  return m ? `${Number(m[1])}.${Number(m[2])}` : 'unknown'
}

/** "16.20.1" → "16.20" */
function patchFromDdragon(version) {
  const m = /^(\d+)\.(\d+)/.exec(String(version || ''))
  return m ? `${Number(m[1])}.${Number(m[2])}` : null
}

/**
 * 패치 달력 [{ patch, first_seen_at }] 에서 gameAtMs 시점의 패치.
 * 그 시각 이전에 보인 패치가 없으면(달력 시작 전 판) 가장 오래된 패치로 본다.
 */
function patchForTime(calendar, gameAtMs) {
  if (!calendar.length) return 'unknown'
  const sorted = [...calendar].sort((a, b) => new Date(a.first_seen_at) - new Date(b.first_seen_at))
  let current = sorted[0].patch
  for (const p of sorted) if (new Date(p.first_seen_at).getTime() <= gameAtMs) current = p.patch
  return current
}

/** epoch ms → KST 날짜 'YYYY-MM-DD' */
function kstDate(ms) {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

const clampSmallint = (n) => (Number.isFinite(n) ? Math.max(-32768, Math.min(32767, Math.round(n))) : null)

/** 이 매치에 나온 사전 키 목록 (적재 전에 한 번에 id 를 받아 오기 위해) */
function collectDictKeys(match) {
  const keys = { unit: new Set(), item: new Set(), trait: new Set() }
  for (const p of match.info?.participants || []) {
    for (const u of p.units || []) {
      if (u.character_id) keys.unit.add(u.character_id)
      for (const it of u.itemNames || []) keys.item.add(it)
    }
    for (const t of p.traits || []) if (t.tier_current > 0 && t.name) keys.trait.add(t.name)
  }
  return keys
}

/**
 * @param match Riot match-v1 응답
 * @param ctx { platform, tierBucket, patchAt?: (gameAtMs) => string }
 * @param dictId (kind, apiId) => number  (collectDictKeys 로 미리 채운 사전)
 * @returns { match, boards } 또는 null (형식이 깨진 응답)
 */
function normalizeMatch(match, { platform, tierBucket, patchAt }, dictId) {
  const info = match.info || {}
  const matchId = match.metadata?.match_id
  if (!matchId || !info.game_datetime || !Array.isArray(info.participants)) return null

  const boards = info.participants
    .filter((p) => p.placement >= 1 && p.placement <= 8)
    .map((p) => {
      const units = (p.units || []).filter((u) => u.character_id)
      const unitIds = units.map((u) => dictId('unit', u.character_id))
      const traits = (p.traits || []).filter((t) => t.tier_current > 0 && t.name)
      return {
        match_id: matchId,
        placement: p.placement,
        level: p.level || 0,
        last_round: clampSmallint(p.last_round),
        gold_left: clampSmallint(p.gold_left),
        damage: clampSmallint(p.total_damage_to_players),
        unit_ids: [...new Set(unitIds)],
        units: units.flatMap((u, k) => {
          const items = (u.itemNames || []).slice(0, 3).map((it) => dictId('item', it))
          return [unitIds[k], u.tier || 1, items[0] || 0, items[1] || 0, items[2] || 0]
        }),
        traits: traits.flatMap((t) => [dictId('trait', t.name), t.num_units || 0, t.tier_current]),
      }
    })

  // 같은 등수가 두 번 나오면(더블업 등) 기본키가 깨지므로 버린다 — 수집 대상은 1100(랭크) 단일 큐
  if (new Set(boards.map((b) => b.placement)).size !== boards.length) return null

  return {
    match: {
      match_id: matchId,
      platform,
      set_number: info.tft_set_number,
      patch: (() => {
        const fromVersion = parsePatch(info.game_version)
        return fromVersion !== 'unknown' || !patchAt ? fromVersion : patchAt(info.game_datetime)
      })(),
      queue_id: info.queue_id,
      game_at: new Date(info.game_datetime).toISOString(),
      game_date: kstDate(info.game_datetime),
      game_length_sec: clampSmallint(info.game_length),
      tier_bucket: tierBucket,
    },
    boards,
  }
}

module.exports = {
  parsePatch,
  patchFromDdragon,
  patchForTime,
  kstDate,
  collectDictKeys,
  normalizeMatch,
  decodeUnits,
  decodeTraits,
  TIER_RANK,
}

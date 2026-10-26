/**
 * 규칙 검증·게임 사실 탐지 공용 보드 로더 (scripts/checkSceneRules.js · scripts/detectGameFacts.js).
 *
 * 로비 1개 = 보드 8개. 각 보드를 앱과 같은 SlimMatchData 모양으로 만든다 —
 * 장면 규칙(lib/keyMoments)을 실제 코드 그대로 돌리기 위해서다.
 *
 * 출처 (있는 것 중 앞에서부터, --source 로 고정 가능)
 *  - db       : Supabase tft_boards (SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY). 기본은 가장 최근 패치
 *  - ladder   : data/ladderBoards.json (npm run collect:boards)
 *  - fixtures : data/evalMatches.json 의 로비 (커밋된 골든셋, 표본 작음)
 *
 * DB 에는 코스트·한글명이 없으므로 lib/constants 의 번역·코스트 표를 쓴다 (앱 lib/summarize 와 같은 결과).
 */
const fs = require('fs')
const path = require('path')
require('./_env').loadEnv()
require('./_ts')
const { translateChampion, translateItem, translateTrait, getChampionCost } = require('../lib/constants')

const ROOT = path.join(__dirname, '..')
const LADDER_PATH = path.join(ROOT, 'data', 'ladderBoards.json')
const FIXTURE_PATH = path.join(ROOT, 'data', 'evalMatches.json')

/** CLI 인자 '--key=value' / '--flag' */
function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true
}

/* ───────── 원시 보드 → SlimMatchData ───────── */

/** raw unit { id, star, items: [Riot item id] } → SlimMatchUnit */
function toUnit(u) {
  const champ = translateChampion(u.id)
  return {
    id: u.id,
    name: champ.name,
    tier: u.star || 1,
    rarity: getChampionCost(u.id) ?? champ.cost,
    items: (u.items || []).map((it) => translateItem(it).name),
    itemIds: u.items || [],
  }
}

/** raw trait { id, units, tier } → SlimMatchTrait */
const toTrait = (t) => ({ name: translateTrait(t.id).name, count: t.units, tier: t.tier, traitId: t.id })

/**
 * 원시 로비 { matchId, patch?, boards: [{ placement, level, units, traits }] } → 앱 모양 로비.
 * 각 보드는 자기 자신이 isUser 인 lobbyParticipants 를 가진 SlimMatchData 다.
 */
function lobbyFromRaw(raw) {
  const players = raw.boards
    .slice()
    .sort((a, b) => a.placement - b.placement)
    .map((b) => ({
      placement: b.placement,
      level: b.level,
      units: (b.units || []).map(toUnit),
      traits: (b.traits || []).filter((t) => t.tier > 0).map(toTrait),
    }))
  return lobbyFromSlim(raw.matchId, raw.patch || null, players)
}

/** players: [{ placement, level, units: SlimMatchUnit[], traits: SlimMatchTrait[] }] */
function lobbyFromSlim(matchId, patch, players) {
  const participants = players.map((p) => ({
    placement: p.placement,
    gameName: `#${p.placement}`,
    level: p.level,
    lastRound: '',
    damageToPlayers: 0,
    traits: p.traits || [],
    units: p.units || [],
    isUser: false,
  }))
  const boards = participants.map((p) => ({
    matchId,
    gameDatetime: 0,
    placement: p.placement,
    level: p.level,
    lastRound: '',
    goldLeft: 0,
    augments: [],
    traits: p.traits,
    units: p.units,
    lobbyParticipants: participants.map((q) => (q === p ? { ...q, isUser: true } : q)),
  }))
  return { matchId, patch, boards }
}

/* ───────── 출처별 로더 ───────── */

/**
 * 골든셋은 2026-10-19 에 캡처돼 8859eb9(10-21) 이전 시너지 오역이 그대로 들어 있다 (시너지는 id 없이 이름만 저장).
 * 지금 앱이 쓰는 이름(lib/constants translateTrait = 공식 세트18 이름)으로 바꿔 읽는다.
 */
const FIXTURE_TRAIT_RENAMES = { 난동꾼: '싸움꾼', 에메랄드: '에메랄드 성위', 라이벌: '경쟁자' }
const renameTrait = (name) => FIXTURE_TRAIT_RENAMES[name] || name

/**
 * 옛 이름 '요정' 은 요정(Fae)일 수도, 오역된 날렵이(Sprykin)일 수도 있다.
 * 보드에서 그 시너지를 가진 기물 수(게임 기준 DB)가 인원에 더 가까운 쪽으로 정한다. 둘 다 있으면 하나씩.
 */
function fixtureTraits(units, traits) {
  const { findChampion, championTraitNames } = require('../lib/gameData')
  const holders = (name) =>
    units.filter((u) => {
      const c = findChampion(u.id)
      return c ? championTraitNames(c).includes(name) : false
    }).length
  const fae = traits.filter((t) => t.name === '요정')
  const pick =
    fae.length >= 2
      ? ['요정', '날렵이']
      : fae.length === 1
        ? [Math.abs(holders('날렵이') - fae[0].count) < Math.abs(holders('요정') - fae[0].count) ? '날렵이' : '요정']
        : []
  return traits.map((t) => ({ ...t, name: t.name === '요정' ? pick.shift() : renameTrait(t.name) }))
}

function loadFixtures() {
  const data = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'))
  const lobbies = new Map()
  for (const c of data.cases || []) {
    for (const m of c.matches || []) {
      // 같은 판이 여러 케이스에 들어 있다 (로비원 여러 명의 시점). 로비가 온전한 것만 쓴다.
      if (lobbies.has(m.matchId) || (m.lobbyParticipants || []).length < 8) continue
      const players = m.lobbyParticipants.map((p) => ({ ...p, traits: fixtureTraits(p.units || [], p.traits || []) }))
      lobbies.set(m.matchId, lobbyFromSlim(m.matchId, null, players))
    }
  }
  return { source: 'fixtures', label: `골든셋 픽스처 (${path.relative(ROOT, FIXTURE_PATH)})`, lobbies: [...lobbies.values()] }
}

function loadLadder() {
  const data = JSON.parse(fs.readFileSync(LADDER_PATH, 'utf-8'))
  const lobbies = (data.matches || []).filter((m) => (m.boards || []).length === 8).map(lobbyFromRaw)
  return { source: 'ladder', label: `래더 보드 (${path.relative(ROOT, LADDER_PATH)}, ${data.updatedAt || '?'})`, lobbies }
}

async function loadDb({ patch: wantPatch, maxMatches }) {
  const { createClient } = require('@supabase/supabase-js')
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const must = ({ data, error }, what) => {
    if (error) throw new Error(`Supabase ${what}: ${error.message}`)
    return data
  }

  const names = new Map()
  for (let from = 0; ; from += 1000) {
    const rows = must(await db.from('tft_dict').select('id, api_id').range(from, from + 999), 'dict 조회')
    for (const r of rows) names.set(r.id, r.api_id)
    if (rows.length < 1000) break
  }

  let patch = wantPatch
  if (!patch) {
    const latest = must(await db.from('tft_matches').select('patch').order('game_at', { ascending: false }).limit(1), '최근 패치')
    patch = latest[0]?.patch
    if (!patch) return { source: 'db', label: 'Supabase (판 없음)', lobbies: [] }
  }

  const matchIds = []
  for (let from = 0; matchIds.length < maxMatches; from += 1000) {
    const rows = must(
      await db
        .from('tft_matches')
        .select('match_id')
        .eq('patch', patch)
        .order('game_at', { ascending: false })
        .range(from, Math.min(from + 999, maxMatches - 1)),
      '매치 목록'
    )
    matchIds.push(...rows.map((r) => r.match_id))
    if (rows.length < 1000) break
  }

  const byMatch = new Map()
  for (let i = 0; i < matchIds.length; i += 100) {
    const part = matchIds.slice(i, i + 100)
    const rows = must(
      await db.from('tft_boards').select('match_id, placement, level, units, traits').in('match_id', part).range(0, 999),
      '보드 조회'
    )
    for (const r of rows) {
      const units = []
      for (let k = 0; k + 5 <= r.units.length; k += 5) {
        units.push({ id: names.get(r.units[k]), star: r.units[k + 1], items: r.units.slice(k + 2, k + 5).filter(Boolean).map((id) => names.get(id)) })
      }
      const traits = []
      for (let k = 0; k + 3 <= r.traits.length; k += 3) traits.push({ id: names.get(r.traits[k]), units: r.traits[k + 1], tier: r.traits[k + 2] })
      if (!byMatch.has(r.match_id)) byMatch.set(r.match_id, [])
      byMatch.get(r.match_id).push({ placement: r.placement, level: r.level, units, traits })
    }
  }
  const lobbies = [...byMatch]
    .filter(([, boards]) => boards.length === 8)
    .map(([matchId, boards]) => lobbyFromRaw({ matchId, patch, boards }))
  return { source: 'db', label: `Supabase tft_boards · 패치 ${patch}`, patch, lobbies }
}

/**
 * --source=db|ladder|fixtures (기본: 쓸 수 있는 것 중 db → ladder → fixtures)
 * --patch=16.20 (db 전용, 기본 최근 패치) · --max-matches=3000 (db 전용)
 */
async function loadLobbies() {
  const want = arg('source')
  const hasDb = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  const source = want || (hasDb ? 'db' : fs.existsSync(LADDER_PATH) ? 'ladder' : 'fixtures')
  if (source === 'db') {
    if (!hasDb) throw new Error('--source=db 에는 SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 가 필요합니다')
    return loadDb({ patch: arg('patch'), maxMatches: Number(arg('max-matches', 3000)) })
  }
  if (source === 'ladder') return loadLadder()
  if (source === 'fixtures') return loadFixtures()
  throw new Error(`알 수 없는 --source=${source} (db|ladder|fixtures)`)
}

/** 마크다운 보고서를 --out 파일과 GitHub Actions 요약(GITHUB_STEP_SUMMARY)에 쓴다 */
function writeReport(markdown) {
  const out = arg('out')
  if (out && out !== true) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
    fs.writeFileSync(out, markdown, 'utf-8')
    console.log(`\n보고서: ${out}`)
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, 'utf-8')
}

/** GitHub Actions 경고 주석 (실행 목록에 노란 표시로 남는다). 로컬에서는 아무것도 안 한다 */
function annotate(title, message) {
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=${title}::${String(message).replace(/\r?\n/g, ' ')}`)
}

module.exports = { arg, loadLobbies, writeReport, annotate, lobbyFromRaw, lobbyFromSlim, fixtureTraits, toUnit }

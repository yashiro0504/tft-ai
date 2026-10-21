/**
 * 수집기 회귀 테스트 (외부 API·DB 불필요).
 *
 * 실행: node scripts/testCollect.js
 *  - 정규화: 패치 파싱 · KST 날짜 · 보드 압축 · 개인정보 제거
 *  - 시드 암호화: 왕복 · 해시 고정
 *  - 메모리 저장소: 멱등 적재 · 티어 상향 · 패치 정리
 *  - 전체 흐름: 가짜 Riot 서버로 collectDb 1회 실행 (중복 판 1회 조회 · 일반 큐 제외 · 시드 커서)
 */
process.argv.push('--dry-run')
process.env.RIOT_API_KEY = 'RGAPI-test'
process.env.RIOT_MIN_INTERVAL_MS = '1'
process.env.MAX_MINUTES = '10' // 덱 클러스터는 남은 시간이 5분 이상일 때만 돈다
process.env.TFT_SEED_KEY = 'x'.repeat(48)

const { parsePatch, patchFromDdragon, patchForTime, kstDate, collectDictKeys, normalizeMatch, decodeUnits, decodeTraits } = require('./collect/normalize')
const { createSeedCrypto } = require('./collect/seedCrypto')
const { createMemoryStore } = require('./collect/store')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  ✅ ${label}`)
  else {
    failures++
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const GAME_VERSION = 'Linux Version 15.20.716.6066 (Oct 01 2026/10:00:00) [PUBLIC] <Releases/15.20>'
function fakeMatch(id, { set = 18, queue = 1100, at = Date.UTC(2026, 9, 19, 16, 30), version = GAME_VERSION } = {}) {
  return {
    metadata: { match_id: id, participants: ['p1', 'p2'] },
    info: {
      game_datetime: at,
      game_length: 2100.5,
      game_version: version,
      queue_id: queue,
      tft_set_number: set,
      participants: Array.from({ length: 8 }, (_, i) => ({
        puuid: `secret-puuid-${i}`,
        riotIdGameName: `닉네임${i}`,
        riotIdTagline: 'KR1',
        placement: i + 1,
        level: 9 - Math.floor(i / 3),
        last_round: 38 - i,
        gold_left: i * 3,
        total_damage_to_players: 120 - i * 10,
        units: [
          { character_id: 'TFT18_Ahri', tier: 2, itemNames: ['TFT_Item_JeweledGauntlet', 'TFT_Item_GuinsoosRageblade'] },
          { character_id: 'TFT18_Garen', tier: 3, itemNames: [] },
        ],
        traits: [
          { name: 'TFT18_Arcana', num_units: 4, tier_current: 2, tier_total: 3 },
          { name: 'TFT18_Inactive', num_units: 1, tier_current: 0, tier_total: 2 },
        ],
      })),
    },
  }
}

;(async () => {
  console.log('정규화')
  check('패치 파싱', parsePatch(GAME_VERSION) === '15.20', parsePatch(GAME_VERSION))
  check('패치 파싱 실패 시 unknown', parsePatch('') === 'unknown')
  check('Data Dragon 버전 → 패치', patchFromDdragon('16.20.1') === '16.20' && patchFromDdragon('x') === null)
  const cal = [
    { patch: '16.19', first_seen_at: '2026-09-24T03:00:00Z' },
    { patch: '16.20', first_seen_at: '2026-10-08T03:00:00Z' },
  ]
  check('패치 달력: 경계 이후 판', patchForTime(cal, Date.parse('2026-10-08T05:00:00Z')) === '16.20')
  check('패치 달력: 경계 이전 판', patchForTime(cal, Date.parse('2026-10-08T01:00:00Z')) === '16.19')
  check('패치 달력: 달력 시작 전 판은 가장 오래된 패치', patchForTime(cal, Date.parse('2026-09-01T00:00:00Z')) === '16.19')
  const unreal = fakeMatch('KR_102', { version: 'TFT Unreal Version ?.?.?.?' })
  const memTmp = createMemoryStore()
  await memTmp.ensureDict(collectDictKeys(unreal))
  check(
    '새 game_version 형식은 달력으로 패치 결정',
    normalizeMatch(unreal, { platform: 'kr', tierBucket: 'MASTER', patchAt: (t) => patchForTime(cal, t) }, memTmp.dictId)
      .match.patch === '16.20'
  )
  check('KST 날짜 (UTC 16:30 → 다음날)', kstDate(Date.UTC(2026, 9, 19, 16, 30)) === '2026-10-20')

  const mem = createMemoryStore()
  const raw = fakeMatch('KR_100')
  await mem.ensureDict(collectDictKeys(raw))
  const norm = normalizeMatch(raw, { platform: 'kr', tierBucket: 'MASTER' }, mem.dictId)
  check('보드 8개', norm.boards.length === 8)
  check('비활성 시너지 제외', decodeTraits(norm.boards[0].traits).length === 1)
  check('고정 폭 배열 (기물 5칸 · 시너지 3칸)', norm.boards[0].units.length === 10 && norm.boards[0].traits.length === 3)
  const du = decodeUnits(norm.boards[0].units)
  check('기물·성급·아이템 복원', du[0].star === 2 && du[0].items.length === 2 && du[1].star === 3 && du[1].items.length === 0)
  check('정수만 저장', norm.boards[0].units.every(Number.isInteger) && norm.boards[0].traits.every(Number.isInteger))
  check('unit_ids 중복 없음', norm.boards[0].unit_ids.length === 2)
  const serialized = JSON.stringify(norm)
  check('닉네임·PUUID 미포함', !/secret-puuid|닉네임|KR1"/.test(serialized))
  check('매치 행 필드', norm.match.patch === '15.20' && norm.match.game_date === '2026-10-20' && norm.match.game_length_sec === 2101)
  const dup = fakeMatch('KR_101')
  dup.info.participants[1].placement = 1
  check('중복 등수(더블업 등) 거부', normalizeMatch(dup, { platform: 'kr', tierBucket: 'MASTER' }, mem.dictId) === null)
  console.log(`  (보드 1판 직렬화 ${serialized.length}B)`)

  console.log('시드 암호화')
  const sc = createSeedCrypto(process.env.TFT_SEED_KEY)
  const enc = sc.encrypt('puuid-abc')
  check('복호화 왕복', sc.decrypt(enc) === 'puuid-abc')
  check('암호문에 원문 없음', !enc.includes('puuid-abc'))
  check('해시 고정 · 원문과 다름', sc.hash('puuid-abc') === sc.hash('puuid-abc') && sc.hash('puuid-abc') !== 'puuid-abc')
  let shortKey = false
  try {
    createSeedCrypto('short')
  } catch {
    shortKey = true
  }
  check('짧은 키 거부', shortKey)

  console.log('메모리 저장소')
  check('첫 적재 true', (await mem.ingest(norm.match, norm.boards)) === true)
  check('재적재 false (멱등)', (await mem.ingest(norm.match, norm.boards)) === false)
  check('티어 상향', (await mem.raiseTier(['KR_100'], 'CHALLENGER')) === 1 && mem._state.matches.get('KR_100').tier_bucket === 'CHALLENGER')
  check('티어 하향 안 함', (await mem.raiseTier(['KR_100'], 'MASTER')) === 0)
  const older = normalizeMatch(fakeMatch('KR_099', { at: Date.UTC(2026, 9, 1), version: 'Version 15.19.1' }), { platform: 'kr', tierBucket: 'MASTER' }, mem.dictId)
  await mem.ingest(older.match, older.boards)
  check('패치 정리: 이전 패치 1판 삭제', (await mem.prune(1)) === 1 && mem._state.matches.size === 1 && mem._state.boards.size === 8)

  console.log('전체 흐름 (가짜 Riot)')
  const leagues = {
    challenger: [{ puuid: 'c1', leaguePoints: 1500 }],
    grandmaster: [{ puuid: 'g1', leaguePoints: 900 }],
    master: [{ puuid: 'm1', leaguePoints: 500 }, { puuid: 'm2', leaguePoints: 400 }],
  }
  const idsByPuuid = { c1: ['KR_1', 'KR_2', 'KR_3'], g1: ['KR_2', 'KR_4'], m1: ['KR_5', 'KR_NORMAL'], m2: ['KR_6'] }
  let detailCalls = 0
  global.fetch = async (url) => {
    const json = (body, status = 200) => ({ status, ok: status < 400, headers: new Map(), json: async () => body })
    let m
    if (url.includes('ddragon.leagueoflegends.com')) return json(['16.20.1', '16.19.1'])
    if ((m = /league\/v1\/(\w+)\?/.exec(url))) return json({ entries: leagues[m[1]] || [] })
    if ((m = /by-puuid\/([^/]+)\/ids/.exec(url))) return json(idsByPuuid[m[1]] || [])
    if ((m = /matches\/(KR_\w+)$/.exec(url))) {
      detailCalls++
      return json(m[1] === 'KR_NORMAL' ? fakeMatch(m[1], { queue: 1090 }) : fakeMatch(m[1]))
    }
    return json({}, 404)
  }

  const quiet = { log() {}, warn() {}, error: console.error }
  // collectDb 는 require 시점에 createMemoryStore 를 구조 분해하므로 그 전에 감싼다 (집계 실패 · 시드 손상 시나리오용)
  const storeMod = require('./collect/store')
  const realCreateMemoryStore = storeMod.createMemoryStore
  let brokenRollup = false
  let corruptSeed = false
  let preloadOld = false
  /** null 이 아니면 rawSizeMb 를 이 값으로 고정 (용량 가드 시나리오) */
  let fakeSizeMb = null
  /** 마지막으로 만든 저장소의 prune 호출 수 */
  let pruneCalls = 0
  storeMod.createMemoryStore = () => {
    const s = realCreateMemoryStore()
    pruneCalls = 0
    const origPrune = s.prune.bind(s)
    s.prune = async (k) => {
      pruneCalls++
      return origPrune(k)
    }
    if (fakeSizeMb !== null) s.rawSizeMb = async () => fakeSizeMb
    if (corruptSeed) {
      // 시드 갱신 직후 c1 의 암호문을 깨뜨린다 (다른 키로 만든 시드 흉내)
      const origUpsert = s.upsertSeeds.bind(s)
      s.upsertSeeds = async (rows) => {
        await origUpsert(rows)
        for (const seed of s._state.seeds.values()) if (sc.decrypt(seed.puuid_enc) === 'c1') seed.puuid_enc = 'broken.token'
      }
    }
    if (brokenRollup || preloadOld) {
      // 이전 패치 1판을 미리 넣어 둔다
      const origLoadDict = s.loadDict.bind(s)
      s.loadDict = async () => {
        await origLoadDict()
        const oldRaw = fakeMatch('KR_OLD', { at: Date.UTC(2026, 9, 1), version: 'Version 15.19.1' })
        await s.ensureDict(collectDictKeys(oldRaw))
        const o = normalizeMatch(oldRaw, { platform: 'kr', tierBucket: 'MASTER' }, s.dictId)
        await s.ingest(o.match, o.boards)
        if (preloadOld) {
          // 용량 가드 시나리오: 수집 전에도 최신 패치 판이 있어야 KEEP_PATCHES=1 정리가 이전 패치를 지운다
          const cur = normalizeMatch(fakeMatch('KR_CUR'), { platform: 'kr', tierBucket: 'MASTER' }, s.dictId)
          await s.ingest(cur.match, cur.boards)
        }
      }
    }
    if (brokenRollup) {
      s.refreshRollup = async () => {
        throw new Error('rollup boom')
      }
    }
    return s
  }
  const { main, CFG, shouldPrune, shouldPruneOnLimit, resolveLimitConfig, refreshAggregates, collectionDeadline } = require('./collectDb')
  const first = await main({ log: quiet })
  const st = first.store._state
  check('1회차: 랭크 6판 적재', first.stats.matches_added === 6, `added=${first.stats.matches_added}`)
  check('1회차: 일반 큐 제외', first.stats.matches_skipped === 1 && !st.matches.has('KR_NORMAL'))
  check('1회차: 겹친 판(KR_2) 상세 1회만 조회', detailCalls === 7, `detail=${detailCalls}`)
  check('1회차: 첫 시드 티어 기록', st.matches.get('KR_1').tier_bucket === 'CHALLENGER' && st.matches.get('KR_5').tier_bucket === 'MASTER')
  check('시드 4명 · 커서 저장', st.seeds.size === 4 && [...st.seeds.values()].every((s) => s.checked_at))
  check('시드 PUUID 암호화 저장', [...st.seeds.values()].every((s) => !['c1', 'g1', 'm1', 'm2'].includes(s.puuid_enc) && ['c1', 'g1', 'm1', 'm2'].includes(sc.decrypt(s.puuid_enc))))
  check('패치 달력 기록 (Data Dragon)', st.patches.has('16.20'))
  check('실행 기록', st.runs.length === 1 && st.runs[0].matches_added === 6)

  // Phase B: 이번 실행에 들어온 조합 집계 + 첫 실행이므로 덱 클러스터(일 1회)
  const rolled = [...st.rollups.values()].reduce((s, r) => s + r.totals.matches, 0)
  check('집계: 적재한 6판이 모두 일별 집계에 들어감', rolled === 6 && !first.aggregates.error, `집계 ${rolled}판`)
  check('집계: 판 티어별 조합 (CHALLENGER · GRANDMASTER · MASTER)', st.rollups.size === 3, [...st.rollups.keys()].join(', '))
  check('덱 클러스터: 최신 패치 × 티어 필터 4개 갱신', first.aggregates.latestPatch === '15.20' && st.comps.size === 4)

  console.log('집계 실패 시 원본 정리 건너뜀 (REVIEW R2)')
  check('shouldPrune: 집계 오류면 false · 성공이면 true', shouldPrune({ error: 'x' }) === false && shouldPrune({ error: null }) === true && shouldPrune(null) === false)
  brokenRollup = true
  const broken = await main({ log: quiet })
  brokenRollup = false
  const bst = broken.store._state
  check('집계 실패 → 이전 패치 원본(KR_OLD) 보존', broken.aggregates.error === 'rollup boom' && bst.matches.has('KR_OLD'), `matches=${[...bst.matches.keys()].join(',')}`)
  check('실행 기록 note 에 건너뜀 사유', /원본 정리를 건너뜀/.test(bst.runs[0].note || ''), bst.runs[0].note)

  console.log('용량 가드: 소프트/하드 한도 분리 (FOLLOWUP F1)')
  const lim = { maxRawMb: 400, maxRawMbHard: 480, pruneOnLimit: false }
  check(
    'shouldPruneOnLimit: 한도 이하 false · 소프트 opt-in 만 · 하드는 항상',
    shouldPruneOnLimit(400, lim) === false &&
      shouldPruneOnLimit(450, lim) === false &&
      shouldPruneOnLimit(450, { ...lim, pruneOnLimit: true }) === true &&
      shouldPruneOnLimit(481, lim) === true
  )
  // 하드 < 소프트 설정 방어 (FOLLOWUP2 G1)
  const r1 = resolveLimitConfig(400, 480)
  const r2 = resolveLimitConfig(500, 480)
  check('resolveLimitConfig: 정상 설정 유지 · 하드 < 소프트면 소프트로 보정', r1.maxRawMb === 400 && r1.maxRawMbHard === 480 && r2.maxRawMb === 500 && r2.maxRawMbHard === 500, JSON.stringify([r1, r2]))
  const inverted = { ...r2, pruneOnLimit: false }
  check(
    '하드 < 소프트(500/480): 490MB 정리 없음 · 501MB 하드 정리 · 보정 전 cfg 를 넘겨도 같음',
    shouldPruneOnLimit(490, inverted) === false &&
      shouldPruneOnLimit(501, inverted) === true &&
      shouldPruneOnLimit(490, { maxRawMb: 500, maxRawMbHard: 480, pruneOnLimit: false }) === false
  )
  check('정상 설정(400/480) 450MB 는 PRUNE_ON_LIMIT 에 따름', shouldPruneOnLimit(450, { ...r1, pruneOnLimit: false }) === false && shouldPruneOnLimit(450, { ...r1, pruneOnLimit: true }) === true)

  // 집계가 계속 실패해 이전 패치 원본(KR_OLD)이 쌓인 상황
  const runWithSize = async (mb, pruneOnLimit, limits = { maxRawMb: 400, maxRawMbHard: 480 }) => {
    const saved = { pruneOnLimit: CFG.pruneOnLimit, maxRawMb: CFG.maxRawMb, maxRawMbHard: CFG.maxRawMbHard }
    Object.assign(CFG, { pruneOnLimit }, resolveLimitConfig(limits.maxRawMb, limits.maxRawMbHard))
    fakeSizeMb = mb
    preloadOld = true
    // 하드 한도 정리는 log.error 로 남는다 (테스트 출력에서는 숨김)
    const r = await main({ log: { ...quiet, error() {} } })
    preloadOld = false
    fakeSizeMb = null
    Object.assign(CFG, saved)
    return { r, calls: pruneCalls, st: r.store._state }
  }
  const soft = await runWithSize(450, false)
  check(
    '소프트 한도 기본: 정리 없이 수집 중단 · KR_OLD 보존 · note',
    soft.calls === 0 && soft.st.matches.has('KR_OLD') && soft.r.stats.matches_added === 0 && /용량 한도 초과/.test(soft.st.runs[0].note || ''),
    `prune=${soft.calls} note=${soft.st.runs[0].note}`
  )
  const optIn = await runWithSize(450, true)
  check('소프트 한도 + PRUNE_ON_LIMIT=1: 정리', optIn.calls === 1 && !optIn.st.matches.has('KR_OLD'), `prune=${optIn.calls}`)
  const hardRun = await runWithSize(500, false)
  check(
    '하드 한도: 설정과 무관하게 정리 · note',
    hardRun.calls === 1 && !hardRun.st.matches.has('KR_OLD') && /하드 한도 초과/.test(hardRun.st.runs[0].note || ''),
    `prune=${hardRun.calls} note=${hardRun.st.runs[0].note}`
  )

  // G1 통합: MAX_RAW_MB=500 / HARD=480 → 490MB 는 한도 이하라 정리·건너뜀 없음, 501MB 는 하드 정리
  const below = await runWithSize(490, false, { maxRawMb: 500, maxRawMbHard: 480 })
  check(
    '하드 < 소프트 설정 · 490MB: 정리 없음 · 하드 note 없음 · 수집 진행',
    below.calls <= 1 && below.st.matches.has('KR_CUR') && !/하드 한도 초과|용량 한도 초과/.test(below.st.runs[0].note || '') && below.r.stats.matches_added > 0,
    `prune=${below.calls} added=${below.r.stats.matches_added} note=${below.st.runs[0].note}`
  )
  const above = await runWithSize(501, false, { maxRawMb: 500, maxRawMbHard: 480 })
  check('하드 < 소프트 설정 · 501MB: 하드 정리 + note', above.calls === 1 && /하드 한도 초과\(501MB > 500MB\)/.test(above.st.runs[0].note || ''), above.st.runs[0].note)

  console.log('시드 복호화 실패 격리 (REVIEW R9)')
  corruptSeed = true
  const withBad = await main({ log: quiet })
  corruptSeed = false
  const wst = withBad.store._state
  // c1 의 판(KR_1·KR_3)만 빠지고 나머지 시드의 판은 수집된다 (KR_2 는 g1 에도 있음)
  check('복호화 불가 시드 1건 → 나머지 시드 수집 계속', withBad.stats.matches_added === 4 && !wst.matches.has('KR_1') && wst.matches.has('KR_2') && wst.matches.has('KR_6'), `added=${withBad.stats.matches_added}`)
  check('실패 시드 수가 실행 기록에 남음', /시드 복호화 실패 1건/.test(wst.runs[0].note || ''), wst.runs[0].note)

  console.log('덱 클러스터 시간 확보 (REVIEW R3)')
  const MIN = 60 * 1000
  check('수집 종료 = MAX_MINUTES − 7분 (짧은 실행은 절반)', collectionDeadline(0, 50) === 43 * MIN && collectionDeadline(0, 10) === 5 * MIN)
  const deckStore = realCreateMemoryStore()
  for (const id of ['KR_D1', 'KR_D2']) {
    const r = fakeMatch(id)
    await deckStore.ensureDict(collectDictKeys(r))
    const n = normalizeMatch(r, { platform: 'kr', tierBucket: 'MASTER' }, deckStore.dictId)
    await deckStore.ingest(n.match, n.boards)
  }
  const t0 = Date.now()
  const runDeadline = t0 + 50 * MIN
  // 수집이 자기 몫(43분)을 다 쓰고 마지막 판 조회로 90초 넘친 시점
  const exhausted = await refreshAggregates({ store: deckStore, dirty: new Set(), deadline: runDeadline, log: quiet, now: () => collectionDeadline(t0, 50) + 90 * 1000 })
  check('수집이 시간을 다 써도 덱 클러스터 재빌드', !exhausted.error && exhausted.comps && deckStore._state.comps.size === 4, JSON.stringify(exhausted))
  const warns = []
  const lateStore = realCreateMemoryStore()
  await lateStore.ensureDict(collectDictKeys(fakeMatch('KR_D3')))
  const n3 = normalizeMatch(fakeMatch('KR_D3'), { platform: 'kr', tierBucket: 'MASTER' }, lateStore.dictId)
  await lateStore.ingest(n3.match, n3.boards)
  const late = await refreshAggregates({ store: lateStore, dirty: new Set(), deadline: runDeadline, log: { ...quiet, warn: (m) => warns.push(m) }, now: () => runDeadline - MIN })
  check('정말 시간이 없으면 미루고 note · 24시간+ 미갱신 경고', late.comps === null && /미룸/.test(late.note) && /미갱신/.test(late.note) && warns.some((w) => /덱 클러스터/.test(w)), `${late.note} / ${warns.join(' | ')}`)
})()
  .catch((e) => {
    failures++
    console.error(e)
  })
  .finally(() => {
    console.log(failures ? `\n❌ 실패 ${failures}건` : '\n✅ 수집기 테스트 통과')
    if (failures) process.exitCode = 1
  })

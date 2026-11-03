/**
 * 세트(시즌) 전환 회귀 테스트 (외부 API·DB 불필요) — docs/SEASON-TRANSITION.md
 *
 * 실행: node scripts/testSeason.js (npm run test:season)
 *  - 수집 기준 세트 = lib/gameData.lite.json (SET_NUMBER 로 덮어쓰기)
 *  - 게임 데이터 자동 세트(--set=auto): DB 최고 세트 · Community Dragon 에 없으면 유지 · overrides 세트 판정 · 시각만 바뀐 파일은 다시 쓰지 않음
 *  - 사이트: 게임 데이터보다 높은 세트 판도 분석 대상 · 이전 세트 패치 플레이북을 새 세트 덱에 붙이지 않음
 *  - 하드코딩 금지: 수집기·화면에 세트 번호 리터럴이 다시 들어오지 않음
 */
require('./_ts')
const fs = require('fs')
const path = require('path')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  ✅ ${label}`)
  else {
    failures++
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const ROOT = path.join(__dirname, '..')
const lite = require('../lib/gameData.lite.json')

;(async () => {
  console.log('수집 기준 세트')
  const season = require('./_season')
  const saved = process.env.SET_NUMBER
  delete process.env.SET_NUMBER
  check('기본 = lib/gameData.lite.json 의 set', season.configuredSet() === lite.set, String(season.configuredSet()))
  process.env.SET_NUMBER = String(lite.set + 1)
  check('SET_NUMBER 환경변수가 우선', season.configuredSet() === lite.set + 1)
  if (saved == null) delete process.env.SET_NUMBER
  else process.env.SET_NUMBER = saved

  console.log('게임 데이터 자동 세트 (--set=auto)')
  const realFetch = global.fetch
  const { resolveAutoSet, sameIgnoringTime, overrideSetOf } = require('./buildGameData')
  const quiet = { warn: console.warn, log: console.log }
  console.warn = () => {}
  console.log = () => {}
  const withDb = async (dbSet, available) => {
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
    global.fetch = async () => ({ ok: true, status: 200, json: async () => (dbSet == null ? [] : [{ set_number: dbSet }]) })
    try {
      return await resolveAutoSet(available)
    } finally {
      delete process.env.SUPABASE_URL
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
      global.fetch = realFetch
    }
  }
  const cur = lite.set
  const results = {
    same: await withDb(cur, [cur - 1, cur]),
    next: await withDb(cur + 1, [cur, cur + 1]),
    notYet: await withDb(cur + 1, [cur]),
    empty: await withDb(null, [cur]),
    noKey: await resolveAutoSet([cur, cur + 1]),
  }
  console.warn = quiet.warn
  console.log = quiet.log
  check('DB 최고 세트 = 지금 세트 → 그대로', results.same === cur)
  check('DB 에 다음 세트 판 + Community Dragon 에 데이터 → 다음 세트로', results.next === cur + 1)
  check('DB 에 다음 세트 판인데 Community Dragon 에 아직 없음 → 지금 세트 유지', results.notYet === cur)
  check('DB 비었거나 키 없음 → 지금 세트 (Community Dragon 에 다음 세트가 먼저 보여도 넘어가지 않음)', results.empty === cur && results.noKey === cur)
  check('overrides 키의 세트', overrideSetOf('DA_18_ElderDragon') === 18 && overrideSetOf('TFT19_Foo') === 19 && overrideSetOf('DA_Lux18_Base') === null)
  check('generatedAt 만 다르면 같은 파일', sameIgnoringTime({ a: 1, generatedAt: 'x' }, { a: 1, generatedAt: 'y' }) && !sameIgnoringTime({ a: 1 }, { a: 2 }))

  console.log('사이트: 세트 경계')
  const { isCurrentSetMatch, isAnalyzableMatch } = require('../lib/queue')
  const { CURRENT_SET, isCurrentSetPatch, patchOrdinal } = require('../lib/gameFacts')
  check(
    '게임 데이터보다 높은 세트 판도 분석 대상 (게임 데이터 배포 전 공백 방지) · 이전 세트는 제외',
    isCurrentSetMatch({ setNumber: CURRENT_SET + 1 }) && isAnalyzableMatch({ queueId: 1100, setNumber: CURRENT_SET + 1 }) && !isCurrentSetMatch({ setNumber: CURRENT_SET - 1 })
  )
  check('패치 순서 비교', patchOrdinal('16.21') > patchOrdinal('16.9') && patchOrdinal('set18') === -1)
  check('세트 첫 패치를 모르면 숫자 패치는 모두 현재 세트', lite.setFirstPatch ? true : isCurrentSetPatch('16.1') && !isCurrentSetPatch('set18'))

  // 세트 첫 패치가 있는 게임 데이터로 플레이북 선택을 확인한다 (lib/gameFacts 를 새 lite 로 다시 읽는다)
  const litePath = require.resolve('../lib/gameData.lite.json')
  const factsPath = require.resolve('../lib/gameFacts')
  const playbookPath = require.resolve('../lib/playbook')
  const swap = (obj) => {
    require.cache[litePath].exports = obj
    delete require.cache[factsPath]
    delete require.cache[playbookPath]
  }
  const original = require.cache[litePath].exports
  swap({ ...original, set: original.set + 1, setFirstPatch: '16.23' })
  try {
    const facts = require('../lib/gameFacts')
    const { choosePlaybook } = require('../lib/playbook')
    check('세트 첫 패치 이후만 현재 세트 패치', facts.isCurrentSetPatch('16.23') && facts.isCurrentSetPatch('16.24') && !facts.isCurrentSetPatch('16.22'))
    const row = (patch, sample, snap = `${patch}|MASTER|1`) => ({ patch, sample_n: sample, snapshot_id: snap, deck_key: 'ladder-kogmaw' })
    // 새 세트 첫 패치(16.23) 표본이 아직 적고, 같은 덱 id 의 이전 세트(16.22) 행만 300판+
    const picked = choosePlaybook([row('16.23', 150), row('16.22', 900)], { snapshotId: '16.23|MASTER|1', patch: '16.23' })
    check('이전 세트 패치(16.22) 플레이북은 새 세트 덱에 붙이지 않음 → 지금 스냅샷 부분 행', picked?.playbook.patch === '16.23' && !picked.label, JSON.stringify(picked))
    const sameSet = choosePlaybook([row('16.24', 150), row('16.23', 900)], { snapshotId: '16.24|MASTER|1', patch: '16.24' })
    check('같은 세트의 이전 패치는 지금처럼 "이전 패치 기준"으로 씀', sameSet?.playbook.patch === '16.23' && /이전 패치/.test(sameSet.label || ''), JSON.stringify(sameSet))
  } finally {
    swap(original)
  }

  console.log('하드코딩 금지')
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')
  for (const rel of ['scripts/collectDb.js', 'scripts/collectLadderBoards.js', 'scripts/collectTopPlayers.js', 'scripts/buildMetaStatsLadder.js', 'scripts/buildGameData.js']) {
    const src = read(rel)
    check(`${rel}: 세트 번호 리터럴 없음`, !/SET_NUMBER\s*=\s*\d|'SET_NUMBER',\s*\d|'set\d+'|arg\('set'\)\s*\|\|\s*\d/.test(src))
  }
  const uiHits = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name)
      if (e.isDirectory()) walk(rel)
      else if (/\.(ts|tsx)$/.test(e.name) && /(시즌|SET) \d{2}\b/.test(read(rel))) uiHits.push(rel)
    }
  }
  walk('app')
  walk('lib')
  check("화면 문구에 '시즌 NN'·'SET NN' 리터럴 없음 (CURRENT_SET 사용)", uiHits.length === 0, uiHits.join(', '))
})()
  .catch((e) => {
    failures++
    console.error(e)
  })
  .finally(() => {
    console.log(failures ? `\n❌ 실패 ${failures}건` : '\n✅ 세트 전환 테스트 통과')
    if (failures) process.exitCode = 1
  })

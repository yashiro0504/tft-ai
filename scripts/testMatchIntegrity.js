/**
 * 경기 데이터 무결성 테스트 (2026-10-28 재평가 P0) — 네트워크 없이 돈다.
 *
 *  1. 경과 시간: 캐시에는 경기 시각만 두고 화면에서 현재 시각으로 계산한다 (lib/timeAgo). 목록은 최신순.
 *  2. 소환·복제 기물: 같은 기물·성급 3장 이상(장로 드래곤 9개)은 복제로 보고 한 장만 남긴다 (lib/boardUnits).
 *     초반 종료는 탈락 라운드로만 판정하고, 늦게 끝났는데 기물이 적은 판은 '보드 데이터 불완전'으로 따로 센다 (lib/quality).
 *
 * 실행: node scripts/testMatchIntegrity.js   (npm run test:ai 에 포함)
 */
require('./_ts')
const fs = require('fs')
const path = require('path')
const { formatTimeAgo, sortByRecent } = require('../lib/timeAgo')
const { cleanBoardUnits, normalizeSlimMatch } = require('../lib/boardUnits')
const { isEarlyGame, sampleIssue, lowSampleReason } = require('../lib/quality')
const { CURRENT_SET } = require('../lib/gameFacts')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  ✅ ${label}`)
  else {
    failures++
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const HOUR = 3600_000
const NOW = Date.UTC(2026, 9, 28, 1, 0, 0)

console.log('경과 시간 (화면에서 현재 시각으로 계산)')
check('19시간 전 경기는 이틀 뒤 "2일 전"', formatTimeAgo(NOW - 19 * HOUR, NOW + 29 * HOUR) === '2일 전', formatTimeAgo(NOW - 19 * HOUR, NOW + 29 * HOUR))
check('4시간 전 경기는 하루 뒤 "1일 전"', formatTimeAgo(NOW - 4 * HOUR, NOW + 24 * HOUR) === '1일 전')
check('1분 미만은 "1분 전"', formatTimeAgo(NOW - 10_000, NOW) === '1분 전')
check('시각이 없으면 "최근"', formatTimeAgo(0, NOW) === '최근')
{
  const list = sortByRecent([{ id: 'b', gameDatetime: NOW - 5 * HOUR }, { id: 'a', gameDatetime: NOW - HOUR }, { id: 'c', gameDatetime: NOW - 50 * HOUR }])
  const ages = list.map((m) => NOW - m.gameDatetime)
  check('목록은 최신순 — 경과 시간이 위에서 아래로 단조 증가', list.map((m) => m.id).join('') === 'abc' && ages.every((a, i) => i === 0 || a >= ages[i - 1]))
}
{
  const n = normalizeSlimMatch({ matchId: 'x', setNumber: CURRENT_SET, gameDatetime: NOW, timeAgo: '19시간 전', level: 8, units: [], traits: [] })
  check('예전 캐시의 경과 시간 문자열은 읽을 때 지움', !('timeAgo' in n) && n.gameDatetime === NOW)
}
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'summarize.ts'), 'utf8')
  check('매치 요약(캐시 값)에 경과 시간 문자열을 넣지 않음', !/timeAgo:\s*formatTimeAgo/.test(src))
}

console.log('소환·복제 기물')
const U = (id, tier = 1, items = 0) => ({ id, name: id, tier, rarity: 1, items: Array.from({ length: items }, (_, i) => `I${i}`) })
{
  // 빈 틈#123 3등 34분 12초: 유닛 20, 장로 드래곤 9개 (협곡야수 복제)
  const others = ['DA_18_Ezreal', 'DA_18_Sett', 'DA_18_Ahri', 'DA_Taric18', 'DA_18_Morgana', 'DA_Sentinel18', 'DA_Brambleback18', 'DA_Krug18']
  const units = [
    U('DA_18_ElderDragon', 2, 3),
    ...Array.from({ length: 8 }, () => U('DA_18_ElderDragon', 2, 0)),
    ...others.map((id) => U(id, 2, 1)),
    U('DA_Sentinel18', 1), U('DA_Brambleback18', 1), U('DA_Krug18', 1),
  ]
  const r = cleanBoardUnits(units, { setNumber: CURRENT_SET, level: 10 })
  const elder = r.units.filter((u) => u.id === 'DA_18_ElderDragon')
  check('유닛 20 → 10 이하', units.length === 20 && r.units.length <= 10, `${r.units.length}`)
  check('장로 드래곤은 한 장 (아이템 든 것)', elder.length === 1 && elder[0].items.length === 3)
}
{
  const units = [U('DA_18_Morgana', 1, 3), U('DA_18_Morgana', 1, 0), U('DA_18_Elise', 3, 3)]
  check('같은 1성 두 장은 실제 보드일 수 있어 남김', cleanBoardUnits(units, { setNumber: CURRENT_SET, level: 7 }).units.length === 3)
}
{
  const units = [U('DA_Sentinel18', 2, 1), U('DA_Sentinel18', 2), U('DA_Sentinel18', 1), U('DA_Sentinel18', 1), U('DA_18_Varus'), U('DA_Vi18')]
  check('2성 두 장 + 1성 두 장 (칸 여유 있음) 은 그대로', cleanBoardUnits(units, { setNumber: CURRENT_SET, level: 8 }).units.length === 6)
}
check('현재 세트에 없는 id(소환수)는 뺌', cleanBoardUnits([U('DA_18_Ahri', 2), U('DA_18_ElderwoodPlant_Fake')], { setNumber: CURRENT_SET }).units.length === 1)
check('이전 세트 판은 기물 목록으로 거르지 않음', cleanBoardUnits([U('TFT16_Something')], { setNumber: CURRENT_SET - 2 }).units.length === 1)
{
  // 픽스처·골든셋 실제 보드는 하나도 바뀌지 않아야 한다
  function* walk(o) {
    if (Array.isArray(o)) for (const v of o) yield* walk(v)
    else if (o && typeof o === 'object') {
      if (Array.isArray(o.units) && typeof o.level === 'number') yield o
      for (const v of Object.values(o)) yield* walk(v)
    }
  }
  let boards = 0
  let changed = 0
  for (const f of ['evalMatches.json', 'goldenLabels.json']) {
    const file = path.join(__dirname, '..', 'data', f)
    if (!fs.existsSync(file)) continue
    for (const b of walk(JSON.parse(fs.readFileSync(file, 'utf8')))) {
      boards++
      if (cleanBoardUnits(b.units, { setNumber: b.setNumber ?? CURRENT_SET, level: b.level }).removed) changed++
    }
  }
  check(`실제 보드 ${boards}개는 그대로 (오탐 0)`, boards > 0 && changed === 0, `${changed}개 바뀜`)
}

console.log('초반 종료 vs 보드 데이터 불완전')
const base = { matchId: 'm', setNumber: CURRENT_SET, gameDatetime: NOW, queueId: 1100, level: 8, goldLeft: 0, augments: [], traits: [] }
{
  // 빈 틈#123 2등 6-2 33분 57초: 기물 3개만 잡힘
  const m = { ...base, placement: 2, lastRound: '6-2', gameLengthSec: 2037, units: [U('DA_Brambleback18', 2, 3), U('DA_18_Malphite', 2, 3), U('DA_Brambleback18', 1)] }
  check('6-2 2등 기물 3개 → 초반 종료 아님, 보드 데이터 불완전', sampleIssue(m) === 'incomplete' && isEarlyGame(m), sampleIssue(m))
  check('사유 문구에 "보드 데이터 불완전"', lowSampleReason(m).startsWith('보드 데이터 불완전') && !lowSampleReason(m).includes('초반'), lowSampleReason(m))
}
{
  const m = { ...base, placement: 8, lastRound: '2-5', gameLengthSec: 700, units: [U('DA_18_Camille', 3, 2)] }
  check('2-5 탈락은 초반 종료', sampleIssue(m) === 'early' && lowSampleReason(m) === '2-5 초반 종료')
}
{
  const m = { ...base, placement: 6, lastRound: '4-3', gameLengthSec: 850, units: Array.from({ length: 7 }, (_, i) => U(`DA_18_${['Ahri', 'Sett', 'Ashe', 'Yunara', 'Yorick', 'Karma', 'MasterYi_AD'][i]}`, 2)) }
  check('4-3 탈락은 게임이 짧아도 정상 표본', sampleIssue(m) === null)
}
{
  const { buildDeckReport } = require('../lib/deckReport')
  const keys = ['Ahri', 'Sett', 'Morgana', 'Diana', 'Sentinel']
  const deck = { name: '테스트', avgPlacement: 4, sampleSize: 200, units: keys.map((k) => ({ key: `TFT18_${k}`, name: k })) }
  const g = (id, p, extra = {}) => ({ ...base, matchId: id, placement: p, lastRound: '5-5', units: keys.map((k) => U(`DA_18_${k}`, 2)), ...extra })
  const r = buildDeckReport(
    [g('a', 3), g('b', 4), g('c', 5), g('early', 8, { lastRound: '2-6' }), g('inc', 2, { lastRound: '6-2', units: [U('DA_18_Ahri', 2)] })],
    [deck]
  )
  const sum = r.rows.reduce((s, x) => s + x.games, 0) + r.unmatched.games + r.early + r.incomplete
  check('덱 성적표: 초반 종료 1 · 보드 불완전 1 따로 셈', r.early === 1 && r.incomplete === 1, JSON.stringify({ early: r.early, incomplete: r.incomplete }))
  check('덱 성적표 합계 = 분석 경기 수', sum === r.total && r.total === 5, `${sum} / ${r.total}`)
}

if (failures) {
  console.error(`\n❌ 경기 데이터 무결성 테스트 실패 ${failures}건`)
  process.exit(1)
}
console.log('\n✅ 경기 데이터 무결성 테스트 통과')

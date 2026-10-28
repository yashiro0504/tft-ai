/**
 * 운영 점검(scripts/checkOps.js) 순수 함수 테스트 (네트워크·DB 불필요).
 *
 * 실행: node scripts/testOps.js
 *  - comparePatchDesc: 숫자.숫자 패치 내림차순 · 비숫자 패치도 결정적
 *  - latestPatchFreshness: 덱 클러스터 신선도는 전역 최신 행이 아니라 최신 패치 기준
 *  - freshnessLevel: 24시간 / 72시간 판정 (stat_comp · stat_unit_build 공통)
 */
const { comparePatchDesc, latestPatchFreshness, freshnessLevel, snapshotHealth, SNAPSHOT_MAX_AGE_H } = require('./checkOps')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  ✅ ${label}`)
  else {
    failures++
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-10-20T12:00:00Z')
const ago = (h) => new Date(NOW - h * HOUR).toISOString()
const rows = (spec) => spec.flatMap(([patch, h, tiers = ['MASTER']]) => tiers.map((tier_min) => ({ patch, tier_min, updated_at: ago(h) })))

console.log('패치 비교')
check('16.20 > 16.9 > 15.24 (숫자 비교)', JSON.stringify(['16.9', '15.24', '16.20'].sort(comparePatchDesc)) === JSON.stringify(['16.20', '16.9', '15.24']))
const mixed = ['set18', '16.20', 'unknown', '16.19']
const sorted1 = [...mixed].sort(comparePatchDesc)
const sorted2 = [...mixed].reverse().sort(comparePatchDesc)
check('비숫자 패치는 숫자 패치 뒤 · 입력 순서와 무관하게 같은 결과', sorted1[0] === '16.20' && sorted1[1] === '16.19' && JSON.stringify(sorted1) === JSON.stringify(sorted2), JSON.stringify(sorted1))

console.log('덱 클러스터 신선도 (최신 패치 기준)')
// 이전 패치가 최근에 다시 빌드돼도 최신 패치가 늦으면 미충족 (기존 구현은 전역 최신 1행이라 통과하던 케이스)
const stale = latestPatchFreshness(rows([['16.19', 1], ['16.20', 30, ['MASTER', 'CHALLENGER']]]), NOW)
check('16.19 1시간 전 + 16.20 30시간 전 → 최신 패치 16.20 · 30시간 (24시간 초과)', stale.latestPatch === '16.20' && Math.round(stale.ageH) === 30 && stale.ageH > 24, JSON.stringify(stale))
check('최신 패치의 티어 필터별 빌드 시각', Object.keys(stale.byTier).sort().join(',') === 'CHALLENGER,MASTER')
const fresh = latestPatchFreshness(rows([['16.20', 2], ['16.19', 50]]), NOW)
check('16.20 2시간 전 + 16.19 50시간 전 → 최신 패치 2시간 (충족)', fresh.latestPatch === '16.20' && Math.round(fresh.ageH) === 2 && fresh.ageH <= 24, JSON.stringify(fresh))
const partial = latestPatchFreshness(rows([['16.20', 30, ['DIAMOND']], ['16.20', 3, ['MASTER']]]), NOW)
check('같은 패치 안에서는 가장 최근 빌드 기준', Math.round(partial.ageH) === 3)
const empty = latestPatchFreshness([], NOW)
check('빈 배열 → 패치 없음 · Infinity (미충족)', empty.latestPatch === null && empty.ageH === Infinity && !(empty.ageH <= 24))
let threw = false
let withSet
try {
  withSet = latestPatchFreshness(rows([['set18', 1], ['16.20', 5]]), NOW)
} catch {
  threw = true
}
check("'set18' 같은 비숫자 패치가 섞여도 throw 없이 숫자 패치 우선", !threw && withSet.latestPatch === '16.20' && Math.round(withSet.ageH) === 5)

console.log('신선도 판정 (stat_comp · stat_unit_build 공통)')
const level = (spec) => freshnessLevel(latestPatchFreshness(rows(spec), NOW))
check('24시간 이내 → ok', level([['16.21', 23]]) === 'ok', level([['16.21', 23]]))
check('24~72시간 → stale', level([['16.21', 30]]) === 'stale', level([['16.21', 30]]))
check('72시간 초과 → critical', level([['16.21', 73]]) === 'critical', level([['16.21', 73]]))
check('빌드 없음 → empty', freshnessLevel(latestPatchFreshness([], NOW)) === 'empty')

console.log('메타 덱 스냅샷 신선도 (2026-10-28 16시 재확인 P0)')
check('DB 집계 · 3시간 전 → 정상', snapshotHealth({ source: 'db', updatedAt: ago(3) }, NOW).ok)
check(`DB 집계 · ${SNAPSHOT_MAX_AGE_H + 1}시간 전 → 알림 (덱 클러스터 주기 8시간 + 6시간 초과)`, !snapshotHealth({ source: 'db', updatedAt: ago(SNAPSHOT_MAX_AGE_H + 1) }, NOW).ok)
const jsonFb = snapshotHealth({ source: 'json', updatedAt: ago(1), fallbackReason: 'db_error' }, NOW)
check('래더 JSON 폴백(db_error) → 알림 (스냅샷 생성 실패)', !jsonFb.ok && jsonFb.reason.includes('db_error'), jsonFb.reason)
check('decksMeta 없음 → 알림 (메타 화면이 스냅샷을 안 읽음)', !snapshotHealth(undefined, NOW).ok)
check('새 패치 표본 부족(small_sample) 래더 표본 → 실패 아님', snapshotHealth({ source: 'json', updatedAt: ago(30), fallbackReason: 'small_sample' }, NOW).ok)
const wf = require('fs').readFileSync(require('path').join(__dirname, '..', '.github', 'workflows', 'meta-snapshot-check.yml'), 'utf8')
check('스냅샷 점검 워크플로: 2시간마다 --snapshot-only --strict', /cron: '\d+ \*\/2 \* \* \*'/.test(wf) && /--snapshot-only/.test(wf) && /--strict/.test(wf))

console.log(failures ? `\n❌ 실패 ${failures}건` : '\n✅ 운영 점검 테스트 통과')
if (failures) process.exitCode = 1

/**
 * AI 분석 횟수 차감 테스트 (2026-10-29 지시문 2 · 네트워크·Redis·Supabase 불필요 — IP 기준 메모리 경로).
 *
 *  - 이미 분석한 경기(캐시 적중)를 다시 분석해도 남은 횟수가 그대로
 *  - 새 경기는 정확히 1회 차감
 *  - 생성 실패면 차감 없음
 *  - 같은 경기 분석을 빠르게 두 번(동시) 보내도 1회만 차감
 *  - 라우트는 새 AI 리포트(캐시 아님·폴백 아님)일 때만 chargeQuotaOnce, 화면 문구
 *
 * 실행: node scripts/testQuotaCharge.js
 */
require('./_ts')
const fs = require('fs')
const path = require('path')
delete process.env.UPSTASH_REDIS_REST_URL
delete process.env.KV_REST_API_URL
const { NextRequest } = require('next/server')
const { quotaCheck, quotaStatus, chargeQuotaOnce } = require('../lib/apiUtils')

let failures = 0
function check(label, ok, detail = '') {
  if (ok) console.log(`  ✅ ${label}`)
  else {
    failures++
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const LIMIT = 3
let ipSeq = 0
const mkReq = (ip) => new NextRequest('http://localhost/api/tft/match', { method: 'POST', headers: { 'x-forwarded-for': ip } })

async function main() {
  const ip = `198.51.100.${++ipSeq}`
  /** 라우트와 같은 순서: 확인 → (생성) → 성공했으면 차감, 캐시면 상태만 */
  async function analyze(key, { cached = false, fail = false } = {}) {
    const req = mkReq(ip)
    const blocked = await quotaCheck(req, 'analysis', LIMIT)
    if (blocked) return { blocked: true }
    if (fail) return { failed: true }
    return cached ? quotaStatus(req) : chargeQuotaOnce(req, key)
  }

  console.log('새 경기 · 캐시 적중')
  const first = await analyze('analysis:KR_1:puuid:single:v1')
  check('새 경기 분석 → 1회 차감 (used 1, 남은 2)', first.charged === true && first.used === 1 && first.remaining === 2, JSON.stringify(first))
  const again = await analyze('analysis:KR_1:puuid:single:v1', { cached: true })
  check('이미 분석한 경기 다시 분석(캐시) → 차감 없음 (used 1 그대로)', again.charged === false && again.used === 1, JSON.stringify(again))
  const replay = await analyze('analysis:KR_1:puuid:single:v1')
  check('캐시가 사라져 다시 생성돼도 같은 경기·버전이면 차감 없음 (멱등 키)', replay.charged === false && replay.used === 1, JSON.stringify(replay))

  console.log('실패')
  await analyze('analysis:KR_2:puuid:single:v1', { fail: true })
  const afterFail = await analyze('analysis:KR_9:puuid:single:v1', { cached: true })
  check('생성 실패 → 차감 없음 (used 1 그대로)', afterFail.used === 1, JSON.stringify(afterFail))

  console.log('빠르게 두 번')
  const both = await Promise.all([analyze('analysis:KR_3:puuid:single:v1'), analyze('analysis:KR_3:puuid:single:v1')])
  check('같은 경기 동시 2건 → 1건만 차감', both.filter((r) => r.charged).length === 1 && Math.max(...both.map((r) => r.used)) === 2, JSON.stringify(both))

  console.log('한도')
  const third = await analyze('analysis:KR_4:puuid:single:v1')
  check('세 번째 새 경기 → used 3, 남은 0', third.charged && third.used === 3 && third.remaining === 0, JSON.stringify(third))
  const over = await analyze('analysis:KR_5:puuid:single:v1')
  check('한도를 다 쓰면 분석 전에 429 (차감 없이 거부)', over.blocked === true)

  console.log('라우트 · 화면')
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
  for (const p of ['app/api/tft/match/route.ts', 'app/api/tft/match/stream/route.ts']) {
    const src = read(p)
    check(`${p}: 확인만 하고 새 리포트일 때만 차감`, /quotaCheck\(/.test(src) && !/quotaGuard\(/.test(src) && /!outcome\.cached && !outcome\.response\.feedback\?\.isFallback \? await chargeQuotaOnce\(req, analysisChargeKey\(params, outcome\.regenerated\)\)/.test(src))
  }
  const ov = read('app/api/tft/overview/route.ts')
  check('종합 분석도 확인 → 성공 후 차감 (캐시 적중 차감 없음)', /quotaCheck\(/.test(ov) && /chargeQuotaOnce\(req, regenerated \? `\$\{cacheKey\}:gen:\$\{REPORT_GENERATOR_VERSION\}` : cacheKey\)/.test(ov) && !/quotaGuard\(/.test(ov))
  // 다시 분석 (2026-10-30 2차 지시문 5-2): 오래된 캐시일 때만 새로 생성 · 차감 키는 생성기 버전을 붙여 한 번 더 · 최신이면 캐시 그대로
  check('다시 분석은 오래된 캐시일 때만 새로 생성 (최신이면 캐시)', /if \(cached && !\(params\.regenerate && cached\.response\.outdated\)\) return/.test(read('lib/matchAnalysis.ts')) && /raw\.regenerate === true && isOutdatedReport/.test(ov))
  check('다시 분석 차감 키 = 첫 생성 키 + 생성기 버전 (같은 버전은 한 번만)', /regenerated \? `\$\{key\}:gen:\$\{REPORT_GENERATOR_VERSION\}` : key/.test(read('lib/matchAnalysis.ts')))
  const ma = read('lib/matchAnalysis.ts')
  check('캐시 키에 메타 스냅샷 없음 (match·puuid·모드·리포트 버전)', /`analysis:\$\{params\.matchId\}:\$\{subject\}:\$\{params\.mode\}:\$\{REPORT_VERSION\}`/.test(ma) && !/snapshot/i.test(ma.match(/analysisCacheKey[\s\S]*?\n}/)[0]))
  check('화면 문구: 저장된 분석 결과(캐시)입니다 · 횟수 차감 없음', read('app/components/MatchCard.tsx').includes('저장된 분석 결과(캐시)입니다 · 횟수 차감 없음'))
  check('화면 카운터는 서버 charged 로만 (quota.consume 직접 호출 없음)', !/quota\.consume\(\)/.test(read('app/components/MatchCard.tsx') + read('app/page.tsx')))

  console.log(failures ? `\n❌ 실패 ${failures}건` : '\n✅ 분석 횟수 차감 테스트 통과')
  if (failures) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})

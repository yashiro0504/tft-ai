/**
 * AI 리포트 신뢰성 평가 하네스 (골든셋 반복 실행)
 *
 * 실행 중인 앱의 /api/tft/overview 를 반복 호출해 아래를 측정한다.
 *  - 성공률 / 폴백률 / 평균 지연
 *  - 근거 검증(grounding) 평균·최저, 미확인 수치 수
 *  - 점수 고정성(metaScore == scoreBreakdown.total, 실행 간 변동)
 *  - 유연성 점수(LLM) 변동성(표준편차)
 *
 * 사용법:
 *   node scripts/evalReports.js            # data/evalMatches.json · 2회 반복
 *   node scripts/evalReports.js --runs 3
 *   node scripts/evalReports.js --api http://localhost:3000
 *
 * 종료코드: 신뢰성 게이트 실패 시 1 (CI 연결 가능)
 */
const fs = require('fs')
const path = require('path')
const { loadEnv } = require('./_env')
loadEnv()

const args = process.argv.slice(2)
const getArg = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}

const API = getArg('--api', process.env.EVAL_API || 'http://localhost:3000')
const RUNS = Number(getArg('--runs', '2'))
const FIXTURES = getArg('--fixtures', path.join(__dirname, '..', 'data', 'evalMatches.json'))
const OUT = path.join(__dirname, '..', 'data', 'evalReport.json')

async function postJson(url, body, timeoutMs = 90000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const json = await res.json()
    return { status: res.status, json, ms: Date.now() - t0 }
  } finally {
    clearTimeout(timer)
  }
}

function stddev(nums) {
  if (nums.length < 2) return 0
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length
  return Math.sqrt(nums.reduce((s, n) => s + (n - avg) ** 2, 0) / nums.length)
}

async function main() {
  if (!fs.existsSync(FIXTURES)) {
    console.error(`픽스처 파일이 없습니다: ${FIXTURES}`)
    console.error('먼저 골든셋을 캡처하세요: node scripts/captureEvalFixtures.js "닉네임#KR1" 3')
    process.exitCode = 1
    return
  }

  const data = JSON.parse(fs.readFileSync(FIXTURES, 'utf-8'))
  const cases = data.cases || []
  if (cases.length === 0) {
    console.error('평가 케이스가 비어 있습니다.')
    process.exitCode = 1
    return
  }

  console.log(`평가 시작: ${cases.length}개 케이스 × ${RUNS}회 · API=${API}`)

  const results = []
  for (const c of cases) {
    const runs = []
    for (let r = 0; r < RUNS; r++) {
      try {
        const { status, json, ms } = await postJson(`${API}/api/tft/overview`, {
          gameName: c.gameName,
          tagLine: c.tagLine,
          matches: c.matches,
          mode: c.mode || 'multi',
          // 캐시 우회: 반복 실행마다 실제 LLM 호출을 측정한다.
          nocache: true,
        })
        const f = json.feedback || {}
        const run = {
          status,
          ok: Boolean(json.success && f.overview),
          ms,
          isFallback: Boolean(f.isFallback),
          metaScore: f.metaScore,
          metaTier: f.metaTier,
          breakdownTotal: f.scoreBreakdown ? f.scoreBreakdown.total : null,
          grounding: f.grounding || null,
          flexibilityScore: f.flexibilityScore,
          error: json.error,
        }
        runs.push(run)
        console.log(
          `  ${c.name} run ${r + 1}/${RUNS} → ${run.ok ? `${run.metaScore}점 (${ms}ms)` : '실패'}`
        )
      } catch (e) {
        runs.push({ ok: false, ms: 0, error: e.message })
        console.log(`  ${c.name} run ${r + 1}/${RUNS} → 실패 (${e.message})`)
      }
      if (r < RUNS - 1) await new Promise((res) => setTimeout(res, 1500))
    }
    results.push({ name: c.name, runs })
  }

  const allRuns = results.flatMap((r) => r.runs)
  const okRuns = allRuns.filter((r) => r.ok)
  const gScores = okRuns.map((r) => r.grounding?.score).filter((n) => typeof n === 'number')
  const claims = okRuns.reduce((s, r) => s + (r.grounding?.total || 0), 0)
  const unsupported = okRuns.reduce((s, r) => s + (r.grounding?.unsupported?.length || 0), 0)
  const scoreMatches = okRuns.filter(
    (r) => r.breakdownTotal != null && r.metaScore === r.breakdownTotal
  ).length

  const perCase = results.map((r) => {
    const scores = r.runs.map((x) => x.metaScore).filter((n) => typeof n === 'number')
    const flex = r.runs.map((x) => x.flexibilityScore).filter((n) => typeof n === 'number')
    return {
      name: r.name,
      runs: r.runs.length,
      ok: r.runs.filter((x) => x.ok).length,
      metaScore: scores,
      metaScoreStable: scores.length > 0 && Math.max(...scores) === Math.min(...scores),
      flexibilityStdDev: Math.round(stddev(flex) * 10) / 10,
      grounding: r.runs.map((x) => (x.grounding ? x.grounding.score : null)),
    }
  })

  const summary = {
    generatedAt: new Date().toISOString(),
    api: API,
    runs: allRuns.length,
    successRate: Math.round((okRuns.length / allRuns.length) * 100),
    fallbackRate: Math.round((allRuns.filter((r) => r.isFallback).length / allRuns.length) * 100),
    avgLatencyMs: okRuns.length ? Math.round(okRuns.reduce((s, r) => s + r.ms, 0) / okRuns.length) : 0,
    groundingAvg: gScores.length ? Math.round(gScores.reduce((a, b) => a + b, 0) / gScores.length) : null,
    groundingMin: gScores.length ? Math.min(...gScores) : null,
    claims,
    unsupportedClaims: unsupported,
    scoreMatchesBreakdown: `${scoreMatches}/${okRuns.length}`,
  }

  console.log('\n=== 요약 ===')
  console.log(
    `성공률 ${summary.successRate}% · 폴백률 ${summary.fallbackRate}% · 평균 지연 ${summary.avgLatencyMs}ms`
  )
  console.log(
    `근거 검증 평균 ${summary.groundingAvg}% (최저 ${summary.groundingMin}%) · 주장 ${summary.claims}개 중 미확인 ${summary.unsupportedClaims}개`
  )
  console.log(`점수=코드 산출 일치: ${summary.scoreMatchesBreakdown}`)

  console.log('\n=== 케이스별 ===')
  perCase.forEach((c) => {
    console.log(
      `- ${c.name}: 점수 ${c.metaScore.join('/')} ${c.metaScoreStable ? '(고정)' : '(변동!)'} · ` +
        `유연성 표준편차 ${c.flexibilityStdDev} · grounding ${c.grounding
          .map((g) => (g == null ? '-' : `${g}%`))
          .join('/')}`
    )
  })

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify({ summary, perCase, results }, null, 2), 'utf-8')
  console.log(`\n저장 → ${OUT}`)

  // CI 게이트
  const failed = []
  if (summary.successRate < 100) failed.push('성공률<100%')
  if (summary.fallbackRate > 0) failed.push('폴백 발생')
  if (summary.groundingAvg != null && summary.groundingAvg < 85) failed.push('grounding<85%')
  if (scoreMatches !== okRuns.length) failed.push('점수-코드 불일치')
  if (perCase.some((c) => !c.metaScoreStable)) failed.push('점수 변동')

  if (failed.length) {
    console.error(`\n❌ 신뢰성 게이트 실패: ${failed.join(', ')}`)
    process.exitCode = 1
  } else {
    console.log('\n✅ 신뢰성 게이트 통과')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

/**
 * 6축·메타 점수 회귀 테스트 (외부 API 불필요, LLM 미사용).
 *
 * 골든셋(data/evalMatches.json)의 모든 케이스에 대해
 * buildCoachingPlan(6축) + computeScoreBreakdown(metaScore)을 계산해 스냅샷과 비교한다.
 *
 * 실행:
 *   node scripts/testAxes.js            # 스냅샷과 비교 (다르면 종료코드 1)
 *   node scripts/testAxes.js --update   # 의도한 공식 변경 후 스냅샷 갱신 (axisConfig.json 의 version 도 올릴 것)
 *
 * 공식(axisConfig.json)을 바꾸면 이 테스트가 어떤 케이스의 어떤 축이 몇 점 바뀌었는지 보여준다.
 */
require('./_ts')
const fs = require('fs')
const path = require('path')
const { buildCoachingPlan } = require('../lib/coaching')
const { computeScoreBreakdown, SCORING_VERSION } = require('../lib/scoring')

const FIXTURES = path.join(__dirname, '..', 'data', 'evalMatches.json')
const SNAPSHOT = path.join(__dirname, '..', 'data', 'axesSnapshot.json')
const UPDATE = process.argv.includes('--update')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) return
  failures += 1
  console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
}

function snapshotOf(matches) {
  const plan = buildCoachingPlan(matches)
  const score = computeScoreBreakdown(matches)
  return {
    focus: plan.focus,
    lowSample: Boolean(plan.lowSample),
    axes: Object.fromEntries(plan.axes.map((a) => [a.key, a.score])),
    metaScore: score ? score.total : null,
    metaTier: score ? score.tier : null,
    components: score ? Object.fromEntries(score.components.map((c) => [c.key, c.score])) : null,
  }
}

const cases = JSON.parse(fs.readFileSync(FIXTURES, 'utf-8')).cases || []
const current = {}
for (const c of cases) current[c.name] = snapshotOf(c.matches)

// ── 불변식: 공식이 바뀌어도 항상 지켜져야 하는 성질 ──
console.log('불변식 검사')
for (const c of cases) {
  const s = current[c.name]
  for (const [k, v] of Object.entries(s.axes)) check(`${c.name} ${k} 0~100`, v >= 0 && v <= 100, String(v))
  if (s.metaScore != null) check(`${c.name} metaScore 0~100`, s.metaScore >= 0 && s.metaScore <= 100)
}
// 단조성: 같은 경기에서 유닛 하나를 2성으로 올리면 완성도가 내려가면 안 된다 / 캐리 아이템이 늘면 아이템 축이 내려가면 안 된다
const sample = cases.flatMap((c) => c.matches).find((m) => (m.units || []).some((u) => (u.tier || 1) === 1))
if (sample) {
  const base = buildCoachingPlan([sample]).axes
  const idx = sample.units.findIndex((u) => (u.tier || 1) === 1)
  const upgraded = { ...sample, units: sample.units.map((u, i) => (i === idx ? { ...u, tier: 2 } : u)) }
  const after = buildCoachingPlan([upgraded]).axes
  const get = (axes, k) => axes.find((a) => a.key === k).score
  check('2성 승급 시 완성도 비감소', get(after, 'completion') >= get(base, 'completion'))
}
console.log(failures ? `  불변식 실패 ${failures}건` : '  ✅ 통과')

// ── 스냅샷 비교 ──
if (UPDATE || !fs.existsSync(SNAPSHOT)) {
  fs.writeFileSync(
    SNAPSHOT,
    JSON.stringify({ scoringVersion: SCORING_VERSION, generatedAt: new Date().toISOString(), cases: current }, null, 2) + '\n',
    'utf-8'
  )
  console.log(`📸 스냅샷 저장 → ${path.relative(process.cwd(), SNAPSHOT)} (케이스 ${cases.length}개, ${SCORING_VERSION})`)
} else {
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf-8'))
  console.log(`스냅샷 비교 (스냅샷 ${snap.scoringVersion} → 현재 ${SCORING_VERSION})`)
  let changed = 0
  for (const [name, now] of Object.entries(current)) {
    const prev = snap.cases[name]
    if (!prev) {
      console.log(`  ➕ 새 케이스: ${name}`)
      continue
    }
    const diffs = []
    for (const k of Object.keys(now.axes)) if (now.axes[k] !== prev.axes[k]) diffs.push(`${k} ${prev.axes[k]}→${now.axes[k]}`)
    if (now.focus !== prev.focus) diffs.push(`주제 ${prev.focus}→${now.focus}`)
    if (now.metaScore !== prev.metaScore) diffs.push(`metaScore ${prev.metaScore}→${now.metaScore}`)
    if (diffs.length) {
      changed += 1
      console.log(`  Δ ${name}: ${diffs.join(', ')}`)
    }
  }
  if (changed && snap.scoringVersion === SCORING_VERSION) {
    check(
      `점수 변경 ${changed}케이스`,
      false,
      '공식을 바꿨다면 axisConfig.json 의 version 을 올리고 --update 로 스냅샷을 갱신하세요 (분석 캐시 무효화)'
    )
  } else if (changed) {
    console.log(`  ⚠️  ${changed}케이스 점수 변경 (버전 변경됨) — 의도한 변경이면 --update`)
    failures += 1
  } else {
    console.log('  ✅ 모든 케이스 동일')
  }
}

if (failures) process.exitCode = 1

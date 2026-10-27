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
const { boardValue } = require('../lib/boardValue')
const { stageOfRound } = require('../lib/quality')

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
  // 캐리 아이템 = 실제 캐리(딜템 최다 기물)의 장착 개수 — 최고 코스트 기물이 빈손이어도 0개가 아니다 (2026-10-27)
  const { readMatch } = require('../lib/coaching')
  const carryBoard = { ...sample, units: [{ id: 'TFT18_Rengar', name: '렝가', rarity: 3, tier: 2, items: ['무한의 대검', '마법공학 총검', '피바라기'] }, { id: 'TFT18_Kennen', name: '케넨', rarity: 5, tier: 1, items: [] }] }
  const cm = readMatch(carryBoard)
  check('캐리 아이템 = 렝가 3개 · 최고 코스트 기물(케넨) 아이템 0개는 따로', cm.carryItems === 3 && cm.topCostItems === 0, JSON.stringify([cm.carryItems, cm.topCostItems]))
  // 같은 스테이지에 탈락한 상대보다 레벨이 낮으면 템포·경제 감점 (5-2 Lv.7 탈락 7등이 템포·경제 100점이던 문제)
  // 표준형 보드로 (리롤형은 템포를 레벨이 아니라 3성으로 본다)
  const lobby = (myLevel) => ({
    ...sample,
    units: sample.units.map((u) => ({ ...u, tier: Math.min(u.tier || 1, 2) })),
    placement: 7,
    level: myLevel,
    lastRound: '5-2',
    lobbyParticipants: [
      { placement: 7, isUser: true, level: myLevel, lastRound: '5-2', units: [], traits: [] },
      { placement: 6, isUser: false, level: 9, lastRound: '5-5', units: [], traits: [] },
      { placement: 8, isUser: false, level: 9, lastRound: '5-1', units: [], traits: [] },
      { placement: 1, isUser: false, level: 10, lastRound: '7-1', units: [], traits: [] },
    ],
  })
  const behind = readMatch(lobby(7))
  check('로비 비교 레벨 = 같은 스테이지 탈락 상대 평균 (Lv.9 · 1등 Lv.10 제외)', behind.lobbyLevel === 9, String(behind.lobbyLevel))
  const scoreOf = (m, k) => buildCoachingPlan([m]).axes.find((a) => a.key === k)
  const t7 = scoreOf(lobby(7), 'tempo')
  const t9 = scoreOf(lobby(9), 'tempo')
  check('같은 스테이지 상대보다 2레벨 낮으면 템포 감점 · 같으면 감점 없음', t7.score < t9.score && t7.effects.some((e) => e.key === 'lobbyLevelGap' && e.points < 0), JSON.stringify([t7.score, t9.score]))
}
console.log(failures ? `  불변식 실패 ${failures}건` : '  ✅ 통과')

// ── 타당도 리포트 (게이트 아님): 정상 경기 단건마다 축 점수와 등수의 스피어만 상관 ──
// 좋은 운영 지표라면 점수가 높을수록 등수가 좋아야 한다 (ρ > 0). 음수면 공식이 거꾸로 동작한다는 신호.
{
  const rank = (a) => {
    const s = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0])
    const r = []
    for (let i = 0; i < s.length; ) {
      let j = i
      while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++
      for (let k = i; k <= j; k++) r[s[k][1]] = (i + j) / 2
      i = j + 1
    }
    return r
  }
  const spearman = (a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    const mean = (x) => x.reduce((p, q) => p + q, 0) / x.length
    const ma = mean(ra)
    const mb = mean(rb)
    let num = 0
    let da = 0
    let db = 0
    for (let i = 0; i < a.length; i++) {
      num += (ra[i] - ma) * (rb[i] - mb)
      da += (ra[i] - ma) ** 2
      db += (rb[i] - mb) ** 2
    }
    return da && db ? num / Math.sqrt(da * db) : 0
  }
  const unique = new Map()
  for (const c of cases) for (const m of c.matches) unique.set(`${c.gameName}:${m.matchId}`, m)
  const singles = [...unique.values()].map((m) => ({ m, plan: buildCoachingPlan([m]) })).filter((x) => !x.plan.lowSample)
  if (singles.length >= 5) {
    const place = singles.map((x) => -x.m.placement)
    const parts = singles[0].plan.axes.map((a) => {
      const scores = singles.map((x) => x.plan.axes.find((y) => y.key === a.key).score)
      const mean = Math.round(scores.reduce((p, q) => p + q, 0) / scores.length)
      return `${a.key} ρ=${spearman(scores, place).toFixed(2)} 평균 ${mean}`
    })
    const focus = {}
    for (const x of singles) focus[x.plan.focus] = (focus[x.plan.focus] || 0) + 1
    console.log(`타당도 (정상 경기 ${singles.length}판, 등수 상관 ρ)`)
    console.log(`  ${parts.join(' · ')}`)
    console.log(`  강의 주제 분포 ${JSON.stringify(focus)}`)
  }

  // 보드 가치(점수 미반영 지표): 로비 전체 보드로 원시 ρ와 스테이지 보정 ρ(같은 탈락 스테이지끼리 비교) — 점수 반영 판단용
  const boards = new Map()
  for (const c of cases)
    for (const m of c.matches)
      for (const p of m.lobbyParticipants || []) boards.set(`${m.matchId}:${p.placement}`, { value: boardValue(p.units), place: -p.placement, stage: stageOfRound(p.lastRound) })
  const all = [...boards.values()].filter((b) => b.stage > 0)
  if (all.length >= 20) {
    const byStage = new Map()
    for (const b of all) byStage.set(b.stage, [...(byStage.get(b.stage) || []), b])
    let weighted = 0
    let n = 0
    const perStage = []
    for (const [stage, list] of [...byStage].sort((a, b) => a[0] - b[0])) {
      if (list.length < 5) continue
      const rho = spearman(list.map((b) => b.value), list.map((b) => b.place))
      weighted += rho * list.length
      n += list.length
      perStage.push(`${stage}스테이지 ${rho.toFixed(2)}(${list.length})`)
    }
    console.log(`보드 가치 (로비 보드 ${all.length}개, 점수 미반영)`)
    console.log(`  원시 ρ=${spearman(all.map((b) => b.value), all.map((b) => b.place)).toFixed(2)} · 스테이지 보정 ρ=${n ? (weighted / n).toFixed(2) : '-'} (${n}개, 스테이지별: ${perStage.join(' · ')})`)
  }

  // 경제 축(보드 가치 반영)을 로비 보드 전체에 적용 — 정상 경기 25판보다 표본이 커서 같은 탈락 스테이지끼리 비교할 수 있다
  const lobbyEco = []
  for (const c of cases)
    for (const m of c.matches)
      for (const p of m.lobbyParticipants || []) {
        const plan = buildCoachingPlan([{ ...m, placement: p.placement, level: p.level, lastRound: p.lastRound, units: p.units, traits: p.traits || [], lobbyParticipants: [] }])
        if (!plan.lowSample) lobbyEco.push({ key: `${m.matchId}:${p.placement}`, score: plan.axes.find((a) => a.key === 'economy').score, place: -p.placement, stage: stageOfRound(p.lastRound) })
      }
  const ecoBoards = [...new Map(lobbyEco.map((b) => [b.key, b])).values()]
  if (ecoBoards.length >= 20) {
    let weighted = 0
    let n = 0
    for (const stage of new Set(ecoBoards.map((b) => b.stage))) {
      const list = ecoBoards.filter((b) => b.stage === stage)
      if (list.length < 5) continue
      weighted += spearman(list.map((b) => b.score), list.map((b) => b.place)) * list.length
      n += list.length
    }
    console.log(`경제 축 (로비 보드 ${ecoBoards.length}개): 같은 탈락 스테이지 내 등수 상관 ρ=${n ? (weighted / n).toFixed(2) : '-'}`)
  }
}

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

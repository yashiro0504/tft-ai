/**
 * 스테이지 기준선 테스트 (외부 API 불필요) — lib/baselineBuild 집계 · lib/baselines 조회 순서 · 커밋된 lib/gameBaselines.json 모양.
 *
 * 실행: node scripts/testBaselines.js
 */
require('./_ts')
const { buildGameBaselines, validateGameBaselines } = require('../lib/baselineBuild')
const { baselineLevel, baselineBoardValue, measuredCell, GAME_BASELINES } = require('../lib/baselines')
const { AXIS_CONFIG } = require('../lib/axisConfig')
const { boardValue } = require('../lib/boardValue')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`)
    return
  }
  failures += 1
  console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
}

// 캐리 = 캐리 아이템이 가장 많은 기물 (lib/deckType boardCarry). 나머지는 아이템 없는 2코 1성.
const unit = (id, rarity, tier, items = []) => ({ id, name: id.replace(/^TFT\d*_/, ''), rarity, tier, items })
const filler = (n) => Array.from({ length: n }, (_, i) => unit(`TFT18_Filler${i}`, 2, 1))
const board = (lastRound, level, carryId, carryStar = 2, fillers = 5) => ({
  placement: 4,
  level,
  lastRound,
  units: [unit(carryId, 4, carryStar, ['무한의 대검', '최후의 속삭임', '거인 학살자']), ...filler(fillers)],
})

console.log('집계 (lib/baselineBuild)')
{
  const boards = [
    board('4-3', 6, 'TFT18_Jinx', 1, 3),
    board('4-5', 7, 'TFT18_Jinx', 2, 4),
    board('4-1', 8, 'TFT18_Jinx', 2, 6),
    board('5-2', 8, 'TFT18_Jinx'),
    board('5-6', 9, 'TFT18_Jinx'),
    board('5-1', 7, 'TFT18_Ahri'),
    board('', 8, 'TFT18_Jinx'), // 탈락 라운드 불명 → 제외
    { placement: 8, level: 3, lastRound: '2-1', units: [] }, // 빈 보드 → 제외
  ]
  const out = buildGameBaselines(
    boards,
    { source: 'test', patch: '16.21', tierMin: 'MASTER', matches: 1, generatedAt: '2026-10-26T00:00:00Z' },
    { stage: 2, carryStage: 2 }
  )
  const values4 = boards.slice(0, 3).map((b) => boardValue(b.units)).sort((a, b) => a - b)
  check('빈 보드 · 탈락 라운드 불명은 빼고 센다', out.boards === 6, String(out.boards))
  check('스테이지 4: 3판 · 레벨 중앙값 7 · 보드 가치 중앙값', out.byStage['4']?.n === 3 && out.byStage['4'].level === 7 && out.byStage['4'].boardValue === values4[1], JSON.stringify(out.byStage['4']))
  check('스테이지 5: 캐리가 달라도 스테이지 전체에는 들어간다 (3판 · 레벨 8)', out.byStage['5']?.n === 3 && out.byStage['5'].level === 8, JSON.stringify(out.byStage['5']))
  check('짝수 표본 중앙값은 가운데 두 값의 평균 (징크스 5스테이지 8·9 → 8.5)', out.byCarry.jinx?.byStage['5']?.level === 8.5, JSON.stringify(out.byCarry.jinx))
  check('캐리 키 = 슬러그 · 이름 = 앱 기물 이름', Boolean(out.byCarry.jinx) && out.byCarry.jinx.name === 'Jinx' && out.byCarry.jinx.n === 5)
  check('표본 하한 미만 칸은 파일에 넣지 않는다 (아리 1판)', !out.byCarry.ahri && !out.byStage['2'])
  check('정상 값이면 상식 검사 통과', validateGameBaselines(out).length === 0, validateGameBaselines(out).join(' · '))
  check(
    '상식 검사: 레벨 범위 밖 · 스테이지 기준선 없음을 잡는다',
    validateGameBaselines({ ...out, byStage: { 5: { n: 200, level: 12, boardValue: 70 } } }).some((p) => p.includes('레벨 12')) &&
      validateGameBaselines({ ...out, byStage: {} }).some((p) => p.includes('하나도 없음'))
  )
}

console.log('조회 순서 (lib/baselines): 캐리 × 스테이지 → 스테이지 → axisConfig 표')
{
  const data = {
    source: 'test',
    patch: '16.21',
    tierMin: 'MASTER',
    generatedAt: null,
    matches: 0,
    boards: 0,
    minSample: { stage: 100, carryStage: 40 },
    byStage: { 4: { n: 500, level: 7, boardValue: 50 }, 5: { n: 900, level: 8, boardValue: 68 } },
    byCarry: { jinx: { name: '징크스', n: 300, byStage: { 5: { n: 120, level: 7.5, boardValue: 61 } } } },
  }
  check('같은 캐리 칸이 있으면 그 값', baselineLevel(5, 'jinx', data) === 7.5 && baselineBoardValue(5, 'jinx', data) === 61 && measuredCell(5, 'jinx', data).source === 'carry')
  check('캐리 칸이 없으면 스테이지 전체', baselineLevel(4, 'jinx', data) === 7 && baselineBoardValue(5, 'ahri', data) === 68 && measuredCell(5, null, data).source === 'stage')
  const lv = AXIS_CONFIG.expectedLevelByStage
  const bv = AXIS_CONFIG.axes.economy.expectedBoardValueByStage
  check('실측 칸이 없으면 axisConfig 표 (폴백)', baselineLevel(6, 'jinx', data) === (lv['6'] ?? lv.default) && baselineBoardValue(3, null, data) === bv['3'] && measuredCell(6, 'jinx', data) === null)
  check('폴백 표의 하한: 레벨은 1스테이지 · 보드 가치는 2스테이지부터', baselineLevel(0, null, data) === lv['1'] && baselineBoardValue(1, null, data) === bv['2'])
}

console.log('커밋된 lib/gameBaselines.json')
{
  const b = GAME_BASELINES
  check('모양: byStage · byCarry · minSample', b && typeof b.byStage === 'object' && typeof b.byCarry === 'object' && b.minSample?.stage > 0 && b.minSample?.carryStage > 0)
  if (b.source === 'none') {
    check('아직 생성 전이면 비어 있다 (전부 axisConfig 폴백)', !Object.keys(b.byStage).length && !Object.keys(b.byCarry).length)
  } else {
    const problems = validateGameBaselines(b)
    check('값 상식 검사', problems.length === 0, problems.join(' · '))
    const small = [
      ...Object.entries(b.byStage).filter(([, c]) => c.n < b.minSample.stage).map(([s]) => `스테이지 ${s}`),
      ...Object.entries(b.byCarry).flatMap(([k, c]) => Object.entries(c.byStage).filter(([, x]) => x.n < b.minSample.carryStage).map(([s]) => `${k}:${s}`)),
    ]
    check('모든 칸이 표본 하한 이상', small.length === 0, small.join(', '))
    check('출처 · 패치 · 판 수 기록', Boolean(b.patch) && b.matches > 0 && b.boards > 0 && Boolean(b.generatedAt))
  }
}

console.log(failures ? `\n❌ 실패 ${failures}건` : '\n✅ 기준선 테스트 통과')
if (failures) process.exitCode = 1

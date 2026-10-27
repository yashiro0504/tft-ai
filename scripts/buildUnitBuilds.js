/**
 * 래더 보드 → 기물 빌드 (아이템 3개 세트) JSON 폴백
 *
 * 입력: data/ladderBoards.json (scripts/collectLadderBoards.js)
 * 출력: 미리보기(기본) / lib/unitBuilds.json (--write)
 *
 * DB 경로(stat_unit_build, scripts/collect/builds.js)와 같은 buildRows 규칙이다 — 아이템 정확히 3개, 세트 키 = 정렬,
 * 기물마다 판 수 많은 상위 10개(5판 이상). DB 가 없을 때 메타 BIS 탭의 "3개 함께" 줄이 이 파일을 쓴다.
 *
 * 패치: 덱 빌드(buildDecksFromBoards)처럼 공식 패치 노트 게시 시각으로 보드에 패치를 붙인다.
 * 현재 패치 보드가 MIN_BOARDS 이상이면 현재 패치만, 모자라면 직전 패치를 합친다 (patches 에 패치별 보드 수를 남긴다).
 *
 * 사용법:
 *  node scripts/buildUnitBuilds.js            # 미리보기
 *  node scripts/buildUnitBuilds.js --write    # lib/unitBuilds.json 교체 (npm run build:builds)
 */
const fs = require('fs')
const path = require('path')
const { buildRows } = require('./collect/builds')

const WRITE = process.argv.includes('--write')
const MIN_BOARDS = Number(process.env.BUILDS_MIN_BOARDS || 400)
const BOARDS_PATH = path.join(__dirname, '..', 'data', 'ladderBoards.json')
const OUT_PATH = path.join(__dirname, '..', 'lib', 'unitBuilds.json')

function main() {
  if (!fs.existsSync(BOARDS_PATH)) {
    console.error('data/ladderBoards.json 이 없습니다. 먼저 node scripts/collectLadderBoards.js 를 실행하세요.')
    process.exitCode = 1
    return
  }
  const data = JSON.parse(fs.readFileSync(BOARDS_PATH, 'utf-8'))
  require('./_ts')
  const { getPatchNotes, patchAt } = require('../lib/patchNotes')
  const notes = getPatchNotes()
  const current = notes[notes.length - 1]?.patch
  const previous = notes[notes.length - 2]?.patch
  const all = data.matches.flatMap((m) => {
    const patch = patchAt(m.datetime)?.patch
    return m.boards.map((b) => ({ ...b, patch }))
  })
  let boards = all
  if (current) {
    const cur = all.filter((b) => b.patch === current)
    boards = cur.length >= MIN_BOARDS ? cur : all.filter((b) => b.patch === current || b.patch === previous)
  }
  const patches = {}
  for (const b of boards) if (b.patch) patches[b.patch] = (patches[b.patch] || 0) + 1
  const builds = buildRows(boards)

  const out = {
    version: 1,
    _comment:
      "기물 빌드(아이템 3개 세트) — scripts/buildUnitBuilds.js --write 가 data/ladderBoards.json 에서 만든다 (매일 collect-ladder 워크플로). 비어 있으면 화면은 '3개 함께' 줄을 그리지 않는다.",
    source: 'riot-ladder-boards',
    generatedAt: new Date().toISOString(),
    sourceUpdatedAt: data.updatedAt || null,
    patches,
    boards: boards.length,
    builds,
  }
  const units = new Set(builds.map((b) => b.unit)).size
  console.log(
    `기물 빌드: 보드 ${boards.length} (${Object.entries(patches)
      .map(([p, n]) => `${p} ${n}`)
      .join(' · ') || '패치 미상'}) → 기물 ${units}종 · 세트 ${builds.length}개`
  )
  for (const b of builds.slice(0, 5)) console.log(`  ${b.unit} ${b.items.join(' + ')} — ${b.games}판 평균 ${(b.placement_sum / b.games).toFixed(2)}등`)
  if (WRITE) {
    fs.writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`)
    console.log(`→ ${path.relative(process.cwd(), OUT_PATH)}`)
  } else console.log('(미리보기 — --write 로 lib/unitBuilds.json 교체)')
}

main()

/**
 * 현재 lib/metaStats.json 에 '이전 수집본 대비 변동'을 (재)계산해 넣는다.
 *
 * 사용법:
 *   node scripts/attachMetaDeltas.js                  # data/metaHistory 최신 스냅샷과 비교
 *   node scripts/attachMetaDeltas.js --prev <file>    # 특정 파일과 비교
 *   node scripts/attachMetaDeltas.js --write           # 결과 저장
 */
const fs = require('fs')
const path = require('path')
const { attachDeltas } = require('./buildMetaStats')

const args = process.argv.slice(2)
const getArg = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const write = args.includes('--write')
const curPath = path.join(__dirname, '..', 'lib', 'metaStats.json')

function latestSnapshot() {
  const dir = path.join(__dirname, '..', 'data', 'metaHistory')
  if (!fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  return files.length ? path.join(dir, files[files.length - 1]) : null
}

const prevPath = getArg('--prev', latestSnapshot())
if (!prevPath) {
  console.error('이전 스냅샷이 없습니다. --prev <file> 로 지정하세요.')
  process.exit(1)
}

const cur = JSON.parse(fs.readFileSync(curPath, 'utf-8'))
const prev = JSON.parse(fs.readFileSync(prevPath, 'utf-8'))

attachDeltas(cur, prev)

const pick = (section, dir) =>
  Object.entries(cur[section] || {})
    .filter(([, v]) => typeof v.rankDelta === 'number' && v.rankDelta !== 0)
    .sort((a, b) =>
      dir === 'up' ? b[1].rankDelta - a[1].rankDelta : a[1].rankDelta - b[1].rankDelta
    )
    .slice(0, 5)

console.log(`비교 기준: ${prev.generatedAt} (${path.basename(prevPath)})`)
for (const section of ['champions', 'traits', 'items']) {
  const up = pick(section, 'up')
  const down = pick(section, 'down')
  console.log(`\n[${section}] 상승 ${up.length} / 하락 ${down.length}`)
  const fmt = (v) =>
    `평균 ${v.avgPlacement}${v.avgDelta != null ? ` (${v.avgDelta > 0 ? '+' : ''}${v.avgDelta})` : ''}`
  up.forEach(([k, v]) => console.log(`  ▲${v.rankDelta} ${k} ${fmt(v)}`))
  down.forEach(([k, v]) => console.log(`  ▼${Math.abs(v.rankDelta)} ${k} ${fmt(v)}`))
}

if (write) {
  fs.writeFileSync(curPath, JSON.stringify(cur, null, 2), 'utf-8')
  console.log(`\n✅ 저장 → ${curPath}`)
} else {
  console.log('\n(미리보기) 저장하려면 --write')
}

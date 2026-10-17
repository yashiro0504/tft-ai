/**
 * 수집 직후 순위 변동 요약 출력 (CI 로그 + GitHub Step Summary)
 *
 * 사용법: node scripts/printMetaDeltas.js [--file lib/metaStats.json]
 */
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const idx = args.indexOf('--file')
const FILE =
  idx >= 0 && args[idx + 1]
    ? path.resolve(args[idx + 1])
    : path.join(__dirname, '..', 'lib', 'metaStats.json')

/** 내부 id → 표시용 이름 (Akali_AD → Akali, Lux18_Base → Lux) */
function displayName(key) {
  return (
    key
      .replace(/\d{2}_(?:ad|ap|base|tank|support)$/i, '')
      .replace(/_(?:ad|ap|base|tank|support)$/i, '')
      .trim() || key
  )
}

function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`파일이 없습니다: ${FILE}`)
    process.exit(1)
  }
  const stats = JSON.parse(fs.readFileSync(FILE, 'utf-8'))

  const rows = Object.entries(stats.champions || {}).map(([key, c]) => ({
    key,
    name: c.name || displayName(key),
    rankDelta: c.rankDelta || 0,
    avgDelta: c.avgDelta || 0,
    avgPlacement: c.avgPlacement,
    sampleSize: c.sampleSize,
  }))

  const moved = rows.filter((r) => r.rankDelta !== 0)
  moved.sort((a, b) => Math.abs(b.rankDelta) - Math.abs(a.rankDelta))

  const rising = moved.filter((r) => r.rankDelta > 0).slice(0, 5)
  const falling = moved.filter((r) => r.rankDelta < 0).slice(0, 5)

  const line = (r) =>
    `${r.name} ${r.rankDelta > 0 ? '▲' : '▼'}${Math.abs(r.rankDelta)}위 (평균 ${Number(
      r.avgPlacement || 0
    ).toFixed(2)}, ${r.sampleSize || 0}판)`

  console.log(`이전 수집 대비 변동: ${moved.length}종 / 전체 ${rows.length}종`)
  console.log(`  상승: ${rising.length ? rising.map(line).join(' · ') : '없음'}`)
  console.log(`  하락: ${falling.length ? falling.map(line).join(' · ') : '없음'}`)

  const md = [
    '### 순위 변동 요약',
    '',
    `- 이전 수집 대비 변동: **${moved.length}종** / 전체 ${rows.length}종`,
    `- 상승: ${rising.length ? rising.map((r) => `\`${line(r)}\``).join(', ') : '없음'}`,
    `- 하락: ${falling.length ? falling.map((r) => `\`${line(r)}\``).join(', ') : '없음'}`,
  ].join('\n')

  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`)
    } catch (e) {
      /* 요약 파일 쓰기 실패는 무시 */
    }
  }
}

main()

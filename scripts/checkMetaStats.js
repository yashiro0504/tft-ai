/**
 * 수집 데이터 무결성 검사 (CI / 자동 커밋 전 가드)
 *
 * 사용법: node scripts/checkMetaStats.js [--file lib/metaStats.json]
 * 종료코드: 검사 실패 시 1
 */
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const fileArgIdx = args.indexOf('--file')
const FILE =
  fileArgIdx >= 0 && args[fileArgIdx + 1]
    ? path.resolve(args[fileArgIdx + 1])
    : path.join(__dirname, '..', 'lib', 'metaStats.json')

/** 최소 기대치 (세트18 래더 표본 기준) */
const MIN = {
  champions: 40,
  traits: 20,
  items: 60,
  combos: 100,
}

const count = (obj) => (obj && typeof obj === 'object' ? Object.keys(obj).length : 0)

function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`❌ 파일이 없습니다: ${FILE}`)
    process.exit(1)
  }

  let stats
  try {
    stats = JSON.parse(fs.readFileSync(FILE, 'utf-8'))
  } catch (e) {
    console.error(`❌ JSON 파싱 실패: ${e.message}`)
    process.exit(1)
  }

  const counts = {
    champions: count(stats.champions),
    traits: count(stats.traits),
    items: count(stats.items),
    combos: count(stats.combos),
    augments: count(stats.augments),
  }

  const failures = Object.entries(MIN)
    .filter(([key, min]) => counts[key] < min)
    .map(([key, min]) => `${key} ${counts[key]} < ${min}`)

  const generatedAtOk = Boolean(stats.generatedAt && !Number.isNaN(Date.parse(stats.generatedAt)))
  if (!generatedAtOk) failures.push('generatedAt 누락/형식 오류')

  const lines = [
    `파일: ${path.relative(path.join(__dirname, '..'), FILE)}`,
    `수집 시각: ${stats.generatedAt || '—'} · 출처: ${stats.source || '—'} · 패치: ${stats.patch || '—'}`,
    `기물 ${counts.champions} · 특성 ${counts.traits} · 아이템 ${counts.items} · BIS 조합 ${counts.combos} · 증강 ${counts.augments}`,
  ]
  lines.forEach((l) => console.log(`  ${l}`))

  // GitHub Actions 요약 출력
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [
      '### 수집 데이터 점검',
      '',
      '| 항목 | 값 |',
      '| --- | --- |',
      ...Object.entries(counts).map(([k, v]) => `| ${k} | ${v} |`),
      '',
      `- 수집 시각: ${stats.generatedAt || '—'}`,
      `- 출처: ${stats.source || '—'} / 패치: ${stats.patch || '—'}`,
      failures.length ? `\n**❌ 실패:** ${failures.join(', ')}` : '\n**✅ 통과**',
    ].join('\n')
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`)
    } catch (e) {
      /* 요약 파일 쓰기 실패는 무시 */
    }
  }

  if (failures.length) {
    console.error(`\n❌ 데이터 점검 실패: ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log('\n✅ 데이터 점검 통과')
}

main()

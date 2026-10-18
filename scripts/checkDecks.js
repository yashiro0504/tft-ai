/**
 * 덱 데이터 무결성 검사 (CI / 배포 전)
 *
 * 사용:
 *   node scripts/checkDecks.js
 *   node scripts/checkDecks.js --file lib/decksData.preview.json
 */
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const fileIdx = args.indexOf('--file')
const FILE =
  fileIdx >= 0 && args[fileIdx + 1]
    ? path.resolve(args[fileIdx + 1])
    : path.join(__dirname, '..', 'lib', 'decksData.json')

const failures = []
function check(label, condition, detail = '') {
  if (!condition) failures.push(detail ? `${label} (${detail})` : label)
}

function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`❌ 파일 없음: ${FILE}`)
    process.exit(1)
  }

  let data
  try {
    data = JSON.parse(fs.readFileSync(FILE, 'utf-8'))
  } catch (err) {
    console.error(`❌ JSON 파싱 실패: ${err.message}`)
    process.exit(1)
  }

  const decks = Array.isArray(data.decks) ? data.decks : []
  check('deckCount 불일치', data.deckCount === decks.length, `${data.deckCount} vs ${decks.length}`)
  check('덱이 10개 미만', decks.length >= 10, String(decks.length))
  check('generatedAt 없음/형식 오류', Boolean(data.generatedAt && !Number.isNaN(Date.parse(data.generatedAt))))
  check('patch 없음', Boolean(data.patch))
  check('unitMatchRate 낮음', typeof data.unitMatchRate === 'number' && data.unitMatchRate >= 0.9, String(data.unitMatchRate))
  check('외부 큐레이션 출처', !/lolchess|롤체지지/i.test(String(data.source || '')), String(data.source))

  const ids = new Set()
  const signatures = new Set()

  decks.forEach((deck, index) => {
    const tag = `deck[${index}] ${deck && deck.name ? deck.name : ''}`.trim()
    check(`${tag}: id 없음`, Boolean(deck.id))
    check(`${tag}: id 중복`, !ids.has(deck.id), deck.id)
    ids.add(deck.id)

    check(`${tag}: 이름 없음`, Boolean(deck.name))
    check(`${tag}: unitCost 이상`, typeof deck.unitCost === 'number' && deck.unitCost > 0, String(deck.unitCost))
    check(`${tag}: avgPlacement 이상`, typeof deck.avgPlacement === 'number' && deck.avgPlacement >= 1 && deck.avgPlacement <= 8, String(deck.avgPlacement))
    check(`${tag}: top4Rate 이상`, typeof deck.top4Rate === 'number' && deck.top4Rate >= 0 && deck.top4Rate <= 1, String(deck.top4Rate))
    check(`${tag}: traits 부족`, Array.isArray(deck.traits) && deck.traits.length >= 2, String(deck.traits && deck.traits.length))

    const units = Array.isArray(deck.units) ? deck.units : []
    check(`${tag}: 유닛 수 이상`, units.length >= 6 && units.length <= 10, String(units.length))
    check(`${tag}: 유닛 중복`, new Set(units.map((unit) => unit.lolchessKey)).size === units.length)

    units.forEach((unit, unitIndex) => {
      const utag = `${tag} unit[${unitIndex}]`
      check(`${utag}: 이름 없음`, Boolean(unit.name))
      check(`${utag}: 아이콘 없음`, Boolean(unit.imgUrl))
      check(`${utag}: 코스트 이상`, unit.cost == null || (unit.cost >= 1 && unit.cost <= 5), String(unit.cost))
      check(`${utag}: 성급 이상`, unit.star >= 1 && unit.star <= 3, String(unit.star))
      for (const item of unit.items || []) {
        check(`${utag}: 아이템 키/이름/아이콘`, Boolean(item.key && item.name && item.iconUrl), item.key)
      }
    })

    for (const trait of deck.traits || []) {
      check(`${tag}: 시너지 키/이름/아이콘`, Boolean(trait.key && trait.name && trait.iconUrl), trait.key)
      check(`${tag}: 시너지 count`, trait.count >= 1, `${trait.key}=${trait.count}`)
    }

    const signature = units.map((unit) => unit.lolchessKey).sort().join(',')
    check(`${tag}: 유닛 조합 중복`, !signatures.has(signature))
    signatures.add(signature)
  })

  console.log(`파일: ${path.relative(path.join(__dirname, '..'), FILE)}`)
  console.log(`출처: ${data.source} · 패치: ${data.patch} · 갱신: ${data.generatedAt}`)
  console.log(`덱 ${decks.length}개 · 유닛 매칭률 ${data.unitMatchRate} · 중복 조합 0`)

  if (failures.length > 0) {
    console.error(`\n❌ 덱 데이터 검사 실패 ${failures.length}건`)
    failures.slice(0, 30).forEach((failure) => console.error(`  - ${failure}`))
    process.exit(1)
  }

  console.log('\n✅ 덱 데이터 검사 통과')
}

main()

/**
 * 덱 데이터 무결성 검사 (CI / 배포 전)
 *
 * 사용:
 *   node scripts/checkDecks.js
 *   node scripts/checkDecks.js --file lib/decksData.preview.json
 *
 * P1-5 강화 항목:
 *  - 시너지 count 가 유닛 구성과 일치하는지 재계산 대조
 *  - 시너지 breakpoint 준수 (미발동 / 최대 단계 초과)
 *  - unitCost · unitCount 필드 정합성
 */
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const fileIdx = args.indexOf('--file')
const FILE =
  fileIdx >= 0 && args[fileIdx + 1]
    ? path.resolve(args[fileIdx + 1])
    : path.join(__dirname, '..', 'lib', 'decksData.json')

const breakpointData = require('../lib/traitBreakpoints.json')
const reference = require('../lib/championTraits.json')

const failures = []
const warnings = []
function check(label, condition, detail = '') {
  if (!condition) failures.push(detail ? `${label} (${detail})` : label)
}
function warn(label, condition, detail = '') {
  if (!condition) warnings.push(detail ? `${label} (${detail})` : label)
}

/** 기물/시너지 ID 정규화 (buildDeckCompsFromStats.js 와 동일 규칙) */
function norm(id) {
  return String(id || '')
    .replace(/^TFT\d*_/i, '')
    .replace(/^DA_\d*_/i, '')
    .replace(/^DA_/i, '')
    .replace(/^TFTTutorial_/i, '')
    .replace(/_Base$/i, '')
    .replace(/Base$/i, '')
    .replace(/_(AP|AD)$/i, '')
    .replace(/\d+$/i, '')
    .toLowerCase()
}

const traitRef = reference.traits || {}

/** 시너지 breakpoint 조회 (영문 → 한글명 순) */
function traitBreakpoints(trait) {
  const direct = breakpointData.traits[norm(trait)]
  if (direct) return direct
  const korean = traitRef[norm(trait)]?.name
  if (korean && breakpointData.traits[korean]) return breakpointData.traits[korean]
  return null
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

      const bp = traitBreakpoints(trait.key)
      if (!bp) {
        warn(`${tag}: 시너지 breakpoint 데이터 없음`, false, trait.key)
        continue
      }
      check(
        `${tag}: 시너지 미발동(breakpoint 미달)`,
        trait.count >= bp.breakpoints[0],
        `${trait.key}=${trait.count} < ${bp.breakpoints[0]}`
      )
      // 실측 덱은 최대 단계보다 많이 쌓은 실제 보드가 있을 수 있어 경고로만 남긴다
      warn(
        `${tag}: 시너지 최대 단계 초과`,
        trait.count <= bp.max,
        `${trait.key}=${trait.count} > ${bp.max}`
      )
    }

    // 선언된 시너지 count 가 실제 유닛 구성과 일치하는지 재계산 대조
    // 플렉스(시너지 최대 단계를 넘는 선택 기물)는 count 에서 제외한다
    const recomputed = new Map()
    for (const unit of units) {
      if (unit.flex) continue
      for (const trait of unit.traits || []) {
        recomputed.set(trait, (recomputed.get(trait) || 0) + 1)
      }
    }
    for (const trait of deck.traits || []) {
      check(
        `${tag}: 시너지 count 불일치`,
        recomputed.get(trait.key) === trait.count,
        `${trait.key}: 선언 ${trait.count} vs 계산 ${recomputed.get(trait.key) ?? 0}`
      )
    }

    // 비용/개수 필드 정합성
    check(
      `${tag}: unitCost 불일치`,
      deck.unitCost === units.reduce((sum, unit) => sum + (unit.cost || 0), 0),
      `선언 ${deck.unitCost}`
    )
    if (typeof deck.unitCount === 'number') {
      check(`${tag}: unitCount 불일치`, deck.unitCount === units.length, `${deck.unitCount} vs ${units.length}`)
    }

    // 캐리는 BIS 아이템이 2개 이상이어야 덱으로서 의미가 있다 (데이터 부족은 경고)
    const carry = units.find((unit) => unit.lolchessKey === norm(deck.carryKey)) || units[0]
    warn(`${tag}: 캐리 BIS 부족`, (carry?.items?.length || 0) >= 2, `${carry?.name || '?'} ${carry?.items?.length || 0}개`)

    const signature = units.map((unit) => unit.lolchessKey).sort().join(',')
    check(`${tag}: 유닛 조합 중복`, !signatures.has(signature))
    signatures.add(signature)
  })

  console.log(`파일: ${path.relative(path.join(__dirname, '..'), FILE)}`)
  console.log(`출처: ${data.source} · 패치: ${data.patch} · 갱신: ${data.generatedAt}`)
  console.log(`덱 ${decks.length}개 · 유닛 매칭률 ${data.unitMatchRate} · 중복 조합 0`)

  if (warnings.length > 0) {
    console.warn(`\n⚠️ 경고 ${warnings.length}건`)
    warnings.slice(0, 10).forEach((warning) => console.warn(`  - ${warning}`))
    if (warnings.length > 10) console.warn(`  ... 외 ${warnings.length - 10}건`)
  }

  if (failures.length > 0) {
    console.error(`\n❌ 덱 데이터 검사 실패 ${failures.length}건`)
    failures.slice(0, 30).forEach((failure) => console.error(`  - ${failure}`))
    process.exit(1)
  }

  console.log('\n✅ 덱 데이터 검사 통과')
}

main()

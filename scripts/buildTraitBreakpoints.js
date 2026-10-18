/**
 * TFT 시너지 breakpoint(발동 단위) 생성기
 *
 * 소스: Community Dragon `cdragon/tft/{ko_kr,en_us}.json`
 *  - Data Dragon 의 tft-trait.json 에는 `effects`(minUnits) 가 없어서 breakpoint 를 얻을 수 없다.
 *  - Community Dragon 은 시너지별 `effects[].minUnits` 를 제공한다.
 *
 * 산출물: `lib/traitBreakpoints.json`
 *  - 키를 3가지로 중복 등록한다: 정규화된 apiName / 정규화된 영문명 / 한글명
 *    (championTraits.json 은 영문 CamelCase 를, 표시는 한글명을 쓴다)
 *
 * 사용법:
 *   node scripts/buildTraitBreakpoints.js                       # 최신 데이터 fetch (세트 18)
 *   node scripts/buildTraitBreakpoints.js --file ko.json --file-en en.json
 *   SET=18 node scripts/buildTraitBreakpoints.js
 */
const fs = require('fs')
const path = require('path')

const CDRAGON_KO = 'https://raw.communitydragon.org/latest/cdragon/tft/ko_kr.json'
const CDRAGON_EN = 'https://raw.communitydragon.org/latest/cdragon/tft/en_us.json'

const args = process.argv.slice(2)
const getArg = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const SET = String(process.env.SET || getArg('--set', '18'))
const KO_FILE = getArg('--file', '')
const EN_FILE = getArg('--file-en', '')
const OUT = path.join(__dirname, '..', 'lib', 'traitBreakpoints.json')

/**
 * 표기가 달라 자동 매칭이 안 되는 시너지 별칭.
 * (championTraits.json 의 영문 표기 ↔ Community Dragon apiName 불일치)
 *  - EmeraldAspect = DA_Emerald18 "에메랄드 성위"
 *  - OldGrowth    = DA_18_Maokai_UniqueTrait "고목"
 *  - BountySeeker = DA_DravenUniqueTrait18 "현상금 추적자"
 */
const ALIASES = {
  emeraldaspect: 'emerald',
  oldgrowth: 'maokai_uniquetrait',
  bountyseeker: 'dravenuniquetrait',
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

async function loadJson(url, file, label) {
  if (file) {
    if (!fs.existsSync(file)) throw new Error(`${label} 파일 없음: ${file}`)
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${label} 다운로드 실패 (${res.status})`)
  return res.json()
}

function pickSet(data, label) {
  const set = data.sets?.[SET]
  if (!set) throw new Error(`${label}: 세트 ${SET} 를 찾을 수 없습니다.`)
  return set
}

async function main() {
  console.log(`Community Dragon 에서 세트 ${SET} 시너지 breakpoint 를 생성합니다...`)
  const [ko, en] = await Promise.all([
    loadJson(CDRAGON_KO, KO_FILE, 'ko_kr'),
    loadJson(CDRAGON_EN, EN_FILE, 'en_us'),
  ])

  const koSet = pickSet(ko, 'ko_kr')
  const enSet = pickSet(en, 'en_us')
  const enNameByApi = new Map((enSet.traits || []).map((t) => [t.apiName, t.name]))

  const traits = {}
  let withEffects = 0

  for (const trait of koSet.traits || []) {
    const minUnits = (trait.effects || [])
      .map((effect) => effect.minUnits)
      .filter((n) => typeof n === 'number' && n > 0)

    if (minUnits.length === 0) continue

    const breakpoints = [...new Set(minUnits)].sort((a, b) => a - b)
    const nameEn = enNameByApi.get(trait.apiName) || ''
    const entry = {
      name: trait.name || '',
      nameEn,
      breakpoints,
      max: breakpoints[breakpoints.length - 1],
    }

    const keys = new Set([
      norm(trait.apiName),
      nameEn ? norm(nameEn) : '',
      (trait.name || '').trim(),
    ])
    for (const key of keys) {
      if (key) traits[key] = entry
    }
    withEffects += 1
  }

  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'communitydragon (cdragon/tft ko_kr + en_us)',
    set: Number(SET),
    traitCount: withEffects,
    traits,
  }

  // 별칭 매핑 (자동 매칭 실패분 보정) — 대상이 없으면 경고만 남긴다.
  const aliasReport = []
  for (const [from, to] of Object.entries(ALIASES)) {
    if (traits[to]) {
      traits[from] = traits[to]
      aliasReport.push(`${from}→${to}`)
    } else {
      aliasReport.push(`${from}→${to}(없음)`)
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(output, null, 2), 'utf-8')

  console.log(`✅ ${path.relative(path.join(__dirname, '..'), OUT)}`)
  console.log(`   세트 ${SET} · breakpoint 보유 시너지 ${withEffects}종 · 등록 키 ${Object.keys(traits).length}개`)
  if (aliasReport.length > 0) console.log(`   별칭: ${aliasReport.join(', ')}`)
  const sample = Object.entries(traits).slice(0, 4)
  for (const [key, entry] of sample) {
    console.log(`   - ${key} → ${entry.name}(${entry.nameEn}) ${entry.breakpoints.join('/')}`)
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`)
  process.exit(1)
})

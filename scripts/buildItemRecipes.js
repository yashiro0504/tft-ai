/**
 * TFT 아이템 조합법(완성템 → 재료 2개) 생성기
 *
 * 소스: Community Dragon `cdragon/tft/ko_kr.json` 의 items[].composition
 *  - Data Dragon tft-item.json 에는 조합법이 없다.
 *  - 기본 재료 8종으로 만드는 아이템만 남긴다. 뒤집개·프라이팬(상징)은 세트마다 이름이 겹치고 캐리 핵심템이
 *    아니므로 제외한다 (옛 세트 재료·용병 상자 등도 제외).
 *  - 경기 데이터·메타 덱 데이터가 아이템을 한글 이름으로 들고 있으므로 한글 이름을 키로 쓴다.
 *
 * 산출물: `lib/itemRecipes.json` — { components: 재료 한글명[], recipes: { 완성템 한글명: [재료, 재료] } }
 *
 * 사용법:
 *   node scripts/buildItemRecipes.js                 # 최신 데이터 fetch
 *   node scripts/buildItemRecipes.js --file ko.json  # 받아 둔 파일 사용
 */
const fs = require('fs')
const path = require('path')

const CDRAGON_KO = 'https://raw.communitydragon.org/latest/cdragon/tft/ko_kr.json'
const OUT = path.join(__dirname, '..', 'lib', 'itemRecipes.json')

const args = process.argv.slice(2)
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : ''

/** 기본 재료 8종 (apiName) */
const COMPONENTS = [
  'TFT_Item_BFSword',
  'TFT_Item_RecurveBow',
  'TFT_Item_NeedlesslyLargeRod',
  'TFT_Item_TearOfTheGoddess',
  'TFT_Item_ChainVest',
  'TFT_Item_NegatronCloak',
  'TFT_Item_GiantsBelt',
  'TFT_Item_SparringGloves',
]

async function load() {
  if (fileArg) return JSON.parse(fs.readFileSync(fileArg, 'utf-8'))
  const res = await fetch(CDRAGON_KO)
  if (!res.ok) throw new Error(`Community Dragon ${res.status}`)
  return res.json()
}

async function run() {
  const data = await load()
  const byApi = Object.fromEntries(data.items.map((i) => [i.apiName, i]))
  const componentName = (api) => byApi[api]?.name
  const components = COMPONENTS.map(componentName)
  if (components.some((n) => !n)) throw new Error(`재료 이름 누락: ${COMPONENTS.filter((a) => !componentName(a)).join(', ')}`)

  const recipes = {}
  const conflicts = []
  for (const item of data.items) {
    const comp = item.composition
    if (!Array.isArray(comp) || comp.length !== 2 || !comp.every((c) => COMPONENTS.includes(c))) continue
    if (!item.name || /^tft_item_name_/i.test(item.name)) continue
    const pair = comp.map(componentName).sort()
    const prev = recipes[item.name]
    if (prev && prev.join('+') !== pair.join('+')) {
      // 같은 이름이 다른 조합으로 두 번 나오면 기본(TFT_Item_) 쪽을 남긴다
      conflicts.push(`${item.name}: ${prev.join('+')} vs ${pair.join('+')} (${item.apiName})`)
      if (!/^TFT_Item_/.test(item.apiName)) continue
    }
    recipes[item.name] = pair
  }

  const out = {
    _comment: '완성템 → 재료 2개 (한글명). scripts/buildItemRecipes.js 로 생성. 빈집 메타 덱 후보의 재료 단위 매칭에 쓴다.',
    source: CDRAGON_KO,
    generatedAt: new Date().toISOString().slice(0, 10),
    components,
    recipes: Object.fromEntries(Object.entries(recipes).sort(([a], [b]) => a.localeCompare(b, 'ko'))),
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf-8')
  console.log(`✅ ${Object.keys(recipes).length}개 조합법 → ${path.relative(process.cwd(), OUT)}`)
  if (conflicts.length) console.log(`⚠️ 이름 충돌 ${conflicts.length}건:\n  ${conflicts.join('\n  ')}`)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

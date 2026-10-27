/**
 * 메타 BIS 탭 검증 (lib/statsShared buildCompSets · lib/metaPayload).
 * BIS 탭은 기물 탭과 같은 기물 수치가 아니라 '기물별 아이템' 정보를 보여 줘야 한다.
 *
 *  1. 채용 순: 표본 큰 주류 아이템이 표본 작은 고성적 아이템보다 앞 (2026-10-27 럭스: 적응형 투구 31판 2.71등이 쇼진의 창 135판을 밀어냄)
 *  2. 후보 하한 20판 · 최대 3개 · 채용률 = 든 판 ÷ 기물 판수 (같은 아이템 2개로 100% 를 넘으면 자름)
 *  3. 빌드 타임 JSON(/api/tft/meta)도 같은 규칙 — 예전 getCompSets 는 10판·평균등수 순이었다
 *  4. AI 리포트 BIS 일치율(lib/comparisonFacts bisBySlug)과 같은 아이템 3개
 *
 * 사용법: node scripts/testBisSets.js   (npm run test:tiers 에 포함)
 */
require('./_ts')
const { MIN_SAMPLE, buildCompSets, buildsCompatible } = require('../lib/statsShared')
const { buildMetaPayload } = require('../lib/metaPayload')
const { bisBySlug } = require('../lib/comparisonFacts')
const { entitySlug } = require('../lib/entitySlug')

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${!ok && detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

const champ = (key, sampleSize, avgPlacement = 4) => ({
  key,
  name: key,
  imgUrl: '',
  cost: 5,
  avgPlacement,
  top4Rate: 0.5,
  sampleSize,
  avgTier: 2,
  threeStarRate: 0,
})
const combo = (champKey, itemKey, sampleSize, avgPlacement) => ({
  key: `${champKey}|${itemKey}`,
  champKey,
  itemKey,
  champName: champKey,
  champImgUrl: '',
  itemName: itemKey,
  itemIconUrl: '',
  avgPlacement,
  top4Rate: 0.5,
  sampleSize,
})

console.log('선택 규칙 (고정 수치)')
const [lux] = buildCompSets(
  [champ('Lux', 388, 3.4)],
  [
    combo('Lux', 'Shojin', 135, 3.62),
    combo('Lux', 'Gauntlet', 68, 3.53),
    combo('Lux', 'Void', 54, 3.19),
    combo('Lux', 'Adaptive', 31, 2.71),
    combo('Lux', 'Rare', 19, 1.5),
  ]
)
check(
  '채용 순 — 주류(쇼진 135판)가 고성적 소수(적응형 31판 2.71등)보다 앞',
  lux.items.map((i) => i.name).join(',') === 'Shojin,Gauntlet,Void',
  lux.items.map((i) => i.name).join(',')
)
check(`후보 하한 ${MIN_SAMPLE.unit_item}판 — 19판 1.5등은 제외`, !lux.items.some((i) => i.name === 'Rare'))
check('채용률 = 든 판 ÷ 기물 판수', Math.abs(lux.items[0].pickRate - 135 / 388) < 1e-9, String(lux.items[0].pickRate))
const [twice] = buildCompSets([champ('Ornn', 40)], [combo('Ornn', 'Sword', 45, 4)])
check('같은 아이템 2개로 든 판이 기물 판수를 넘어도 채용률 ≤ 100%', twice.items[0].pickRate === 1, String(twice.items[0].pickRate))
const tie = buildCompSets([champ('Ahri', 100)], [combo('Ahri', 'B', 40, 4.2), combo('Ahri', 'A', 40, 3.9)])[0]
check('채용 판 수가 같으면 평균등수 낮은 순', tie.items[0].name === 'A')
check('아이템 후보가 없는 기물은 BIS 행 없음', buildCompSets([champ('Zed', 100)], [combo('Zed', 'X', 10, 3)]).length === 0)

console.log('3개 함께 (기물 빌드 — lib/unitBuilds)')
{
  const { toBuildRankings } = require('../lib/unitBuilds')
  const row = (unit, items, games, placementSum, unitGames) => ({ unit, items, games, placement_sum: placementSum, top4: Math.round(games / 2), wins: 1, unit_games: unitGames })
  // 같은 기물의 두 api_id(GnarSmall·Gnar)는 한 기물로 합치고, 분모는 api_id 마다 한 번씩
  const merged = toBuildRankings([
    row('TFT18_GnarSmall', ['Shojin', 'Gauntlet', 'Void'], 10, 30, 100),
    row('TFT18_Gnar', ['Void', 'Shojin', 'Gauntlet'], 10, 50, 100),
    row('TFT18_Gnar', ['Shojin', 'Shojin', 'Void'], 30, 120, 100),
    row('TFT18_Gnar', ['Shojin', 'Void'], 50, 100, 100),
  ])
  const g = merged.find((b) => b.itemKeys.join() === 'Gauntlet,Shojin,Void')
  check(
    'api_id 변형 합치기 · 순서 무관 같은 세트 · 분모 합(100+100) · 아이템 3개 아닌 행 제외',
    merged.length === 2 && g && g.champKey === 'Gnar' && g.sampleSize === 20 && g.avgPlacement === 4 && g.pickRate === 0.1,
    JSON.stringify(merged.map((b) => [b.key, b.sampleSize, b.avgPlacement, b.pickRate]))
  )
  check('채용 판 수 순 (쇼진 2개 세트 30판이 먼저)', merged[0].itemKeys.join() === 'Shojin,Shojin,Void')

  const builds = toBuildRankings([
    row('TFT18_Lux', ['Shojin', 'Gauntlet', 'Void'], 40, 140, 388),
    row('TFT18_Lux', ['Shojin', 'Gauntlet', 'Rabadon'], 50, 160, 388),
    row('TFT18_Lux', ['Shojin', 'Void', 'Morello'], 8, 30, 388),
    row('TFT18_Lux', ['Shojin', 'Void', 'Archangel'], 6, 30, 388),
  ])
  const combos = [combo('Lux', 'Shojin', 135, 3.62), combo('Lux', 'Gauntlet', 68, 3.53), combo('Lux', 'Void', 54, 3.19), combo('Lux', 'Rabadon', 30, 3.6)]
  const [withSet] = buildCompSets([champ('Lux', 388, 3.4)], combos, builds)
  check(
    'bisSet = BIS 3개(쇼진·건틀릿·공허)를 함께 든 세트 — 가장 많이 든 세트(라바돈 50판)와 따로',
    withSet.bisSet && withSet.bisSet.sampleSize === 40 && withSet.bisSet.avgPlacement === 3.5 && withSet.builds[0].sampleSize === 50,
    JSON.stringify({ bisSet: withSet.bisSet, builds: withSet.builds?.map((b) => b.sampleSize) })
  )
  check('builds: 많이 든 순 상위 3개', withSet.builds.length === 3 && withSet.builds.map((b) => b.sampleSize).join() === '50,40,8')
  check(
    '세트 안 아이템은 이 기물에서 많이 드는 아이템부터 (쇼진 135 > 건틀릿 68 > 공허 54)',
    withSet.bisSet.items.map((i) => i.key).join() === 'Shojin,Gauntlet,Void',
    withSet.bisSet.items.map((i) => i.key).join()
  )
  const [rare] = buildCompSets([champ('Lux', 388, 3.4)], combos, builds.filter((b) => b.itemKeys.join() !== 'Gauntlet,Shojin,Void'))
  check('빌드 집계는 있는데 BIS 세트가 목록에 없음 → null (화면: 3개 함께 든 판 적음)', rare.bisSet === null)
  const [noData] = buildCompSets([champ('Lux', 388, 3.4)], combos, [])
  check('빌드 집계가 비었으면 builds·bisSet 없음 (적음으로 잘못 보이지 않게)', noData.builds === undefined && noData.bisSet === undefined)
  const [twoItems] = buildCompSets([champ('Lux', 388, 3.4)], combos.slice(0, 2), builds)
  check('BIS 가 2개뿐이면 bisSet 없음 · builds 는 있음', twoItems.bisSet === undefined && twoItems.builds.length === 3)
}

console.log('빌드 사용 가드')
{
  const stats = (source, patch) => ({ source, filter: patch ? { patch, tier: 'master', days: 7 } : null })
  const builds = (source, patch) => ({ success: true, source, filter: patch ? { patch, tier: 'master' } : null, rows: [] })
  check('db/db + 같은 패치 → 사용', buildsCompatible(stats('db', '16.21'), builds('db', '16.21')) === true)
  check('db/db + 다른 패치 → 버림 (패치 전환 직후 캐시 어긋남)', buildsCompatible(stats('db', '16.21'), builds('db', '16.20')) === false)
  check('db 통계 + json 빌드 → 버림', buildsCompatible(stats('db', '16.21'), builds('json', null)) === false)
  check('빌드 응답 없음 → 버림', buildsCompatible(stats('db', '16.21'), null) === false)
  check('json/json → 사용 (패치 라벨 체계가 달라 비교하지 않음)', buildsCompatible(stats('json', null), builds('json', null)) === true)
}

console.log('빌드 타임 JSON (/api/tft/meta)')
const p = buildMetaPayload()
const comps = p.comps
check('BIS 행이 있음', comps.length > 0, String(comps.length))
const bad = comps.filter(
  (c) =>
    !c.items.length ||
    c.items.length > 3 ||
    c.items.some((it, i) => it.sampleSize < MIN_SAMPLE.unit_item || !(it.pickRate > 0 && it.pickRate <= 1) || (i && c.items[i - 1].sampleSize < it.sampleSize))
)
check('모든 행: 1~3개 · 20판 이상 · 채용 순 · 채용률 0~100%', !bad.length, bad.slice(0, 3).map((c) => c.name).join(', '))
const champByKey = new Map(p.champions.map((c) => [c.key, c]))
check(
  'BIS 행의 기물 수치 = 기물 탭 수치 (기준값으로만 쓴다)',
  comps.every((c) => champByKey.get(c.key)?.avgPlacement === c.avgPlacement && champByKey.get(c.key)?.sampleSize === c.sampleSize)
)

console.log('AI 리포트 BIS 일치율과 같은 기준')
const ai = bisBySlug(p.combos)
const diff = comps.filter((c) => (ai.get(entitySlug('champion', c.key)) ?? []).join('|') !== c.items.map((it) => it.name).join('|'))
check('기물별 BIS 3개가 bisBySlug 와 같음', !diff.length, diff.slice(0, 3).map((c) => `${c.name}: ${c.items.map((i) => i.name)} ≠ ${ai.get(entitySlug('champion', c.key))}`).join(' / '))

console.log(failures.length ? `\n❌ 실패 ${failures.length}건` : '\n✅ BIS 탭 테스트 통과')
if (failures.length) process.exitCode = 1

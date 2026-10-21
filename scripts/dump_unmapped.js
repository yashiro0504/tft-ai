/**
 * 세트18 전용 기물/아이템/시너지 중 한글 미번역 키 추출 스크립트
 *
 * 출력: 콘솔에 미번역 키 목록 (챔피언/아이템/시너지별)
 *  - constants.ts의 translate* 함수 로직과 동일하게 탐색:
 *    SPECIAL 사전 -> champMap/itemMap/traitMap 순서
 *
 * 사용법: node scripts/dump_unmapped.js
 */
const tftData = require('../lib/tftData.json')
const meta = require('../lib/metaStats.json')

function normalizeTftId(id) {
  if (!id) return ''
  return String(id)
    .replace(/^TFT\d*_/i, '')
    .replace(/^DA_\d*_/i, '')
    .replace(/^DA_/i, '')
    .replace(/^TFTTutorial_/i, '')
    .replace(/_Base$/i, '')
    .replace(/Base$/i, '')
    .replace(/_(AP|AD)$/i, '')
    .replace(/\d+$/i, '')
    .replace(/Small$/i, '')
    .trim()
}

function cleanItemId(id) {
  if (!id) return ''
  return String(id)
    .replace(/^TFT\d*_Item_/i, '')
    .replace(/^DA_\d*_Item_/i, '')
    .replace(/^DA_Item_/i, '')
    .replace(/^DA_/i, '')
    .replace(/^TFT_Item_/i, '')
    .replace(/^Item_/i, '')
    .trim()
}

// constants.ts SPECIAL 사전 (동기화 유지)
const SPECIAL_CHAMPS = [
  'kobuko', 'loris', 'silco', 'sevika', 'scar', 'smeech', 'maddie', 'steb', 'gnar',
  // 세트18 전용 기물 (SET18_CHAMPS)
  'murkwolf', 'krug', 'scuttlecrab', 'brambleback', 'sentinel', 'sentry',
  'elderdragon', 'cinderling', 'alune', 'gromp', 'pebbles', 'mamabeak', 'crimsonraptor',
]
// constants.ts SET18_TRAITS 와 동일 — traitMap 의 세트18 키(DA_*18*)를 정규화 id 로 색인
const SET18_TRAITS = new Set(
  Object.keys(tftData.traitMap || {})
    .filter((k) => /^DA_/.test(k) && /18/.test(k))
    .map((k) => normalizeTftId(k).toLowerCase())
)

// itemMap 카테고리 접두사(Foo/Bar/ID) 제거 인덱스 — constants.ts itemSegmentIndex 와 동일
const ITEM_SEGMENT_INDEX = (() => {
  const m = tftData.itemMap || {}
  const idx = {}
  for (const [k, v] of Object.entries(m)) {
    const seg = k.split('/').pop() || k
    if (!idx[seg]) idx[seg] = v
    const low = seg.toLowerCase()
    if (!idx[low]) idx[low] = v
  }
  return idx
})()

function isChampMapped(key) {
  const cleanId = normalizeTftId(key)
  const lower = cleanId.toLowerCase()
  if (SPECIAL_CHAMPS.includes(lower)) return true
  const m = tftData.champMap || {}
  return Boolean(m[key] || m[cleanId] || m[lower])
}

function isItemMapped(key) {
  const cleanId = cleanItemId(key)
  const lower = cleanId.toLowerCase()
  const m = tftData.itemMap || {}
  if (m[key] || ITEM_SEGMENT_INDEX[key]) return true
  if (m[cleanId] || ITEM_SEGMENT_INDEX[cleanId]) return true
  if (m[lower] || ITEM_SEGMENT_INDEX[lower]) return true
  if (/emblem/i.test(cleanId)) return true // 상징 자동번역 처리됨
  return false
}

function isTraitMapped(key) {
  const cleanId = normalizeTftId(key)
  const lower = cleanId.toLowerCase()
  if (SET18_TRAITS.has(lower)) return true
  const m = tftData.traitMap || {}
  return Boolean(m[key] || m[cleanId] || m[lower])
}

function collectSection(section, isMapped) {
  const map = meta[section] || {}
  return Object.keys(map).filter((k) => !isMapped(k))
}

const unChamps = collectSection('champions', isChampMapped)
const unItems = collectSection('items', isItemMapped)
const unTraits = collectSection('traits', isTraitMapped)
// combos는 champ|item 쌍 — 각 파트를 개별 검사
const comboMap = meta.combos || {}
const unComboParts = new Set()
for (const key of Object.keys(comboMap)) {
  const [c, ...rest] = String(key).split('|')
  const item = rest.join('|')
  if (c && !isChampMapped(c)) unComboParts.add('CHAMP:' + c)
  if (item && !isItemMapped(item)) unComboParts.add('ITEM:' + item)
}

console.log('=== UNMAPPED CHAMPIONS (' + unChamps.length + ') ===')
unChamps.forEach((k) => console.log('  ' + k))
console.log('=== UNMAPPED ITEMS (' + unItems.length + ') ===')
unItems.forEach((k) => console.log('  ' + k))
console.log('=== UNMAPPED TRAITS (' + unTraits.length + ') ===')
unTraits.forEach((k) => console.log('  ' + k))
console.log('=== UNMAPPED COMBO PARTS (' + unComboParts.size + ') ===')
;[...unComboParts].forEach((k) => console.log('  ' + k))

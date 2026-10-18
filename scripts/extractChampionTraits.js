/**
 * 기물→시너지 사실 관계 추출 (1회성/재생성용)
 *
 * 현재 lib/decksData.json 의 units/traits 에서 "기물이 어떤 시너지를 갖는지"만 뽑아
 * lib/championTraits.json 으로 저장한다.
 * 덱 구성(큐레이션)은 가져오지 않으므로, 이후 덱 생성기는 이 파일만 참조한다.
 *
 * 사용: node scripts/extractChampionTraits.js
 */
const fs = require('fs')
const path = require('path')

const decks = require('../lib/decksData.json')

function norm(value) {
  return String(value || '')
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

const champions = {}
const traits = {}

for (const deck of decks.decks || []) {
  for (const trait of deck.traits || []) {
    const key = norm(trait.key)
    if (key && !traits[key]) traits[key] = { name: trait.name, iconUrl: trait.iconUrl }
  }

  for (const unit of deck.units || []) {
    const key = norm(unit.matchedKey || unit.lolchessKey)
    if (!key) continue
    const entry = (champions[key] = champions[key] || {
      name: unit.name,
      cost: unit.cost,
      imgUrl: unit.imgUrl,
      traits: [],
    })
    for (const trait of unit.traits || []) {
      if (!entry.traits.includes(trait)) entry.traits.push(trait)
    }
    if (entry.cost == null && unit.cost != null) entry.cost = unit.cost
    if (!entry.imgUrl && unit.imgUrl) entry.imgUrl = unit.imgUrl
    if (!entry.name && unit.name) entry.name = unit.name
  }
}

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: 'lib/decksData.json (기물-시너지 사실 관계만 추출)',
  championCount: Object.keys(champions).length,
  traitCount: Object.keys(traits).length,
  champions,
  traits,
}

const outPath = path.join(__dirname, '..', 'lib', 'championTraits.json')
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8')
console.log(`✅ ${outPath}`)
console.log(`   기물 ${output.championCount}종 · 시너지 ${output.traitCount}종`)

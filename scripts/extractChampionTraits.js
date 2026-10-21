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

/**
 * 덱 데이터에 한 번도 안 나와 빠지는 세트18 기물 보충 (Community Dragon ko_kr/en_us 세트 18 기준).
 * scripts/detectGameFacts.js '사전 누락' 이 찾았다 (2026-10-22).
 * 럭스는 기본형만 — 시너지 1개씩 더 붙는 변형(DA_18_Lux_Coven 등)은 별도 기물 키라 여기서 다루지 않는다.
 */
const SUPPLEMENT_TRAITS = {
  avatar: { name: '화신', iconUrl: 'https://ddragon.leagueoflegends.com/cdn/16.17.1/img/tft-trait/Trait_Icon_18_Avatar.TFT_Set18.png' },
}
const SUPPLEMENT_CHAMPIONS = {
  lux: { name: '럭스', cost: 5, imgUrl: 'https://raw.communitydragon.org/latest/game/assets/characters/tft18_lux/tft18_lux_square.png', traits: ['Avatar'] },
  gromp: { name: '심술두꺼비', cost: 2, imgUrl: 'https://raw.communitydragon.org/latest/game/assets/characters/tft18_gromp/tft18_gromp_square.png', traits: ['Riftbeast', 'Adaptor'] },
}
for (const [key, entry] of Object.entries(SUPPLEMENT_TRAITS)) traits[key] = traits[key] || entry
for (const [key, entry] of Object.entries(SUPPLEMENT_CHAMPIONS)) champions[key] = champions[key] || entry

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

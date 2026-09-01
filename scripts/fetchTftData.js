const fs = require('fs')
const path = require('path')

const DDRAGON_VERSION = '16.17.1'

async function run() {
  console.log('Fetching DataDragon metadata...')
  const [traitsRes, itemsRes, champsRes] = await Promise.all([
    fetch(`https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/data/ko_KR/tft-trait.json`).then(r => r.json()),
    fetch(`https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/data/ko_KR/tft-item.json`).then(r => r.json()),
    fetch(`https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/data/ko_KR/champion.json`).then(r => r.json()),
  ])

  const traitMap = {}
  for (const [key, val] of Object.entries(traitsRes.data)) {
    const cleanKey = key.replace(/^TFT\d*_/i, '').toLowerCase()
    const entry = {
      name: val.name,
      iconUrl: val.image?.full
        ? `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/tft-trait/${val.image.full}`
        : '',
    }
    traitMap[key] = entry
    traitMap[cleanKey] = entry
  }

  const itemMap = {}
  for (const [key, val] of Object.entries(itemsRes.data)) {
    const cleanKey = key
      .replace(/^TFT\d*_Item_/i, '')
      .replace(/^TFT_Item_/i, '')
      .replace(/^Item_/i, '')
      .toLowerCase()
    const entry = {
      name: val.name,
      iconUrl: val.image?.full
        ? `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/tft-item/${val.image.full}`
        : '',
    }
    itemMap[key] = entry
    itemMap[cleanKey] = entry
  }

  const champMap = {}
  for (const [key, val] of Object.entries(champsRes.data)) {
    const cleanKey = key.toLowerCase()
    const entry = {
      name: val.name,
      iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/${val.image.full}`,
    }
    champMap[key] = entry
    champMap[cleanKey] = entry
  }

  // 특수 챔피언 매핑 (Wukong, ChoGath, etc.)
  champMap['wukong'] = { name: '오공', iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/MonkeyKing.png` }
  champMap['monkeyking'] = { name: '오공', iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/MonkeyKing.png` }
  champMap['fiddlesticks'] = { name: '피들스틱', iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/FiddleSticks.png` }
  champMap['tahmkench'] = { name: '탐 켄치', iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/TahmKench.png` }
  champMap['twistedfate'] = { name: '트위스티드 페이트', iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/TwistedFate.png` }
  champMap['missfortune'] = { name: '미스 포츈', iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/MissFortune.png` }
  champMap['masteryi'] = { name: '마스터 이', iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/MasterYi.png` }
  champMap['xinzhao'] = { name: '신 짜오', iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/XinZhao.png` }
  champMap['jarvaniv'] = { name: '자르반 4세', iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/JarvanIV.png` }
  champMap['kogmaw'] = { name: '코그모', iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/KogMaw.png` }
  champMap['drmundo'] = { name: '문도 박사', iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/DrMundo.png` }
  champMap['aurelionsol'] = { name: '아우렐리온 솔', iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/AurelionSol.png` }
  champMap['reksai'] = { name: '렉사이', iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/RekSai.png` }
  champMap['khazix'] = { name: '카직스', iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Khazix.png` }
  champMap['chogath'] = { name: '초가스', iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Chogath.png` }
  champMap['kaisa'] = { name: '카이사', iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Kaisa.png` }
  champMap['velkoz'] = { name: '벨코즈', iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Velkoz.png` }
  champMap['leblanc'] = { name: '르블랑', iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Leblanc.png` }

  const output = {
    version: DDRAGON_VERSION,
    traitMap,
    itemMap,
    champMap,
  }

  const outPath = path.join(__dirname, '..', 'lib', 'tftData.json')
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8')
  console.log(`Saved ${Object.keys(traitMap).length} traits, ${Object.keys(itemMap).length} items, ${Object.keys(champMap).length} champs to ${outPath}`)
}

run().catch(console.error)

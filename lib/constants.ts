import tftData from './tftData.json'

export const DDRAGON_VERSION = tftData.version

export interface TranslatedItem {
  name: string
  iconUrl: string
}

export interface TranslatedTrait {
  name: string
  iconUrl: string
}

export interface TranslatedChamp {
  name: string
  imgUrl: string
  cost: number
}

// TFT Set 18 및 모든 시즌 접두사/접미사 정규화 (DA_18_Kobuko -> Kobuko, DA_Vi18 -> Vi)
export function normalizeTftId(id: string): string {
  if (!id) return ''
  return id
    .replace(/^TFT\d*_/i, '')
    .replace(/^DA_\d*_/i, '')
    .replace(/^DA_/i, '')
    .replace(/^TFTTutorial_/i, '')
    .replace(/\d+$/i, '')
    .replace(/Small$/i, '')
    .trim()
}

// 18시즌 및 TFT 전용 기물 특별 보완 사전
const SPECIAL_CHAMPS: Record<string, { ko: string; imgSlug: string; cost: number }> = {
  kobuko: { ko: '코부코', imgSlug: 'Braum', cost: 1 },
  loris: { ko: '로리스', imgSlug: 'Shen', cost: 3 },
  silco: { ko: '실코', imgSlug: 'Singed', cost: 4 },
  sevika: { ko: '세비카', imgSlug: 'Samira', cost: 5 },
  scar: { ko: '스카', imgSlug: 'Warwick', cost: 3 },
  smeech: { ko: '스미치', imgSlug: 'Twitch', cost: 3 },
  maddie: { ko: '매디', imgSlug: 'Caitlyn', cost: 1 },
  steb: { ko: '스텝', imgSlug: 'Singed', cost: 1 },
  gnar: { ko: '나르', imgSlug: 'Gnar', cost: 2 },
}

// 18시즌 및 특별 시너지 보완 사전
const SPECIAL_TRAITS: Record<string, { ko: string; iconSlug: string }> = {
  primal: { ko: '원시', iconSlug: 'Trait_Icon_16_Ixtal.png' },
  rival: { ko: '라이벌', iconSlug: 'Trait_Icon_16_Heroic.png' },
  sprykin: { ko: '요정', iconSlug: 'Trait_Icon_16_Yordle.png' },
  emerald: { ko: '에메랄드', iconSlug: 'Trait_Icon_16_Targon.png' },
  hunter: { ko: '사냥꾼', iconSlug: 'Trait_Icon_16_Demacia.png' },
  brawler: { ko: '난동꾼', iconSlug: 'Trait_Icon_16_Brawler.png' },
  juggernaut: { ko: '전쟁기계', iconSlug: 'Trait_Icon_16_Juggernaut.png' },
}

export function translateChampion(id: string): TranslatedChamp {
  if (!id) return { name: '알 수 없음', imgUrl: '', cost: 3 }

  const cleanId = normalizeTftId(id)
  const lower = cleanId.toLowerCase()

  // 1. 특별 기물 확인 (코부코 등)
  if (SPECIAL_CHAMPS[lower]) {
    const s = SPECIAL_CHAMPS[lower]
    return {
      name: s.ko,
      imgUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/${s.imgSlug}.png`,
      cost: s.cost,
    }
  }

  // 2. DataDragon 공식 데이터베이스 확인
  const champMap = tftData.champMap as Record<string, { name: string; iconUrl: string }>
  const entry = champMap[id] || champMap[cleanId] || champMap[lower]

  if (entry) {
    return {
      name: entry.name,
      imgUrl: entry.iconUrl,
      cost: 3,
    }
  }

  return {
    name: cleanId,
    imgUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/${cleanId}.png`,
    cost: 3,
  }
}

export function translateItem(id: string): TranslatedItem {
  if (!id) return { name: '', iconUrl: '' }

  const cleanId = id
    .replace(/^TFT\d*_Item_/i, '')
    .replace(/^DA_\d*_Item_/i, '')
    .replace(/^TFT_Item_/i, '')
    .replace(/^Item_/i, '')
    .trim()
  const lower = cleanId.toLowerCase()

  const itemMap = tftData.itemMap as Record<string, { name: string; iconUrl: string }>
  const entry = itemMap[id] || itemMap[cleanId] || itemMap[lower]

  if (entry) {
    return {
      name: entry.name,
      iconUrl: entry.iconUrl,
    }
  }

  // 상징(Emblem) 자동 번역
  if (cleanId.includes('Emblem')) {
    const traitKey = cleanId.replace(/Emblem(Item)?$/i, '').trim()
    const traitTrans = translateTrait(traitKey)
    return {
      name: `${traitTrans.name || traitKey} 상징`,
      iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/tft-item/TFT_Item_TacticiansCrown.png`,
    }
  }

  return {
    name: cleanId,
    iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/tft-item/${id}.png`,
  }
}

export function translateTrait(id: string): TranslatedTrait {
  if (!id) return { name: '', iconUrl: '' }

  const cleanId = normalizeTftId(id)
  const lower = cleanId.toLowerCase()

  // 1. 특별 18시즌 시너지 확인
  if (SPECIAL_TRAITS[lower]) {
    const s = SPECIAL_TRAITS[lower]
    return {
      name: s.ko,
      iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/tft-trait/${s.iconSlug}`,
    }
  }

  // 2. DataDragon 공식 데이터베이스 확인
  const traitMap = tftData.traitMap as Record<string, { name: string; iconUrl: string }>
  const entry = traitMap[id] || traitMap[cleanId] || traitMap[lower]

  if (entry) {
    return {
      name: entry.name,
      iconUrl: entry.iconUrl,
    }
  }

  return {
    name: cleanId,
    iconUrl: '',
  }
}

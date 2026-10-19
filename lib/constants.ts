import tftData from './tftData.json'

export const DDRAGON_VERSION = tftData.version
export const DDRAGON_TFT_VERSION = `tft-${tftData.version}`

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

// TFT Set 18 및 모든 시즌 접두사/접미사 정규화 (DA_18_Kobuko -> Kobuko, DA_Vi18 -> Vi, TFT18_Lux18_Base -> Lux)
export function normalizeTftId(id: string): string {
  if (!id) return ''
  return id
    .replace(/^TFT\d*_/i, '')
    .replace(/^DA_\d*_/i, '')
    .replace(/^DA_/i, '')
    .replace(/^TFTTutorial_/i, '')
    .replace(/_Base$/i, '')
    .replace(/Base$/i, '')
    // 세트 표기 접미사: Nidalee18_AP / KogMaw18_AD / Akali_AD → Nidalee / KogMaw / Akali
    .replace(/_(AP|AD)$/i, '')
    .replace(/\d+$/i, '')
    .replace(/Small$/i, '')
    .trim()
}

/** 아이템 아이콘/이름 조회용: itemMap 의 카테고리 접두사(Foo/Bar/ID)를 제거한 마지막 세그먼트 인덱스 */
const itemSegmentIndex: Record<string, { name: string; iconUrl: string }> = (() => {
  const map = tftData.itemMap as Record<string, { name: string; iconUrl: string }>
  const index: Record<string, { name: string; iconUrl: string }> = {}
  for (const [key, value] of Object.entries(map)) {
    const segment = key.split('/').pop() || key
    if (!index[segment]) index[segment] = value
    const lowerSegment = segment.toLowerCase()
    if (!index[lowerSegment]) index[lowerSegment] = value
  }
  return index
})()

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

// 세트18 전용 기물(정글 몬스터) 한글명 사전 — 한국 클라이언트 표기 기준
// (Murkwolf → 어스름늑대, Scuttlecrab → 바위 게, Krug → 돌거북, Brambleback → 덩굴정령 …)
// 주의: 내부 id와 실제 기물명이 다른 케이스가 있다 (Sentry = Pebbles/조약돌, 에셋명도 tft18_sentry).
// 이미지는 CommunityDragon TFT 에셋(tft18_*_square.png)을 사용한다.
const TFT_UNIT_ASSET_BASE = 'https://raw.communitydragon.org/latest/game/assets/characters'

interface Set18Champ {
  ko: string
  unit: string
  cost: number
  /** square 이미지가 character 루트가 아닌 하위 폴더(hud 등)에 있는 경우의 상대 경로 */
  square?: string
}

const SET18_CHAMPS: Record<string, Set18Champ> = {
  murkwolf: { ko: '어스름늑대', unit: 'tft18_murkwolf', cost: 2 },
  krug: { ko: '돌거북', unit: 'tft18_krug', cost: 3 },
  scuttlecrab: { ko: '바위 게', unit: 'tft18_scuttlecrab', cost: 2 },
  brambleback: { ko: '덩굴정령', unit: 'tft18_brambleback', cost: 4 },
  sentinel: { ko: '감시자', unit: 'tft18_sentinel', cost: 4 },
  sentry: { ko: '조약돌', unit: 'tft18_sentry', cost: 1 }, // 내부 id Sentry = Pebbles(조약돌)
  elderdragon: { ko: '장로 드래곤', unit: 'tft18_elderdragon', cost: 5 },
  cinderling: { ko: '불타는 묘목', unit: 'tft18_cinderling', cost: 1 },
  alune: { ko: '알룬', unit: 'tft18_alune', cost: 5 },
  gromp: { ko: '심술두꺼비', unit: 'tft18_gromp', cost: 2 },
  pebbles: { ko: '조약돌', unit: 'tft18_sentry', cost: 1 }, // Pebbles 에셋 폴더가 tft18_sentry
  mamabeak: { ko: '어미 부리', unit: 'tft18_raptor', cost: 3, square: 'tft18_raptor/hud/tft18_raptor_square.png' },
  crimsonraptor: { ko: '어미 부리', unit: 'tft18_raptor', cost: 3, square: 'tft18_raptor/hud/tft18_raptor_square.png' }, // 내부 id CrimsonRaptor = Mama Beak
}

/**
 * 세트18 기물 초상화 (CommunityDragon `tft18_<기물>/tft18_<기물>_square.png`).
 * LoL 기본 초상화(ddragon img/champion) 대신 TFT 세트18 전용 아트를 쓴다.
 * 목록은 CommunityDragon `game/assets/characters/` 의 tft18_* 폴더 중 기물 본체만 추렸다.
 */
const SET18_PORTRAIT_UNITS = new Set([
  'ahri', 'akali', 'alistar', 'alune', 'amumu', 'anivia', 'aphelios', 'ashe', 'azir', 'bard', 'brambleback',
  'brock', 'caitlyn', 'camille', 'cassiopeia', 'chogath', 'cinderling', 'diana', 'draven', 'elderdragon',
  'elise', 'evelynn', 'ezreal', 'fiddlesticks', 'gnar', 'gromp', 'hecarim', 'ivern', 'kalista', 'karma',
  'katarina', 'kayle', 'kennen', 'khazix', 'kobuko', 'kogmaw', 'krug', 'leblanc', 'leona', 'lillia', 'lux',
  'malphite', 'maokai', 'masteryi', 'mordekaiser', 'morgana', 'murkwolf', 'nautilus', 'neeko', 'nidalee',
  'nunu', 'ornn', 'rakan', 'rammus', 'raptor', 'reksai', 'renekton', 'rengar', 'scuttlecrab', 'sejuani',
  'sentinel', 'sentry', 'sett', 'shen', 'sion', 'sivir', 'soraka', 'talon', 'taric', 'teemo', 'tristana',
  'udyr', 'varus', 'veigar', 'vi', 'warwick', 'willump', 'xayah', 'xerath', 'yorick', 'yunara', 'zyra',
])

/** 내부 id/표기와 에셋 폴더명이 다른 기물 */
const SET18_PORTRAIT_ALIAS: Record<string, string> = {
  pebbles: 'sentry', // 조약돌
  mamabeak: 'raptor', // 어미 부리
  crimsonraptor: 'raptor',
}

/** 세트18 기물이면 전용 초상화 URL, 아니면 null */
export function set18PortraitUrl(id: string): string | null {
  if (!id) return null
  const lower = normalizeTftId(id).toLowerCase().replace(/[^a-z]/g, '')
  const folder = SET18_PORTRAIT_ALIAS[lower] ?? lower
  if (!SET18_PORTRAIT_UNITS.has(folder)) return null
  // 어미 부리는 square 이미지가 hud 폴더에만 있다
  if (folder === 'raptor') return `${TFT_UNIT_ASSET_BASE}/tft18_raptor/hud/tft18_raptor_square.png`
  return `${TFT_UNIT_ASSET_BASE}/tft18_${folder}/tft18_${folder}_square.png`
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

// 세트18 기물 코스트 (수집 데이터에 cost가 없을 때 폴백)
const CHAMPION_COSTS: Record<string, number> = {
  // 1코스트
  rakan: 1,
  leona: 1,
  reksai: 1,
  varus: 1,
  veigar: 1,
  cinderling: 1,
  akali: 1,
  ornn: 1,
  yorick: 1,
  xayah: 1,
  pebbles: 1,
  sentry: 1,
  karma: 1,
  camille: 1,
  kobuko: 1,
  // 2코스트
  leblanc: 2,
  scuttlecrab: 2,
  sejuani: 2,
  shen: 2,
  gromp: 2,
  alistar: 2,
  murkwolf: 2,
  elise: 2,
  warwick: 2,
  yunara: 2,
  caitlyn: 2,
  kayle: 2,
  teemo: 2,
  // 3코스트
  diana: 3,
  krug: 3,
  rammus: 3,
  rengar: 3,
  masteryi: 3,
  vi: 3,
  azir: 3,
  mamabeak: 3,
  crimsonraptor: 3,
  cassiopeia: 3,
  khazix: 3,
  kogmaw: 3,
  tristana: 3,
  fiddlesticks: 3,
  hecarim: 3,
  // 4코스트
  nidalee: 4,
  brambleback: 4,
  lillia: 4,
  malphite: 4,
  morgana: 4,
  sett: 4,
  soraka: 4,
  sivir: 4,
  ahri: 4,
  amumu: 4,
  aphelios: 4,
  ezreal: 4,
  zyra: 4,
  sentinel: 4,
  // 5코스트
  gnar: 5,
  draven: 5,
  lux: 5,
  maokai: 5,
  ivern: 5,
  alune: 5,
  ashe: 5,
  elderdragon: 5,
  kennen: 5,
  taric: 5,
}

/** 기물 코스트 (1~5). 표에 없으면 undefined */
export function getChampionCost(id: string): number | undefined {
  const key = normalizeTftId(id).toLowerCase()
  return CHAMPION_COSTS[key]
}

export function translateChampion(id: string): TranslatedChamp {
  if (!id) return { name: '알 수 없음', imgUrl: '', cost: 3 }

  const cleanId = normalizeTftId(id)
  const lower = cleanId.toLowerCase()
  // 세트18 기물은 이름 출처와 상관없이 전용 초상화를 쓴다
  const portrait = set18PortraitUrl(id)

  // 1. 특별 기물 확인 (코부코 등)
  if (SPECIAL_CHAMPS[lower]) {
    const s = SPECIAL_CHAMPS[lower]
    return {
      name: s.ko,
      imgUrl: portrait ?? `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/${s.imgSlug}.png`,
      cost: s.cost,
    }
  }

  // 1-1. 세트18 전용 기물 확인 (정글 몬스터: 머크울프/크러그/바위 게 …)
  if (SET18_CHAMPS[lower]) {
    const s = SET18_CHAMPS[lower]
    return {
      name: s.ko,
      imgUrl: s.square
        ? `${TFT_UNIT_ASSET_BASE}/${s.square}`
        : `${TFT_UNIT_ASSET_BASE}/${s.unit}/${s.unit}_square.png`,
      cost: s.cost,
    }
  }

  // 2. DataDragon 공식 데이터베이스 확인
  const champMap = tftData.champMap as Record<string, { name: string; iconUrl: string }>
  const entry = champMap[id] || champMap[cleanId] || champMap[lower]

  if (entry) {
    return {
      name: entry.name,
      imgUrl: portrait ?? entry.iconUrl,
      cost: 3,
    }
  }

  return {
    name: cleanId,
    imgUrl: portrait ?? `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/${cleanId}.png`,
    cost: 3,
  }
}

export function translateItem(id: string): TranslatedItem {
  if (!id) return { name: '', iconUrl: '' }

  const cleanId = id
    .replace(/^TFT\d*_Item_/i, '')
    .replace(/^DA_\d*_Item_/i, '')
    .replace(/^DA_Item_/i, '')
    .replace(/^DA_/i, '')
    .replace(/^TFT_Item_/i, '')
    .replace(/^Item_/i, '')
    .trim()
  const lower = cleanId.toLowerCase()

  const itemMap = tftData.itemMap as Record<string, { name: string; iconUrl: string }>
  // 세트18 아이템은 "TFTSet18/Set18_Items/DA_SpiritVisage"처럼 카테고리 접두사가 붙은 키로
  // 저장되어 있으므로, 마지막 경로 세그먼트 인덱스를 원본 id 우선으로 조회한다.
  // (예: DA_RedBuff 가 구버전 별칭 redbuff=태양불꽃 망토 로 잘못 번역되는 것 방지)
  const entry =
    itemMap[id] ||
    itemSegmentIndex[id] ||
    itemMap[cleanId] ||
    itemSegmentIndex[cleanId] ||
    itemMap[lower] ||
    itemSegmentIndex[lower]

  if (entry) {
    const itemFileName = entry.iconUrl.split('/').pop() || `${id}.png`
    return {
      name: entry.name,
      iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/tft-item/${itemFileName}`,
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
      iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_TFT_VERSION}/img/tft-trait/${s.iconSlug}`,
    }
  }

  // 2. DataDragon 공식 데이터베이스 확인 (이미지 URL은 TFT 전용으로 재구성)
  const traitMap = tftData.traitMap as Record<string, { name: string; iconUrl: string }>
  const entry = traitMap[id] || traitMap[cleanId] || traitMap[lower]

  if (entry) {
    const traitFileName = entry.iconUrl.split('/').pop() || `${cleanId}.png`
    return {
      name: entry.name,
      iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_TFT_VERSION}/img/tft-trait/${traitFileName}`,
    }
  }

  return {
    name: cleanId,
    iconUrl: '',
  }
}

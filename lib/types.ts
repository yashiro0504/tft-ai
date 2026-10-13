export interface RiotAccount {
  puuid: string
  gameName: string
  tagLine: string
}

export interface RawTFTUnit {
  character_id: string
  itemNames: string[]
  name?: string
  rarity?: number
  tier: number // 1, 2, 3성
}

export interface RawTFTTrait {
  name: string
  num_units: number
  style: number
  tier_current: number
  tier_total: number
}

export interface RawTFTParticipant {
  puuid: string
  riotIdGameName?: string
  riotIdTagline?: string
  placement: number
  level: number
  last_round: number
  time_eliminated: number
  gold_left: number
  players_eliminated: number
  total_damage_to_players: number
  augments: string[]
  traits: RawTFTTrait[]
  units: RawTFTUnit[]
}

export interface RawTFTMatch {
  metadata: {
    data_version: string
    match_id: string
    participants: string[]
  }
  info: {
    endOfGameResult: string
    gameCreation: number
    gameId: number
    game_datetime: number
    game_length: number
    game_version: string
    queue_id: number
    tft_set_number: number
    tft_set_core_name?: string
    participants: RawTFTParticipant[]
  }
}

// 토큰 다이어트된 핵심 매치 요약
export interface SlimMatchUnit {
  id: string
  name: string
  tier: number
  rarity?: number
  imgUrl?: string
  items: string[]
  itemIcons?: string[]
}

export interface SlimMatchTrait {
  name: string
  tier: number
  count: number
  iconUrl?: string
}

// 로비 8명 전체 순위 정보 (롤체지지/OP.GG 아코디언)
export interface LobbyParticipant {
  placement: number
  gameName: string
  tagLine?: string
  level: number
  lastRound: string
  damageToPlayers: number
  traits: SlimMatchTrait[]
  units: SlimMatchUnit[]
  isUser: boolean
}

// ── 로비 경합 분석 (Phase 2: 코스트/성급/시너지 가중) ──

export type ContestLevel = '빈집' | '보통' | '경합' | '심각'

export interface UnitContestDetail {
  unitId: string
  name: string
  /** 코스트(1~5). SlimMatchUnit.rarity 가 실제 코스트 */
  cost: number
  /** 내 성급 (1~3) */
  myTier: number
  /** 나와 같은 기물을 기용한 상대 수 */
  opponentCount: number
  /** 경합 위험 가중치 (코스트 × 성급 민감도 × 빈도) */
  weight: number
}

export interface TraitContestDetail {
  name: string
  /** 내 시너지 활성 단계 */
  myTier: number
  /** 내 시너지 기물 수 */
  myCount: number
  /** 나와 같은 시너지를 활성한 상대 수 */
  opponentCount: number
  weight: number
}

export interface ContestAnalysis {
  isContested: boolean
  /** 경합 강도 0~100 (0=빈집, 100=최악). analyzeContest()가 항상 채움 */
  contestScore?: number
  level?: ContestLevel
  /** 코어 기물 또는 상위 시너지를 공유한 상대 수 */
  opponentCount: number
  contestedUnits: string[]
  contestedTraits: string[]
  unitDetails?: UnitContestDetail[]
  traitDetails?: TraitContestDetail[]
  /** 규칙 기반 요약 텍스트 (LLM 없이도 표시 가능) */
  summary?: string
}

export interface SlimMatchData {
  matchId: string
  setNumber?: number
  gameDatetime: number
  timeAgo?: string
  gameLengthStr?: string
  queueType?: string
  placement: number
  level: number
  lastRound: string // e.g. "5-2"
  goldLeft: number
  augments: string[]
  traits: SlimMatchTrait[]
  units: SlimMatchUnit[]
  lobbyParticipants?: LobbyParticipant[] // 로비 8명 전체 순위
  contestedInfo?: ContestAnalysis
}

// 소환사 프로필 요약 카드 정보
export interface SummonerProfile {
  gameName: string
  tagLine: string
  summonerLevel: number
  profileIconUrl: string
  avgPlacement: number
  winRate: number // 1등 비율 (%)
  top4Rate: number // 순방 비율 (%)
  totalGames: number
}

// 전문 메타 코칭 응답 결과
export interface MetaCoachFeedback {
  mode: 'single' | 'multi'
  metaScore: number
  metaTier: string
  flexibilityScore: number
  playstyle: string
  overview: string
  contestAnalysis: string
  itemAnalysis: string
  synergyAnalysis: string
  economyAnalysis: string
  improvements: string[]
  actionPlan: string[]
  fullMarkdown?: string
}

export interface TFTAnalysisResponse {
  success: boolean
  gameName: string
  tagLine: string
  puuid: string
  mode: 'single' | 'multi'
  matches: SlimMatchData[]
  feedback: MetaCoachFeedback
  summonerProfile?: SummonerProfile
  isDemo?: boolean
  error?: string
}

// ── Phase 1: 아이디 검색 → 경기별 분석 API 응답 타입 ──

/** POST /api/tft/search 응답: 프로필 + 최근 매치 리스트 (AI 분석 없음) */
export interface TftSearchResponse {
  success: boolean
  gameName: string
  tagLine: string
  puuid: string
  summonerProfile?: SummonerProfile
  matches: SlimMatchData[]
  isDemo?: boolean
  error?: string
}

/** POST /api/tft/match 응답: 특정 경기 1개 정밀 AI 분석 (matchId 캐시) */
export interface TftMatchAnalysisResponse {
  success: boolean
  matchId: string
  match?: SlimMatchData
  feedback?: MetaCoachFeedback
  cached?: boolean
  error?: string
}

/** POST /api/tft/overview 응답: 로드된 여러 경기 종합 AI 분석 */
export interface TftOverviewResponse {
  success: boolean
  gameName: string
  tagLine: string
  puuid?: string
  mode: 'single' | 'multi'
  matchCount: number
  feedback?: MetaCoachFeedback
  summonerProfile?: SummonerProfile
  isDemo?: boolean
  error?: string
}

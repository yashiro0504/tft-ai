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
  augments?: string[]
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
  /** Riot 시너지 색 단계: 1 브론즈 · 2 실버 · 3 골드 · 4 프리즘 (이 필드 전에 캐시된 경기에는 없다) */
  style?: number
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

// ── 증강 메타 분석 (Phase 3: 메타 데이터 파이프라인) ──

export interface AugmentMetaDetail {
  name: string
  /** 해당 패치 평균 등수 (낮을수록 좋음) */
  avgPlacement?: number
  top4Rate?: number
  /** 픽률 (0~1) */
  pickRate?: number
  sampleSize?: number
  /** 평균 등수 기반 티어 (S/A/B/C/D) */
  tier?: string
  /** baseline(4.5) 대비 개선도 (양수=좋음) */
  deltaVsBaseline?: number
}

export interface AugmentAnalysis {
  /** 메타 통계가 실제로 매칭된 증강이 하나라도 있는지 */
  hasMeta: boolean
  /** 샘플(검증 전) 데이터 여부 — true면 실측 통계로 단정 금지 */
  sample: boolean
  patch?: string
  source?: string
  baselineAvgPlacement?: number
  details: AugmentMetaDetail[]
  /** 증강 선택 종합 점수 0~100 (메타 있을 때만 산출) */
  augmentScore?: number
}

export interface SlimMatchData {
  matchId: string
  setNumber?: number
  /** 경기 시각 (Riot game_datetime, ms). 경과 시간은 화면에서 이 값으로 계산한다 (lib/timeAgo) */
  gameDatetime: number
  /** @deprecated 예전 캐시에 남은 문자열 — 읽을 때 지운다 (lib/boardUnits normalizeSlimMatch) */
  timeAgo?: string
  gameLengthStr?: string
  /** 게임 길이(초) — 초반 종료 표본 판정용 */
  gameLengthSec?: number
  /** Riot queue_id (1100 = 랭크). 분석은 랭크 판만 — lib/queue */
  queueId?: number
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
  augmentAnalysis?: AugmentAnalysis
}

// 소환사 랭크(티어) 정보 — TFT League v1 `RANKED_TFT` 큐
export interface TftRankInfo {
  queueType: 'RANKED_TFT'
  /** IRON | BRONZE | SILVER | GOLD | PLATINUM | EMERALD | DIAMOND | MASTER | GRANDMASTER | CHALLENGER */
  tier: string
  /** I~IV (MASTER 이상은 'I' 고정) */
  rank: string
  leaguePoints: number
  wins: number
  losses: number
  hotStreak?: boolean
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
  /** 랭크 정보. 배치 중/미조회/API 오류 시 null */
  rank?: TftRankInfo | null
}

/** LLM 서술의 수치 근거 검증 결과 (코드 산출) */
export interface GroundingReport {
  /** 근거 일치율 0~100 (낮을수록 창작/환각 가능성) */
  score: number
  /** 검증한 수치 주장 수 */
  total: number
  /** 제공된 사실에서 확인된 수치 주장 수 */
  supported: number
  /** 사실에서 확인되지 않은 수치 주장 (예: "72%", "3.44") */
  unsupported: string[]
  /** 수치가 아닌 환각 경고 (제공되지 않은 시너지명, 존재하지 않는 코스트 등) */
  warnings?: string[]
  /** 의미(엔티티 사실) 오류 — 기물 성급·3성 개수·아이템 소유·시너지 단계가 최종 보드와 다름 (lib/semanticGrounding).
   * 검출 기록이다: 해당 문장은 응답 전에 고치거나 지웠다 (repairEntityErrors) */
  entityErrors?: EntityFactError[]
  /** 리포트에 나온 기물·아이템 이름 중 내 보드(또는 메타·상대 맥락의 사실)로 확인한 수 — 확인 못 한 문장은 지운 뒤 센다 */
  namesChecked?: number
}

export interface EntityFactError {
  /** unit_absent · item_absent: 내 최종 보드에 없는 기물·아이템을 내 보드 이야기처럼 쓴 문장 (지운다) */
  type: 'unit_star' | 'three_star_count' | 'item_owner' | 'trait_tier' | 'unit_absent' | 'item_absent' | 'item_recipe' | 'advice_conflict' | 'count_mismatch'
  /** 오류가 있는 문장 */
  text: string
  /** 데이터 값 */
  expected: string
  /** 리포트가 쓴 값 */
  actual: string
}

/** 리포트가 참조한 데이터 출처/패치/표본 정보 */
export interface FeedbackProvenance {
  patch?: string
  source?: string
  generatedAt?: string
  sample?: boolean
  /** DB 집계 범위 (예: "마스터+ · 최근 7일") — source='riot-ranked-db' 일 때 */
  filter?: string
  /** 그 범위의 판 수 */
  matches?: number
  /** 프롬프트에 주입한 기물/아이템/조합 통계 항목 수 */
  championStats?: number
  itemStats?: number
  comboStats?: number
}

/** 점수 구성요소 (코드 산출) */
export interface ScoreComponent {
  key: 'placement' | 'completion' | 'items' | 'contest'
  label: string
  /** 가중치 0~1 */
  weight: number
  /** 구성요소 점수 0~100 */
  score: number
  /** 기여도 = weight × score (0~100) */
  contribution: number
  /** 근거 요약 (경기 평균 기준) */
  detail: string
}

/** 결정론적 metaScore 산출 근거 */
export interface ScoreBreakdown {
  /** 가중 합산 점수 0~100 */
  total: number
  tier: string
  components: ScoreComponent[]
  /** 집계에 사용된 경기 수 */
  matches: number
  /** 경기별 총점 (재현/디버깅용) */
  perMatch: number[]
  /** 점수 집계에서 제외한 초반 종료 경기 수 */
  excludedMatches?: number
  /** 표본이 부족해 점수 해석에 주의가 필요한가 */
  lowSample?: boolean
  /** 표본 관련 안내 문구 */
  sampleWarning?: string
  /** 산출식 버전 */
  version: string
}

/** 강의형 코칭 축 */
export type CoachingAxisKey =
  | 'economy'
  | 'itemization'
  | 'tempo'
  | 'completion'
  | 'synergy'
  | 'contest'

/** 축 점수의 근거가 되는 원시 지표 (경기 평균 또는 이 경기 값) */
export interface AxisMetric {
  key: string
  label: string
  value: number
  unit?: string
}

/** 축 점수에 더해지거나 빠진 항목 (점수 = 각 항목 합, 0~100 으로 자른 뒤 경기 평균) */
export interface AxisEffect {
  key: string
  label: string
  /** +면 가점, -면 감점 (경기 평균, 소수 1자리) */
  points: number
}

export interface CoachingAxis {
  key: CoachingAxisKey
  label: string
  /** 0~100 (코드 산출) */
  score: number
  detail: string
  /** 세부 지표 (axisConfig 공식의 입력값) */
  metrics?: AxisMetric[]
  /** 점수 구성 (가점/감점 분해) */
  effects?: AxisEffect[]
  /** 이 축에서 배울 개념 한 줄 */
  lesson: string
  /** LLM 한 줄 진단 */
  verdict?: string
}

/** 덱 유형 (리롤형/표준형). mixed 는 여러 경기 종합에서 유형이 섞인 경우 */
export type DeckType = 'reroll' | 'standard' | 'mixed' | 'unknown'

/** 한 경기의 덱 유형 판정 결과 (lib/deckType.ts) */
export interface DeckTypeInfo {
  type: Exclude<DeckType, 'mixed'>
  threeStars: number
  threeStarCosts: number[]
  lowCostThreeStars: number
  carryThreeStar: boolean
  reason: string
}

/** 코드가 결정한 이번 리포트의 강의 계획 */
export interface CoachingPlan {
  focus: CoachingAxisKey
  focusLabel: string
  /** 강의 주제 (예: "레벨업 타이밍 강의 — 언제 6·7·8·9를 찍어야 하는가") */
  topic: string
  axes: CoachingAxis[]
  /** 강의 기본 개념 문장 */
  drillTemplate: string
  matchCount: number
  /** 덱 유형 판정 (리롤형이면 템포 축·강의 주제가 리롤 성과 기준으로 바뀐다) */
  deckType?: DeckType
  deckTypeLabel?: string
  deckTypeReason?: string
  /** 초반 종료 경기만 있어 표본이 부족한가 */
  lowSample?: boolean
  /** 점수/강의에서 제외한 초반 종료 경기 수 */
  excludedMatches?: number
  /** 표본 관련 안내 */
  sampleWarning?: string
  /** 점수 공식 버전 (axisConfig.version) */
  scoringVersion?: string
}

/** LLM이 작성하는 강의 본문 */
/** 핵심 장면 해설 — title·fact 는 코드(lib/keyMoments)가 정하고, why·fix 는 LLM 이 쓴다 */
export interface LectureMoment {
  /** 장면 종류 (lib/keyMoments KeyMoment.kind) — 연습 목표(lib/goals)로 바꿀 때 쓴다. 2026-10-22 이전 리포트엔 없다 */
  kind?: string
  title: string
  /** 코드가 뽑은 사실 줄 (기물·성급·수치) */
  fact: string
  /** 이 판에서 왜 보드를 약하게 했나 */
  why: string
  /** 다음 판 같은 상황에서 할 행동 */
  fix: string
}

export interface CoachLecture {
  /** 강의 제목 (코드가 정한 topic 을 그대로 사용) */
  topic: string
  /** 개념 정의/원리 (2~3문장) */
  concept: string
  /** 왜 중요한가 (1~2문장) */
  why: string
  /** 이 데이터에서의 근거 (수치 인용 필수) */
  evidence: string
  /** 그 순간의 더 나은 선택 (행동 + 타이밍) */
  alternative: string
  /** 다음 3판 연습 과제 */
  drill: string
  /** 실전 체크리스트 3~5개 */
  checklist: string[]
  /** 핵심 장면 해설 (프롬프트 2026-10-21.14~). 있으면 화면은 evidence/alternative 대신 이것을 보여 준다 */
  moments?: LectureMoment[]
}

// 전문 메타 코칭 응답 결과
export interface MetaCoachFeedback {
  mode: 'single' | 'multi'
  metaScore: number
  metaTier: string
  playstyle: string
  overview: string
  /** 다음 판에서 할 행동 3개 (스키마 v2, 2026-10-21.3~) */
  actions?: string[]
  /*
   * 스키마 v1 필드 — 2026-10-21.3 이전에 캐시된 리포트에만 있다. 화면은 있으면 그대로 보여 준다.
   * v2 에서는 6축 verdict(plan.axes) · 6축 contest 점수 · actions 로 대체.
   */
  /** @deprecated v1 — 6축 contest 점수로 대체 */
  flexibilityScore?: number
  /** @deprecated v1 — plan.axes contest verdict */
  contestAnalysis?: string
  /** @deprecated v1 — plan.axes itemization verdict */
  itemAnalysis?: string
  /** @deprecated v1 — plan.axes synergy verdict */
  synergyAnalysis?: string
  /** @deprecated v1 — plan.axes economy verdict */
  economyAnalysis?: string
  /** @deprecated v1 — actions */
  improvements?: string[]
  /** @deprecated v1 — actions · lecture.checklist */
  actionPlan?: string[]
  /** 강의형 코칭 (코드가 주제 선택, LLM이 본문 작성) */
  lecture?: CoachLecture
  /** 6축 진단 + 강의 계획 (코드 산출) */
  plan?: CoachingPlan
  /** LLM 서술의 수치 근거 검증 결과 */
  grounding?: GroundingReport
  /** LLM 미사용(규칙 기반 폴백) 여부 */
  isFallback?: boolean
  /** 참조한 데이터 출처/패치/표본 */
  provenance?: FeedbackProvenance
  /** 코드가 산출한 점수 근거 (LLM 아님) */
  scoreBreakdown?: ScoreBreakdown
  /** 표본 품질 (초반 종료 경기 등) */
  dataQuality?: {
    /** 초반 종료 경기만 있어 점수/강의 해석에 주의가 필요한가 */
    lowSample: boolean
    /** 표본 부족 사유 (예: "2-2 초반 종료 · 보드 1유닛") */
    reason?: string
    /** 점수 집계에서 제외한 초반 종료 경기 수 */
    excludedMatches?: number
  }
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
  /** 랭크 판이 모자라 최근 N판 이전에서 더 훑은 판 수 (lib/tftService 분석 판 보충) */
  olderScanned?: number
  isDemo?: boolean
  /** Riot 에서 이 전적을 받아온 시각 (epoch ms). 캐시 응답이면 원래 받아온 시각 */
  fetchedAt?: number
  /** 이 시각(epoch ms) 이후에 다시 전적 갱신 가능 */
  refreshAvailableAt?: number
  /** 내 덱 성적표 (lib/deckReport, 서버 계산 · 캐시 밖에서 붙인다). 덱 데이터를 못 읽으면 null */
  deckReport?: import('./deckReportShared').DeckReport | null
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

// ---- Meta Rank (메타 랭킹, Phase 4) ----

/** GET /api/tft/meta: 챔피언/시너지/아이템/조합 메타 티어 응답 */

export interface MetaChampRanking {
  /** 수집 키 (예: 'Brambleback', 'Lux') — 화면 표시는 name 사용 */
  key: string
  name: string
  imgUrl: string
  avgPlacement: number
  top4Rate: number
  sampleSize: number
  avgTier: number
  threeStarRate: number
  /** 이전 수집 대비 (있을 때만) */
  prevRank?: number
  rankDelta?: number
  avgDelta?: number
  /** 코스트 1~5 */
  cost?: number
}

export interface MetaTraitRanking {
  key: string
  name: string
  iconUrl: string
  avgPlacement: number
  top4Rate: number
  sampleSize: number
  avgTier: number
  prevRank?: number
  rankDelta?: number
  avgDelta?: number
}

export interface MetaItemRanking {
  key: string
  name: string
  iconUrl: string
  avgPlacement: number
  top4Rate: number
  sampleSize: number
  prevRank?: number
  rankDelta?: number
  avgDelta?: number
}

export interface MetaComboRanking {
  key: string
  champKey: string
  itemKey: string
  champName: string
  champImgUrl: string
  itemName: string
  itemIconUrl: string
  avgPlacement: number
  top4Rate: number
  sampleSize: number
}

/** 메타 조합 (기물 + BIS 아이템 세트) */
export interface MetaCompRanking {
  /** 기물 수집 키 (예: 'Lux18_Base') */
  key: string
  name: string
  imgUrl: string
  cost?: number
  avgPlacement: number
  top4Rate: number
  sampleSize: number
  avgTier: number
  threeStarRate: number
  prevRank?: number
  rankDelta?: number
  avgDelta?: number
  /** 채용 순 BIS 아이템 (최대 3개, lib/statsShared buildCompSets). 수치는 이 기물이 그 아이템을 든 판 — 3개를 함께 든 판이 아니다 */
  items: {
    key: string
    name: string
    iconUrl: string
    avgPlacement: number
    top4Rate: number
    sampleSize: number
    /** 이 기물이 나온 판 중 이 아이템을 든 비율 (sampleSize ÷ 기물 판수) */
    pickRate: number
  }[]
  /** 아이템 3개를 함께 든 세트 — 많이 든 순 상위 3개. 빌드 집계가 없으면(0008 미적용·JSON 미생성) undefined */
  builds?: MetaBuildStat[]
  /** items(BIS 3개)를 함께 든 세트. 빌드 집계는 있는데 이 세트가 없으면 null (5판 미만 또는 기물별 상위 10개 밖) */
  bisSet?: MetaBuildStat | null
}

/** 기물 빌드 = 기물 1개가 아이템 3개를 함께 든 판 (lib/unitBuilds — 패치 전체, 덱 클러스터와 같은 하루 1회 집계) */
export interface MetaBuildStat {
  /** `${기물 키}|${아이템 키 정렬, 쉼표}` */
  key: string
  items: { key: string; name: string; iconUrl: string }[]
  avgPlacement: number
  top4Rate: number
  sampleSize: number
  /** 같은 집계에서 이 기물이 나온 판 중 이 세트를 든 비율 */
  pickRate: number
}

export interface MetaBuildRanking extends MetaBuildStat {
  champKey: string
  /** 정렬된 아이템 키 3개 */
  itemKeys: string[]
}

/** 메타 덱(보드 조합) — Riot 래더 실제 보드를 묶은 덱 (실측) */
/**
 * 래더 실측 덱 가이드 (scripts/buildDecksFromBoards.js deckGuide) — 최종 보드 통계.
 * carryItems 는 '조합 순서'가 아니라 최종 보드 채용률이다.
 */
export interface DeckGuide {
  boards: number
  /** 채용률 80%+ 기물 */
  core: { key: string; name: string; usage: number; avgPlacement: number }[]
  /** 채용률 20~80% 기물 (썼을 때 평균 등수) */
  flex: { key: string; name: string; usage: number; avgPlacement: number }[]
  /** 캐리 완성 아이템: 채용률(보드 비율) · 들었을 때 평균 등수 */
  carryItems: { key: string; name: string; rate: number; avgPlacement: number }[]
  /** 레벨 → 보드 비율 */
  levels: Record<string, number>
  carryThreeStarRate: number
  /** flexSlots = 대표 구성 칸 수 − 핵심 기물 수 · sharedCarryDecks = 같은 캐리 메타 덱 수 */
  openness: { coreCount: number; flexSlots: number; sharedCarryDecks: number }
  /** 이 통계를 만든 보드의 패치별 판 수 (현재 패치 표본이 부족하면 직전 패치를 합친다) */
  patch?: PatchBasis
}

/** 통계의 패치 기준 — counts: 패치 → 판 수, mixed: 두 패치 이상을 합쳤는가 */
export interface PatchBasis {
  counts: Record<string, number>
  mixed: boolean
}

export interface MetaDeckRanking {
  id: string
  name: string
  /** 덱 총 골드(업그레이드 포함, 사이트 표기) */
  gold: number | null
  /** 유닛 코스트 합 */
  unitCost: number
  traits: { key: string; name: string; iconUrl: string; count: number }[]
  units: {
    key: string
    name: string
    cost: number | null
    star: number
    /** 보드 슬롯 인덱스 (0~27: 4행×7열) */
    index: number | null
    imgUrl: string
    items: { key: string; name: string; iconUrl: string }[]
    /** 시너지 최대 단계(breakpoint max)를 넘는 선택 기물 — 시너지 count 에서 제외 */
    flex?: boolean
    stat?: { avgPlacement: number; top4Rate: number; sampleSize: number }
  }[]
  avgPlacement: number | null
  top4Rate: number | null
  /** 실측 통계가 존재하는 기물 비율 0~1 */
  coverage: number
  sampleSize: number
  tier: string
  carryKey: string | null
  /** 래더 실측: 레벨 중앙값, 판수, 픽률(0~1), 1등 비율(0~1), 1~8등 횟수 */
  level?: number
  games?: number
  playRate?: number
  winRate?: number
  placementDist?: number[]
  /** 래더 실측 덱 가이드 (래더 덱만) */
  guide?: DeckGuide
}

export interface TftMetaResponse {
  success: boolean
  /** 실측 수집 메타인가 (false면 아직 수집 안 됨) */
  hasMeta: boolean
  patch?: string
  source?: string
  generatedAt?: string
  /** 직전 수집 시각 (순위 변동 기준) */
  prevGeneratedAt?: string
  /** 증강은 Riot 세트18 미제공으로 비어 있을 수 있음 */
  hasAugmentMeta: boolean
  champions: MetaChampRanking[]
  traits: MetaTraitRanking[]
  items: MetaItemRanking[]
  combos: MetaComboRanking[]
  /** 메타 조합 (기물 + BIS 아이템 세트) */
  comps: MetaCompRanking[]
  /** 메타 덱 (보드 조합, 롤체지지 추천 덱 + 실측 통계) */
  decks: MetaDeckRanking[]
  deckMeta?: {
    /** decksData.json 빌드 시각 */
    generatedAt: string
    /** 원본 래더 보드 수집 시각 — 화면의 '갱신'은 이 값 */
    sourceUpdatedAt?: string
    source: string
    patch: string | null
    deckCount: number
    unitMatchRate: number
    /** 덱을 묶은 래더 판 수 */
    matchCount?: number
  }
  error?: string
}

/**
 * 경기 1건 AI 분석 파이프라인 (JSON 라우트 · SSE 스트림 라우트 공용).
 *
 * - 매치 데이터는 불변 → `analysis:{matchId}:{subject}:{mode}:{promptVersion}` 캐시.
 * - 쿼터/레이트리밋은 **라우트에서** 처리한다. (이 모듈은 순수 분석만 담당)
 * - 실패는 `MatchAnalysisError`(status 포함)로 던져 라우트가 그대로 응답할 수 있게 한다.
 */
import { getTftMatchDetail, getAccountByRiotId } from './riot'
import { extractSlimMatchData } from './summarize'
import { isCurrentSetMatch, isRankedMatch } from './queue'
import { getDemoMatches } from './demo'
import { generateMetaCoachFeedback, COACH_PROMPT_VERSION } from './llm'
import { SCORING_VERSION } from './axisConfig'
import { cacheGetWithSource, cacheSet, CACHE_TTL } from './cache'
import { incrMetric, logEvent } from './observability'
import { SlimMatchData, TftMatchAnalysisResponse } from './types'

/** 라우트가 HTTP 상태로 변환할 수 있는 분석 오류. */
export class MatchAnalysisError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'MatchAnalysisError'
    this.status = status
  }
}

/** 진행 단계 — SSE `stage` 이벤트로 그대로 전달된다. */
export type AnalysisStage = 'match' | 'analyzing'

export const ANALYSIS_STAGE_MESSAGE: Record<AnalysisStage, string> = {
  match: '경기 데이터를 확인하는 중...',
  analyzing: 'AI가 리포트를 작성하는 중...',
}

export interface MatchAnalysisParams {
  matchId: string
  puuid?: string
  /** puuid 가 없을 때 계정 조회에 사용 (이미 정규화된 값) */
  gameName?: string
  tagLine?: string
  isDemo?: boolean
  mode: 'single' | 'multi'
}

export interface MatchAnalysisOutcome {
  response: TftMatchAnalysisResponse
  cached: boolean
}

/** 캐시 키 (프롬프트·점수 공식 버전 포함 → 둘 중 하나가 바뀌면 자동 무효화) */
export function analysisCacheKey(params: MatchAnalysisParams): string {
  const subject = params.puuid || params.gameName?.toLowerCase() || 'anon'
  return `analysis:${params.matchId}:${subject}:${params.mode}:${COACH_PROMPT_VERSION}:${SCORING_VERSION}`
}

/**
 * 캐시된 분석 결과만 조회한다. (없으면 null)
 * 스트림 라우트가 캐시 히트를 즉시 반환하기 위해 사용한다.
 */
export async function getCachedMatchAnalysis(
  params: MatchAnalysisParams
): Promise<{ response: TftMatchAnalysisResponse; source: 'memory' | 'redis' } | null> {
  const hit = await cacheGetWithSource<TftMatchAnalysisResponse>(analysisCacheKey(params))
  if (!hit) return null
  incrMetric('llm.cache_hit.match_analysis')
  return { response: { ...hit.value, cached: true }, source: hit.source }
}

export interface MatchAnalysisCallbacks {
  /** 진행 단계 콜백 */
  onStage?: (stage: AnalysisStage) => void
  /**
   * 매치 해석 직후, LLM 리포트 생성 전에 호출된다.
   * 스트림 라우트가 이 시점에 짧은 인트로 토큰 스트림을 병렬로 시작한다.
   */
  onMatch?: (match: SlimMatchData, displayName: string) => void
}

/**
 * 매치 1건을 분석한다. 캐시 히트면 Riot/LLM 호출 없이 즉시 반환.
 * @param callbacks 진행 단계 / 매치 해석 콜백 (선택)
 */
export async function runMatchAnalysis(
  params: MatchAnalysisParams,
  callbacks: MatchAnalysisCallbacks = {}
): Promise<MatchAnalysisOutcome> {
  const { onStage, onMatch } = callbacks
  const { matchId, mode } = params
  if (!matchId) throw new MatchAnalysisError('분석할 경기(matchId)가 필요합니다.', 400)

  const cached = await getCachedMatchAnalysis(params)
  if (cached) return { response: cached.response, cached: true }

  onStage?.('match')

  const hasApiKey = Boolean(process.env.RIOT_API_KEY)
  const isDemo = params.isDemo === true
  let match: SlimMatchData | null = null
  let displayName = params.gameName || '소환사'

  // 프로덕션에서 키가 없을 때 데모 데이터로 조용히 폴백하지 않는다.
  if (!isDemo && !hasApiKey && process.env.NODE_ENV === 'production') {
    throw new MatchAnalysisError('서비스 준비 중입니다. 잠시 후 다시 시도해주세요.', 503)
  }

  if (isDemo || !hasApiKey) {
    match = getDemoMatches(displayName).find((m) => m.matchId === matchId) || null
  } else {
    let puuid = params.puuid || ''
    if (!puuid) {
      if (!params.gameName || !params.tagLine) {
        throw new MatchAnalysisError('소환사 닉네임과 태그를 입력해주세요.', 400)
      }
      const account = await getAccountByRiotId(params.gameName, params.tagLine)
      puuid = account.puuid
      displayName = account.gameName
    }
    const rawMatch = await getTftMatchDetail(matchId)
    match = extractSlimMatchData(rawMatch, puuid)
  }

  if (!match) {
    throw new MatchAnalysisError(
      '해당 경기 데이터를 찾을 수 없습니다. (matchId 또는 소환사 정보를 확인해주세요)',
      404
    )
  }

  // 메타 통계·규칙이 랭크 기준이라 이벤트·일반 판은 분석하지 않는다 (경기 카드도 버튼을 숨긴다 — lib/queue)
  if (!isRankedMatch(match)) {
    throw new MatchAnalysisError(`랭크 게임만 분석합니다. 이 경기는 ${match.queueType || '이벤트·기타 모드'}입니다.`, 400)
  }
  // 메타 통계·기물 데이터가 현재 세트라 지난 시즌 판은 비교할 기준이 없다
  if (!isCurrentSetMatch(match)) {
    throw new MatchAnalysisError(`이번 시즌 경기만 분석합니다. 이 경기는 시즌 ${match.setNumber} 경기입니다.`, 400)
  }

  onMatch?.(match, displayName)
  onStage?.('analyzing')
  const feedback = await generateMetaCoachFeedback(displayName, [match], mode)

  const response: TftMatchAnalysisResponse = {
    success: true,
    matchId,
    match,
    feedback,
    cached: false,
  }

  await cacheSet(analysisCacheKey(params), response, CACHE_TTL.MATCH)
  logEvent('info', 'match_analysis_generated', {
    matchId,
    mode,
    isDemo: Boolean(isDemo || !hasApiKey),
    isFallback: Boolean(feedback.isFallback),
  })

  return { response, cached: false }
}

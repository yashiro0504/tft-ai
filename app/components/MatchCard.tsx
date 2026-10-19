'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Sparkles, RefreshCw, AlertCircle, Info, Database,
} from 'lucide-react'
import type { SlimMatchData, MetaCoachFeedback, TftMatchAnalysisResponse } from '@/lib/types'
import { FeedbackReport } from './FeedbackReport'
import { track } from '@/lib/analytics'
import { AnalysisStreamUnavailableError, analyzeMatchJson, analyzeMatchStream } from '@/lib/analysisStream'
import { useQuota } from '@/lib/useQuota'
import { LimitModal } from './LimitModal'
import { TraitHex, traitMaxLevel } from './LabUI'

interface MatchCardProps {
  match: SlimMatchData
  index: number
  puuid: string
  gameName: string
  tagLine: string
  isDemo: boolean
}

/**
 * 실전 매치 1건 카드 (롤체지지/OP.GG 스타일) + 경기별 AI 분석 버튼.
 * 버튼 클릭 시 POST /api/tft/match 로 해당 경기만 정밀 분석한다 (matchId 캐시).
 */
export function MatchCard({ match, index, puuid, gameName, tagLine, isDemo }: MatchCardProps) {
  const [isOpenLobby, setIsOpenLobby] = useState(false)
  const [isOpenEvidence, setIsOpenEvidence] = useState(false)
  const [feedback, setFeedback] = useState<MetaCoachFeedback | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [wasCached, setWasCached] = useState(false)
  /** 스트리밍 진행 문구 (예: "AI가 리포트를 작성하는 중...") */
  const [stageMessage, setStageMessage] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const quota = useQuota()
  const [isLimitOpen, setIsLimitOpen] = useState(false)

  // 카드가 사라지면 진행 중인 스트림을 끊는다.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  // 접지 근거 표시용 계산 지표 (LLM에 제공되는 값과 동일)
  const twoStarPlus = match.units.filter((u) => (u.tier || 1) >= 2).length
  const threeStar = match.units.filter((u) => u.tier === 3).length
  const totalItems = match.units.reduce((s, u) => s + (u.items?.length || 0), 0)

  const isWin = match.placement === 1
  const isTop4 = match.placement <= 4 && !isWin

  // 등수는 카드 왼쪽 띠 색으로만 표시한다 (1등 gold, 2~4등 good, 5~8등 bad)
  const containerTheme = isWin
    ? 'border-l-4 border-l-gold'
    : isTop4
    ? 'border-l-4 border-l-good'
    : 'border-l-4 border-l-bad'

  // 등수 박스: 왼쪽 위에 작게, 글자색은 --text
  const placementBadgeTheme = 'border border-line bg-sunken text-ink font-black'

  // 코스트 색은 챔피언 아이콘 테두리에만 사용
  const costStyle: Record<number, { border: string }> = {
    5: { border: 'border-cost-5' },
    4: { border: 'border-cost-4' },
    3: { border: 'border-cost-3' },
    2: { border: 'border-cost-2' },
    1: { border: 'border-cost-1' },
  }

  const handleAnalyze = async () => {
    if (isAnalyzing) return
    if (quota.exhausted) {
      setIsLimitOpen(true)
      return
    }
    setIsAnalyzing(true)
    setAnalyzeError(null)
    setStageMessage('분석을 준비하는 중...')
    track('analysis_click', { scope: 'match', placement: match.placement })

    const controller = new AbortController()
    abortRef.current = controller
    const body = { matchId: match.matchId, puuid, gameName, tagLine, isDemo }

    try {
      let data: TftMatchAnalysisResponse
      try {
        // 1순위: SSE (진행 상황 표시 + TTFB 개선)
        data = await analyzeMatchStream({
          body,
          signal: controller.signal,
          onStage: setStageMessage,
        })
      } catch (err) {
        // 스트리밍 미지원 배포에서만 기존 JSON 경로로 폴백한다.
        // (그 외 오류는 쿼터가 이미 소모된 상태이므로 재요청하지 않는다)
        if (err instanceof AnalysisStreamUnavailableError) {
          data = await analyzeMatchJson({ body, signal: controller.signal })
        } else {
          throw err
        }
      }

      if (!data.success || !data.feedback) {
        throw new Error(data.error || '이 경기 분석 중 오류가 발생했습니다.')
      }
      setFeedback(data.feedback)
      quota.consume()
      setWasCached(Boolean(data.cached))
      track('analysis_success', {
        scope: 'match',
        placement: match.placement,
        cached: Boolean(data.cached),
      })
    } catch (err) {
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : '이 경기 분석 중 오류가 발생했습니다.'
      setAnalyzeError(message)
    } finally {
      abortRef.current = null
      setStageMessage('')
      setIsAnalyzing(false)
    }
  }

  return (
    <div data-index={index} className={`border border-line bg-panel shadow-card rounded-card overflow-hidden transition ${containerTheme}`}>
      <div className="p-4 md:p-5">
        <div className="flex flex-col lg:flex-row items-start justify-between gap-4">
          {/* 1. 좌측 위: 등수(작게) 및 경기 메타데이터 */}
          <div className="space-y-1 min-w-[200px] shrink-0">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-chip text-xs ${placementBadgeTheme}`}>
                <span className="font-mono">#{match.placement}</span>
                <span className="font-semibold">{isWin ? '1등 승리' : isTop4 ? '순방' : '탈락'}</span>
              </span>
              <span className="text-xs font-bold text-ink">{match.queueType || '랭크 게임'}</span>
              <span className="text-xs text-muted">{match.timeAgo || '최근'}</span>
            </div>
            <div className="text-xs text-muted flex items-center gap-2">
              <span>{match.lastRound} 라운드</span>
              <span>•</span>
              <span>{match.gameLengthStr || '31분 20초'}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted font-mono">
              <span className="text-ink font-bold">Lv.{match.level}</span>
              <span>|</span>
              <span>잔여 {match.goldLeft}G</span>
            </div>
          </div>

          {/* 2. 우측: 챔피언 아이콘 (48px, 코스트 색 테두리, 별은 아래쪽에 겹쳐서) + 아이템 */}
          <div className="flex flex-wrap items-start gap-2 w-full lg:w-auto lg:justify-end">
            {match.units.map((unit, i) => {
              const cost = unit.rarity || 3
              const info = costStyle[cost] || costStyle[3]

              return (
                <div key={i} className="flex flex-col items-center group/unit relative">
                  <div
                    className={`relative h-12 w-12 rounded-control border-2 overflow-hidden bg-sunken flex items-center justify-center ${info.border}`}
                  >
                    {unit.imgUrl ? (
                      <img
                        src={unit.imgUrl}
                        alt={unit.name}
                        className="w-full h-full object-cover z-10"
                        onError={(e) => {
                          ;(e.target as HTMLElement).style.display = 'none'
                        }}
                      />
                    ) : null}

                    {/* 이미지 실패 시 백업 텍스트 */}
                    <span className="text-xs font-black text-muted pointer-events-none absolute text-center px-0.5 truncate max-w-[44px]">
                      {unit.name.slice(0, 2)}
                    </span>

                    {/* 코스트 배지 */}
                    <div className="absolute top-0 left-0 rounded-br-[4px] bg-black/70 px-1 text-[10px] leading-4 font-mono text-white font-bold z-20">
                      {cost}G
                    </div>

                    {/* 성급: 아이콘 아래쪽에 겹쳐서 작게 */}
                    {unit.tier >= 2 ? (
                      <span
                        className={`absolute bottom-0 inset-x-0 z-20 text-center text-[10px] leading-3 tracking-[-0.1em] bg-black/60 ${
                          unit.tier === 3 ? 'text-[color:var(--gold)]' : 'text-white'
                        }`}
                      >
                        {unit.tier === 3 ? '★★★' : '★★'}
                      </span>
                    ) : null}
                  </div>

                  {/* 장착 아이템 3슬롯 */}
                  <div className="flex items-center gap-0.5 mt-1 h-3.5">
                    {unit.items.slice(0, 3).map((item, itemIdx) => {
                      const iconUrl = unit.itemIcons?.[itemIdx]
                      return (
                        <div
                          key={itemIdx}
                          title={item}
                          className="h-3.5 w-3.5 rounded-[2px] bg-sunken border border-line overflow-hidden shrink-0 flex items-center justify-center"
                        >
                          {iconUrl ? (
                            <img
                              src={iconUrl}
                              alt={item}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                ;(e.target as HTMLElement).style.display = 'none'
                              }}
                            />
                          ) : (
                            <span className="text-[7px] text-muted font-black">
                              {item.charAt(0)}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* 기물 이름 */}
                  <span className="text-xs text-muted truncate max-w-[48px] text-center mt-0.5 font-medium group-hover/unit:text-ink">
                    {unit.name}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* 3. 시너지: 육각형(단계 농도) + 이름, 가로로 줄바꿈 */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {match.traits.map((t, i) => (
            <TraitHex key={i} name={t.name} count={t.count} level={t.tier} max={traitMaxLevel(t.name)} iconUrl={t.iconUrl} />
          ))}
        </div>

        {/* 4. 증강체 */}
        {match.augments.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {match.augments.map((aug, i) => {
              const d = match.augmentAnalysis?.details.find((x) => x.name === aug)
              // 티어는 강조색 농도로만 구분한다 (S 진하게 → C/D 흐리게)
              const tierColor =
                d?.tier === 'S'
                  ? 'bg-accent border-accent text-on-accent'
                  : d?.tier === 'A'
                  ? 'bg-accent-bg border-accent/40 text-accent'
                  : d?.tier === 'B'
                  ? 'bg-sunken border-line text-ink'
                  : 'bg-sunken border-line text-subtle'
              const title =
                d && typeof d.avgPlacement === 'number'
                  ? `${aug} · 평균 ${d.avgPlacement}등 (${d.tier})${match.augmentAnalysis?.sample ? ' · 샘플(검증 전)' : ''}`
                  : aug
              return (
                <span
                  key={i}
                  title={title}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-chip border text-xs max-w-[160px] ${tierColor}`}
                >
                  {d?.tier && <span className="font-black shrink-0">{d.tier}</span>}
                  <span className="truncate">{aug}</span>
                </span>
              )
            })}
            {match.augmentAnalysis?.sample && (
              <span
                title="검증 전 샘플 메타 통계입니다"
                className="text-xs text-muted border border-line rounded-chip px-1.5 py-0.5 shrink-0"
              >
                샘플
              </span>
            )}
          </div>
        )}

        {/* 5. 로비 경합 상태: 칩 영역 아래 가로 전체 폭 */}
        {match.contestedInfo &&
          (match.contestedInfo.isContested ? (
            <div
              title={match.contestedInfo.summary}
              className="mt-3 flex w-full items-center gap-1.5 px-3 py-2 rounded-control bg-bad/10 text-bad text-xs font-semibold"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>
                {match.contestedInfo.level && match.contestedInfo.level !== '경합'
                  ? `경합 ${match.contestedInfo.level}`
                  : '경합'}{' '}
                · 로비 {match.contestedInfo.opponentCount}명 겹침
                {match.contestedInfo.contestScore != null ? ` (강도 ${match.contestedInfo.contestScore}/100)` : ''}
              </span>
            </div>
          ) : (
            <div
              title={match.contestedInfo.summary}
              className="mt-3 flex w-full items-center gap-1.5 px-3 py-2 rounded-control bg-good/10 text-ink text-xs font-semibold"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-good shrink-0" />
              <span>
                빈집 선점
                {match.contestedInfo.contestScore != null ? ` (강도 ${match.contestedInfo.contestScore}/100)` : ''}
              </span>
            </div>
          ))}

        {/* 4. 하단: 경기별 AI 분석 버튼 + 로비 8명 전체 순위 토글 */}
        <div className="mt-3 pt-2.5 border-t border-line flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-subtle">로비 8인 경기 결과 기록</span>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {match.lobbyParticipants && match.lobbyParticipants.length > 0 && (
              <button
                type="button"
                onClick={() => setIsOpenLobby(!isOpenLobby)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-sunken hover:border-accent text-ink text-xs font-semibold transition cursor-pointer border border-line"
              >
                <span>{isOpenLobby ? '로비 순위 접기' : '로비 8명 전체 순위 보기'}</span>
                {isOpenLobby ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsOpenEvidence(!isOpenEvidence)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-sunken hover:border-accent text-ink text-xs font-semibold transition cursor-pointer border border-line"
            >
              <Database className="w-3.5 h-3.5" />
              <span>{isOpenEvidence ? '접지 근거 접기' : '접지 근거 보기'}</span>
              {isOpenEvidence ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            <span className="text-xs text-subtle whitespace-nowrap">오늘 {quota.remaining}/{quota.limit}회 남음</span>
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-accent hover:opacity-90 disabled:opacity-60 text-on-accent text-xs font-bold transition cursor-pointer"
            >
              {isAnalyzing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>{stageMessage || '이 경기 AI 분석 중...'}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{feedback ? '이 경기 다시 분석' : '이 경기 AI 분석'}</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
      {/* 펼쳐진 로비 8인 순위 테이블 (LOLCHESS 스타일) */}
      {isOpenLobby && match.lobbyParticipants && (
        <div className="bg-sunken border-t border-line p-4 animate-in fade-in duration-200">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-muted text-xs">
                  <th className="pb-2 pl-2 w-12">등수</th>
                  <th className="pb-2 w-32">소환사</th>
                  <th className="pb-2 w-16">레벨</th>
                  <th className="pb-2">최종 덱 및 핵심 기물</th>
                  <th className="pb-2 w-28">활성 시너지</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {match.lobbyParticipants.map((p, idx) => (
                  <tr
                    key={idx}
                    className={`hover:bg-panel transition ${p.isUser ? 'bg-accent-bg font-semibold' : ''}`}
                  >
                    <td className="py-2.5 pl-2 font-mono">
                      <span
                        className={`inline-block w-6 h-6 rounded-chip text-center leading-6 font-bold text-xs ${
                          p.placement === 1
                            ? 'bg-gold/10 text-ink'
                            : p.placement <= 4
                            ? 'bg-good/10 text-ink'
                            : 'bg-sunken text-muted'
                        }`}
                      >
                        {p.placement}
                      </span>
                    </td>

                    <td className="py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`truncate max-w-[120px] ${p.isUser ? 'text-accent font-bold' : 'text-ink-soft'}`}>
                          {p.gameName}
                        </span>
                        {p.isUser && (
                          <span className="px-1.5 py-0.2 rounded-chip bg-accent-bg text-accent text-xs font-bold">
                            ME
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-2.5 text-muted font-mono">Lv.{p.level}</td>

                    <td className="py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {p.units.slice(0, 8).map((u, uIdx) => (
                          <div
                            key={uIdx}
                            title={`${u.name} ${u.tier}성${u.items.length ? ` (${u.items.join(', ')})` : ''}`}
                            className="relative flex items-center rounded-chip border border-line bg-panel p-0.5"
                          >
                            <div className="relative h-6 w-6 shrink-0 overflow-hidden rounded-chip bg-sunken">
                              {u.imgUrl ? (
                                <img
                                  src={u.imgUrl}
                                  alt={u.name}
                                  className="h-full w-full object-cover"
                                  onError={(e) => {
                                    ;(e.target as HTMLElement).style.display = 'none'
                                  }}
                                />
                              ) : (
                                <span className="flex h-full w-full items-center justify-center text-xs font-black text-muted">
                                  {u.name.slice(0, 1)}
                                </span>
                              )}
                              {u.tier > 1 && (
                                <span className="absolute right-0 top-0 rounded-bl bg-black/80 px-0.5 text-[7px] font-black text-[color:var(--gold)]">
                                  {u.tier}★
                                </span>
                              )}
                            </div>
                            {u.items.length > 0 && (
                              <span className="ml-1 pr-1 text-xs font-mono font-bold text-muted">
                                ⚔{u.items.length}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>

                    <td className="py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {p.traits.slice(0, 3).map((t, tIdx) => (
                          <span
                            key={tIdx}
                            className="inline-flex items-center gap-0.5 rounded-chip px-1.5 py-0.5 bg-sunken text-muted text-xs font-bold border border-line"
                          >
                            <span>{t.name}</span>
                            <span className="text-ink font-mono">{t.count}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 접지 근거 패널 (AI에 제공된 계산 데이터) */}
      {isOpenEvidence && (
        <div className="bg-sunken border-t border-line p-4 md:p-5 space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center gap-2 text-accent font-extrabold text-xs uppercase tracking-wider">
            <Database className="w-4 h-4 text-accent" />
            <span>접지 근거 · AI에 제공된 계산 데이터</span>
          </div>

          {/* 1) 계산 지표 */}
          <div>
            <p className="text-xs font-bold text-muted mb-1.5">📊 계산 지표 (코드 산출)</p>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <span className="px-2 py-0.5 rounded-chip bg-panel border border-line text-muted">2성+ 기물 <b className="text-ink">{twoStarPlus}개</b></span>
              <span className="px-2 py-0.5 rounded-chip bg-panel border border-line text-muted">3성 <b className="text-ink">{threeStar}개</b></span>
              <span className="px-2 py-0.5 rounded-chip bg-panel border border-line text-muted">총 장착아이템 <b className="text-ink">{totalItems}개</b></span>
              <span className="px-2 py-0.5 rounded-chip bg-panel border border-line text-muted">잔여 골드 <b className="text-ink">{match.goldLeft}G</b></span>
              <span className="px-2 py-0.5 rounded-chip bg-panel border border-line text-muted">탈락 라운드 <b className="text-ink-soft">{match.lastRound}</b></span>
              <span className="px-2 py-0.5 rounded-chip bg-panel border border-line text-muted">최종 레벨 <b className="text-ink-soft">Lv.{match.level}</b></span>
            </div>
          </div>

          {/* 2) 로비 경합 분석 */}
          {match.contestedInfo && (
            <div>
              <p className="text-xs font-bold text-muted mb-1.5">⚔️ 로비 경합 분석</p>
              <div className="flex flex-wrap gap-1.5 text-xs mb-2">
                <span className="px-2 py-0.5 rounded-chip bg-panel border border-line text-muted">경합 강도 <b className="text-ink">{match.contestedInfo.contestScore ?? '-'}/100</b></span>
                <span className="px-2 py-0.5 rounded-chip bg-panel border border-line text-muted">등급 <b className="text-ink">{match.contestedInfo.level ?? '-'}</b></span>
                <span className="px-2 py-0.5 rounded-chip bg-panel border border-line text-muted">겹친 상대 <b className="text-ink-soft">{match.contestedInfo.opponentCount}명</b></span>
              </div>

              {!!match.contestedInfo.unitDetails?.length && (
                <div className="space-y-1 mb-2">
                  {match.contestedInfo.unitDetails.map((d, i) => (
                    <div key={i} className="flex items-center justify-between text-xs px-2 py-1 rounded-chip bg-panel border border-line">
                      <span className="text-ink-soft">{d.name} <span className="text-subtle">· {d.cost}코 · 나 {d.myTier}성</span></span>
                      <span className="text-muted">상대 <b className="text-ink">{d.opponentCount}명</b> · 가중 <b className="text-ink">{d.weight}</b></span>
                    </div>
                  ))}
                </div>
              )}

              {!!match.contestedInfo.traitDetails?.length && (
                <div className="space-y-1 mb-2">
                  {match.contestedInfo.traitDetails.map((d, i) => (
                    <div key={i} className="flex items-center justify-between text-xs px-2 py-1 rounded-chip bg-panel border border-line">
                      <span className="text-ink-soft">{d.name} <span className="text-subtle">· {d.myTier}단계</span></span>
                      <span className="text-muted">상대 <b className="text-ink">{d.opponentCount}명</b> · 가중 <b className="text-ink">{d.weight}</b></span>
                    </div>
                  ))}
                </div>
              )}

              {match.contestedInfo.summary && (
                <p className="text-xs text-muted leading-relaxed">{match.contestedInfo.summary}</p>
              )}
            </div>
          )}

          {/* 3) 증강 메타 대조 (증강 데이터가 있는 세트에서만) */}
          {match.augments.length > 0 && (
          <div>
            <p className="text-xs font-bold text-muted mb-1.5 flex items-center gap-1.5">
              🎲 증강 메타 대조
              {match.augmentAnalysis?.sample && (
                <span className="text-muted border border-line rounded-chip px-1.5 py-0.5">샘플(검증 전)</span>
              )}
            </p>
            {match.augmentAnalysis?.hasMeta ? (
              <>
                <div className="flex flex-wrap gap-1.5 text-xs mb-2">
                  <span className="px-2 py-0.5 rounded-chip bg-panel border border-line text-muted">증강 점수 <b className="text-ink">{match.augmentAnalysis.augmentScore ?? '-'}/100</b></span>
                  <span className="px-2 py-0.5 rounded-chip bg-panel border border-line text-muted">출처 <b className="text-ink-soft">{match.augmentAnalysis.source ?? '-'}</b></span>
                  <span className="px-2 py-0.5 rounded-chip bg-panel border border-line text-muted">패치 <b className="text-ink-soft">{match.augmentAnalysis.patch ?? '-'}</b></span>
                  <span className="px-2 py-0.5 rounded-chip bg-panel border border-line text-muted">baseline <b className="text-ink-soft">{match.augmentAnalysis.baselineAvgPlacement ?? 4.5}등</b></span>
                </div>
                <div className="space-y-1">
                  {match.augmentAnalysis.details.map((d, i) => (
                    <div key={i} className="flex items-center justify-between text-xs px-2 py-1 rounded-chip bg-panel border border-line">
                      <span className="text-ink-soft">{d.name}</span>
                      <span className="text-muted">
                        {typeof d.avgPlacement === 'number' ? (
                          <>
                            <b className="text-ink-soft">평균 {d.avgPlacement}등</b> · <b className="text-ink">{d.tier}</b>
                            {typeof d.pickRate === 'number' ? ` · 픽률 ${Math.round(d.pickRate * 100)}%` : ''}
                          </>
                        ) : (
                          '메타 데이터 없음'
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-subtle">증강 메타 통계가 없습니다. (scripts/buildMetaStats.js 로 생성)</p>
            )}
          </div>
          )}

          <p className="text-xs text-subtle border-t border-line pt-2">
            ※ 위 수치가 코드로 계산되어 AI 프롬프트에 ‘제공된 사실 데이터’로 전달됩니다. AI는 이 범위 밖은 단정하지 않습니다.
          </p>
        </div>
      )}

      {/* 경기별 AI 분석 오류 */}
      {analyzeError && (
        <div className="bg-bad/10 border-t border-bad/60 p-4 flex items-start gap-2 text-sm text-bad">
          <AlertCircle className="w-4 h-4 text-bad shrink-0 mt-0.5" />
          <span>{analyzeError}</span>
        </div>
      )}

      {/* 경기별 AI 정밀 코칭 리포트 */}
      {feedback && (
        <div className="bg-sunken border-t border-line p-4 md:p-6 animate-in fade-in duration-300">
          {wasCached && (
            <div className="mb-3 inline-flex items-center gap-1 text-xs text-accent">
              <Info className="w-3 h-3" />
              <span>저장된 분석 결과(캐시)입니다.</span>
            </div>
          )}
          <FeedbackReport feedback={feedback} title="이 경기 정밀 코칭 (단일 매치)" compact />
        </div>
      )}

      <LimitModal open={isLimitOpen} onClose={() => setIsLimitOpen(false)} scope="match" />

    </div>
  )
}

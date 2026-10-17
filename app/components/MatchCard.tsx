'use client'

import { useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Sparkles, RefreshCw, AlertCircle, Info, Database,
} from 'lucide-react'
import type { SlimMatchData, MetaCoachFeedback, TftMatchAnalysisResponse } from '@/lib/types'
import { FeedbackReport } from './FeedbackReport'

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

  // 접지 근거 표시용 계산 지표 (LLM에 제공되는 값과 동일)
  const twoStarPlus = match.units.filter((u) => (u.tier || 1) >= 2).length
  const threeStar = match.units.filter((u) => u.tier === 3).length
  const totalItems = match.units.reduce((s, u) => s + (u.items?.length || 0), 0)

  const isWin = match.placement === 1
  const isTop4 = match.placement <= 4 && !isWin

  // 롤체지지 / OP.GG 테마 색상 정의
  const containerTheme = isWin
    ? 'border-l-4 border-l-amber-400 bg-gradient-to-r from-amber-500/10 via-panel/95 to-panel border-amber-500/30'
    : isTop4
    ? 'border-l-4 border-l-emerald-400 bg-gradient-to-r from-emerald-500/10 via-panel/95 to-panel border-emerald-500/30'
    : 'border-l-4 border-l-slate-600 bg-gradient-to-r from-sunken/80 via-panel/95 to-panel border-line/10'

  const placementBadgeTheme = isWin
    ? 'bg-amber-400 text-slate-950 font-black shadow-lg shadow-amber-500/30'
    : isTop4
    ? 'bg-emerald-500 text-ink font-bold shadow-lg shadow-emerald-500/20'
    : 'bg-slate-800 text-muted font-semibold'

  const costBorder: Record<number, string> = {
    5: 'border-amber-400',
    4: 'border-purple-400',
    3: 'border-blue-400',
    2: 'border-emerald-500',
    1: 'border-slate-600',
  }

  const getTraitBadge = (tier: number) => {
    if (tier >= 3) return 'bg-amber-950/80 border-amber-400 text-amber-300 font-bold'
    if (tier === 2) return 'bg-slate-800/80 border-slate-300 text-ink-soft font-semibold'
    return 'bg-amber-950/40 border-amber-700/60 text-amber-400'
  }

  const handleAnalyze = async () => {
    if (isAnalyzing) return
    setIsAnalyzing(true)
    setAnalyzeError(null)
    try {
      const res = await fetch('/api/tft/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId: match.matchId, puuid, gameName, tagLine, isDemo }),
      })
      const data: TftMatchAnalysisResponse = await res.json()
      if (!res.ok || !data.success || !data.feedback) {
        throw new Error(data.error || '이 경기 분석 중 오류가 발생했습니다.')
      }
      setFeedback(data.feedback)
      setWasCached(Boolean(data.cached))
    } catch (err) {
      const message = err instanceof Error ? err.message : '이 경기 분석 중 오류가 발생했습니다.'
      setAnalyzeError(message)
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <div data-index={index} className={`border rounded-2xl overflow-hidden transition ${containerTheme}`}>
      <div className="p-4 md:p-5">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5">
          {/* 1. 좌측: 등수 및 경기 메타데이터 */}
          <div className="flex items-center gap-4 min-w-[200px] shrink-0">
            <div className="text-center">
              <div className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center ${placementBadgeTheme}`}>
                <span className="text-xl leading-none font-black font-mono">#{match.placement}</span>
                <span className="text-[10px] leading-tight mt-0.5">
                  {isWin ? '1등 승리' : isTop4 ? '순방' : '탈락'}
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-ink">{match.queueType || '랭크 게임'}</span>
                <span className="text-[11px] text-muted">{match.timeAgo || '최근'}</span>
              </div>
              <div className="text-xs text-muted flex items-center gap-2">
                <span>{match.lastRound} 라운드</span>
                <span>•</span>
                <span>{match.gameLengthStr || '31분 20초'}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-subtle font-mono">
                <span className="text-cyan-400 font-bold">Lv.{match.level}</span>
                <span>|</span>
                <span>잔여 {match.goldLeft}G</span>
              </div>
            </div>
          </div>
          {/* 2. 중앙: 활성 시너지 & 증강체 & 로비 기물 경합 뱃지 */}
          <div className="flex-1 space-y-2.5 w-full">
            {/* 시너지 뱃지 모음 (아이콘 + 한글명 + 개수) */}
            <div className="flex flex-wrap items-center gap-1.5">
              {match.traits.map((t, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] ${getTraitBadge(t.tier)}`}
                >
                  {t.iconUrl ? (
                    <img
                      src={t.iconUrl}
                      alt={t.name}
                      className="w-3.5 h-3.5 object-contain"
                      onError={(e) => {
                        ;(e.target as HTMLElement).style.display = 'none'
                      }}
                    />
                  ) : null}
                  <span className="font-bold">{t.count}</span>
                  <span>{t.name}</span>
                </span>
              ))}
            </div>

            {/* 증강체 & 경합 상태 */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {match.augments.length > 0 && (
                <div className="flex items-center gap-1">
                  {match.augments.map((aug, i) => {
                    const d = match.augmentAnalysis?.details.find((x) => x.name === aug)
                    const tierColor =
                      d?.tier === 'S'
                        ? 'border-amber-400 text-amber-300'
                        : d?.tier === 'A'
                        ? 'border-emerald-400 text-emerald-300'
                        : d?.tier === 'B'
                        ? 'border-cyan-400 text-cyan-300'
                        : d?.tier === 'C'
                        ? 'border-slate-500 text-muted'
                        : d?.tier === 'D'
                        ? 'border-rose-500 text-rose-300'
                        : 'border-line/15 text-muted'
                    const title =
                      d && typeof d.avgPlacement === 'number'
                        ? `${aug} · 평균 ${d.avgPlacement}등 (${d.tier})${match.augmentAnalysis?.sample ? ' · 샘플(검증 전)' : ''}`
                        : aug
                    return (
                      <span
                        key={i}
                        title={title}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800/90 border text-[11px] max-w-[140px] ${tierColor}`}
                      >
                        {d?.tier && <span className="font-black shrink-0">{d.tier}</span>}
                        <span className="truncate">{aug}</span>
                      </span>
                    )
                  })}
                  {match.augmentAnalysis?.sample && (
                    <span
                      title="검증 전 샘플 메타 통계입니다"
                      className="text-[10px] text-amber-400/80 border border-amber-800/50 rounded px-1.5 py-0.5 shrink-0"
                    >
                      샘플
                    </span>
                  )}
                </div>
              )}

              {match.contestedInfo && (
                <div>
                  {match.contestedInfo.isContested ? (
                    <span
                      title={match.contestedInfo.summary}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-950/80 border border-rose-800/80 text-rose-300 text-[11px] font-semibold"
                    >
                      <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                      <span>
                        경합 {match.contestedInfo.level ?? ''} · 로비 {match.contestedInfo.opponentCount}명 겹침
                        {match.contestedInfo.contestScore != null ? ` (강도 ${match.contestedInfo.contestScore}/100)` : ''}
                      </span>
                    </span>
                  ) : (
                    <span
                      title={match.contestedInfo.summary}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-800/80 text-emerald-300 text-[11px] font-semibold"
                    >
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span>
                        빈집 선점
                        {match.contestedInfo.contestScore != null ? ` (강도 ${match.contestedInfo.contestScore}/100)` : ''}
                      </span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          {/* 3. 우측: 챔피언 아바타 이미지 + 3성 골드 별 + 아이템 아이콘 */}
          <div className="flex flex-wrap items-end gap-2.5 w-full lg:w-auto shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-line/10">
            {match.units.map((unit, i) => {
              const cost = unit.rarity || 3
              const borderClass = costBorder[cost] || costBorder[3]

              return (
                <div key={i} className="flex flex-col items-center group relative">
                  {/* 성급 별 표시 */}
                  <div className="h-4 flex items-center justify-center">
                    {unit.tier === 3 ? (
                      <span className="text-amber-400 font-black text-xs drop-shadow-[0_0_4px_rgba(245,158,11,0.9)] tracking-tight">
                        ★★★
                      </span>
                    ) : unit.tier === 2 ? (
                      <span className="text-muted font-bold text-[11px] tracking-tight">
                        ★★
                      </span>
                    ) : (
                      <span className="text-subtle text-[10px]">★</span>
                    )}
                  </div>

                  {/* 챔피언 아바타 박스 (이미지 + 텍스트 백업) */}
                  <div
                    className={`w-12 h-12 rounded-xl border-2 overflow-hidden relative shadow-md bg-panel/90 transition-transform group-hover:scale-105 flex items-center justify-center ${borderClass}`}
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
                    {/* 이미지 로딩 실패 시 백업 글자 */}
                    <span className="text-[11px] font-black text-muted pointer-events-none absolute text-center px-0.5 truncate max-w-[44px]">
                      {unit.name.slice(0, 2)}
                    </span>
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent flex items-end justify-center pb-0.5 pointer-events-none z-20">
                      <span className="text-[9px] font-mono text-white/90 font-bold">
                        {cost}G
                      </span>
                    </div>
                  </div>

                  {/* 기물 이름 */}
                  <span className="text-[10px] text-muted truncate max-w-[48px] text-center mt-1 font-medium">
                    {unit.name}
                  </span>

                  {/* 장착 아이템 3슬롯 실제 아이콘 */}
                  <div className="flex items-center gap-0.5 mt-0.5 h-4">
                    {unit.items.slice(0, 3).map((item, itemIdx) => {
                      const iconUrl = unit.itemIcons?.[itemIdx]
                      return (
                        <div
                          key={itemIdx}
                          title={item}
                          className="w-4 h-4 rounded bg-sunken/70 border border-amber-500/70 overflow-hidden shadow shrink-0 flex items-center justify-center"
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
                            <span className="text-[8px] text-amber-300 font-black">
                              {item.charAt(0)}
                            </span>
                          )}
                        </div>
                      )
                    })}
                    {unit.items.length === 0 && <span className="w-4 h-4" />}
                  </div>
                </div>
              )
            })}
          </div>



        </div>
        {/* 4. 하단: 경기별 AI 분석 버튼 + 로비 8명 전체 순위 토글 */}
        <div className="mt-3 pt-2.5 border-t border-line/10/80 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-subtle">로비 8인 경기 결과 기록</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 disabled:opacity-60 text-white text-xs font-bold transition cursor-pointer border border-blue-500/40 shadow-md shadow-blue-600/20"
            >
              {isAnalyzing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>이 경기 AI 분석 중...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{feedback ? '이 경기 다시 분석' : '이 경기 AI 분석'}</span>
                </>
              )}
            </button>

            {match.lobbyParticipants && match.lobbyParticipants.length > 0 && (
              <button
                type="button"
                onClick={() => setIsOpenLobby(!isOpenLobby)}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-cyan-300 text-xs font-semibold transition cursor-pointer border border-line/15"
              >
                <span>{isOpenLobby ? '로비 순위 접기' : '로비 8명 전체 순위 보기'}</span>
                {isOpenLobby ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsOpenEvidence(!isOpenEvidence)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-muted hover:text-ink text-xs font-semibold transition cursor-pointer border border-line/15"
            >
              <Database className="w-3.5 h-3.5" />
              <span>{isOpenEvidence ? '접지 근거 접기' : '접지 근거 보기'}</span>
              {isOpenEvidence ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

      </div>
      {/* 펼쳐진 로비 8인 순위 테이블 (LOLCHESS 스타일) */}
      {isOpenLobby && match.lobbyParticipants && (
        <div className="bg-sunken/70 border-t border-line/10 p-4 animate-in fade-in duration-200">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line/10 text-muted text-[11px]">
                  <th className="pb-2 pl-2 w-12">등수</th>
                  <th className="pb-2 w-32">소환사</th>
                  <th className="pb-2 w-16">레벨</th>
                  <th className="pb-2">최종 덱 및 핵심 기물</th>
                  <th className="pb-2 w-28">활성 시너지</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/10/60">
                {match.lobbyParticipants.map((p, idx) => (
                  <tr
                    key={idx}
                    className={`hover:bg-panel/90 transition ${p.isUser ? 'bg-blue-950/30 font-semibold' : ''}`}
                  >
                    <td className="py-2.5 pl-2 font-mono">
                      <span
                        className={`inline-block w-6 h-6 rounded-md text-center leading-6 font-bold text-xs ${
                          p.placement === 1
                            ? 'bg-amber-400 text-slate-950'
                            : p.placement <= 4
                            ? 'bg-emerald-500/80 text-ink'
                            : 'bg-slate-800 text-muted'
                        }`}
                      >
                        {p.placement}
                      </span>
                    </td>

                    <td className="py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`truncate max-w-[120px] ${p.isUser ? 'text-cyan-300 font-bold' : 'text-ink-soft'}`}>
                          {p.gameName}
                        </span>
                        {p.isUser && (
                          <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-cyan-400 text-[10px] font-bold">
                            ME
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-2.5 text-muted font-mono">Lv.{p.level}</td>

                    <td className="py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {p.units.slice(0, 6).map((u, uIdx) => (
                          <div
                            key={uIdx}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-panel/90 border border-line/10 text-[11px]"
                          >
                            <span className="text-amber-400 text-[10px]">
                              {'★'.repeat(Math.min(u.tier, 3))}
                            </span>
                            <span className="text-muted">{u.name}</span>
                            {u.items.length > 0 && (
                              <span className="text-subtle text-[9px]">({u.items.length})</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>

                    <td className="py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {p.traits.slice(0, 2).map((t, tIdx) => (
                          <span key={tIdx} className="px-1.5 py-0.2 rounded bg-slate-800 text-muted text-[10px]">
                            {t.name} {t.count}
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
        <div className="bg-sunken/70 border-t border-line/10 p-4 md:p-5 space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center gap-2 text-cyan-300 font-extrabold text-xs uppercase tracking-wider">
            <Database className="w-4 h-4 text-cyan-400" />
            <span>접지 근거 · AI에 제공된 계산 데이터</span>
          </div>

          {/* 1) 계산 지표 */}
          <div>
            <p className="text-[11px] font-bold text-muted mb-1.5">📊 계산 지표 (코드 산출)</p>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <span className="px-2 py-0.5 rounded bg-panel/90 border border-line/10 text-muted">2성+ 기물 <b className="text-cyan-300">{twoStarPlus}개</b></span>
              <span className="px-2 py-0.5 rounded bg-panel/90 border border-line/10 text-muted">3성 <b className="text-amber-300">{threeStar}개</b></span>
              <span className="px-2 py-0.5 rounded bg-panel/90 border border-line/10 text-muted">총 장착아이템 <b className="text-cyan-300">{totalItems}개</b></span>
              <span className="px-2 py-0.5 rounded bg-panel/90 border border-line/10 text-muted">잔여 골드 <b className="text-emerald-300">{match.goldLeft}G</b></span>
              <span className="px-2 py-0.5 rounded bg-panel/90 border border-line/10 text-muted">탈락 라운드 <b className="text-ink-soft">{match.lastRound}</b></span>
              <span className="px-2 py-0.5 rounded bg-panel/90 border border-line/10 text-muted">최종 레벨 <b className="text-ink-soft">Lv.{match.level}</b></span>
            </div>
          </div>

          {/* 2) 로비 경합 분석 */}
          {match.contestedInfo && (
            <div>
              <p className="text-[11px] font-bold text-muted mb-1.5">⚔️ 로비 경합 분석</p>
              <div className="flex flex-wrap gap-1.5 text-[11px] mb-2">
                <span className="px-2 py-0.5 rounded bg-panel/90 border border-line/10 text-muted">경합 강도 <b className="text-rose-300">{match.contestedInfo.contestScore ?? '-'}/100</b></span>
                <span className="px-2 py-0.5 rounded bg-panel/90 border border-line/10 text-muted">등급 <b className="text-amber-300">{match.contestedInfo.level ?? '-'}</b></span>
                <span className="px-2 py-0.5 rounded bg-panel/90 border border-line/10 text-muted">겹친 상대 <b className="text-ink-soft">{match.contestedInfo.opponentCount}명</b></span>
              </div>

              {!!match.contestedInfo.unitDetails?.length && (
                <div className="space-y-1 mb-2">
                  {match.contestedInfo.unitDetails.map((d, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px] px-2 py-1 rounded bg-panel/90 border border-line/10">
                      <span className="text-ink-soft">{d.name} <span className="text-subtle">· {d.cost}코 · 나 {d.myTier}성</span></span>
                      <span className="text-muted">상대 <b className="text-rose-300">{d.opponentCount}명</b> · 가중 <b className="text-cyan-300">{d.weight}</b></span>
                    </div>
                  ))}
                </div>
              )}

              {!!match.contestedInfo.traitDetails?.length && (
                <div className="space-y-1 mb-2">
                  {match.contestedInfo.traitDetails.map((d, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px] px-2 py-1 rounded bg-panel/90 border border-line/10">
                      <span className="text-ink-soft">{d.name} <span className="text-subtle">· {d.myTier}단계</span></span>
                      <span className="text-muted">상대 <b className="text-rose-300">{d.opponentCount}명</b> · 가중 <b className="text-cyan-300">{d.weight}</b></span>
                    </div>
                  ))}
                </div>
              )}

              {match.contestedInfo.summary && (
                <p className="text-[11px] text-muted leading-relaxed">{match.contestedInfo.summary}</p>
              )}
            </div>
          )}

          {/* 3) 증강 메타 대조 */}
          <div>
            <p className="text-[11px] font-bold text-muted mb-1.5 flex items-center gap-1.5">
              🎲 증강 메타 대조
              {match.augmentAnalysis?.sample && (
                <span className="text-amber-400/80 border border-amber-800/50 rounded px-1.5 py-0.5">샘플(검증 전)</span>
              )}
            </p>
            {match.augmentAnalysis?.hasMeta ? (
              <>
                <div className="flex flex-wrap gap-1.5 text-[11px] mb-2">
                  <span className="px-2 py-0.5 rounded bg-panel/90 border border-line/10 text-muted">증강 점수 <b className="text-cyan-300">{match.augmentAnalysis.augmentScore ?? '-'}/100</b></span>
                  <span className="px-2 py-0.5 rounded bg-panel/90 border border-line/10 text-muted">출처 <b className="text-ink-soft">{match.augmentAnalysis.source ?? '-'}</b></span>
                  <span className="px-2 py-0.5 rounded bg-panel/90 border border-line/10 text-muted">패치 <b className="text-ink-soft">{match.augmentAnalysis.patch ?? '-'}</b></span>
                  <span className="px-2 py-0.5 rounded bg-panel/90 border border-line/10 text-muted">baseline <b className="text-ink-soft">{match.augmentAnalysis.baselineAvgPlacement ?? 4.5}등</b></span>
                </div>
                <div className="space-y-1">
                  {match.augmentAnalysis.details.map((d, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px] px-2 py-1 rounded bg-panel/90 border border-line/10">
                      <span className="text-ink-soft">{d.name}</span>
                      <span className="text-muted">
                        {typeof d.avgPlacement === 'number' ? (
                          <>
                            <b className="text-ink-soft">평균 {d.avgPlacement}등</b> · <b className="text-amber-300">{d.tier}</b>
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
              <p className="text-[11px] text-subtle">증강 메타 통계가 없습니다. (scripts/buildMetaStats.js 로 생성)</p>
            )}
          </div>

          <p className="text-[10px] text-subtle border-t border-line/10 pt-2">
            ※ 위 수치가 코드로 계산되어 AI 프롬프트에 ‘제공된 사실 데이터’로 전달됩니다. AI는 이 범위 밖은 단정하지 않습니다.
          </p>
        </div>
      )}

      {/* 경기별 AI 분석 오류 */}
      {analyzeError && (
        <div className="bg-red-950/50 border-t border-red-900/60 p-4 flex items-start gap-2 text-sm text-red-200">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{analyzeError}</span>
        </div>
      )}

      {/* 경기별 AI 정밀 코칭 리포트 */}
      {feedback && (
        <div className="bg-sunken/70 border-t border-line/10 p-4 md:p-6 animate-in fade-in duration-300">
          {wasCached && (
            <div className="mb-3 inline-flex items-center gap-1 text-[11px] text-cyan-400/80">
              <Info className="w-3 h-3" />
              <span>저장된 분석 결과(캐시)입니다.</span>
            </div>
          )}
          <FeedbackReport feedback={feedback} title="이 경기 정밀 코칭 (단일 매치)" compact />
        </div>
      )}

    </div>
  )
}

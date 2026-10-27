import { RawTFTMatch, SlimMatchData, SlimMatchTrait, SlimMatchUnit, LobbyParticipant } from './types'
import { translateChampion, translateItem, translateTrait } from './constants'
import { analyzeContest } from './contest'
import { analyzeAugments } from './meta'
import { isEarlyGame, lowSampleReason } from './quality'
import { queueLabel } from './queue'

export function formatTftRound(lastRoundInt: number): string {
  if (!lastRoundInt || lastRoundInt <= 0) return '1-1'
  if (lastRoundInt <= 4) {
    return `1-${lastRoundInt}`
  }
  const adjusted = lastRoundInt - 4
  const stage = Math.floor((adjusted - 1) / 7) + 2
  const round = ((adjusted - 1) % 7) + 1
  return `${stage}-${round}`
}

export function cleanName(id: string): string {
  if (!id) return ''
  return id
    .replace(/^TFT\d*_/i, '')
    .replace(/^Item_/i, '')
    .replace(/Augment_/i, '')
    .replace(/_/g, ' ')
    .trim()
}

export function formatTimeAgo(timestamp: number): string {
  const diffMs = Date.now() - timestamp
  const diffMins = Math.floor(diffMs / (1000 * 60))
  if (diffMins < 60) return `${Math.max(diffMins, 1)}분 전`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}시간 전`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}일 전`
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '31분 20초'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}분 ${String(secs).padStart(2, '0')}초`
}

function processParticipantUnits(units: any[]): SlimMatchUnit[] {
  return (units || [])
    .sort((a, b) => b.tier - a.tier || (b.itemNames?.length || 0) - (a.itemNames?.length || 0))
    .map((u) => {
      const champ = translateChampion(u.character_id)
      const translatedItems = ((u.itemNames as string[]) || []).map(translateItem)
      return {
        id: u.character_id,
        name: champ.name,
        tier: u.tier,
        rarity: u.rarity !== undefined ? u.rarity + 1 : champ.cost,
        imgUrl: champ.imgUrl,
        items: translatedItems.map((i) => i.name),
        itemIcons: translatedItems.map((i) => i.iconUrl),
      }
    })
}

function processParticipantTraits(traits: any[]): SlimMatchTrait[] {
  return (traits || [])
    .filter((t) => t.tier_current > 0)
    .sort((a, b) => b.tier_current - a.tier_current || b.num_units - a.num_units)
    .map((t) => {
      const traitInfo = translateTrait(t.name)
      return {
        name: traitInfo.name,
        tier: t.tier_current,
        count: t.num_units,
        iconUrl: traitInfo.iconUrl,
        style: typeof t.style === 'number' ? t.style : undefined,
      }
    })
}

export function extractSlimMatchData(rawMatch: RawTFTMatch, userPuuid: string): SlimMatchData | null {
  const participants = rawMatch.info?.participants || []
  const participant = participants.find((p) => p.puuid === userPuuid)

  if (!participant) {
    return null
  }

  const activeTraits = processParticipantTraits(participant.traits)
  const units = processParticipantUnits(participant.units)
  const augments = (participant.augments || []).map(cleanName)
  const augmentAnalysis = analyzeAugments(augments)

  // 로비 8명 전체 순위 정보 (롤체지지/OP.GG 아코디언)
  const lobbyParticipants: LobbyParticipant[] = participants
    .slice()
    .sort((a, b) => a.placement - b.placement)
    .map((p) => ({
      placement: p.placement,
      gameName: p.riotIdGameName || (p.puuid === userPuuid ? '나' : `소환사 #${p.placement}`),
      tagLine: p.riotIdTagline || 'KR1',
      level: p.level,
      lastRound: formatTftRound(p.last_round),
      damageToPlayers: p.total_damage_to_players || 0,
      traits: processParticipantTraits(p.traits),
      units: processParticipantUnits(p.units),
      isUser: p.puuid === userPuuid,
    }))

  // 로비 경합 분석 (코스트/성급/시너지 가중) — lib/contest.ts
  const contestedInfo = analyzeContest(
    units,
    activeTraits,
    lobbyParticipants.filter((p) => !p.isUser)
  )

  const queueId = rawMatch.info.queue_id
  const queueType = queueLabel(queueId)

  return {
    matchId: rawMatch.metadata.match_id,
    setNumber: rawMatch.info.tft_set_number,
    gameDatetime: rawMatch.info.game_datetime,
    timeAgo: formatTimeAgo(rawMatch.info.game_datetime),
    gameLengthStr: formatDuration(participant.time_eliminated || rawMatch.info.game_length),
    gameLengthSec: participant.time_eliminated || rawMatch.info.game_length || 0,
    queueId,
    queueType,
    placement: participant.placement,
    level: participant.level,
    lastRound: formatTftRound(participant.last_round),
    goldLeft: participant.gold_left || 0,
    augments,
    traits: activeTraits,
    units,
    lobbyParticipants,
    contestedInfo,
    augmentAnalysis,
  }
}

export function serializeMatchesForLLM(
  matches: SlimMatchData[],
  options: { includeLobby?: boolean } = {}
): string {
  return matches
    .map((m, idx) => {
      const traitStr = m.traits.map((t) => `${t.name}(${t.count})[${t.tier}단계]`).join(', ') || '없음'
      const unitStr = m.units
        .map((u) => {
          const stars = '★'.repeat(Math.min(u.tier, 3))
          const items = u.items.length > 0 ? `[템: ${u.items.join(', ')}]` : ''
          return `${u.name}${stars} ${items}`.trim()
        })
        .join(' | ')
      const augStr = m.augments.length
        ? m.augments
            .map((name) => {
              const d = m.augmentAnalysis?.details.find((x) => x.name === name)
              if (d && typeof d.avgPlacement === 'number') {
                return `${name}(평균 ${d.avgPlacement}등·${d.tier}${m.augmentAnalysis?.sample ? '·샘플' : ''})`
              }
              return name
            })
            .join(', ')
        : '없음'
      const setStr = m.setNumber ? `시즌 ${m.setNumber}` : '현재 시즌'

      const twoStarPlus = m.units.filter((u) => (u.tier || 1) >= 2).length
      const threeStar = m.units.filter((u) => u.tier === 3).length
      const totalItems = m.units.reduce((s, u) => s + (u.items?.length || 0), 0)

      const ci = m.contestedInfo
      const contestStr = !ci
        ? '경합 정보 없음'
        : ci.isContested
        ? [
            `⚠️ 경합 등급 ${ci.level ?? '경합'} (강도 ${ci.contestScore ?? '?'}/100, 로비 ${ci.opponentCount}명 겹침)`,
            ci.unitDetails?.length
              ? `기물: ${ci.unitDetails
                  .slice(0, 3)
                  .map((d) => `${d.name}(${d.cost}코·나 ${d.myTier}성·상대 ${d.opponentCount}명)`)
                  .join(', ')}`
              : '',
            ci.traitDetails?.length
              ? `시너지: ${ci.traitDetails
                  .slice(0, 3)
                  .map((d) => `${d.name}(${d.myTier}단계·상대 ${d.opponentCount}명)`)
                  .join(', ')}`
              : '',
          ]
            .filter(Boolean)
            .join(' | ')
        : `✅ 경합 등급 ${ci.level ?? '빈집'} — 겹침 거의 없음(유리한 조건) (강도 ${ci.contestScore ?? 0}/100)`

      const augmentLine = m.augments.length ? `\n- 선택 증강체: ${augStr}` : ''

      const others = (m.lobbyParticipants || [])
        .filter((p) => !p.isUser)
        .sort((a, b) => a.placement - b.placement)
      const top = others.slice(0, 3)
      const avgLevel = others.length ? others.reduce((s, p) => s + p.level, 0) / others.length : 0
      const lobbyLine =
        options.includeLobby && top.length
          ? `\n- 로비 상위 3명: ${top
              .map(
                (p) =>
                  `${p.placement}등 Lv.${p.level} [${p.units
                    .slice(0, 4)
                    .map((u) => `${u.name}${u.tier >= 2 ? `★${u.tier}` : ''}`)
                    .join(', ')}] ${p.traits
                    .slice(0, 2)
                    .map((t) => `${t.name} ${t.count}`)
                    .join(' / ')}`
              )
              .join(' | ')}\n- 로비 평균 레벨: Lv.${Math.round(avgLevel * 10) / 10} (내 Lv.${m.level})`
          : ''
      const sampleLine = isEarlyGame(m)
        ? `\n- ⚠️ 표본 품질: 초반 종료 (${lowSampleReason(m)} · ${m.gameLengthStr ?? '?'}) — 이 판은 등급/강의 근거로 쓰지 말고 "표본 부족"을 명시하라`
        : ''

      return `[매치 ${idx + 1} - ${setStr}]
- 최종 등수: ${m.placement}등 (${m.placement <= 4 ? '순방/승리' : '하위권/탈락'})
- 로비 경쟁 현황: ${contestStr}
- 계산 지표(코드 산출): 2성+기물 ${twoStarPlus}개, 3성 ${threeStar}개, 총 장착아이템 ${totalItems}개
- 최종 레벨: Lv.${m.level} (탈락 라운드: ${m.lastRound}, 경기 길이: ${m.gameLengthStr ?? '?'})${augmentLine}${sampleLine}${lobbyLine}
- 활성 시너지: ${traitStr}
- 최종 기물/아이템 구성: ${unitStr}`
    })
    .join('\n\n')
}

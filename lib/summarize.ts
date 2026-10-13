import { RawTFTMatch, SlimMatchData, SlimMatchTrait, SlimMatchUnit, LobbyParticipant } from './types'
import { translateChampion, translateItem, translateTrait } from './constants'

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

  // 로비 내 타 유저들과의 기물/시너지 겹침(대깨/경합 여부) 분석
  const opponents = participants.filter((p) => p.puuid !== userPuuid)
  const myTopTraits = activeTraits.slice(0, 2).map((t) => t.name)
  const myTopUnits = units.slice(0, 3).map((u) => u.name)

  const contestedTraitsSet = new Set<string>()
  const contestedUnitsSet = new Set<string>()
  let opponentCount = 0

  for (const opp of opponents) {
    let hasContest = false
    const oppTraits = (opp.traits || []).filter((t: any) => t.tier_current > 0).map((t: any) => translateTrait(t.name).name)
    const oppUnits = (opp.units || []).map((u: any) => translateChampion(u.character_id).name)

    for (const t of myTopTraits) {
      if (oppTraits.includes(t)) {
        contestedTraitsSet.add(t)
        hasContest = true
      }
    }
    for (const u of myTopUnits) {
      if (oppUnits.includes(u)) {
        contestedUnitsSet.add(u)
        hasContest = true
      }
    }
    if (hasContest) opponentCount++
  }

  const contestedInfo = {
    isContested: contestedTraitsSet.size > 0 || contestedUnitsSet.size > 0,
    contestedTraits: Array.from(contestedTraitsSet),
    contestedUnits: Array.from(contestedUnitsSet),
    opponentCount,
  }

  const queueMap: Record<number, string> = {
    1100: '랭크 게임',
    1090: '일반 게임',
    1130: '초고속 모드',
    1160: '더블 업',
  }
  const queueType = queueMap[rawMatch.info.queue_id] || '랭크 게임'

  return {
    matchId: rawMatch.metadata.match_id,
    setNumber: rawMatch.info.tft_set_number,
    gameDatetime: rawMatch.info.game_datetime,
    timeAgo: formatTimeAgo(rawMatch.info.game_datetime),
    gameLengthStr: formatDuration(participant.time_eliminated || rawMatch.info.game_length),
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
  }
}

export function serializeMatchesForLLM(matches: SlimMatchData[]): string {
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
      const augStr = m.augments.join(', ') || '없음'
      const setStr = m.setNumber ? `시즌 ${m.setNumber}` : '현재 시즌'
      
      const contestStr = m.contestedInfo?.isContested
        ? `⚠️ 경합 발생: 로비 내 ${m.contestedInfo.opponentCount}명의 유저와 메인 시너지(${m.contestedInfo.contestedTraits.join(', ') || '동일 시너지'}) / 핵심 기물(${m.contestedInfo.contestedUnits.join(', ') || '동일 기물'}) 겹침 (대깨 여부 판단 요망)`
        : `✅ 빈집 성공: 로비 내 핵심 시너지 겹침 유저 거의 없음 (유연한 빈집 진입)`

      return `[매치 ${idx + 1} - ${setStr}]
- 최종 등수: ${m.placement}등 (${m.placement <= 4 ? '순방/승리' : '하위권/탈락'})
- 로비 경쟁 현황: ${contestStr}
- 최종 레벨: Lv.${m.level} (탈락 라운드: ${m.lastRound}, 남은 골드: ${m.goldLeft}G)
- 선택 증강체: ${augStr}
- 활성 시너지: ${traitStr}
- 최종 기물/아이템 구성: ${unitStr}`
    })
    .join('\n\n')
}

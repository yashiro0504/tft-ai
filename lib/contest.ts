import {
  ContestAnalysis,
  ContestLevel,
  LobbyParticipant,
  SlimMatchTrait,
  SlimMatchUnit,
  TraitContestDetail,
  UnitContestDetail,
} from './types'

/**
 * 로비 경합(대깨 vs 유연성) 결정론적 분석 엔진.
 *
 * 기존: 이름 문자열 일치만 카운트 (가중치 없음)
 * 개선: 코스트 / 성급 민감도 / 경합 빈도 / 시너지 단계를 반영한 "경합 강도" 산출.
 *
 * ※ Riot 매치 데이터에는 "언제 피봇했는지" 타임라인이 없으므로,
 *    여기서는 결과 시점의 경합 상태(겹침 강도)를 정량화한다.
 */

/** 코어 기물 판정: 2성 이상이거나 아이템을 1개 이상 보유한 기물 */
function isCoreUnit(u: SlimMatchUnit): boolean {
  return (u.tier || 1) >= 2 || (u.items?.length || 0) > 0
}

/**
 * 내 성급에 따른 경합 민감도.
 * 아직 2성 미완성(1성)일 때 경합이 가장 치명적이고, 3성 완성 시 민감도는 낮다.
 */
function starSensitivity(tier: number): number {
  if (tier <= 1) return 1.4
  if (tier === 2) return 1.0
  return 0.5
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function analyzeContest(
  userUnits: SlimMatchUnit[],
  userTraits: SlimMatchTrait[],
  opponents: LobbyParticipant[]
): ContestAnalysis {
  const coreUnits = (userUnits || []).filter(isCoreUnit)

  // 상대별 보유 기물 (id + 이름 모두 담아 매칭 견고화) / 활성 시너지 name 집합
  const oppUnitSets = opponents.map((p) => {
    const set = new Set<string>()
    for (const u of p.units || []) {
      if (u.id) set.add(u.id)
      if (u.name) set.add(u.name)
    }
    return set
  })
  const oppTraitSets = opponents.map((p) => new Set((p.traits || []).map((t) => t.name)))

  const sharesUnitWith = (set: Set<string>, u: SlimMatchUnit) => set.has(u.id) || set.has(u.name)

  // 1. 기물 경합 (코스트 × 성급 민감도 × 빈도 가중)
  const unitDetails: UnitContestDetail[] = coreUnits
    .map((u) => {
      let opponentCount = 0
      for (const set of oppUnitSets) if (sharesUnitWith(set, u)) opponentCount++

      const cost = u.rarity || 3
      const weight = round1(cost * starSensitivity(u.tier) * (1 + Math.max(opponentCount - 1, 0) * 0.3))

      return { unitId: u.id, name: u.name, cost, myTier: u.tier, opponentCount, weight }
    })
    .filter((d) => d.opponentCount > 0)
    .sort((a, b) => b.weight - a.weight)

  // 2. 시너지 경합 (시너지 단계 × 빈도 가중)
  const myTopTraits = (userTraits || []).slice(0, 4)
  const traitDetails: TraitContestDetail[] = myTopTraits
    .map((t) => {
      let opponentCount = 0
      for (const set of oppTraitSets) if (set.has(t.name)) opponentCount++

      const weight = round1(t.tier * opponentCount)
      return { name: t.name, myTier: t.tier, myCount: t.count, opponentCount, weight }
    })
    .filter((d) => d.opponentCount > 0)
    .sort((a, b) => b.weight - a.weight)

  // 3. 코어 기물/상위 시너지를 공유한 상대 수
  let opponentCount = 0
  for (let i = 0; i < opponents.length; i++) {
    const sharesUnit = coreUnits.some((u) => sharesUnitWith(oppUnitSets[i], u))
    const sharesTrait = myTopTraits.some((t) => oppTraitSets[i].has(t.name))
    if (sharesUnit || sharesTrait) opponentCount++
  }

  // 4. 경합 강도 0~100 (포화 함수로 정규화)
  const unitScore = unitDetails.reduce((s, d) => s + d.weight, 0)
  const traitScore = traitDetails.reduce((s, d) => s + d.weight, 0)
  const raw = unitScore + traitScore
  const contestScore = Math.min(100, Math.round((100 * raw) / (raw + 25)))

  const level: ContestLevel =
    contestScore < 15 ? '빈집' : contestScore < 40 ? '보통' : contestScore < 65 ? '경합' : '심각'

  const isContested = unitDetails.length > 0 || traitDetails.length > 0
  const contestedUnits = unitDetails.map((d) => d.name)
  const contestedTraits = traitDetails.map((d) => d.name)

  const summary = buildSummary(level, contestScore, opponentCount, unitDetails, traitDetails)

  return {
    isContested,
    contestScore,
    level,
    opponentCount,
    contestedUnits,
    contestedTraits,
    unitDetails,
    traitDetails,
    summary,
  }
}

function buildSummary(
  level: ContestLevel,
  contestScore: number,
  opponentCount: number,
  unitDetails: UnitContestDetail[],
  traitDetails: TraitContestDetail[]
): string {
  const head = `경합 강도 ${contestScore}/100 (${level})`

  if (level === '빈집' || (!unitDetails.length && !traitDetails.length)) {
    return `${head} · 로비 내 내 코어 기물/시너지 겹침이 거의 없는 '빈집' 판이었습니다.`
  }

  const parts: string[] = [`${head} · 로비 ${opponentCount}명이 내 덱과 겹쳤습니다.`]

  if (unitDetails.length) {
    const u = unitDetails
      .slice(0, 3)
      .map((d) => `${d.name}(${d.cost}코·나 ${d.myTier}성·상대 ${d.opponentCount}명)`)
      .join(', ')
    parts.push(`핵심 기물 경합: ${u}.`)
  }

  if (traitDetails.length) {
    const t = traitDetails
      .slice(0, 3)
      .map((d) => `${d.name}(${d.myTier}단계·상대 ${d.opponentCount}명)`)
      .join(', ')
    parts.push(`시너지 경합: ${t}.`)
  }

  return parts.join(' ')
}

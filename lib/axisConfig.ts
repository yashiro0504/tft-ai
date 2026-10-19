import cfg from './axisConfig.json'

/**
 * 6축 진단·metaScore 공식 파라미터 (axisConfig.json 기반).
 *
 * 공식을 바꾸는 순서:
 *  1) axisConfig.json 값 수정 + version 올리기
 *  2) node scripts/testAxes.js 로 골든셋 케이스별 점수 변화 확인
 *  3) 의도한 변화면 node scripts/testAxes.js --update 로 스냅샷 갱신
 * version 은 분석/종합 캐시 키에 포함되어 이전 점수로 만든 리포트를 자동 무효화한다.
 */
export interface AxisConfig {
  version: string
  expectedLevelByStage: Record<string, number>
  earlyGame: { minStage: number; minUnits: number; minGameSec: number }
  axes: {
    economy: {
      idleGoldFree: number
      idleGoldPenaltyPerGold: number
      /** 이 등수는 잔여 골드를 보지 않는다 (1등은 게임이 끝나 남은 골드가 낭비가 아님) */
      idleGoldExemptPlacements: number[]
      levelGapPenaltyPerLevel: number
      earlyExitPenalty: { maxStage: number; penalty: number }[]
    }
    itemization: { carryItemsMax: number; carryWeight: number; boardItemsMax: number; boardWeight: number }
    tempo: { unknownStageScore: number; levelGapPenaltyPerLevel: number }
    completion: { fillBase: number; twoPlusBonus: number; threeStarBonusEach: number; threeStarMax: number }
    synergy: {
      /** 1명으로 켜지는 고유 시너지는 활성 개수에서 뺀다 */
      excludeUniqueTraits: boolean
      /** 이 범위 안의 활성 시너지 개수는 감점하지 않는다 */
      idealActiveMin: number
      idealActiveMax: number
      spreadPenaltyPerTrait: number
      /** 활성 시너지 단계(tier_current) 합이 이 값이면 만점 — 세트별 보정값 */
      tierTotalTarget: number
      spreadWeight: number
      tierWeight: number
    }
    contest: {
      /** 경합 등급별 조건 점수 (등급이 없는 옛 데이터는 아래 3개 값으로 판정) */
      byLevel: Record<string, { top4: number; bottom4: number }>
      uncontested: number
      contestedTop4: number
      contestedBottom4: number
      focusMinGap: number
    }
  }
  metaScore: {
    weights: { placement: number; completion: number; items: number; contest: number }
    boardItemsMax: number
    tiers: { min: number; tier: string }[]
  }
}

export const AXIS_CONFIG = cfg as AxisConfig

/** 점수 공식 버전 (캐시 키·스냅샷·리포트 표시에 공용) */
export const SCORING_VERSION = AXIS_CONFIG.version

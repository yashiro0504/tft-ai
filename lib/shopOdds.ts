import { GAME_VERSION, SHOP_ODDS } from './gameFacts'

/**
 * 레벨별 상점 확률 — 게임 파일의 현재 세트 상점 확률표 (scripts/buildGameData.js → lib/gameData.lite.json).
 * 1성 캐리 장면(lib/keyMoments)과 AI 프롬프트(lib/llm)가 "그 레벨까지 그 코스트를 얼마나 볼 수 있었나"를 같은 표로 판단한다.
 * 클라이언트 공용 (lite 데이터만 읽는다).
 */

/**
 * 캐리를 2성으로 올릴 수 있었다고 보는 상점 확률(%) 하한 — 최종 레벨까지 그 코스트가 이만큼 나온 레벨을 지났어야
 * 1성 캐리를 장면으로 본다. Set 18 표로는 4코스트 Lv.8(30%)부터 · 3코스트 Lv.7(40%)부터 · 5코스트는 Lv.10(25%)까지 해당 없음.
 * 예전 기준 '1~3코스트만'은 Lv.8 이상 1성 4코스트 캐리를 놓쳤다 (래더 9,952보드 같은 레벨 비교 +2.25등, npm run rules:check).
 * 5코스트를 계속 빼는 근거: 1등 판 Lv.9 1성 장로 드래곤 BIS(KR_8427833164)는 정상 운영이다 (그 레벨 5코스트 15%).
 */
export const CARRY_STAR_ODDS_MIN = 30

const maxLevel = () => SHOP_ODDS.length

const clampLevel = (level: number) => Math.min(Math.max(Math.round(level || 1), 1), maxLevel())

/** 그 레벨 상점의 그 코스트 확률(%). 표가 없거나 코스트가 1~5 밖이면 0 */
export function costOdds(level: number, cost: number): number {
  if (!maxLevel()) return 0
  return SHOP_ODDS[clampLevel(level) - 1]?.[cost - 1] ?? 0
}

/**
 * 레벨 1~level 중 그 코스트가 상점에 min% 이상 나온 레벨 구간 (없으면 null).
 * 코스트별 확률은 레벨이 오르며 올랐다 내려가므로 구간은 이어져 있다 (1코스트는 Lv.1~6, 4코스트는 Lv.8~).
 */
export function oddsWindow(cost: number, level: number, min = CARRY_STAR_ODDS_MIN): { from: number; to: number } | null {
  let from = 0
  let to = 0
  for (let l = 1; l <= clampLevel(level); l++) {
    if (costOdds(l, cost) < min) continue
    if (!from) from = l
    to = l
  }
  return from ? { from, to } : null
}

/** "Lv.8~9" / "Lv.8" */
export const levelRange = (w: { from: number; to: number }) => (w.from === w.to ? `Lv.${w.from}` : `Lv.${w.from}~${w.to}`)

/** "Lv.8 상점: 1코 15% · 2코 20% · 3코 32% · 4코 30% · 5코 3%" (표가 없으면 빈 문자열) */
export function shopOddsLine(level: number): string {
  if (!maxLevel()) return ''
  const lv = clampLevel(level)
  return `Lv.${lv} 상점: ${SHOP_ODDS[lv - 1].map((p, i) => `${i + 1}코 ${p}%`).join(' · ')}`
}

/** "4코스트 레벨별 상점 확률: Lv.7 10% · Lv.8 30% · Lv.9 33% · Lv.10 40%" — 그 코스트가 나오는 레벨만 (Lv.10 까지) */
export function costOddsLine(cost: number): string {
  const levels = Array.from({ length: Math.min(maxLevel(), 10) }, (_, i) => i + 1).filter((l) => l >= 3 && costOdds(l, cost) > 0)
  return levels.length ? `${cost}코스트 레벨별 상점 확률: ${levels.map((l) => `Lv.${l} ${costOdds(l, cost)}%`).join(' · ')}` : ''
}

/** AI 프롬프트 [상점 확률] 블록의 출처 표기 */
export const SHOP_ODDS_SOURCE = `게임 파일 상점 확률표 (패치 ${GAME_VERSION})`

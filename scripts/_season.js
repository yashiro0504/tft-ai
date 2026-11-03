/**
 * 세트(시즌) 번호 — 수집 스크립트 공용.
 *
 * 예전에는 수집기마다 `SET_NUMBER = 18` 을 따로 적어 두어, 다음 세트가 열리면 새 세트 판을 전부 '다른 세트'로 버렸다
 * (수집이 멈춘 것처럼 보이고 시드 커서는 그대로 밀려 그 판들은 다시 받지도 않는다).
 * 이제 기준은 하나다: lib/gameData.lite.json 의 set (scripts/buildGameData.js 가 만든다 · 사이트의 CURRENT_SET 과 같다).
 * 환경변수 SET_NUMBER 로 덮어쓸 수 있다.
 *
 * 수집기는 '기준 세트 이상'을 받는다(createSetGate). 기준보다 높은 세트 판이 보이면 그 세트로 올라가고,
 * 그 뒤로는 낮은 세트 판을 버린다 — 게임 데이터(lib/gameData.json)를 새 세트로 다시 만들기 전에도 새 세트 판을 놓치지 않는다.
 * 세트 전환 절차: docs/SEASON-TRANSITION.md
 */
const fs = require('fs')
const path = require('path')

const LITE = path.join(__dirname, '..', 'lib', 'gameData.lite.json')

/** 게임 데이터 기준 세트 (lib/gameData.lite.json) */
function gameDataSet() {
  try {
    const n = Number(JSON.parse(fs.readFileSync(LITE, 'utf-8')).set)
    return Number.isInteger(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

/** 수집 기준 세트: SET_NUMBER 환경변수 → lib/gameData.lite.json */
function configuredSet() {
  const env = Number(process.env.SET_NUMBER)
  if (Number.isInteger(env) && env > 0) return env
  const set = gameDataSet()
  if (!set) throw new Error('세트 번호를 알 수 없습니다 — lib/gameData.lite.json 의 set 또는 SET_NUMBER 환경변수가 필요합니다')
  return set
}

/**
 * 세트 관문 — 기준 세트 이상만 통과시키고, 더 높은 세트를 보면 기준을 그 세트로 올린다.
 * @param base 시작 기준 세트
 * @param onNewSet (set, prev) => void — 기준이 올라갈 때 1번
 */
function createSetGate(base, onNewSet) {
  let current = base
  return {
    /** 이 판을 받을지. 더 높은 세트면 기준을 올리고 true */
    accept(setNumber) {
      const n = Number(setNumber)
      if (!Number.isInteger(n) || n < current) return false
      if (n > current) {
        const prev = current
        current = n
        if (onNewSet) onNewSet(n, prev)
      }
      return true
    },
    get current() {
      return current
    },
    get base() {
      return base
    },
    /** 실행 중에 새 세트를 봤는가 */
    get changed() {
      return current > base
    },
  }
}

/** GitHub Actions 실행이면 경고 주석(::warning::)으로, 아니면 그냥 경고로 */
function annotateWarning(title, message, log = console) {
  if (process.env.GITHUB_ACTIONS) log.log(`::warning title=${title}::${message}`)
  else log.warn(`⚠️  ${title}: ${message}`)
}

module.exports = { gameDataSet, configuredSet, createSetGate, annotateWarning }

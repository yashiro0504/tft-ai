/**
 * 정답셋(골든셋 판정 라벨) 공용 — 골든셋 경기마다 코드가 내는 장면을 뽑는다.
 *  - scripts/buildLabelPage.js : 라벨링 페이지에 넣을 장면 목록
 *  - scripts/testGoldenLabels.js : 사람이 단 라벨과 지금 코드의 장면을 대조
 *
 * 대상 = 골든셋 각 경기의 "내 보드" (lib/keyMoments allKeyMoments + 4등 안이면 winFactors).
 * 골든셋은 10-19 캡처라 옛 시너지·기물 이름이 남아 있어, 지금 앱이 보여 줄 이름으로 바꿔 읽는다.
 *
 * 장면 id = `${matchId}:${kind}` (이긴 요인은 `${matchId}:win:${분류}`) — 문구가 바뀌어도 라벨이 따라간다.
 */
const fs = require('fs')
const path = require('path')
const { fixtureTraits } = require('./_boards')
const { allKeyMoments, winFactors } = require('../lib/keyMoments')
const { translateChampion } = require('../lib/constants')

const FIXTURE_PATH = path.join(__dirname, '..', 'data', 'evalMatches.json')

/** 이긴 요인 문구 앞머리 → 분류 (lib/keyMoments winFactors 의 줄 순서·형식) */
const WIN_KINDS = [
  ['3성 ', 'threeStar', '3성 기물'],
  ['높은 단계 시너지', 'deepTraits', '높은 단계 시너지'],
  ['2성 이상', 'twoStar', '2성 수 · 레벨'],
  ['로비 경합', 'contest', '로비 경합'],
]

const SCENE_TITLE = {
  sameComp: '같은 구성 상위 등수와 성급 차이',
  duplicateCopies: '같은 기물 1성 여러 장',
  itemsOnWeak: '아이템이 1성 저코스트에',
  carryOneStar: '저코스트 캐리가 1성',
  emptySlots: '보드 빈칸',
  nearBreakpoint: '1명 모자란 시너지',
}

/** 지금 앱 기준 이름으로 고친 보드 */
function refresh(board) {
  return {
    ...board,
    units: (board.units || []).map((u) => ({ ...u, name: translateChampion(u.id).name || u.name })),
    traits: fixtureTraits(board.units || [], board.traits || []),
  }
}

/** 골든셋 경기 (내 보드 기준, matchId+등수로 중복 제거) + 각 경기의 장면 */
function goldenScenes() {
  const data = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'))
  const seen = new Set()
  const matches = []
  for (const c of data.cases || []) {
    for (const raw of c.matches || []) {
      const key = `${raw.matchId}:${raw.placement}`
      if (seen.has(key)) continue
      seen.add(key)
      const m = { ...refresh(raw), lobbyParticipants: (raw.lobbyParticipants || []).map(refresh) }
      const scenes = allKeyMoments(m).map((k) => ({
        id: `${m.matchId}:${k.kind}`,
        group: 'scene',
        kind: k.kind,
        title: k.title,
        fact: k.fact,
      }))
      if (m.placement <= 4) {
        for (const line of winFactors(m)) {
          const hit = WIN_KINDS.find(([prefix]) => line.startsWith(prefix))
          if (!hit) continue
          scenes.push({ id: `${m.matchId}:win:${hit[1]}`, group: 'win', kind: `win:${hit[1]}`, title: `이긴 요인 · ${hit[2]}`, fact: line })
        }
      }
      matches.push({
        matchId: m.matchId,
        caseName: c.name,
        mode: c.mode,
        placement: m.placement,
        level: m.level,
        lastRound: m.lastRound,
        units: m.units.map((u) => ({ name: u.name, star: u.tier || 1, cost: u.rarity || null, items: u.items || [] })),
        traits: (m.traits || []).filter((t) => (t.tier || 0) > 0).map((t) => ({ name: t.name, count: t.count, tier: t.tier })),
        scenes,
      })
    }
  }
  return matches
}

module.exports = { goldenScenes, SCENE_TITLE }

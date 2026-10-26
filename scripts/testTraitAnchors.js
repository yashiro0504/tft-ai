/**
 * [시너지 유지 기물] 테스트 — lib/traitAnchors.ts.
 *
 * 실행: node scripts/testTraitAnchors.js   (npm run test:ai 에 포함)
 *  - 협곡야수 7 보드: 장로 드래곤(2명분)·어스름늑대 등 협곡야수 전원이 유지 기물, 빼면 5명 단계 (2026-10-23 오진단 회귀:
 *    "어스름늑대 2성과 장로 드래곤 1성 자리에 2성 기물을 채우라")
 *  - 시너지와 무관한 기물만 교체 후보
 *  - 단계에 여유가 있는 시너지(4명 중 3명 단계)는 유지 기물이 없다
 *  - 첫 단계 시너지(협곡야수 3 · 사냥꾼 2 같은 스플래시)는 지키지 않는다 — 다 지키면 교체 후보가 사라진다
 *  - 인원이 Riot 집계와 다르면 그 시너지는 건너뛴다
 *  - 1명 모자란 시너지의 채울 자리 (lib/keyMoments fillSpots): 그 시너지 소속·핵심 시너지 기물 제외, 빼면 잃는 시너지 표기
 *  - 실제 래더 보드: 켜진 다인원 시너지의 인원 계산이 Riot 집계와 대부분 일치
 */
require('./_ts')
const fs = require('fs')
const path = require('path')
const { traitAnchors, freeUnits, traitAnchorFacts, unitTraitCounts } = require('../lib/traitAnchors')
const { allKeyMoments, fillSpots, fillableNearBreakpoints } = require('../lib/keyMoments')
const { findChampion, findItem, findTrait } = require('../lib/gameData')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  ✅ ${label}`)
  else {
    failures++
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const unit = (id, tier = 1, items = []) => ({ id, name: findChampion(id).name, tier, items })
const RIFT = findTrait('DA_Riftbeast18').name

console.log('협곡야수 7 보드')
const rift7 = {
  placement: 1,
  level: 9,
  units: [
    unit('DA_18_ElderDragon', 1),
    unit('DA_Murkwolf18', 2),
    unit('DA_18_Sentry', 2),
    unit('DA_Krug18', 2),
    unit('DA_Scuttlecrab18', 1),
    unit('DA_Sentinel18', 1),
    unit('DA_18_Azir', 2),
    unit('DA_18_Rammus', 1),
  ],
  traits: [{ name: RIFT, tier: 3, count: 7 }],
}
const a = traitAnchors(rift7)
check('협곡야수 하나만 잡힘', a.length === 1 && a[0].trait === RIFT, JSON.stringify(a))
check('켜진 단계 7 · 빼면 5', a[0]?.active === 7 && a[0]?.dropTo === 5, JSON.stringify(a[0]))
const names = (a[0]?.units || []).map((u) => u.name)
check('장로 드래곤·어스름늑대 포함', names.includes('장로 드래곤') && names.includes('어스름늑대'), names.join(','))
check('협곡야수 6기물 전원', names.length === 6, names.join(','))
check('장로 드래곤은 2명분', a[0]?.units.find((u) => u.name === '장로 드래곤')?.contributes === 2)
const free = freeUnits(rift7).map((u) => u.name)
check('교체 후보 = 핵심 시너지와 무관한 1성만 (아지르 2성 제외)', free.length === 1 && free[0] === findChampion('DA_18_Rammus').name, free.join(','))
const lines = traitAnchorFacts(rift7)
check('프롬프트 줄에 단계 하락 표기', lines.some((l) => l.includes('2단계(5명)로 내려감') && l.includes('장로 드래곤 1성(2명분)')), lines.join(' | '))
// "N단계" = 몇 번째 단계 (summarize 표기와 같다). "7명 단계"처럼 인원을 단계로 쓰면 모델이 "7단계"로 옮긴다
check('단계는 번호로 표기 (협곡야수 7명 = 3단계)', lines.some((l) => l.startsWith(`- ${RIFT} 7명(3단계)`)) && !lines.some((l) => /\d+명 단계/.test(l)), lines.join(' | '))
// 모델이 줄 표기를 사용자 문장에 그대로 옮기므로 내부 용어(유지 기물·교체 후보)를 쓰지 않는다
check('줄 표기에 내부 용어 없음', !lines.some((l) => /유지 기물|교체 후보|산출/.test(l)), lines.join(' | '))

console.log('여유 있는 단계 · 인원 불일치')
const slack = { ...rift7, units: rift7.units.slice(1, 5), traits: [{ name: RIFT, tier: 1, count: 4 }] }
check('4명 중 3명 단계 → 유지 기물 없음', traitAnchors(slack).length === 0, JSON.stringify(traitAnchors(slack)))
check('유지 기물 없으면 프롬프트 줄 없음', traitAnchorFacts(slack).length === 0)
const firstTier = { ...rift7, units: rift7.units.slice(2, 5), traits: [{ name: RIFT, tier: 1, count: 3 }] }
check('첫 단계(협곡야수 3)는 지키지 않음', traitAnchors(firstTier).length === 0, JSON.stringify(traitAnchors(firstTier)))
const mismatch = { ...rift7, traits: [{ name: RIFT, tier: 3, count: 8 }] }
check('Riot 인원과 다르면 건너뜀', traitAnchors(mismatch).length === 0)

console.log('제보 경기 (골든셋 Rift01: 1등 Lv9 협곡야수 7, 장로 드래곤 1성)')
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'evalMatches.json'), 'utf8'))
const rift01 = golden.cases.find((c) => c.name.startsWith('Rift01'))?.matches[0]
if (rift01) {
  const anchors = traitAnchors(rift01).find((x) => x.trait === RIFT)
  const held = (anchors?.units || []).map((u) => u.name)
  check('장로 드래곤·어스름늑대가 협곡야수 7을 받침', held.includes('장로 드래곤') && held.includes('어스름늑대'), held.join(','))
  check('교체 후보에 협곡야수 기물 없음', !freeUnits(rift01).some((u) => held.includes(u.name)), freeUnits(rift01).map((u) => u.name).join(','))

  // 1명 모자란 시너지의 채울 자리 — "타릭 자리에 선봉대를"·"벤치에 남겨둘 것" 오진단 회귀
  const vanguard = fillSpots(rift01, '선봉대')
  const names = vanguard.swaps.map((w) => w.name)
  check('선봉대 채울 자리에 타릭 없음 (이미 선봉대)', !names.includes('타릭'), names.join(','))
  check('선봉대 채울 자리에 장로 드래곤 없음 (협곡야수 7을 받침)', !names.includes('장로 드래곤'), names.join(','))
  check('세트 자리는 맞바꿈 (빼면 싸움꾼 꺼짐)', vanguard.swaps.find((w) => w.name === '세트')?.cost.join() === '싸움꾼 꺼짐', JSON.stringify(vanguard.swaps))
  check('기원자 채울 자리에는 타릭 포함 (빼도 선봉대 1단계 유지)', fillSpots(rift01, '기원자').swaps.some((w) => w.name === '타릭' && !w.cost.some((c) => c.startsWith('선봉대'))), JSON.stringify(fillSpots(rift01, '기원자').swaps))
  // 단일 경기 장면에서는 빠졌다 (10-22 정답셋 0/19) — 채울 자리 계산만 남는다
  const fillable = fillableNearBreakpoints(rift01).find((n) => n.trait === '선봉대')
  check('채울 자리가 있는 시너지만: 선봉대 3→4 · 세트 1성 자리(빼면 싸움꾼 꺼짐)', fillable?.count === 3 && fillable.next === 4 && fillable.spot.swaps.some((w) => w.name === '세트' && w.cost.join() === '싸움꾼 꺼짐'), JSON.stringify(fillable))
  check('1명 모자란 시너지는 단일 경기 장면에 없음', !allKeyMoments(rift01).some((x) => x.kind === 'nearBreakpoint'))
} else {
  check('골든셋에 Rift01 케이스 있음', false)
}

console.log('실제 래더 보드 인원 일치율')
const file = path.join(__dirname, '..', 'data', 'ladderBoards.json')
if (fs.existsSync(file)) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  let total = 0
  let matched = 0
  for (const m of data.matches) {
    for (const b of m.boards) {
      const units = b.units.map((u) => ({ id: u.id, name: findChampion(u.id)?.name || u.id, tier: u.star, items: u.items.map((i) => findItem(i)?.name || i) }))
      const counts = units.map(unitTraitCounts)
      for (const t of b.traits || []) {
        const name = findTrait(t.id)?.name || t.id
        const bps = findTrait(t.id)?.breakpoints || []
        if (!t.tier || (bps[0] ?? 1) <= 1) continue
        total++
        if (counts.reduce((s, c) => s + (c.get(name) || 0), 0) === t.units) matched++
      }
    }
  }
  const rate = total ? matched / total : 1
  console.log(`  켜진 다인원 시너지 ${total}개 중 ${matched}개 인원 일치 (${Math.round(rate * 1000) / 10}%)`)
  check('인원 일치율 90% 이상', rate >= 0.9)
} else {
  console.log('  (data/ladderBoards.json 없음 — 건너뜀)')
}

if (failures) {
  console.error(`\n❌ 실패 ${failures}건`)
  process.exit(1)
}
console.log('\n✅ 시너지 유지 기물 테스트 통과')

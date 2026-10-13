/**
 * 합성(데모) 표본 생성기 — 튜닝 하네스 검증용 (실측 데이터 아님)
 *
 * 설계: 참가자 코어 기물/시너지의 총 겹침(opp)이 클수록 등수가 나빠지도록 생성 + 노이즈.
 * → scripts/tuneContest.js 가 이를 감지해 가중치/임계값을 복원하는지 확인.
 *
 * 사용법: node scripts/genSyntheticSamples.js
 * 출력: data/contestSamples.sample.json (source="synthetic-demo", sample=true)
 */
const fs = require('fs')
const path = require('path')

let seed = 42
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))

const samples = []
for (let i = 0; i < 120; i++) {
  const nu = ri(2, 4)
  const units = []
  for (let j = 0; j < nu; j++) units.push({ cost: ri(1, 5), tier: ri(1, 3), opp: ri(0, 3) })

  const nt = ri(1, 3)
  const traits = []
  for (let j = 0; j < nt; j++) traits.push({ tier: ri(1, 3), opp: ri(0, 3) })

  const opp = units.reduce((s, u) => s + u.opp, 0) + traits.reduce((s, t) => s + t.opp, 0)
  let placement = Math.round(1 + opp * 0.55 + (rnd() - 0.5) * 4)
  placement = Math.max(1, Math.min(8, placement))

  samples.push({ matchId: `SYN_${i}`, placement, units, traits })
}

const out = {
  source: 'synthetic-demo',
  sample: true,
  generatedAt: new Date().toISOString(),
  patch: 'synthetic',
  samples,
}

const p = path.join(__dirname, '..', 'data', 'contestSamples.sample.json')
fs.mkdirSync(path.dirname(p), { recursive: true })
fs.writeFileSync(p, JSON.stringify(out, null, 2), 'utf-8')
console.log(`생성: ${samples.length}건 → ${p}`)

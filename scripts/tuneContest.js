/**
 * 경합 분석 임계값/가중치 튜닝 스크립트 (그리드서치)
 *
 * 입력: scripts/collectContestSamples.js 로 수집한 data/contestSamples.json
 *   (또는 합성 데이터 data/contestSamples.sample.json)
 *
 * 목적:
 *  1) 가중치(성급민감도/빈도스텝/시너지가중)를 그리드서치하여
 *     "경합 raw 점수 ↔ 나쁜 등수" 상관(Spearman)을 최대화
 *  2) 최적 가중치 기준 분포로 saturation K 와 등급 임계값(분위수)을 재산출
 *
 * 사용법:
 *   node scripts/tuneContest.js data/contestSamples.json
 *   node scripts/tuneContest.js data/contestSamples.json --write   # lib/contestConfig.json 갱신
 */
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const shouldWrite = args.includes('--write')
const dataPath =
  args.find((a) => !a.startsWith('--')) || path.join(__dirname, '..', 'data', 'contestSamples.sample.json')

const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
const samples = data.samples || []
if (samples.length < 10) {
  console.error(`표본이 너무 적습니다 (${samples.length}건). 더 수집하세요.`)
  process.exit(1)
}

const starSens = (w, tier) => w.star[String(tier)] ?? w.star.default ?? 1.0

function rawForSample(s, w) {
  let raw = 0
  for (const u of s.units || []) raw += (u.cost || 3) * starSens(w, u.tier) * (1 + Math.max((u.opp || 0) - 1, 0) * w.freq)
  for (const t of s.traits || []) raw += (t.tier || 1) * (t.opp || 0) * w.traitW
  return raw
}

function rank(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])
  const r = new Array(arr.length)
  for (let i = 0; i < idx.length; i++) r[idx[i][1]] = i + 1
  return r
}
function pearson(a, b) {
  const n = a.length
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma
    const y = b[i] - mb
    num += x * y
    da += x * x
    db += y * y
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}
// 경합이 높을수록 등수가 나빠야(숫자 큼) 하므로 raw vs placement 양의 상관을 최대화
function spearman(raws, placements) {
  return pearson(rank(raws), rank(placements))
}

function quantile(sorted, q) {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base]
}

const placements = samples.map((s) => s.placement)

// ── 1) 가중치 그리드서치 ──
const grid = { star1: [1.0, 1.2, 1.4, 1.6, 1.8], star3: [0.3, 0.5, 0.7, 1.0], freq: [0, 0.2, 0.3, 0.5], traitW: [0.5, 1.0, 1.5, 2.0] }
let best = null
for (const star1 of grid.star1)
  for (const star3 of grid.star3)
    for (const freq of grid.freq)
      for (const traitW of grid.traitW) {
        const w = { star: { '1': star1, '2': 1.0, '3': star3, default: 1.0 }, freq, traitW }
        const raws = samples.map((s) => rawForSample(s, w))
        const rho = spearman(raws, placements)
        if (!best || rho > best.rho) best = { w, rho, raws }
      }

// ── 2) K 와 임계값 재산출 (최적 가중치 분포 기준) ──
const raws = best.raws
const sortedRaw = [...raws].sort((a, b) => a - b)
const K = Math.max(1, Math.round(quantile(sortedRaw, 0.5))) // 중앙 raw → score≈50 이 되도록
const scores = raws.map((r) => Math.round((100 * r) / (r + K))).sort((a, b) => a - b)
const recommended = {
  ...best.w,
  K,
  thresholds: {
    binzip: Math.round(quantile(scores, 0.4)),
    boTong: Math.round(quantile(scores, 0.65)),
    gyeonghap: Math.round(quantile(scores, 0.85)),
  },
}

console.log(`표본 ${samples.length}건 (source=${data.source || '?'}, sample=${data.sample})`)
console.log(`■ 가중치 그리드서치: 최고 Spearman(rho) = ${best.rho.toFixed(4)}`)
console.log(`   star1=${best.w.star['1']}, star3=${best.w.star['3']}, freq=${best.w.freq}, traitW=${best.w.traitW}`)
console.log(`■ saturationK(중앙값 기준) = ${K}`)
console.log(`■ 임계값(분위수 40/65/85%) = 빈집<${recommended.thresholds.binzip} / 보통<${recommended.thresholds.boTong} / 경합<${recommended.thresholds.gyeonghap}`)
if (best.rho < 0.05) console.log('⚠️ 상관이 매우 낮습니다. 표본을 늘리거나 특징 설계를 재검토하세요.')

// ⛔ 안전장치: 검증 전(sample=true) 데이터로는 기본값을 덮어쓰지 않는다.
if (shouldWrite && data.sample === true && !args.includes('--force')) {
  console.log('⛔ sample=true(검증 전) 데이터로는 설정을 덮어쓰지 않습니다. 그래도 쓰려면 --force 를 추가하세요.')
  process.exit(0)
}

if (shouldWrite) {
  const cfgPath = path.join(__dirname, '..', 'lib', 'contestConfig.json')
  const cur = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
  const updated = {
    ...cur,
    starSensitivity: { '1': best.w.star['1'], '2': 1.0, '3': best.w.star['3'], default: 1.0 },
    frequencyStep: best.w.freq,
    traitTierWeight: best.w.traitW,
    saturationK: K,
    thresholds: recommended.thresholds,
  }
  fs.writeFileSync(cfgPath, JSON.stringify(updated, null, 2) + '\n', 'utf-8')
  console.log(`✅ lib/contestConfig.json 갱신 완료`)
} else {
  console.log('(적용하려면 --write 플래그를 추가하세요)')
}

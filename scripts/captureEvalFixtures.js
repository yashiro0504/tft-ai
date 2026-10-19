/**
 * 평가 하네스용 골든셋 캡처
 *
 * 실제 랭크 경기를 /api/tft/search 로 가져와 data/evalMatches.json 에 저장한다.
 * (이후 evalReports.js 가 같은 입력으로 반복 평가하고, testAxes.js 가 6축 점수 회귀를 검사한다)
 *
 * 사용법:
 *   node scripts/captureEvalFixtures.js "닉네임#KR1" [경기수=3]     # 한 소환사 → multi 케이스 1개 추가
 *   node scripts/captureEvalFixtures.js --seeds [--per-tag 3]        # SEEDS 전체 → 상황별 케이스 자동 선별
 *   --api http://localhost:3000   (기본 EVAL_API 또는 localhost:3000)
 *   --replace                     기존 케이스를 지우고 새로 저장 (기본은 같은 이름만 교체)
 *
 * --seeds 모드는 개인정보를 남기지 않는다: 소환사명은 SeedNN, 로비 참가자는 P{등수} 로 바꾼다.
 * 선별 태그: multi(최근 5판) · win(1등) · bottom(7~8등) · contested-top4 · contested-bot4 · open(빈집) · early(초반 종료)
 */
const fs = require('fs')
const path = require('path')
const { loadEnv, getSeeds } = require('./_env')
loadEnv()

const args = process.argv.slice(2)
const getArg = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const API = getArg('--api', process.env.EVAL_API || 'http://localhost:3000')
const SEEDS_MODE = args.includes('--seeds')
const REPLACE = args.includes('--replace')
const PER_TAG = Number(getArg('--per-tag', '3'))
const MULTI_MAX = Number(getArg('--multi', '4'))
const VALUE_FLAGS = new Set(['--api', '--per-tag', '--multi'])
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1]))

const OUT = path.join(__dirname, '..', 'data', 'evalMatches.json')
const EARLY_STAGE = 3

async function search(gameName, tagLine, limit) {
  const res = await fetch(`${API}/api/tft/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameName, tagLine, limit }),
  })
  const json = await res.json()
  if (!res.ok || !json.success || !Array.isArray(json.matches) || json.matches.length === 0) {
    throw new Error(json.error || `HTTP ${res.status}`)
  }
  return json
}

/** 소환사명/로비 닉네임을 지운다 (matchId·보드 데이터는 공개 경기 정보라 유지) */
function anonymizeMatch(m) {
  return {
    ...m,
    lobbyParticipants: (m.lobbyParticipants || []).map((p) => {
      const { tagLine: _drop, ...rest } = p
      return { ...rest, gameName: p.isUser ? 'ME' : `P${p.placement}` }
    }),
  }
}

const stageOf = (round) => Number(/^(\d+)-/.exec(String(round || ''))?.[1] || 0)
const isEarly = (m) => (stageOf(m.lastRound) > 0 && stageOf(m.lastRound) < EARLY_STAGE) || (m.units?.length ?? 0) < 4

function tagsOf(m) {
  const tags = []
  if (isEarly(m)) return ['early']
  if (m.placement === 1) tags.push('win')
  if (m.placement >= 7) tags.push('bottom')
  if (m.contestedInfo?.isContested) tags.push(m.placement <= 4 ? 'contested-top4' : 'contested-bot4')
  else tags.push('open')
  return tags
}

function readExisting() {
  if (REPLACE || !fs.existsSync(OUT)) return []
  try {
    return JSON.parse(fs.readFileSync(OUT, 'utf-8')).cases || []
  } catch {
    return []
  }
}

function save(newCases) {
  const byName = new Map(readExisting().map((c) => [c.name, c]))
  for (const c of newCases) byName.set(c.name, c)
  const cases = [...byName.values()]
  const payload = { version: 2, capturedAt: new Date().toISOString(), cases }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  // 로비 8명 보드가 커서 들여쓰기 없이 저장한다 (케이스 20개 ≈ 1.3MB)
  fs.writeFileSync(OUT, JSON.stringify(payload), 'utf-8')
  const tagCount = {}
  for (const c of cases) for (const t of c.tags || [c.mode]) tagCount[t] = (tagCount[t] || 0) + 1
  console.log(`✅ 골든셋 저장 → ${OUT} (케이스 ${cases.length}개 · ${JSON.stringify(tagCount)})`)
}

async function captureOne(riotId, count) {
  const [gameName, tagLine] = riotId.split('#')
  const json = await search(gameName, tagLine, count)
  save([
    {
      name: `${json.gameName}#${json.tagLine} ${json.matches.length}경기`,
      gameName: json.gameName,
      tagLine: json.tagLine,
      mode: json.matches.length > 1 ? 'multi' : 'single',
      tags: ['multi'],
      matches: json.matches,
    },
  ])
}

async function captureSeeds() {
  const seeds = getSeeds()
  if (!seeds.length) throw new Error('SEEDS 가 비어 있습니다 (.env.local 의 SEEDS=닉#태그,...)')

  const multi = []
  /** tag → [{ seedNo, match }] */
  const pool = {}
  for (let i = 0; i < seeds.length; i++) {
    const seedNo = String(i + 1).padStart(2, '0')
    const [gameName, tagLine = 'KR1'] = seeds[i].split('#')
    try {
      const json = await search(gameName, tagLine, 10)
      const matches = json.matches.map(anonymizeMatch)
      console.log(`  Seed${seedNo}: ${matches.length}경기`)
      const full = matches.filter((m) => !isEarly(m))
      if (full.length >= 3 && multi.length < MULTI_MAX) {
        multi.push({
          name: `Seed${seedNo} 최근 ${Math.min(full.length, 5)}경기`,
          gameName: `Seed${seedNo}`,
          tagLine: 'EVAL',
          mode: 'multi',
          tags: ['multi'],
          matches: full.slice(0, 5),
        })
      }
      for (const m of matches) for (const t of tagsOf(m)) (pool[t] ||= []).push({ seedNo, match: m })
    } catch (e) {
      console.warn(`  Seed${seedNo}: 건너뜀 (${e.message})`)
    }
  }

  // 태그별로 서로 다른 시드를 우선해 PER_TAG 개씩 고른다. (한 경기는 한 케이스에만)
  const used = new Set()
  const singles = []
  for (const tag of ['win', 'bottom', 'contested-top4', 'contested-bot4', 'open', 'early']) {
    const picked = []
    const seen = new Set()
    for (const pass of [0, 1]) {
      for (const { seedNo, match } of pool[tag] || []) {
        if (picked.length >= PER_TAG) break
        if (used.has(match.matchId) || (pass === 0 && seen.has(seedNo))) continue
        picked.push({ seedNo, match })
        seen.add(seedNo)
        used.add(match.matchId)
      }
    }
    for (const { seedNo, match } of picked) {
      singles.push({
        name: `Seed${seedNo} ${tag} ${match.placement}등 ${match.lastRound}`,
        gameName: `Seed${seedNo}`,
        tagLine: 'EVAL',
        mode: 'single',
        tags: tagsOf(match),
        matches: [match],
      })
    }
  }

  save([...multi, ...singles])
}

async function main() {
  if (SEEDS_MODE) return captureSeeds()
  const riotId = positional[0] || ''
  if (!riotId.includes('#')) {
    console.error('사용법: node scripts/captureEvalFixtures.js "닉네임#KR1" [경기수=3]  |  --seeds')
    process.exitCode = 1
    return
  }
  return captureOne(riotId, Math.min(Math.max(Number(positional[1] || 3), 1), 10))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

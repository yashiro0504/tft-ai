#!/usr/bin/env node
/**
 * 경제·템포·완성도 축 기준선 생성 — Supabase 원본 보드(tft_boards) → lib/gameBaselines.json
 *
 * 같은 탈락 스테이지 보드의 레벨·보드 가치 중앙값을 스테이지 전체와 캐리(lib/deckType boardCarryKey) × 스테이지로 만든다.
 * 앱(lib/baselines)은 캐리 × 스테이지 → 스테이지 → axisConfig.json 손 표 순으로 쓴다.
 *
 * 실행
 *   node scripts/buildBaselines.js                 # 보고서만 (파일 안 씀)
 *   node scripts/buildBaselines.js --write         # lib/gameBaselines.json 갱신
 *   --patch=16.21 (기본: 가장 최근 패치) · --max-matches=6000
 * 필요: SUPABASE_URL(또는 NEXT_PUBLIC_SUPABASE_URL) · SUPABASE_SERVICE_ROLE_KEY — 원본 보드는 RLS 로 막혀 있다.
 * 매일 collect-ladder 워크플로가 --write 로 돌리고 메타 데이터와 함께 커밋한다.
 */
const fs = require('fs')
const path = require('path')
require('./_env').loadEnv()
require('./_ts')
const { arg, writeReport, annotate, toUnit } = require('./_boards')
const { decodeUnits } = require('./collect/normalize')
const { formatTftRound } = require('../lib/summarize')
const { buildGameBaselines, validateGameBaselines, BASELINE_MIN_SAMPLE } = require('../lib/baselineBuild')
const { AXIS_CONFIG } = require('../lib/axisConfig')

const OUT_PATH = path.join(__dirname, '..', 'lib', 'gameBaselines.json')
/** '기준'은 마스터+ 보드 */
const TIER_MIN = 'MASTER'
const TIER_BUCKETS = ['CHALLENGER', 'GRANDMASTER', 'MASTER']
/** 패치 초반엔 표본이 작아 기준이 흔들린다 — 이보다 적으면 파일을 바꾸지 않는다 */
const MIN_MATCHES = Number(process.env.BASELINE_MIN_MATCHES || 500)

async function loadBoards({ patch: wantPatch, maxMatches }) {
  const { createClient } = require('@supabase/supabase-js')
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const must = ({ data, error }, what) => {
    if (error) throw new Error(`Supabase ${what}: ${error.message}`)
    return data
  }

  const names = new Map()
  for (let from = 0; ; from += 1000) {
    const rows = must(await db.from('tft_dict').select('id, api_id').range(from, from + 999), 'dict 조회')
    for (const r of rows) names.set(r.id, r.api_id)
    if (rows.length < 1000) break
  }

  let patch = wantPatch
  if (!patch) {
    const latest = must(await db.from('tft_matches').select('patch').order('game_at', { ascending: false }).limit(1), '최근 패치')
    patch = latest[0]?.patch
    if (!patch) return { patch: null, matches: 0, boards: [] }
  }

  const matchIds = []
  for (let from = 0; matchIds.length < maxMatches; from += 1000) {
    const rows = must(
      await db
        .from('tft_matches')
        .select('match_id')
        .eq('patch', patch)
        .in('tier_bucket', TIER_BUCKETS)
        .order('game_at', { ascending: false })
        .range(from, Math.min(from + 999, maxMatches - 1)),
      '매치 목록'
    )
    matchIds.push(...rows.map((r) => r.match_id))
    if (rows.length < 1000) break
  }

  const boards = []
  for (let i = 0; i < matchIds.length; i += 100) {
    const rows = must(
      await db
        .from('tft_boards')
        .select('placement, level, last_round, units')
        .in('match_id', matchIds.slice(i, i + 100))
        .range(0, 999),
      '보드 조회'
    )
    for (const r of rows) {
      boards.push({
        placement: r.placement,
        level: r.level,
        lastRound: r.last_round ? formatTftRound(r.last_round) : '',
        units: decodeUnits(r.units || []).map((u) =>
          toUnit({ id: names.get(u.unit), star: u.star, items: u.items.map((it) => names.get(it)).filter(Boolean) })
        ),
      })
    }
  }
  return { patch, matches: matchIds.length, boards }
}

function report(b) {
  const lv = AXIS_CONFIG.expectedLevelByStage
  const bv = AXIS_CONFIG.axes.economy.expectedBoardValueByStage
  const lines = [
    `## 경제·템포 기준선 — 패치 ${b.patch} · 마스터+ ${b.matches.toLocaleString()}판 (보드 ${b.boards.toLocaleString()})`,
    '',
    `같은 탈락 스테이지 보드의 중앙값. 칸 표본 하한: 스테이지 ${b.minSample.stage} · 캐리×스테이지 ${b.minSample.carryStage}`,
    '',
    '| 탈락 스테이지 | 보드 | 레벨 (손 표) | 보드 가치 G (손 표) |',
    '| --- | --- | --- | --- |',
    ...Object.entries(b.byStage).map(
      ([s, c]) =>
        `| ${s} | ${c.n.toLocaleString()} | ${c.level} (${lv[s] ?? lv.default}) | ${c.boardValue} (${bv[s] ?? bv.default}) |`
    ),
    '',
    `캐리별 기준선: ${Object.keys(b.byCarry).length}개 캐리`,
    '',
    '| 캐리 | 보드 | 스테이지별 레벨 · 보드 가치 |',
    '| --- | --- | --- |',
    ...Object.entries(b.byCarry)
      .slice(0, 15)
      .map(([, c]) => `| ${c.name} | ${c.n} | ${Object.entries(c.byStage).map(([s, x]) => `${s}: Lv${x.level} · ${x.boardValue}G (${x.n})`).join(' / ')} |`),
  ]
  return lines.join('\n')
}

async function main() {
  const hasDb = Boolean((process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY)
  if (!hasDb) {
    console.log('ℹ️  SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 가 없어 기준선을 만들지 않습니다 (기존 lib/gameBaselines.json 유지).')
    return
  }
  const { patch, matches, boards } = await loadBoards({ patch: arg('patch'), maxMatches: Number(arg('max-matches', 6000)) })
  if (matches < MIN_MATCHES) {
    console.log(`ℹ️  패치 ${patch ?? '?'} 마스터+ ${matches}판 < ${MIN_MATCHES}판 — 표본이 작아 기준선을 바꾸지 않습니다.`)
    return
  }

  const baselines = buildGameBaselines(
    boards,
    { source: 'supabase-tft_boards', patch, tierMin: TIER_MIN, matches, generatedAt: new Date().toISOString() },
    BASELINE_MIN_SAMPLE
  )
  const md = report(baselines)
  console.log(md)
  writeReport(md)

  const problems = validateGameBaselines(baselines)
  if (problems.length) {
    annotate('기준선 이상', problems.join(' · '))
    throw new Error(`기준선 값 이상 — 쓰지 않습니다: ${problems.join(' · ')}`)
  }

  const prev = JSON.parse(fs.readFileSync(OUT_PATH, 'utf-8'))
  const out = { _comment: prev._comment, ...baselines }
  const json = `${JSON.stringify(out, null, 2)}\n`
  if (process.env.GITHUB_ACTIONS) {
    console.log('::group::lib/gameBaselines.json')
    console.log(json)
    console.log('::endgroup::')
  }
  if (arg('write')) {
    fs.writeFileSync(OUT_PATH, json, 'utf-8')
    console.log(`\n✅ ${path.relative(process.cwd(), OUT_PATH)} 갱신`)
  } else {
    console.log('\n(--write 없이 실행 — 파일은 그대로)')
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`)
  process.exitCode = 1
})

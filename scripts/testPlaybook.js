/**
 * 덱 플레이북 테스트 (2026-10-29 지시문 4 · 네트워크·DB·LLM 불필요 — 가짜 보드·가짜 LLM).
 *
 *  - 플레이북 sample_n · BIS(덱 카드 아이템) = 같은 묶음으로 만든 메타 덱(stat_comp 행)
 *  - 300판+ 전체 / 100~299판 core_units·carry_bis 만 / 100판 미만 없음
 *  - 팁: 숫자·evidence 대조 통과분만, 배치·타이밍·조합식 금지, 3개 미만이면 비움
 *  - external_links 는 source·url 만
 *  - 이전 패치 플레이북 선택(새 패치 300판 미만) · 스냅샷 다르면 안 씀
 *  - 리포트 "이 덱의 정석과 비교": 최대 3항목, 수치는 플레이북 값 그대로, 100판 미만은 한 줄
 *
 * 실행: node scripts/testPlaybook.js   (npm run test:ai 에 포함)
 */
require('./_ts')
const { clusterDecks } = require('./collect/decks')
const { buildPlaybookRows, validateTip, generateTips, externalLinks, snapshotIdOf: scriptSnapshotId } = require('./collect/playbook')
const { choosePlaybook, buildDeckComparison, comparePlaybook, snapshotIdOf, DECK_COMPARISON_SKIPPED } = require('../lib/playbook')
const { validateFeedbackGrounding, collectFactNumbers } = require('../lib/grounding')

let failures = 0
function check(label, ok, detail = '') {
  if (ok) console.log(`  ✅ ${label}`)
  else {
    failures++
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** jsonb 는 키 순서를 바꾼다 — 키 정렬해서 비교 */
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x))

let seed = 11
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647

/** 덱 A: 자야 캐리 · 숲지기 (400판) / 덱 B: 덩굴정령 캐리 · 협곡야수 (150판) / 덱 C: 60판 */
const DECKS = {
  A: {
    carry: { id: 'DA_18_Xayah', items: ['DA_GuinsoosRageblade', 'DA_Deathblade', 'DA_GiantSlayer'] },
    core: ['DA_18_Ornn', 'DA_Krug18', 'DA_Sentinel18', 'DA_Scuttlecrab18', 'DA_Murkwolf18'],
    flex: 'DA_Cinderling18',
    traits: [{ id: 'DA_18_Elderwood', units: 4, style: 2 }],
    games: 400,
  },
  B: {
    carry: { id: 'DA_Brambleback18', items: ['DA_Bloodthirster', 'DA_EdgeOfNight', 'DA_Deathblade'] },
    core: ['DA_Gromp18_AP', 'DA_Murkwolf18', 'DA_18_Sentry', 'DA_Scuttlecrab18', 'DA_Krug18'],
    traits: [{ id: 'DA_Riftbeast18', units: 6, style: 3 }],
    games: 150,
  },
}

function makeBoard(kind, placement, matchId) {
  const d = DECKS[kind]
  const units = [
    { id: d.carry.id, star: placement <= 4 && rnd() < 0.6 ? 3 : 2, items: rnd() < 0.8 ? [...d.carry.items] : [d.carry.items[0], 'DA_BlueBuff', d.carry.items[2]] },
    ...d.core.map((id) => ({ id, star: rnd() < 0.7 ? 2 : 1, items: [] })),
  ]
  if (d.flex && rnd() < 0.5) units.push({ id: d.flex, star: 1, items: [] })
  return { match_id: matchId, placement, level: placement <= 4 ? (rnd() < 0.6 ? 8 : 9) : rnd() < 0.5 ? 7 : 8, last_round: placement <= 4 ? 35 : 20 + Math.floor(rnd() * 8), units, traits: d.traits, tier_bucket: 'MASTER' }
}

// 판마다 8명: A 0~2명 · B 0~1명 · 나머지는 덱으로 안 묶이는 보드(기물 4개)
const boards = []
const left = { A: DECKS.A.games, B: DECKS.B.games }
for (let m = 0; left.A > 0 || left.B > 0; m++) {
  const matchId = `KR_${1000 + m}`
  const kinds = []
  const nA = Math.min(left.A, m % 3 === 0 ? 2 : 1)
  for (let i = 0; i < nA; i++) kinds.push('A')
  if (left.B > 0 && m % 2 === 0) kinds.push('B')
  left.A -= nA
  if (kinds.includes('B')) left.B--
  const places = [1, 2, 3, 4, 5, 6, 7, 8].sort(() => rnd() - 0.5)
  places.forEach((p, i) => {
    if (kinds[i]) boards.push(makeBoard(kinds[i], p, matchId))
    else boards.push({ match_id: matchId, placement: p, level: 7, last_round: 25, units: [{ id: 'DA_18_Sentry', star: 1, items: [] }], traits: [], tier_bucket: 'MASTER' })
  })
}

;(async () => {
  console.log('플레이북 = 메타 덱 (같은 묶음 · 같은 스냅샷)')
  const { rows: compRowsOut, decks } = clusterDecks(boards, { minGames: 8 })
  const patch = '16.21'
  const updatedAt = '2026-10-29T06:12:00.123456+00:00'
  const snapshotId = scriptSnapshotId(patch, 'MASTER', updatedAt)
  check('snapshot_id 규칙: 수집기 = 앱 (같은 stat_comp.updated_at)', snapshotId === snapshotIdOf(patch, 'master', updatedAt), snapshotId)
  const tipLlm = async () => ({ tips: [] })
  const rows = await buildPlaybookRows(decks, { patch, snapshotId, llm: tipLlm, log: { log() {}, warn() {} } })
  const byKey = new Map(rows.map((r) => [r.deck_key, r]))
  const metaA = compRowsOut.find((r) => r.deck.units[0].name === '자야')
  const pbA = metaA && byKey.get(metaA.comp_id)
  check('300판+ 덱 플레이북 생성 · scope full', pbA && pbA.scope === 'full', JSON.stringify(rows.map((r) => [r.deck_name, r.sample_n, r.scope])))
  check('sample_n = 메타 덱 판수', pbA && pbA.sample_n === metaA.games, `${pbA?.sample_n} vs ${metaA?.games}`)
  const carryMeta = metaA?.deck.units.find((u) => u.items.length)
  const carryPb = pbA?.carry_bis.find((c) => c.key === carryMeta?.matchedKey)
  check('BIS = 메타 페이지 덱 카드의 캐리 아이템', carryPb && JSON.stringify(carryPb.items) === JSON.stringify(carryMeta.items.map((i) => i.name)), JSON.stringify([carryPb?.items, carryMeta?.items.map((i) => i.name)]))
  check('BIS 3개 세트(기존 BIS 로직) 상위에 평균등수·판수', carryPb && carryPb.sets.length > 0 && carryPb.sets[0].games > 0 && carryPb.sets[0].avg != null)
  check('snapshot_id 저장', rows.every((r) => r.snapshot_id === snapshotId))
  const metaB = compRowsOut.find((r) => r.deck.units[0].name === '덩굴정령')
  const pbB = metaB && byKey.get(metaB.comp_id)
  check('100~299판 덱은 core_units·carry_bis 만', pbB && pbB.scope === 'partial' && pbB.core_units.length > 0 && pbB.three_star === null && pbB.level_profile === null, JSON.stringify(pbB && [pbB.sample_n, pbB.scope]))
  check('100판 미만 덱은 생성하지 않음', rows.every((r) => r.sample_n >= 100))
  check('전체 플레이북 필드: core·three_star·level·elim·contested · augments 없음(null)', pbA && pbA.core_units.length && pbA.three_star && pbA.level_profile && pbA.elim_profile && pbA.contested && pbA.augments === null)
  check('contested: 같은 로비 같은 덱 2명 판을 셈', pbA && pbA.contested.contested_n > 0 && pbA.contested.solo_n > 0, JSON.stringify(pbA?.contested))
  check('flex_units: 양쪽 50판 이상일 때만', pbA && pbA.flex_units.every((f) => f.with_n >= 50 && f.without_n >= 50))

  console.log('팁 근거 검증')
  const lv = pbA.level_profile
  const st = pbA.three_star[0]
  const good = [
    { text: `TOP4의 ${lv.top4_lv8plus_pct}%가 최종 Lv.8 이상으로 끝냅니다`, evidence: ['level_profile'] },
    { text: `${st.name} ★3 달성률은 TOP4 ${st.top4_pct}% · 5~8등 ${st.bottom_pct}%입니다`, evidence: ['three_star'] },
    { text: `경쟁자가 있으면 평균 ${pbA.contested.contested_avg.toFixed(2)}등, 혼자면 ${pbA.contested.solo_avg.toFixed(2)}등입니다`, evidence: ['contested'] },
  ]
  check('수치가 evidence 필드에 있으면 통과', good.every((t) => validateTip(t, pbA).ok), JSON.stringify(good.map((t) => validateTip(t, pbA))))
  check('필드에 없는 숫자 → 버림', !validateTip({ text: 'TOP4의 97%가 Lv.10', evidence: ['level_profile'] }, pbA).ok)
  check('숫자가 다른 필드에만 있으면 → 버림 (evidence 불일치)', !validateTip({ text: `TOP4의 ${lv.top4_lv8plus_pct}%가 최종 Lv.8 이상`, evidence: ['contested'] }, pbA).ok || String(lv.top4_lv8plus_pct) === '0')
  check('숫자 없는 팁 → 버림', !validateTip({ text: '코어를 먼저 모으세요', evidence: ['core_units'] }, pbA).ok)
  check('배치 조언 → 버림', !validateTip({ text: `자야를 구석 자리에 두면 TOP4 ${lv.top4_lv8plus_pct}%`, evidence: ['level_profile'] }, pbA).ok)
  check('라운드 타이밍 → 버림', !validateTip({ text: `4-1까지 Lv.8 — TOP4의 ${lv.top4_lv8plus_pct}%`, evidence: ['level_profile'] }, pbA).ok)
  check('아이템 조합식 → 버림', !validateTip({ text: `구인수 = 곡궁 + 지팡이, TOP4 ${lv.top4_lv8plus_pct}%`, evidence: ['level_profile'] }, pbA).ok)
  const four = await generateTips(pbA, { llm: async () => ({ tips: [...good, { text: 'TOP4의 97%', evidence: ['level_profile'] }] }), log: {} })
  check('4개 중 3개 통과 → 3개 저장', four.tips.length === 3 && four.rejected.length === 1)
  const two = await generateTips(pbA, { llm: async () => ({ tips: [good[0], good[1], { text: '자리 배치 97%', evidence: ['core_units'] }] }), log: {} })
  check('통과 팁 3개 미만 → tips 비움 (화면은 수치만)', two.tips.length === 0)
  const partial = await generateTips(pbB, { llm: async () => ({ tips: good }), log: {} })
  check('100~299판 덱은 팁을 만들지 않음', partial.tips.length === 0)

  console.log('외부 링크')
  check('외부 링크는 source·url 만 (매핑 없으면 빈 배열)', rows.every((r) => Array.isArray(r.external_links) && r.external_links.every((l) => Object.keys(l).sort().join() === 'source,url')))
  check('external_links 에 https 아닌 값은 버림', externalLinks('없는덱').length === 0)

  console.log('플레이북 선택 (패치 · 스냅샷)')
  const cur = { snapshotId, patch }
  const old = { ...pbA, patch: '16.20', snapshot_id: '16.20|MASTER|1', sample_n: 900 }
  check('지금 스냅샷 300판+ → 그대로', choosePlaybook([pbA, old], cur)?.playbook === pbA)
  const fresh = { ...pbA, sample_n: 120, scope: 'partial' }
  const fb = choosePlaybook([fresh, old], cur)
  check('새 패치 300판 미만 → 이전 패치 + "이전 패치(16.20) 기준"', fb?.playbook === old && fb.label === '이전 패치(16.20) 기준', JSON.stringify(fb?.label))
  check('이전 패치도 없으면 지금 스냅샷 100~299판', choosePlaybook([fresh], cur)?.playbook === fresh)
  check('스냅샷이 다르면(메타 페이지와 어긋남) 쓰지 않음', choosePlaybook([{ ...pbA, snapshot_id: `${patch}|MASTER|5` }], cur) === null)

  console.log('리포트 "이 덱의 정석과 비교"')
  const match = {
    matchId: 'KR_1',
    placement: 6,
    level: 7,
    lastRound: pbA.elim_profile.stages[0].stage,
    goldLeft: 0,
    augments: [],
    traits: [],
    gameDatetime: Date.now(),
    units: [
      { id: 'TFT18_Xayah', name: '자야', tier: 2, items: [carryPb.items[0]] },
      { id: 'TFT18_Ornn', name: '오른', tier: 1, items: [] },
      { id: 'TFT18_Cinderling', name: '불타는 묘목', tier: 1, items: [] },
    ],
  }
  const cmp = buildDeckComparison(match, { id: pbA.deck_key, name: pbA.deck_name, sampleSize: pbA.sample_n }, { playbook: pbA }, 1)
  check('최대 3항목', cmp.items.length > 0 && cmp.items.length <= 3, String(cmp.items.length))
  const allRows = comparePlaybook(match, pbA, 1)
  check('항목은 비교표의 한 행 (id = 플레이북 필드)', cmp.items.every((it) => allRows.some((r) => r.text === it.text && r.id === it.id) && it.id in pbA))
  const pbNums = collectFactNumbers(JSON.stringify(pbA) + ` Lv.${match.level} ${match.lastRound} ★${match.units[0].tier} 1명`)
  const nums = cmp.items.flatMap((it) => it.text.match(/\d+(?:\.\d+)?/g) || [])
  check('항목 수치 = 플레이북 값 (또는 이 경기 값)', nums.every((n) => pbNums.has(String(Math.round(Number(n) * 100) / 100))), nums.filter((n) => !pbNums.has(String(Math.round(Number(n) * 100) / 100))).join(','))
  const g = validateFeedbackGrounding({ overview: '', deckComparison: cmp }, allRows.map((r) => r.text).join('\n'))
  check('근거 검증기가 비교 섹션 수치까지 검사 (프롬프트 비교표와 대조 100%)', g.total > 0 && g.score === 100, JSON.stringify(g))
  const skip = buildDeckComparison(match, { name: '작은 덱', sampleSize: 60 }, null)
  check('100판 미만 덱 → "표본 부족으로 덱 기준 비교 생략" 한 줄만', skip.skipped === DECK_COMPARISON_SKIPPED && skip.items.length === 0)

  console.log('0011 마이그레이션 (PGlite)')
  try {
    const { PGlite } = await import('@electric-sql/pglite')
    const db = new PGlite()
    await db.exec('create role anon; create role authenticated;')
    await db.exec(require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'migrations', '0011_deck_playbook.sql'), 'utf8'))
    const save = (r) => db.query("select public.tft_replace_playbooks('16.21', 'MASTER', $1::jsonb) as n", [JSON.stringify(r)])
    await save(rows)
    const stored = (await db.query('select deck_key, sample_n, snapshot_id, carry_bis from deck_playbook order by sample_n desc')).rows
    check('저장 → 다시 읽은 sample_n · snapshot_id · BIS 그대로', stored.length === rows.length && stored[0].sample_n === pbA.sample_n && stored[0].snapshot_id === snapshotId && canon(stored[0].carry_bis) === canon(pbA.carry_bis))
    let rejected = false
    try {
      await save([{ ...rows[0], external_links: [{ source: 'TFT Academy', url: 'https://example.com', text: '가이드 본문' }] }])
    } catch {
      rejected = true
    }
    check('external_links 에 source·url 외 키(외부 텍스트) → DB 가 거부', rejected)
  } catch (e) {
    check('PGlite 로 0011 실행', false, e.message)
  }

  console.log(failures ? `\n❌ 실패 ${failures}건` : '\n✅ 덱 플레이북 테스트 통과')
  if (failures) process.exitCode = 1
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

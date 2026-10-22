/**
 * 정답셋 검사 — 사람이 단 판정(data/goldenLabels.json)과 지금 코드가 내는 장면(scripts/_goldenScenes)을 대조한다.
 *
 * 실행: npm run test:labels
 *  - 규칙(kind)별 정확도 = 맞음 / (맞음 + 틀림) — 애매는 빼고 센다
 *  - 실패(종료 코드 1): '맞음' 으로 판정한 장면이 더 이상 안 나옴 (규칙을 고치다 맞던 장면을 잃음)
 *  - 경고: '틀림' 으로 판정한 장면이 아직 나옴 (고칠 목록) · 판정 뒤 문구가 바뀐 장면 (다시 볼 것) · 미판정 장면
 *  - 라벨 파일이 없으면 안내만 하고 통과한다
 */
require('./_env').loadEnv()
require('./_ts')
const fs = require('fs')
const path = require('path')
const { goldenScenes } = require('./_goldenScenes')

const LABELS_PATH = path.join(__dirname, '..', 'data', 'goldenLabels.json')

function main() {
  if (!fs.existsSync(LABELS_PATH)) {
    console.log('ℹ️  data/goldenLabels.json 이 없습니다 — 정답셋 라벨링 후 다시 실행하세요 (docs/GOLDEN-LABELS.md).')
    return
  }
  const { labels = {}, missed = {} } = JSON.parse(fs.readFileSync(LABELS_PATH, 'utf-8'))
  const scenes = new Map(goldenScenes().flatMap((m) => m.scenes.map((s) => [s.id, s])))

  const byKind = new Map()
  const lost = []
  const stillWrong = []
  const changed = []
  for (const [id, l] of Object.entries(labels)) {
    const k = byKind.get(l.kind) || { ok: 0, wrong: 0, unsure: 0, nowOk: 0, nowWrong: 0, now: 0 }
    k[l.verdict]++
    byKind.set(l.kind, k)
    const now = scenes.get(id)
    if (now) {
      k.now++
      if (l.verdict === 'ok') k.nowOk++
      if (l.verdict === 'wrong') k.nowWrong++
    }
    if (!now) {
      if (l.verdict === 'ok') lost.push({ id, l })
      continue
    }
    if (l.verdict === 'wrong') stillWrong.push({ id, l, now })
    if (now.fact !== l.fact) changed.push({ id, l, now })
  }
  const unlabeled = [...scenes.keys()].filter((id) => !labels[id])

  console.log(`정답셋 — 판정 ${Object.keys(labels).length}개 · 지금 장면 ${scenes.size}개 · 미판정 ${unlabeled.length}개\n`)
  // 판정 당시 = 판정한 장면 전부, 지금 코드 = 그중 지금도 나오는 장면 (규칙을 고친 효과)
  const pct = (ok, wrong) => (ok + wrong ? `${Math.round((ok / (ok + wrong)) * 100)}%` : '–')
  console.log('규칙별 정확도 (맞음 / 맞음+틀림, 애매 제외) — 판정 당시 → 지금 코드가 내는 장면')
  for (const [kind, k] of [...byKind].sort(([a], [b]) => a.localeCompare(b))) {
    const then = `${pct(k.ok, k.wrong).padStart(4)} (맞음 ${k.ok} · 틀림 ${k.wrong} · 애매 ${k.unsure})`
    const now = k.now ? `${pct(k.nowOk, k.nowWrong).padStart(4)} (맞음 ${k.nowOk} · 틀림 ${k.nowWrong}, ${k.now}개)` : '안 나옴'
    console.log(`  ${kind.padEnd(16)} ${then}  →  ${now}`)
  }

  if (stillWrong.length) {
    console.log(`\n⚠️  틀림으로 판정했는데 아직 나오는 장면 ${stillWrong.length}개 (고칠 목록)`)
    for (const { id, l } of stillWrong) console.log(`  - ${id}${l.note ? ` — ${l.note}` : ''}`)
  }
  if (changed.length) {
    console.log(`\n⚠️  판정 뒤 문구가 바뀐 장면 ${changed.length}개 (판정이 아직 맞는지 다시 볼 것)`)
    for (const { id, l, now } of changed) console.log(`  - ${id}\n      판정 때: ${l.fact}\n      지금:    ${now.fact}`)
  }
  const missedEntries = Object.entries(missed)
  if (missedEntries.length) {
    console.log(`\nℹ️  코드가 놓친 장면 메모 ${missedEntries.length}건`)
    for (const [matchId, note] of missedEntries) console.log(`  - ${matchId}: ${note}`)
  }
  if (lost.length) {
    console.error(`\n❌ 맞음으로 판정한 장면이 사라짐 ${lost.length}개 — 규칙 변경으로 맞던 장면을 잃었습니다`)
    for (const { id, l } of lost) console.error(`  - ${id}: ${l.fact}`)
    process.exitCode = 1
    return
  }
  console.log('\n✅ 맞음으로 판정한 장면이 모두 그대로 나옵니다')
}

main()

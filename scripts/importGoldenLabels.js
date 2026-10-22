/**
 * 라벨링 페이지에서 내려받은 판정 → data/goldenLabels.json
 *
 * 페이지 db 를 문서별 JSON 으로 내려받은 폴더(<dir>/labels/*.json, <dir>/missed/*.json)를 읽는다.
 * (Claude 세션에서 ArtifactData list --out_dir 로 받는다.)
 *
 * 실행: node scripts/importGoldenLabels.js <dir>
 */
const fs = require('fs')
const path = require('path')

const dir = process.argv[2]
if (!dir) {
  console.error('사용법: node scripts/importGoldenLabels.js <내려받은 폴더>')
  process.exit(1)
}
const OUT = path.join(__dirname, '..', 'data', 'goldenLabels.json')

/** 폴더의 문서 JSON 들 → [{ id, data }] (ArtifactData out_dir 형식: 문서 본문 또는 {id, data}) */
function readDocs(sub) {
  const p = path.join(dir, sub)
  if (!fs.existsSync(p)) return []
  return fs
    .readdirSync(p)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const raw = JSON.parse(fs.readFileSync(path.join(p, f), 'utf-8'))
      return raw.data && raw.id ? { id: raw.id, data: raw.data } : { id: decodeURIComponent(f.slice(0, -5)), data: raw }
    })
}

const labels = {}
for (const { id, data } of readDocs('labels')) {
  if (!['ok', 'wrong', 'unsure'].includes(data.verdict)) continue
  labels[id] = { verdict: data.verdict, note: data.note || '', kind: data.kind, fact: data.fact }
}
const missed = {}
for (const { id, data } of readDocs('missed')) if ((data.note || '').trim()) missed[id] = data.note.trim()

const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
const out = { version: 1, updatedAt: new Date().toISOString(), labels: sorted(labels), missed: sorted(missed) }
fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, 'utf-8')
console.log(`✅ ${path.relative(process.cwd(), OUT)} — 판정 ${Object.keys(labels).length}개 · 놓친 장면 메모 ${Object.keys(missed).length}개`)

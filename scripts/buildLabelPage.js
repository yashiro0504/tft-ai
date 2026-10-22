/**
 * 정답셋 라벨링 페이지 생성 — 골든셋 장면(scripts/_goldenScenes)을 scripts/labelPage.html 에 넣어 tmp/labelPage.html 로 쓴다.
 * 판정은 페이지(claude.ai 비공개 아티팩트)의 db 에 저장되고, 저장소의 data/goldenLabels.json 으로 옮긴다.
 *
 * 실행: node scripts/buildLabelPage.js  →  tmp/labelPage.html (같은 아티팩트에 다시 게시하면 판정은 유지된다)
 */
require('./_env').loadEnv()
require('./_ts')
const fs = require('fs')
const path = require('path')
const { goldenScenes } = require('./_goldenScenes')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'tmp', 'labelPage.html')

const matches = goldenScenes()
const template = fs.readFileSync(path.join(__dirname, 'labelPage.html'), 'utf-8')
// </script> 가 데이터 안에 있어도 페이지가 깨지지 않게
const json = JSON.stringify({ matches }).replace(/</g, '\\u003c')
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, template.replace('/*__DATA__*/', json), 'utf-8')
console.log(`✅ ${path.relative(ROOT, OUT)} — 경기 ${matches.length}개 · 장면 ${matches.reduce((s, m) => s + m.scenes.length, 0)}개`)

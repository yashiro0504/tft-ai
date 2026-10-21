/**
 * TFT 공식 패치 노트 수집기 → lib/patchNotes.json
 *
 * 소스: teamfighttactics.leagueoflegends.com/ko-kr/news/game-updates/ (robots.txt: Allow /)
 *  - 페이지의 __NEXT_DATA__ 안 patchNotesRichText 본문(HTML)을 읽는다.
 *  - 저장하는 것은 변경 목록(기물·특성·아이템 이름과 "항목: 이전 ⇒ 이후" 줄)뿐이다.
 *    라이엇 개발진 해설(blockquote 산문)은 저작물이므로 저장하지 않는다.
 *  - 상향/하향은 추론하지 않는다 (마나 감소는 상향, 기절 감소는 하향처럼 숫자 방향만으로는 알 수 없다).
 *  - 증강 섹션은 저장하지 않는다 (Riot 매치 데이터에 증강이 없어 경기와 연결할 수 없다).
 *
 * 사용법:
 *   node scripts/fetchPatchNotes.js              # 세트 18 패치 노트 전체
 *   node scripts/fetchPatchNotes.js --set 18
 *   node scripts/fetchPatchNotes.js --file a.html --file b.html   # 받아 둔 페이지(테스트용)
 */
const fs = require('fs')
const path = require('path')

const BASE = 'https://teamfighttactics.leagueoflegends.com'
const LIST_URL = `${BASE}/ko-kr/news/game-updates/`
const OUT = path.join(__dirname, '..', 'lib', 'patchNotes.json')

const args = process.argv.slice(2)
const argValues = (name) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []))
const SET = String(argValues('--set')[0] || process.env.SET || '18')
const FILES = argValues('--file')

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'tft-ai patch-notes collector (+https://github.com/yashiro0504/tft-ai)' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.text()
}

function nextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) throw new Error('__NEXT_DATA__ 없음')
  return JSON.parse(m[1])
}

const decode = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

/** 섹션 제목 → 대상 종류 */
function sectionKind(title) {
  if (/특성/.test(title)) return 'trait'
  if (/유닛|챔피언/.test(title)) return 'unit'
  if (/찬란한/.test(title)) return 'radiantItem'
  if (/아이템|유물/.test(title)) return 'item'
  if (/증강/.test(title)) return 'augment'
  return 'system'
}

/**
 * 패치 본문 HTML → 섹션별 변경 목록.
 * <h4>섹션</h4> [<blockquote>해설</blockquote>] <ul><li>대상<ul><li>변경 줄</li>…</ul></li>…</ul>
 * 3단 중첩(대상 → 소제목 "주문력 형태" → 변경 줄)은 "소제목 — 변경 줄"로 펼친다.
 * 해설(blockquote)과 h2 안내 문구는 건너뛴다. 대상이 없는 맨 바깥 li 는 entity '' 의 변경 줄이 된다.
 */
function parseBody(html) {
  const sections = []
  let section = null
  let inQuote = 0
  let ulDepth = 0
  let text = ''
  let entity = null // { name, lines }
  let sublabel = '' // 3단 중첩의 소제목
  let capture = null // 'h4' | 'li'
  let liDepth = 0
  const flushOuter = () => {
    if (!section || !text.trim()) return
    const t = decode(text)
    text = ''
    return t
  }
  const re = /<(\/?)(h2|h3|h4|ul|li|blockquote)\b[^>]*>|<[^>]+>|([^<]+)/g
  let m
  while ((m = re.exec(html))) {
    const [, close, tag, chunk] = m
    if (chunk !== undefined) {
      if (!inQuote && capture) text += chunk
      continue
    }
    if (!tag) continue
    if (tag === 'blockquote') {
      inQuote += close ? -1 : 1
      continue
    }
    if (inQuote) continue
    if (tag === 'h2' || tag === 'h3' || tag === 'h4') {
      if (!close) {
        capture = 'h'
        text = ''
      } else {
        const title = decode(text)
        text = ''
        capture = null
        // h4 = 변경 섹션 제목, h2/h3 = 큰 묶음(안내 문구 포함) — 새 h2 가 나오면 이전 섹션을 닫는다
        if (tag === 'h4') {
          section = { title, kind: sectionKind(title), changes: [] }
          sections.push(section)
        } else section = null
      }
      continue
    }
    if (!section) continue
    if (tag === 'ul') {
      if (!close) {
        // 대상 li 안의 ul 이 열리면, 지금까지 모은 글자가 대상 이름이다
        if (ulDepth === 1 && liDepth === 1 && capture === 'li') {
          const name = flushOuter()
          entity = { entity: (name || '').replace(/[:：]\s*$/, ''), lines: [] }
          section.changes.push(entity)
          capture = null
        } else if (ulDepth === 2 && liDepth === 2 && entity && capture === 'li') {
          sublabel = flushOuter() || ''
          capture = null
        }
        ulDepth++
      } else ulDepth--
      continue
    }
    if (tag === 'li') {
      if (!close) {
        liDepth++
        capture = 'li'
        text = ''
      } else {
        const t = flushOuter()
        if (liDepth === 3 && entity && t) entity.lines.push(sublabel ? `${sublabel} — ${t}` : t)
        else if (liDepth === 2 && entity && t) entity.lines.push(t)
        if (liDepth === 2) sublabel = ''
        else if (liDepth === 1 && t) section.changes.push({ entity: '', lines: [t] })
        if (liDepth === 1) entity = null
        liDepth--
        capture = liDepth > 0 && entity ? null : capture
      }
    }
  }
  return sections.filter((s) => s.kind !== 'augment' && s.changes.some((c) => c.lines.length))
}

function parsePage(html, url) {
  const page = nextData(html).props.pageProps.page
  const blade = (page.blades || []).find((b) => b.type === 'patchNotesRichText')
  if (!blade) throw new Error(`패치 본문 없음: ${url}`)
  const patch = (String(page.title || url).match(/(\d+)\.(\d+)/) || String(url).match(/patch-(\d+)-(\d+)/) || []).slice(1, 3).join('.')
  return {
    patch,
    url,
    publishedAt: page.displayedPublishDate || null,
    sections: parseBody(blade.richText.body),
  }
}

async function run() {
  let pages
  if (FILES.length) {
    pages = FILES.map((f) => ({ html: fs.readFileSync(f, 'utf-8'), url: f }))
  } else {
    const list = await get(LIST_URL)
    const slugs = [...new Set([...list.matchAll(/href="(\/ko-kr\/news\/game-updates\/teamfight-tactics-patch-(\d+)-\d+)\/?"/g)].filter((x) => x[2] === SET).map((x) => x[1]))]
    if (!slugs.length) throw new Error(`세트 ${SET} 패치 노트 링크를 찾지 못했습니다 (목록 구조 변경?)`)
    pages = []
    for (const slug of slugs) pages.push({ html: await get(BASE + slug), url: BASE + slug })
  }
  const fetched = pages.map(({ html, url }) => parsePage(html, url)).filter((p) => p.patch && p.publishedAt)

  // 목록 페이지는 최근 글만 보여 줄 수 있다 — 같은 세트의 기존 패치는 이번에 못 받았어도 남긴다 (덱 빌드 패치 태깅이 쓴다)
  let prev = null
  try {
    prev = JSON.parse(fs.readFileSync(OUT, 'utf-8'))
  } catch {
    /* 첫 실행 */
  }
  const byPatch = new Map()
  if (!FILES.length && prev && prev.set === Number(SET)) for (const p of prev.patches || []) byPatch.set(p.patch, p)
  for (const p of fetched) byPatch.set(p.patch, p)
  const patches = [...byPatch.values()].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))

  // 내용이 같으면 fetchedAt 도 그대로 둔다 (매일 워크플로가 빈 변경을 커밋하지 않게)
  const same = prev && prev.set === Number(SET) && JSON.stringify(prev.patches) === JSON.stringify(patches)
  const out = {
    _comment: 'TFT 공식 패치 노트의 변경 목록(사실)만 저장. 해설 산문은 저장하지 않음. scripts/fetchPatchNotes.js 로 생성.',
    source: LIST_URL,
    set: Number(SET),
    fetchedAt: same && prev.fetchedAt ? prev.fetchedAt : new Date().toISOString(),
    patches,
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf-8')
  for (const p of patches) {
    const n = p.sections.reduce((s, x) => s + x.changes.length, 0)
    console.log(`  ${p.patch} (${p.publishedAt.slice(0, 10)}) 섹션 ${p.sections.length} · 대상 ${n}`)
  }
  console.log(`✅ 패치 ${patches.length}개 → ${path.relative(process.cwd(), OUT)}`)
}

if (require.main === module)
  run().catch((e) => {
    console.error(e)
    process.exit(1)
  })

module.exports = { parseBody, parsePage, sectionKind }

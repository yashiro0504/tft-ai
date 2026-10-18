/**
 * 앱 아이콘 생성기 (PWA · favicon)
 *
 * `app/icon.svg` 를 원본으로 PNG(192/512/maskable/apple-touch)와 `app/favicon.ico` 를 만든다.
 * sharp 는 Next 의존성으로 이미 설치되어 있다.
 *
 * 사용법:
 *   node scripts/generateIcons.js
 */
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..')
const ICON_DIR = path.join(ROOT, 'public', 'icons')

/** 브랜드 타일과 같은 시안→블루 그라디언트 + 기하학적 T (폰트 의존 없음) */
const GRADIENT = `<defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#06b6d4"/>
      <stop offset="55%" stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#4338ca"/>
    </linearGradient>
  </defs>`

/** 512 기준 T 마크 (가로바 + 세로기둥, 시각적 중앙 정렬) */
const MARK = `<rect x="126" y="141" width="260" height="70" rx="20" fill="#ffffff"/>
    <rect x="221" y="141" width="70" height="230" rx="20" fill="#ffffff"/>`

function logoSvg({ size = 512, padding = 0 } = {}) {
  const inset = padding
  const inner = size - padding * 2
  const scale = inner / 512
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${GRADIENT}
  <rect width="${size}" height="${size}" rx="${Math.round(112 * scale)}" fill="url(#g)"/>
  <g transform="translate(${inset} ${inset}) scale(${scale})">
    ${MARK}
  </g>
</svg>`
}

/** maskable: 안전 영역(80%) 안에 로고를 두고 배경은 꽉 채운다 */
function maskableSvg(size = 512) {
  const inner = Math.round(size * 0.62)
  const offset = Math.round((size - inner) / 2)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${GRADIENT}
  <rect width="${size}" height="${size}" fill="url(#g)"/>
  <g transform="translate(${offset} ${offset}) scale(${inner / 512})">
    ${MARK}
  </g>
</svg>`
}

/** PNG 여러 장을 담는 ICO 컨테이너 생성 (Vista+ 는 PNG payload 지원) */
function buildIco(pngBuffers, sizes) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(pngBuffers.length, 4)

  const entries = []
  let offset = 6 + pngBuffers.length * 16
  pngBuffers.forEach((buf, i) => {
    const size = sizes[i]
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1) // height
    entry.writeUInt8(0, 2) // palette
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // color planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(buf.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += buf.length
    entries.push(entry)
  })

  return Buffer.concat([header, ...entries, ...pngBuffers])
}

async function main() {
  fs.mkdirSync(ICON_DIR, { recursive: true })

  // Next 가 /icon.svg 로 서빙하는 원본
  fs.writeFileSync(path.join(ROOT, 'app', 'icon.svg'), logoSvg({ size: 512 }), 'utf-8')

  const targets = [
    { file: 'icon-192.png', size: 192, svg: logoSvg({ size: 192 }) },
    { file: 'icon-512.png', size: 512, svg: logoSvg({ size: 512 }) },
    { file: 'icon-maskable-512.png', size: 512, svg: maskableSvg(512) },
    { file: 'apple-touch-icon.png', size: 180, svg: logoSvg({ size: 180 }) },
  ]

  for (const target of targets) {
    const png = await sharp(Buffer.from(target.svg)).png({ compressionLevel: 9 }).toBuffer()
    fs.writeFileSync(path.join(ICON_DIR, target.file), png)
    console.log(`  ${target.file} (${target.size}px, ${png.length}B)`)
  }

  // favicon.ico (16/32/48) — 브라우저 자동 요청 404 방지
  const icoSizes = [16, 32, 48]
  const icoPngs = await Promise.all(
    icoSizes.map((size) =>
      sharp(Buffer.from(logoSvg({ size }))).png({ compressionLevel: 9 }).toBuffer()
    )
  )
  const ico = buildIco(icoPngs, icoSizes)
  fs.writeFileSync(path.join(ROOT, 'app', 'favicon.ico'), ico)
  console.log(`  app/favicon.ico (${icoSizes.join('/')}, ${ico.length}B)`)

  console.log('\n✅ 아이콘 생성 완료')
}

main().catch((err) => {
  console.error(`❌ ${err.message}`)
  process.exit(1)
})

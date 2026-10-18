/**
 * 운영 설정 점검 (Go-live gate)
 *
 * 사용:
 *   node scripts/checkOps.js [URL] [--strict]
 *   npm run check:ops -- https://www.tftlab.kr --strict
 *
 * 확인 항목:
 *  - /api/health 200 및 Riot/LLM 연동
 *  - Redis(분산 캐시) 설정 여부
 *  - Turnstile 강제 여부 + 토큰 없이 검색이 403으로 막히는지
 *  - sitemap URL 수/덱 URL 존재 및 덱 페이지 200
 *
 * --strict: 하나라도 미충족이면 exit 1 (배포 전 게이트로 사용)
 */
const rawUrl =
  process.argv.find((arg) => arg.startsWith('http')) || process.env.OPS_URL || 'https://www.tftlab.kr'
const BASE = rawUrl.replace(/\/+$/, '')
const STRICT = process.argv.includes('--strict')

const failures = []
const notes = []

function pass(label) {
  console.log(`  ✅ ${label}`)
}
function fail(label) {
  failures.push(label)
  console.error(`  ❌ ${label}`)
}

async function fetchText(path, init) {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store', ...init })
  return { status: res.status, text: await res.text() }
}

async function main() {
  console.log(`\nTFT LAB 운영 점검 — ${BASE}${STRICT ? ' (strict)' : ''}\n`)

  let health
  try {
    const res = await fetchText('/api/health')
    if (res.status !== 200) throw new Error(`status ${res.status}`)
    health = JSON.parse(res.text)
  } catch (err) {
    console.error(`  ❌ /api/health 실패: ${err.message}`)
    process.exit(1)
  }

  console.log(`health: ${health.status} · env=${health.env} · uptime=${health.uptimeSec}s`)
  console.log(`cache: ${health.cache?.backend} (redisConfigured=${health.cache?.redisConfigured})`)
  console.log(
    `integrations: riot=${health.integrations?.riot} deepseek=${health.integrations?.deepseek} gemini=${health.integrations?.gemini}`
  )
  const turnstile = health.integrations?.turnstile || {}
  console.log(
    `turnstile: configured=${turnstile.configured} enforced=${turnstile.enforced} siteKey=${turnstile.siteKeyConfigured}`
  )
  console.log(`limits: ${JSON.stringify(health.limits?.perDay)} · llmBudget=${JSON.stringify(health.limits?.llmBudget)}`)

  health.status === 'ok' ? pass('health ok') : fail('health status != ok')
  health.integrations?.riot ? pass('Riot 키 설정') : fail('RIOT_API_KEY 미설정')
  health.integrations?.deepseek || health.integrations?.gemini
    ? pass('LLM 키 설정')
    : fail('LLM 키 미설정')

  if (health.cache?.redisConfigured && health.cache?.backend === 'redis+memory') {
    pass('Redis 분산 캐시 활성')
  } else {
    fail('Redis 미설정 (쿼터/예산이 인스턴스별로만 동작)')
    notes.push('Upstash Redis 생성 후 UPSTASH_REDIS_REST_URL/TOKEN 등록 → 재배포')
  }

  if (turnstile.enforced && turnstile.siteKeyConfigured) {
    pass('Turnstile 강제 + site key 설정')
  } else {
    fail('Turnstile 미설정/미강제 (검색 봇 차단 없음)')
    notes.push('Cloudflare Turnstile 사이트 추가 후 NEXT_PUBLIC_TURNSTILE_SITE_KEY/TURNSTILE_SECRET_KEY 등록 → 재배포')
  }

  // Turnstile 이 강제 중이면 토큰 없는 검색이 403 이어야 한다.
  if (turnstile.enforced) {
    try {
      const res = await fetchText('/api/tft/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameName: 'OpsCheck', tagLine: 'KR1', isDemo: true, limit: 1 }),
      })
      if (res.status === 403) pass('Turnstile: 토큰 없는 검색 403 차단')
      else fail(`Turnstile enforced 인데 토큰 없는 검색이 ${res.status} (403이어야 함)`)
    } catch (err) {
      fail(`Turnstile 차단 테스트 실패: ${err.message}`)
    }
  }

  // sitemap / deck 페이지
  try {
    const res = await fetchText('/sitemap.xml')
    const locs = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    const decks = locs.filter((loc) => loc.includes('/deck/'))
    console.log(`sitemap: ${locs.length} URLs (decks=${decks.length})`)
    locs.length > 0 ? pass('sitemap URL 존재') : fail('sitemap URL 없음')
    decks.length > 0 ? pass('sitemap 덱 URL 존재') : fail('sitemap 덱 URL 없음')

    if (decks.length > 0) {
      const deckPath = decks[0].replace(BASE, '')
      const deck = await fetchText(deckPath)
      deck.status === 200 ? pass(`덱 페이지 200 (${deckPath})`) : fail(`덱 페이지 ${deck.status}`)
    }
  } catch (err) {
    fail(`sitemap 확인 실패: ${err.message}`)
  }

  if (Array.isArray(health.warnings) && health.warnings.length > 0) {
    console.log('\nwarnings:')
    health.warnings.forEach((warning) => console.log(`  - ${warning}`))
  }

  if (notes.length > 0) {
    console.log('\n다음 조치:')
    notes.forEach((note) => console.log(`  - ${note}`))
  }

  if (failures.length > 0) {
    console.error(`\n${STRICT ? '❌' : '⚠️'} 미충족 ${failures.length}건${STRICT ? ' (strict 실패)' : ''}`)
    if (STRICT) process.exit(1)
  } else {
    console.log('\n✅ 운영 점검 통과')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

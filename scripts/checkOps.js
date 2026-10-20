/**
 * 운영 설정 점검 (Go-live gate)
 *
 * 사용:
 *   node scripts/checkOps.js [URL] [--strict] [--db]
 *   npm run check:ops -- https://www.tftlab.kr --strict --db
 *
 * 확인 항목:
 *  - /api/health 200 및 Riot/LLM 연동
 *  - Redis(분산 캐시) 설정 여부
 *  - Turnstile 강제 여부 + 토큰 없이 검색이 403으로 막히는지
 *  - sitemap URL 수/덱 URL 존재 및 덱 페이지 200
 *  - (--db) 덱 클러스터(stat_comp) 신선도: 마지막 빌드가 24시간 넘으면 미충족, 72시간 넘으면 수집 파이프라인 점검 안내
 *    NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (.env.local 도 읽음) 필요 — stat_comp 는 anon 읽기 공개.
 *    없으면 건너뛴다(CI 등).
 *
 * --strict: 하나라도 미충족이면 exit 1 (배포 전 게이트로 사용)
 */
const rawUrl =
  process.argv.find((arg) => arg.startsWith('http')) || process.env.OPS_URL || 'https://www.tftlab.kr'
const BASE = rawUrl.replace(/\/+$/, '')
const STRICT = process.argv.includes('--strict')
const DB = process.argv.includes('--db')
const HOUR = 60 * 60 * 1000

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

  if (DB) await checkDeckFreshness()

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

/** stat_comp 의 마지막 빌드 시각 (docs/DATA-PLATFORM.md §13 신선도 기준: 24시간 · 72시간) */
async function checkDeckFreshness() {
  require('./_env').loadEnv()
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    console.log('db: Supabase URL/anon 키가 없어 덱 신선도 점검을 건너뜁니다')
    return
  }
  try {
    const res = await fetch(`${url}/rest/v1/stat_comp?select=patch,tier_min,updated_at&order=updated_at.desc&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`status ${res.status}`)
    const [latest] = await res.json()
    if (!latest) {
      fail('덱 클러스터(stat_comp) 비어 있음 — npm run collect:db:rollup')
      return
    }
    const ageH = (Date.now() - Date.parse(latest.updated_at)) / HOUR
    console.log(`db: 덱 클러스터 마지막 빌드 ${latest.updated_at} (패치 ${latest.patch}, ${ageH.toFixed(1)}시간 전)`)
    if (ageH <= 24) {
      pass('덱 클러스터 24시간 이내 갱신')
      return
    }
    fail(`덱 클러스터 ${Math.floor(ageH)}시간 미갱신 (24시간 초과)`)
    notes.push('npm run collect:db:rollup 으로 덱 클러스터 수동 갱신 (tft_collect_runs.note 의 "덱 클러스터 미룸" 확인)')
    if (ageH > 72) {
      notes.push('72시간 초과: collect-db 워크플로 실패 여부 · RIOT_API_KEY 만료 · 0006 마이그레이션 적용 상태를 함께 확인')
    }
  } catch (err) {
    fail(`덱 클러스터 신선도 확인 실패: ${err.message}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

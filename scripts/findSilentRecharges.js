/**
 * 안내 없는 재생성 차감 찾기·환급 (2026-11-02 지시문 1-5).
 *
 * 경기 분석 리포트가 Redis 캐시(24시간)에서 사라진 뒤 같은 경기를 다시 열면, 새로 생성되며 다른 날짜로 한 번 더 차감됐다.
 * quota_charges(0010) 에는 (사용자, 날짜, 버킷, 멱등 키)가 남는다 — 멱등 키는 리포트 캐시 키라서,
 * **같은 멱등 키가 두 날짜 이상에 있으면** 같은 리포트를 다시 만들며 다시 차감한 건이다.
 * ("새 버전으로 다시 분석" 버튼으로 차감한 건은 멱등 키 끝에 :gen: 이 붙어 따로 센다 — 대상 아님)
 *
 * 로그인 사용자만 셀 수 있다 (비로그인은 IP 기준 Redis 카운터라 멱등 키 기록이 없다).
 *
 * 실행:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/findSilentRecharges.js            # 조회만 (기본)
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/findSilentRecharges.js --refund   # 오늘(KST) 차감분 환급
 *
 * 환급: 오늘 날짜의 재차감 건수만큼 usage_daily.used 를 줄인다 (0 아래로는 안 내려감). quota_charges 행은 남겨
 * 같은 리포트가 오늘 다시 차감되지 않게 한다. 지난 날짜는 하루 횟수가 이미 초기화돼 환급할 것이 없다 — 목록만 보여 준다.
 */
const DAYS = Number(process.env.LOOKBACK_DAYS) || 14

function kstToday() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
}

/** quota_charges 행 → 같은 멱등 키를 두 날짜 이상 차감한 건 (첫 날 이후의 차감만) */
function findRecharges(rows) {
  const byKey = new Map()
  for (const r of rows) {
    if (String(r.idem_key).includes(':gen:')) continue
    const k = `${r.user_id}|${r.bucket}|${r.idem_key}`
    const list = byKey.get(k) || []
    list.push(r)
    byKey.set(k, list)
  }
  const out = []
  for (const list of byKey.values()) {
    const days = [...new Set(list.map((r) => r.day))].sort()
    if (days.length < 2) continue
    for (const day of days.slice(1)) out.push({ user_id: list[0].user_id, bucket: list[0].bucket, idem_key: list[0].idem_key, day, firstDay: days[0] })
  }
  return out.sort((a, b) => a.day.localeCompare(b.day))
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.')
    process.exit(1)
  }
  const refund = process.argv.includes('--refund')
  const { createClient } = require('@supabase/supabase-js')
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const since = new Date(Date.now() - DAYS * 86400_000).toISOString().slice(0, 10)
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('quota_charges')
      .select('user_id, day, bucket, idem_key, created_at')
      .in('bucket', ['analysis', 'overview'])
      .gte('day', since)
      .order('created_at')
      .range(from, from + 999)
    if (error) throw new Error(`quota_charges 조회 실패: ${error.message}`)
    rows.push(...data)
    if (data.length < 1000) break
  }
  const hits = findRecharges(rows)
  const today = kstToday()
  console.log(`최근 ${DAYS}일 차감 ${rows.length}건 중 같은 리포트 재차감 ${hits.length}건 (사용자 ${new Set(hits.map((h) => h.user_id)).size}명)`)
  for (const h of hits) console.log(`- ${h.day} (처음 ${h.firstDay}) ${h.bucket} user=${h.user_id.slice(0, 8)}… ${h.idem_key.replace(/^(analysis|overview):/, '').slice(0, 60)}`)

  const todayHits = hits.filter((h) => h.day === today)
  if (!todayHits.length) {
    console.log(`오늘(${today}) 환급할 건 없음.`)
    return
  }
  if (!refund) {
    console.log(`오늘(${today}) 환급 대상 ${todayHits.length}건 — 환급하려면 --refund 로 다시 실행하세요.`)
    return
  }
  const per = new Map()
  for (const h of todayHits) per.set(`${h.user_id}|${h.bucket}`, (per.get(`${h.user_id}|${h.bucket}`) || 0) + 1)
  for (const [k, n] of per) {
    const [userId, bucket] = k.split('|')
    const { data, error } = await db.from('usage_daily').select('used').eq('user_id', userId).eq('day', today).eq('bucket', bucket).maybeSingle()
    if (error || !data) {
      console.warn(`  환급 건너뜀 user=${userId.slice(0, 8)}… (${error?.message || '사용량 행 없음'})`)
      continue
    }
    const used = Math.max(0, Number(data.used) - n)
    const upd = await db.from('usage_daily').update({ used }).eq('user_id', userId).eq('day', today).eq('bucket', bucket)
    if (upd.error) console.warn(`  환급 실패 user=${userId.slice(0, 8)}…: ${upd.error.message}`)
    else console.log(`  환급 user=${userId.slice(0, 8)}… ${bucket} ${data.used} → ${used}`)
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err)
    process.exit(1)
  })
}

module.exports = { findRecharges }

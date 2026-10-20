/**
 * 봇 게이트 쿠키(lib/botGate.ts) 테스트 (네트워크 불필요).
 *
 * 실행: node scripts/testBotGate.js
 *  - 현재 형식 ts.sig · 이전 형식 ts.ip.sig(IP 무시) 통과
 *  - 서명 위조 · 만료 · 형식 오류 · 쿠키 없음 거부
 *  - 키 미설정이면 게이트 비활성
 */
require('./_ts')
const crypto = require('crypto')
const { NextResponse } = require('next/server')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  ✅ ${label}`)
  else {
    failures++
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const SECRET = 'test-bot-gate-secret'
const sign = (payload, secret = SECRET) => crypto.createHmac('sha256', secret).update(payload).digest('base64url')
const now = Math.floor(Date.now() / 1000)

delete process.env.TURNSTILE_SECRET_KEY
delete process.env.BOT_GATE_SECRET
const gate = require('../lib/botGate')

console.log('키 미설정')
check('게이트 비활성 (disabled)', gate.botGateEnabled() === false && gate.checkBotGate(undefined) === 'disabled')

process.env.BOT_GATE_SECRET = SECRET
console.log('쿠키 검증')
check('쿠키 없음 → missing', gate.checkBotGate(undefined, now) === 'missing')
check('현재 형식 ts.sig → ok', gate.checkBotGate(`${now}.${sign(String(now))}`, now) === 'ok')
// 이전 형식 ts.ip.sig — IPv4 는 '.' 이 섞여 이전 구현(split 3조각)이 항상 거부하던 쿠키
for (const ip of ['203.0.113.7', '2001:db8::1', 'unknown']) {
  const payload = `${now - 60}.${ip}`
  check(`이전 형식 ts.ip.sig (${ip}) → ok · IP 무시`, gate.checkBotGate(`${payload}.${sign(payload)}`, now) === 'ok')
}
check('다른 키로 서명 → bad_signature', gate.checkBotGate(`${now}.${sign(String(now), 'other')}`, now) === 'bad_signature')
check('타임스탬프 변조 → bad_signature', gate.checkBotGate(`${now + 999}.${sign(String(now))}`, now) === 'bad_signature')
check('2시간 넘음 → expired', gate.checkBotGate(`${now - 7201}.${sign(String(now - 7201))}`, now) === 'expired')
check('1시간 59분 → ok', gate.checkBotGate(`${now - 7140}.${sign(String(now - 7140))}`, now) === 'ok')
check('형식 오류 → malformed', gate.checkBotGate('abc', now) === 'malformed' && gate.checkBotGate('.sig', now) === 'malformed' && gate.checkBotGate('123.', now) === 'malformed')
check('임의 조각 → bad_signature', gate.checkBotGate('a.b.c.d', now) === 'bad_signature')

console.log('발급')
const res = gate.issueBotGate(NextResponse.json({ ok: true }))
const cookie = res.cookies.get('tftlg')
check('발급 쿠키 = ts.sig · HttpOnly · Secure · 2시간', cookie && cookie.value.split('.').length === 2 && cookie.httpOnly && cookie.secure && cookie.maxAge === 7200, JSON.stringify(cookie))
check('발급한 쿠키가 검증을 통과', gate.checkBotGate(cookie && cookie.value) === 'ok')

console.log(failures ? `\n❌ 실패 ${failures}건` : '\n✅ 봇 게이트 테스트 통과')
if (failures) process.exitCode = 1

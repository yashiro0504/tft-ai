import { NextRequest, NextResponse } from 'next/server'
import { rateLimitGuard, readJson, isNextResponse } from '@/lib/apiUtils'
import { checkOwnerKey, clearOwnerCookie, hasOwnerCookie, isOwnerKeyConfigured, issueOwnerCookie } from '@/lib/ownerKey'
import { logEvent } from '@/lib/observability'

export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'no-store' }

/** 운영자 쿠키 상태 */
export async function GET(req: NextRequest) {
  return NextResponse.json({ success: true, configured: isOwnerKeyConfigured(), exempt: hasOwnerCookie(req) }, { headers })
}

/** 운영자 키 확인 → 쿼터 면제 쿠키 발급. 무차별 대입을 막으려고 IP당 분당 5회로 제한한다. */
export async function POST(req: NextRequest) {
  const limited = rateLimitGuard(req, 'owner', 5, 60_000)
  if (limited) return limited

  const raw = await readJson(req)
  if (isNextResponse(raw)) return raw

  if (!isOwnerKeyConfigured()) {
    return NextResponse.json({ success: false, error: '운영자 키가 설정되지 않았습니다 (QUOTA_EXEMPT_KEY).' }, { status: 503, headers })
  }
  const key = typeof raw.key === 'string' ? raw.key : ''
  if (!checkOwnerKey(key)) {
    logEvent('warn', 'owner_key_rejected', {})
    return NextResponse.json({ success: false, error: '키가 올바르지 않습니다.' }, { status: 401, headers })
  }
  logEvent('info', 'owner_key_accepted', {})
  return issueOwnerCookie(NextResponse.json({ success: true, exempt: true }, { headers }))
}

/** 이 브라우저의 운영자 쿠키 삭제 */
export async function DELETE() {
  return clearOwnerCookie(NextResponse.json({ success: true, exempt: false }, { headers }))
}

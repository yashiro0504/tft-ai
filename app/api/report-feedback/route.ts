import { NextRequest, NextResponse } from 'next/server'
import { isNextResponse, rateLimitGuard, readJson } from '@/lib/apiUtils'
import { parseReportFeedback, saveReportFeedback } from '@/lib/reportFeedback'
import { incrMetric } from '@/lib/observability'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

/**
 * POST /api/report-feedback — AI 리포트 👍/👎 + 한 줄 코멘트.
 * body: { visitorId, reportKey, mode, matchId?, rating: 1 | -1, comment?, patch?, snapshot? }
 * 같은 방문자가 같은 리포트에 다시 보내면 200(duplicate=true) — 화면은 이미 보낸 것으로 처리한다.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimitGuard(req, 'report-feedback', 10, 60_000)
  if (limited) return limited

  const raw = await readJson(req)
  if (isNextResponse(raw)) return raw

  const parsed = parseReportFeedback(raw)
  if ('error' in parsed) {
    return NextResponse.json({ success: false, error: parsed.error }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const result = await saveReportFeedback(parsed.value)
  if (!result.ok && result.code === 'unavailable') {
    incrMetric('report_feedback.unavailable')
    return NextResponse.json(
      { success: false, error: '지금은 피드백을 저장할 수 없습니다. 잠시 후 다시 시도해주세요.' },
      { status: 503, headers: NO_STORE_HEADERS }
    )
  }

  incrMetric(`report_feedback.${parsed.value.rating === 1 ? 'up' : 'down'}`)
  return NextResponse.json(
    { success: true, duplicate: !result.ok },
    { status: result.ok ? 201 : 200, headers: NO_STORE_HEADERS }
  )
}

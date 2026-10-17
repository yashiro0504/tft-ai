import { NextRequest, NextResponse } from 'next/server'
import { cacheBackend } from '@/lib/cache'
import { redisConfigured } from '@/lib/redisRest'
import { snapshotMetrics, uptimeSeconds } from '@/lib/observability'
import { dailyQuotaLimit } from '@/lib/quota'
import { getLlmBudgetStatus } from '@/lib/llmBudget'
import { turnstileStatus } from '@/lib/turnstile'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health
 *
 * 운영 점검용 엔드포인트. 시크릿 값은 절대 노출하지 않고 설정 여부만 반환한다.
 * HEALTH_TOKEN 이 설정되어 있으면 `x-health-token` 헤더(또는 Bearer)가 일치해야 한다.
 *
 * 주의: 카운터는 "이 인스턴스" 기준이다. 서버리스에서는 인스턴스마다 값이 다르므로
 * 전역 지표는 로그(event=api_search, llm_call, riot_call) 집계로 보는 것을 권장한다.
 */
export async function GET(req: NextRequest) {
  const token = process.env.HEALTH_TOKEN
  if (token) {
    const header = req.headers.get('x-health-token')
    const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (header !== token && bearer !== token) {
      return NextResponse.json({ status: 'unauthorized' }, { status: 401 })
    }
  }

  const warnings: string[] = []
  if (!process.env.RIOT_API_KEY) warnings.push('RIOT_API_KEY 미설정: 데모 데이터로 동작합니다.')
  if (!redisConfigured()) warnings.push('Redis 미설정: 캐시는 인스턴스 메모리(L1)만 사용합니다.')
  if (!process.env.DEEPSEEK_API_KEY && !process.env.GEMINI_API_KEY) {
    warnings.push('LLM 키 미설정: AI 코칭은 결정론적 폴백으로 응답합니다.')
  }
  if (!process.env.NEXT_PUBLIC_SITE_URL) {
    warnings.push('NEXT_PUBLIC_SITE_URL 미설정: canonical/sitemap URL이 배포 도메인과 다를 수 있습니다.')
  }
  if (!process.env.NEXT_PUBLIC_CONTACT_EMAIL) {
    warnings.push('NEXT_PUBLIC_CONTACT_EMAIL 미설정: 약관/개인정보 문의처가 플레이스홀더입니다.')
  }

  const budget = await getLlmBudgetStatus()
  const turnstile = turnstileStatus()
  if (budget.exceeded) {
    warnings.push('LLM 일일 예산 초과: AI 코칭이 결정론적 폴백으로 응답 중입니다.')
  }
  if (turnstile.enforced && !turnstile.siteKeyConfigured) {
    warnings.push('TURNSTILE_SECRET_KEY만 설정됨: 클라이언트 site key가 없어 검색이 403으로 차단됩니다.')
  }
  if (!turnstile.enforced && turnstile.siteKeyConfigured) {
    warnings.push('NEXT_PUBLIC_TURNSTILE_SITE_KEY만 설정됨: 서버 검증이 비활성입니다.')
  }
  if (process.env.NODE_ENV === 'production' && !process.env.RIOT_API_KEY) {
    warnings.push('프로덕션에 RIOT_API_KEY 미설정: 검색이 503으로 실패합니다.')
  }

  return NextResponse.json({
    status: 'ok',
    env: process.env.NODE_ENV,
    uptimeSec: uptimeSeconds(),
    cache: { backend: cacheBackend(), redisConfigured: redisConfigured() },
    integrations: {
      riot: Boolean(process.env.RIOT_API_KEY),
      deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      turnstile,
    },
    limits: {
      perDay: {
        search: dailyQuotaLimit('QUOTA_SEARCH_PER_DAY', 50),
        analysis: dailyQuotaLimit('QUOTA_ANALYSIS_PER_DAY', 10),
        overview: dailyQuotaLimit('QUOTA_OVERVIEW_PER_DAY', 10),
      },
      llmBudget: {
        enabled: budget.enabled,
        budgetUsd: budget.budgetUsd,
        spentTodayUsd: budget.spentUsd,
        exceeded: budget.exceeded,
      },
    },
    warnings,
    metrics: snapshotMetrics(),
  })
}

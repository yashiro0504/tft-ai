import type { Metadata } from 'next'
import Link from 'next/link'
import { Check, Crown, ShieldCheck, Sparkles, Zap } from 'lucide-react'
import { SimpleHeader } from '@/app/components/SimpleHeader'
import { SiteFooter } from '@/app/components/SiteFooter'
import { SITE_NAME, SITE_URL } from '@/lib/site'
import { ProWaitlistButton } from './ProWaitlistButton'

export const metadata: Metadata = {
  title: 'Pro 플랜 — 출시 알림',
  description: `${SITE_NAME} Pro 플랜(월 3,900원) 출시 알림. AI 분석 한도 확대와 Pro 배지를 준비 중입니다.`,
  alternates: { canonical: `${SITE_URL}/pro` },
  openGraph: {
    title: `${SITE_NAME} — Pro 플랜 출시 알림`,
    description: 'AI 분석 한도 확대와 Pro 배지를 준비 중입니다. 출시 전 관심을 남겨주세요.',
    url: `${SITE_URL}/pro`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: `${SITE_NAME} — Pro 플랜 출시 알림`,
    description: 'AI 분석 한도 확대와 Pro 배지를 준비 중입니다.',
  },
}

const BENEFITS = [
  {
    icon: Zap,
    title: 'AI 분석 50회/일',
    description: '무료 플랜 10회에서 5배로 확대해, 연습량이 많은 날에도 끊기지 않게 합니다.',
  },
  {
    icon: Crown,
    title: 'Pro 배지',
    description: '프로필과 계정 메뉴에 Pro 표시가 붙습니다.',
  },
  {
    icon: ShieldCheck,
    title: '우선 지원',
    description: '오류 제보와 기능 요청을 먼저 확인합니다.',
  },
]

const FAQ = [
  {
    question: '무료 플랜은 계속 쓸 수 있나요?',
    answer:
      '네. 전적 검색과 AI 분석 10회/일은 지금처럼 무료로 유지합니다. Pro는 더 많이 쓰고 싶은 분을 위한 선택지입니다.',
  },
  {
    question: '지금 결제할 수 있나요?',
    answer:
      '아니요. 이 페이지에는 결제 기능이 없습니다. 정식 출시 전까지는 가격과 혜택이 바뀔 수 있습니다.',
  },
  {
    question: '알림은 어떻게 받나요?',
    answer:
      '현재는 이메일을 수집하지 않습니다. 버튼 클릭은 관심 집계로만 사용되며, 출시 시 사이트 공지로 안내드립니다.',
  },
  {
    question: '어떤 정보를 수집하나요?',
    answer:
      'Riot ID, 이메일, 결제 정보는 받지 않습니다. 클릭 이벤트(어느 화면에서 눌렀는지, 가격대)만 개인정보 없이 집계합니다.',
  },
]

export default function ProPage() {
  return (
    <div className="min-h-screen bg-app text-ink">
      <SimpleHeader active="pro" />

      <main className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
        <div className="grid items-start gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <section>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-amber-300">
              <Sparkles className="h-3.5 w-3.5" />
              Pro waitlist
            </span>

            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
              더 깊은 분석을 위한 <span className="text-amber-300">Pro</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
              무료 플랜은 그대로. AI 분석을 더 자주 돌리고 싶은 분들을 위해 Pro 플랜을 준비하고
              있습니다. 지금은 결제 없이 관심만 모으는 단계입니다.
            </p>

            <ul className="mt-7 space-y-3">
              {BENEFITS.map((benefit) => {
                const Icon = benefit.icon
                return (
                  <li
                    key={benefit.title}
                    className="flex gap-3 rounded-xl border border-line/10 bg-panel/70 p-4"
                  >
                    <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-amber-500/10 text-amber-300">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-bold text-ink">{benefit.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted">
                        {benefit.description}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>

            <p className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed text-subtle">
              <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-400" />
              위 혜택은 출시 예정안이며, 정식 출시 전에 조정될 수 있습니다.
            </p>
          </section>

          <aside className="rounded-2xl border border-amber-400/25 bg-gradient-to-b from-amber-500/10 via-panel to-panel p-6 shadow-xl shadow-amber-950/10">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.14em] text-amber-300">
                <Crown className="h-4 w-4" />
                Pro
              </span>
              <span className="rounded-full border border-line/15 px-2 py-0.5 text-[10px] font-bold text-muted">
                준비 중
              </span>
            </div>

            <div className="mt-5 flex items-end gap-1.5">
              <span className="font-mono text-4xl font-black tracking-tight text-ink">3,900</span>
              <span className="pb-1 text-sm font-bold text-muted">원 / 월</span>
            </div>
            <p className="mt-1 text-[11px] text-subtle">
              예정 가격 · 정기결제 도입 시 변경될 수 있습니다.
            </p>

            <ul className="mt-5 space-y-2 border-t border-line/10 pt-4 text-xs text-muted">
              <li className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                AI 분석 50회/일
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                Pro 배지 · 우선 지원
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                무료 플랜은 그대로 유지
              </li>
            </ul>

            <ProWaitlistButton />

            <p className="mt-4 text-[10px] leading-relaxed text-subtle">
              이 페이지에는 결제 기능이 없습니다. 버튼을 눌러도 결제창으로 이동하지 않습니다.
            </p>
          </aside>
        </div>

        <section className="mt-12 border-t border-line/10 pt-8">
          <h2 className="text-lg font-black tracking-tight">자주 묻는 질문</h2>
          <div className="mt-4 divide-y divide-line/10 rounded-xl border border-line/10 bg-panel/50">
            {FAQ.map((item) => (
              <details key={item.question} className="group px-4 py-3">
                <summary className="cursor-pointer list-none text-sm font-bold text-ink marker:hidden">
                  <span className="flex items-center justify-between gap-3">
                    {item.question}
                    <span className="text-muted transition group-open:rotate-45">+</span>
                  </span>
                </summary>
                <p className="mt-2 text-xs leading-relaxed text-muted">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="rounded-xl border border-line/15 bg-elev/5 px-4 py-2.5 text-xs font-bold text-muted transition hover:border-cyan-400/40 hover:text-ink"
          >
            무료로 AI 코칭 받기
          </Link>
          <Link
            href="/meta"
            className="rounded-xl border border-line/15 bg-elev/5 px-4 py-2.5 text-xs font-bold text-muted transition hover:border-cyan-400/40 hover:text-ink"
          >
            메타 랭킹 보기
          </Link>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}

import Link from 'next/link'
import type { ReactNode } from 'react'
import { CONTACT_EMAIL, POLICY_EFFECTIVE_DATE, SITE_NAME } from '@/lib/site'
import { SiteFooter } from './SiteFooter'

/** 약관/개인정보처리방침 공통 레이아웃 (서버 컴포넌트) */
export function LegalPageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-app text-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-app/95 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="text-[15px] font-black tracking-tight">
            TFT <span className="text-accent">LAB</span>
            <span className="ml-2 hidden text-xs font-bold text-muted sm:inline">SET 18</span>
          </Link>
          <Link href="/" className="text-xs font-bold text-muted transition hover:text-ink">
            ← 홈으로
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-black tracking-tight">{title}</h1>
        <p className="mt-2 text-xs text-subtle">시행일: {POLICY_EFFECTIVE_DATE}</p>
        <div className="mt-8 space-y-7 text-sm leading-relaxed text-ink-soft">{children}</div>
        <p className="mt-10 rounded-card border border-line bg-sunken p-4 text-xs text-muted">
          본 문서에 대한 문의: <a className="underline hover:text-ink" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          <br />
          {SITE_NAME} is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games
          or anyone officially involved in producing or managing Riot Games properties.
          <br />
          이 서비스는 라이엇 게임즈와 제휴하거나 승인받지 않았습니다.
        </p>
      </main>

      <SiteFooter />
    </div>
  )
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-bold text-ink">{title}</h2>
      {children}
    </section>
  )
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-muted">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  )
}

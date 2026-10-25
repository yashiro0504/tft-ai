import type { Metadata } from 'next'
import Link from 'next/link'
import { SimpleHeader } from '@/app/components/SimpleHeader'
import { SiteFooter } from '@/app/components/SiteFooter'
import { OwnerKeyForm } from './OwnerKeyForm'

export const metadata: Metadata = {
  title: '운영자',
  robots: { index: false, follow: false },
}

export default function OwnerPage() {
  return (
    <div className="min-h-screen bg-app text-ink">
      <SimpleHeader active="profile" />

      <main className="mx-auto flex max-w-md flex-col px-4 py-14">
        <div className="rounded-card border border-line bg-panel p-6 shadow-card">
          <h1 className="text-xl font-black tracking-tight">운영자 키</h1>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            운영자 키를 입력하면 이 브라우저는 일일 검색·AI 분석 한도를 받지 않습니다. LLM 일일 예산은 그대로
            적용됩니다.
          </p>
          <div className="mt-5">
            <OwnerKeyForm />
          </div>
          <Link href="/owner/feedback" className="mt-5 inline-block text-xs text-muted underline hover:text-ink">
            리포트 피드백 보기 →
          </Link>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}

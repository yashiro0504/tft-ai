import type { Metadata } from 'next'
import Link from 'next/link'
import { SimpleHeader } from './components/SimpleHeader'
import { SiteFooter } from './components/SiteFooter'

export const metadata: Metadata = {
  title: '페이지를 찾을 수 없습니다',
  robots: { index: false, follow: true },
}

/** 없는 주소 · notFound() 호출 시 보여주는 404 화면 */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-app text-ink">
      <SimpleHeader />
      <main className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
        <p className="text-sm font-black text-accent">404</p>
        <h1 className="mt-2 text-2xl font-black tracking-tight">페이지를 찾을 수 없습니다</h1>
        <p className="mt-3 text-sm text-muted">
          주소가 바뀌었거나 이번 패치에서 사라진 기물·아이템·덱일 수 있습니다.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <Link
            href="/"
            className="rounded-control bg-accent px-5 py-2.5 text-sm font-bold text-on-accent transition hover:opacity-90"
          >
            홈으로
          </Link>
          <Link
            href="/meta"
            className="rounded-control border border-line px-5 py-2.5 text-sm font-bold text-muted transition hover:bg-sunken hover:text-ink"
          >
            메타 랭킹 보기
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}

'use client'

import Link from 'next/link'
import { useEffect } from 'react'

/** 페이지 렌더링 중 오류가 났을 때의 화면 (루트 레이아웃은 유지된다) */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-4 py-24 text-center">
      <p className="text-sm font-black text-accent">오류</p>
      <h1 className="mt-2 text-2xl font-black tracking-tight">일시적인 문제가 발생했습니다</h1>
      <p className="mt-3 text-sm text-muted">잠시 후 다시 시도해 주세요. 문제가 계속되면 홈에서 다시 시작해 주세요.</p>
      {error.digest && <p className="mt-2 text-xs text-subtle">오류 코드: {error.digest}</p>}
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-control bg-accent px-5 py-2.5 text-sm font-bold text-on-accent transition hover:opacity-90"
        >
          다시 시도
        </button>
        <Link
          href="/"
          className="rounded-control border border-line px-5 py-2.5 text-sm font-bold text-muted transition hover:bg-sunken hover:text-ink"
        >
          홈으로
        </Link>
      </div>
    </main>
  )
}

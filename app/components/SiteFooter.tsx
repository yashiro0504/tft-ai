import Link from 'next/link'
import { CONTACT_EMAIL, SITE_NAME } from '@/lib/site'

/** 전 페이지 공통 푸터 (약관/개인정보 링크 포함) */
export function SiteFooter() {
  return (
    <footer className="relative border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-center sm:flex-row sm:text-left">
        <p className="text-[12px] text-muted">
          <span className="font-black text-muted">{SITE_NAME}</span> · 시즌 18 메타 랭킹 &amp; AI 코치
        </p>
        <nav className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-subtle">
          <Link href="/pro" className="font-bold text-accent underline-offset-2 hover:underline">
            Pro
          </Link>
          <Link href="/terms" className="underline-offset-2 hover:text-ink hover:underline">
            이용약관
          </Link>
          <Link href="/privacy" className="underline-offset-2 hover:text-ink hover:underline">
            개인정보처리방침
          </Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline-offset-2 hover:text-ink hover:underline">
            문의
          </a>
        </nav>
        <p className="text-xs leading-relaxed text-subtle">
          데이터: Riot 실측 매치 표본 · {SITE_NAME} is not endorsed by Riot Games.
        </p>
      </div>
    </footer>
  )
}

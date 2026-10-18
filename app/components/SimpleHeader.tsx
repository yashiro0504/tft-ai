import Link from 'next/link'

/** 정책/메타/프로필 페이지용 경량 서버 헤더 */
export function SimpleHeader({ active }: { active?: 'meta' | 'profile' | 'pro' }) {
  const linkClass = (isActive: boolean) =>
    `rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
      isActive ? 'bg-elev/10 text-ink' : 'text-muted hover:bg-elev/5 hover:text-ink'
    }`

  return (
    <header className="sticky top-0 z-40 border-b border-line/10 bg-app/95 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-[15px] font-black tracking-tight">
            TFT <span className="text-cyan-400">LAB</span>
          </span>
          <span className="hidden rounded border border-line/15 px-1.5 py-0.5 text-[11px] font-bold text-muted sm:inline">
            SET 18
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link href="/meta" className={linkClass(active === 'meta')}>
            메타 랭킹
          </Link>
          <Link href="/" className={linkClass(active === 'profile')}>
            AI 코치
          </Link>
          <Link
            href="/pro"
            className={`rounded-lg px-2.5 py-1.5 text-xs font-black transition ${
              active === 'pro'
                ? 'bg-amber-500/15 text-amber-300'
                : 'text-amber-300/80 hover:bg-amber-500/10 hover:text-amber-300'
            }`}
          >
            Pro
          </Link>
        </nav>
      </div>
    </header>
  )
}

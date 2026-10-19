import Link from 'next/link'

/** 정책/메타/프로필 페이지용 경량 서버 헤더 */
export function SimpleHeader({ active }: { active?: 'meta' | 'profile' | 'pro' }) {
  const linkClass = (isActive: boolean) =>
    `rounded-control px-2.5 py-1.5 text-xs font-bold transition ${
      isActive ? 'bg-accent-bg text-accent' : 'text-muted hover:bg-sunken hover:text-ink'
    }`

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-app/95 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-[15px] font-black tracking-tight">
            TFT <span className="text-accent">LAB</span>
          </span>
          <span className="hidden rounded-chip border border-line px-1.5 py-0.5 text-xs font-bold text-muted sm:inline">
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
            className={`rounded-control px-2.5 py-1.5 text-xs font-black transition ${
              active === 'pro'
                ? 'bg-accent-bg text-accent'
                : 'text-accent hover:bg-accent-bg hover:text-accent'
            }`}
          >
            Pro
          </Link>
        </nav>
      </div>
    </header>
  )
}

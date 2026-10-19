'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BarChart3, Bot, FlaskConical, Moon, Sun } from 'lucide-react'
import { UserMenu } from './UserMenu'
import { syncThemeColor } from '@/lib/themeColor'

export type SiteTab = 'meta' | 'coach'

/** 다크/라이트 테마 토글 (localStorage 유지) */
function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')

  useEffect(() => {
    const t = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
    setTheme(t)
    // 첫 페인트 전에 적용된 실제 테마와 theme-color 를 맞춘다.
    syncThemeColor(t)
  }, [])

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    syncThemeColor(next)
    try {
      localStorage.setItem('tft-theme', next)
    } catch {
      /* localStorage 차단 환경 무시 */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? '라이트 테마로 전환' : '다크 테마로 전환'}
      title={theme === 'dark' ? '라이트 테마' : '다크 테마'}
      className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-control border border-line text-muted transition hover:bg-sunken hover:text-ink"
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  )
}

/**
 * 상단 고정 헤더 (롤체지지/tactics.tools 스타일 내비게이션)
 */
export function SiteHeader({
  active,
  onChange,
}: {
  active: SiteTab
  onChange: (tab: SiteTab) => void
}) {
  const nav: { id: SiteTab; label: string; icon: typeof BarChart3 }[] = [
    { id: 'coach', label: 'AI 코치', icon: Bot },
    { id: 'meta', label: '메타 랭킹', icon: BarChart3 },
  ]

  return (
    <header className="sticky top-0 z-40 border-b border-sunken bg-app/95 backdrop-blur-xl">
      <div
        className={`mx-auto flex h-16 items-center gap-3 px-4 sm:gap-6 sm:px-6 ${
          active === 'meta' ? 'max-w-[1440px]' : 'max-w-[1200px]'
        }`}
      >
        <button
          type="button"
          onClick={() => onChange('coach')}
          className="flex shrink-0 cursor-pointer items-center gap-2.5"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-control bg-accent">
            <FlaskConical className="h-4 w-4 text-on-accent" strokeWidth={2.4} />
          </span>
          <span className="whitespace-nowrap text-base font-bold tracking-tight text-ink">TFT LAB</span>
        </button>

        <nav aria-label="주 메뉴" className="flex items-center gap-1">
          {nav.map((item) => {
            const Icon = item.icon
            const isActive = active === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChange(item.id)}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-control px-2.5 py-2 text-sm transition sm:px-3 ${
                  isActive ? 'bg-accent-bg font-semibold text-accent' : 'font-medium text-muted hover:bg-sunken hover:text-ink'
                }`}
              >
                <Icon className="h-4 w-4 sm:hidden" aria-hidden="true" />
                <span className="hidden whitespace-nowrap sm:inline">{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/pro"
            className="hidden rounded-control px-2 py-2 text-sm font-bold text-accent transition hover:bg-accent-bg sm:inline-block"
          >
            PRO
          </Link>
          <UserMenu />
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}

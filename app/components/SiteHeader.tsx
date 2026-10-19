'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BarChart3, Bot, Moon, Sun, Trophy } from 'lucide-react'
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
      className="ml-1 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-control border border-line text-muted transition hover:bg-sunken hover:text-ink"
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
    <header className="sticky top-0 z-40 border-b border-line bg-app/95 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onChange('meta')}
          className="flex shrink-0 items-center gap-2 cursor-pointer"
        >
          <span className="w-8 h-8 rounded-control bg-accent flex items-center justify-center">
            <Trophy className="w-4 h-4 text-on-accent" />
          </span>
          <span className="font-black text-ink tracking-tight text-[15px] whitespace-nowrap">
            TFT <span className="text-accent">LAB</span>
          </span>
          <span className="hidden sm:inline text-xs font-bold text-muted border border-line rounded-chip px-1.5 py-0.5">
            SET 18
          </span>
        </button>

        <nav className="flex items-center gap-1">
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
                className={`inline-flex shrink-0 items-center gap-1.5 px-2 sm:px-3 py-2 rounded-control text-xs sm:text-xs font-bold transition border cursor-pointer ${
                  isActive
                    ? 'bg-accent-bg text-accent border-accent'
                    : 'text-muted hover:text-ink hover:bg-sunken border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="whitespace-nowrap">{item.label}</span>
              </button>
            )
          })}
          <UserMenu />
          <ThemeToggle />
          <Link
            href="/pro"
            className="ml-1 hidden rounded-control px-2 py-2 text-xs font-black text-accent transition hover:bg-accent-bg lg:inline-block"
          >
            PRO
          </Link>
          <Link
            href="/terms"
            className="ml-1 hidden rounded-control px-2 py-2 text-xs font-bold text-muted transition hover:bg-sunken hover:text-ink lg:inline-block"
          >
            약관
          </Link>
          <Link
            href="/privacy"
            className="hidden rounded-control px-2 py-2 text-xs font-bold text-muted transition hover:bg-sunken hover:text-ink lg:inline-block"
          >
            개인정보
          </Link>
        </nav>
      </div>
    </header>
  )
}

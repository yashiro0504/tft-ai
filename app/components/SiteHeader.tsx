'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BarChart3, Bot, Moon, Sun, Trophy } from 'lucide-react'

export type SiteTab = 'meta' | 'coach'

/** 다크/라이트 테마 토글 (localStorage 유지) */
function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')

  useEffect(() => {
    const t = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
    setTheme(t)
  }, [])

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
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
      className="ml-1 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-line/10 text-muted transition hover:bg-elev/5 hover:text-ink"
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
    { id: 'meta', label: '메타 랭킹', icon: BarChart3 },
    { id: 'coach', label: 'AI 코치', icon: Bot },
  ]

  return (
    <header className="sticky top-0 z-40 border-b border-line/10 bg-app/95 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onChange('meta')}
          className="flex items-center gap-2 cursor-pointer"
        >
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-600/20">
            <Trophy className="w-4 h-4 text-white" />
          </span>
          <span className="font-black text-ink tracking-tight text-[15px]">
            TFT <span className="text-cyan-400">LAB</span>
          </span>
          <span className="hidden sm:inline text-[11px] font-bold text-muted border border-line/15 rounded px-1.5 py-0.5">
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
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition border cursor-pointer ${
                  isActive
                    ? 'bg-elev/10 text-ink border-line/10 shadow-sm'
                    : 'text-muted hover:text-ink hover:bg-elev/5 border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            )
          })}
          <ThemeToggle />
          <Link
            href="/terms"
            className="ml-1 hidden rounded-lg px-2 py-2 text-[11px] font-bold text-muted transition hover:bg-elev/5 hover:text-ink lg:inline-block"
          >
            약관
          </Link>
          <Link
            href="/privacy"
            className="hidden rounded-lg px-2 py-2 text-[11px] font-bold text-muted transition hover:bg-elev/5 hover:text-ink lg:inline-block"
          >
            개인정보
          </Link>
        </nav>
      </div>
    </header>
  )
}

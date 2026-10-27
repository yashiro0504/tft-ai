'use client'

import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'

/**
 * 휴대폰(lg 미만)에서만 접어 두는 영역. lg 이상에서는 늘 펼쳐져 있고 버튼도 없다.
 * 처음 상태를 CSS(hidden lg:block)로 정해 서버 렌더와 첫 화면이 같다 (펼침 깜빡임 없음).
 */
export function MobileCollapse({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-control border border-line bg-sunken px-3 py-2.5 text-left text-sm font-semibold text-ink lg:hidden"
      >
        <span className="min-w-0 truncate">
          {open ? '접기' : '펼쳐 보기'} <span className="font-medium text-subtle">· {label}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-subtle transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      <div className={open ? 'block' : 'hidden lg:block'}>{children}</div>
    </>
  )
}

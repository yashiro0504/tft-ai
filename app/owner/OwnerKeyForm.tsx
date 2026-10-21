'use client'

import { useEffect, useState } from 'react'

type Status = { configured: boolean; exempt: boolean } | null

export function OwnerKeyForm() {
  const [status, setStatus] = useState<Status>(null)
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/owner', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setStatus({ configured: Boolean(d.configured), exempt: Boolean(d.exempt) }))
      .catch(() => setStatus({ configured: false, exempt: false }))
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) setError(data.error || '확인에 실패했습니다.')
      else {
        setKey('')
        setStatus({ configured: true, exempt: true })
      }
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true)
    await fetch('/api/owner', { method: 'DELETE' }).catch(() => null)
    setStatus((s) => (s ? { ...s, exempt: false } : s))
    setBusy(false)
  }

  if (!status) return <p className="text-xs text-subtle">확인 중…</p>

  if (!status.configured) {
    return (
      <div className="rounded-card border border-bad/30 bg-bad/10 p-4 text-xs leading-relaxed text-ink">
        운영자 키가 설정되지 않았습니다. 환경변수 <code>QUOTA_EXEMPT_KEY</code>(16자 이상)를 등록하고 다시 배포해 주세요.
      </div>
    )
  }

  if (status.exempt) {
    return (
      <div className="space-y-3">
        <p className="rounded-control border border-line bg-sunken px-3 py-2 text-xs font-bold text-ink">
          이 브라우저는 한도 면제 상태입니다.
        </p>
        <button
          type="button"
          onClick={clear}
          disabled={busy}
          className="text-xs text-muted underline hover:text-ink disabled:opacity-50"
        >
          이 브라우저에서 면제 해제
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        type="password"
        autoComplete="current-password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="운영자 키"
        className="w-full rounded-control border border-line bg-sunken px-3 py-2 text-sm text-ink outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={busy || !key}
        className="w-full rounded-control border border-accent bg-accent-bg px-3 py-2 text-xs font-bold text-accent transition disabled:opacity-50"
      >
        확인
      </button>
      {error ? <p className="text-xs text-bad">{error}</p> : null}
    </form>
  )
}

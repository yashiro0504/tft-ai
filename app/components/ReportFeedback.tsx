'use client'

import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { MetaCoachFeedback } from '@/lib/types'
import { getVisitorId } from '@/lib/analytics'

const MAX_COMMENT = 200
const STORAGE_PREFIX = 'tftlab_rf:'

/** 리포트 식별자: 단일 경기는 matchId, 종합은 총평 해시 (같은 리포트를 다시 열어도 같은 키) */
function reportKeyOf(feedback: MetaCoachFeedback, matchId?: string): string {
  if (feedback.mode === 'single' && matchId) return `match:${matchId}`
  let h = 5381
  for (const ch of feedback.overview || '') h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0
  return `${feedback.mode}:${h.toString(36)}`
}

function readSent(key: string): 1 | -1 | null {
  try {
    const v = window.localStorage.getItem(STORAGE_PREFIX + key)
    return v === '1' ? 1 : v === '-1' ? -1 : null
  } catch {
    return null
  }
}

function writeSent(key: string, rating: 1 | -1) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, String(rating))
  } catch {
    // 저장 불가(시크릿 모드 등) — 이번 화면에서만 보낸 상태로 둔다
  }
}

/** AI 리포트 하단 👍/👎 + 한 줄 코멘트. 분석 품질 개선용으로 /owner/feedback 에서 모아 본다. */
export function ReportFeedback({ feedback, matchId }: { feedback: MetaCoachFeedback; matchId?: string }) {
  const reportKey = reportKeyOf(feedback, matchId)
  const [rating, setRating] = useState<1 | -1 | null>(null)
  const [comment, setComment] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const prev = readSent(reportKey)
    setRating(prev)
    setSent(prev !== null)
  }, [reportKey])

  const submit = async () => {
    if (!rating) return
    setBusy(true)
    setError('')
    try {
      const actions = feedback.actions?.length ? feedback.actions : feedback.improvements ?? []
      const res = await fetch('/api/report-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorId: getVisitorId(),
          reportKey,
          mode: feedback.mode,
          matchId,
          rating,
          comment: comment.trim(),
          patch: feedback.provenance?.patch,
          snapshot: {
            overview: feedback.overview,
            topic: feedback.lecture?.topic,
            actions: actions.slice(0, 3),
            metaScore: feedback.metaScore,
            isFallback: feedback.isFallback,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error || '보내지 못했습니다. 잠시 후 다시 시도해주세요.')
        return
      }
      writeSent(reportKey, rating)
      setSent(true)
    } catch {
      setError('보내지 못했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <p className="text-xs text-subtle">
        {rating === 1 ? '👍' : '👎'} 피드백 고마워요. 분석 개선에 반영할게요.
      </p>
    )
  }

  const choice = (value: 1 | -1, label: string) => {
    const Icon = value === 1 ? ThumbsUp : ThumbsDown
    const active = rating === value
    return (
      <button
        type="button"
        onClick={() => setRating(value)}
        aria-pressed={active}
        aria-label={label}
        className={`flex items-center gap-1 rounded-control border px-2.5 py-1 text-xs font-semibold transition ${
          active ? 'border-accent bg-accent-bg text-accent' : 'border-line bg-sunken text-muted hover:border-accent'
        }`}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </button>
    )
  }

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-subtle">이 분석이 도움이 됐나요?</span>
        {choice(1, '도움 됨')}
        {choice(-1, '아쉬움')}
      </div>
      {rating ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={comment}
            maxLength={MAX_COMMENT}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) submit()
            }}
            placeholder={rating === 1 ? '어떤 점이 좋았나요? (선택)' : '어디가 틀렸거나 아쉬웠나요? (선택)'}
            className="min-w-0 flex-1 rounded-control border border-line bg-sunken px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="rounded-control border border-accent bg-accent-bg px-3 py-1.5 text-xs font-bold text-accent transition disabled:opacity-50"
          >
            보내기
          </button>
        </div>
      ) : null}
      {error ? <p className="text-xs text-bad">{error}</p> : null}
    </div>
  )
}

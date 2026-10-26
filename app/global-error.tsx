'use client'

import { useEffect } from 'react'

/**
 * 루트 레이아웃까지 실패했을 때의 마지막 화면.
 * 레이아웃(globals.css·폰트)이 없으므로 인라인 스타일만 쓴다.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 16px',
          textAlign: 'center',
          background: '#0E1320',
          color: '#E8ECF4',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>일시적인 문제가 발생했습니다</h1>
        <p style={{ fontSize: 14, opacity: 0.7, marginTop: 12 }}>잠시 후 다시 시도해 주세요.</p>
        {error.digest && <p style={{ fontSize: 12, opacity: 0.5, marginTop: 4 }}>오류 코드: {error.digest}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 28 }}>
          <button
            type="button"
            onClick={reset}
            style={{ padding: '10px 20px', borderRadius: 8, border: 0, fontWeight: 700, cursor: 'pointer' }}
          >
            다시 시도
          </button>
          {/* 레이아웃이 깨진 상태라 Link 대신 전체 새로고침으로 홈에 간다 */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.2)',
              color: 'inherit',
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            홈으로
          </a>
        </div>
      </body>
    </html>
  )
}

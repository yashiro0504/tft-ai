import { ImageResponse } from 'next/og'
import { calculateProfileStats } from '@/lib/profile'
import { analyzableMatches } from '@/lib/queue'
import { loadProfile } from '@/lib/profileData'
import { formatRankLabel, formatRankLp } from '@/lib/rank'
import { loadKoreanFont } from '@/lib/ogFont'

export const alt = 'TFT LAB 소환사 전적 카드'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 300

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export default async function Image({ params }: { params: Promise<{ region: string; name: string; tag: string }> }) {
  const { name, tag } = await params
  const gameName = decodeParam(name)
  const tagLine = decodeParam(tag)

  let stats: ReturnType<typeof calculateProfileStats> | null = null
  let placements: number[] = []

  try {
    const data = await loadProfile(gameName, tagLine, 5)
    stats = calculateProfileStats(
      data.matches,
      data.gameName,
      data.tagLine,
      data.summonerLevel,
      data.profileIconId,
      data.rank
    )
    placements = analyzableMatches(data.matches).map((m) => m.placement)
  } catch {
    stats = null
  }

  const displayName = stats?.gameName || gameName
  const displayTag = stats?.tagLine || tagLine
  const avg = stats ? stats.avgPlacement : '-'
  const top4 = stats ? `${stats.top4Rate}%` : '-'
  const win = stats ? `${stats.winRate}%` : '-'
  const total = stats ? stats.totalGames : 0
  const rankLabel = formatRankLabel(stats?.rank)
  const rankLp = formatRankLp(stats?.rank)

  const fontText = [
    'TFT LAB', 'SET 18', 'AI COACH', '소환사 전적', '평균 등수', '순방률', 'TOP 4', '1등', '승률',
    '최근', '경기', '기준', '전적을 불러오지 못했습니다', '위', '%', '#', '·', '—', '-',
    '아이언', '브론즈', '실버', '골드', '플래티넘', '에메랄드', '다이아몬드', '마스터', '그랜드마스터',
    '챌린저', '배치 중', 'LP', 'I', 'II', 'III', 'IV', rankLabel, rankLp,
    displayName, displayTag, String(avg), String(top4), String(win), String(total),
    ...placements.map((p) => `#${p}`),
  ].join('')

  const font = await loadKoreanFont(fontText)
  const fontFamily = font ? 'NotoKR' : 'sans-serif'

  const placementColor = (placement: number) => {
    if (placement === 1) return { bg: 'rgba(251,191,36,0.18)', border: 'rgba(251,191,36,0.55)', color: '#fbbf24' }
    if (placement <= 4) return { bg: 'rgba(52,211,153,0.14)', border: 'rgba(52,211,153,0.45)', color: '#34d399' }
    return { bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.35)', color: '#94a3b8' }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #070a12 0%, #0b1220 55%, #0d2232 100%)',
          padding: '52px 64px',
          fontFamily,
          color: '#f8fafc',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 56,
                height: 56,
                borderRadius: 16,
                background: 'linear-gradient(135deg, #06b6d4, #2563eb)',
                fontSize: 26,
                fontWeight: 700,
              }}
            >
              T
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.5 }}>TFT LAB</div>
              <div style={{ fontSize: 18, color: '#94a3b8' }}>SET 18 · AI COACH</div>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              padding: '10px 18px',
              borderRadius: 999,
              border: '1px solid rgba(34,211,238,0.45)',
              background: 'rgba(8,145,178,0.18)',
              color: '#67e8f9',
              fontSize: 20,
              fontWeight: 700,
            }}
          >
            소환사 전적
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
            <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: -2 }}>{displayName}</div>
            <div style={{ fontSize: 36, color: '#94a3b8', fontWeight: 700 }}>{`#${displayTag}`}</div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginLeft: 6,
                padding: '8px 18px',
                borderRadius: 999,
                border: '1px solid rgba(251,191,36,0.5)',
                background: 'rgba(251,191,36,0.14)',
                color: '#fbbf24',
                fontSize: 24,
                fontWeight: 700,
              }}
            >
              {`${rankLabel} · ${rankLp}`}
            </div>
          </div>
          <div style={{ display: 'flex', marginTop: 10, fontSize: 22, color: '#94a3b8' }}>
            {!stats ? '전적을 불러오지 못했습니다' : total ? `최근 ${total}경기 기준 · 평균 등수 ${avg}위` : '이번 시즌 랭크 게임이 없습니다'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 18 }}>
          {[
            { label: '평균 등수', value: `#${avg}`, color: '#fbbf24' },
            { label: '순방률 (TOP 4)', value: top4, color: '#34d399' },
            { label: '1등 승률', value: win, color: '#22d3ee' },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                padding: '20px 24px',
                borderRadius: 18,
                border: '1px solid rgba(148,163,184,0.2)',
                background: 'rgba(15,23,42,0.65)',
              }}
            >
              <div style={{ fontSize: 20, color: '#94a3b8' }}>{item.label}</div>
              <div style={{ fontSize: 44, fontWeight: 700, color: item.color }}>{item.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {placements.length > 0 ? (
              placements.map((placement, index) => {
                const theme = placementColor(placement)
                return (
                  <div
                    key={index}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 56,
                      height: 56,
                      borderRadius: 14,
                      border: `1px solid ${theme.border}`,
                      background: theme.bg,
                      color: theme.color,
                      fontSize: 22,
                      fontWeight: 700,
                    }}
                  >
                    {`#${placement}`}
                  </div>
                )
              })
            ) : (
              <div style={{ display: 'flex', fontSize: 20, color: '#64748b' }}>최근 경기 없음</div>
            )}
          </div>
          <div style={{ display: 'flex', fontSize: 20, color: '#64748b' }}>실측 매치 데이터 기반</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: font
        ? [{ name: 'NotoKR', data: font, weight: 700 as const, style: 'normal' as const }]
        : undefined,
    }
  )
}

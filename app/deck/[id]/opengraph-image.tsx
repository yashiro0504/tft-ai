import { ImageResponse } from 'next/og'
import { getDeckViews } from '@/lib/decks'
import { loadKoreanFont } from '@/lib/ogFont'

export const alt = 'TFT LAB 덱 구성 카드'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 300

const TIER_COLOR: Record<string, { bg: string; border: string; color: string }> = {
  S: { bg: 'rgba(224,177,92,0.18)', border: 'rgba(224,177,92,0.55)', color: '#e0b15c' },
  A: { bg: 'rgba(95,184,138,0.16)', border: 'rgba(95,184,138,0.5)', color: '#5fb88a' },
  B: { bg: 'rgba(148,163,184,0.14)', border: 'rgba(148,163,184,0.4)', color: '#94a3b8' },
  C: { bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.28)', color: '#94a3b8' },
  D: { bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.22)', color: '#7c8794' },
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const deck = getDeckViews().find((item) => item.id === id)

  if (!deck) {
    const font = await loadKoreanFont('TFT LAB 덱을 찾을 수 없습니다')
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0a0c0f',
            color: '#e9ecef',
            fontFamily: font ? 'NotoKR' : 'sans-serif',
            fontSize: 44,
          }}
        >
          TFT LAB — 덱을 찾을 수 없습니다
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

  const tier = (deck.tier || 'C').toUpperCase()
  const theme = TIER_COLOR[tier] || TIER_COLOR.C
  const avg = typeof deck.avgPlacement === 'number' ? deck.avgPlacement.toFixed(2) : '-'
  const top4 = typeof deck.top4Rate === 'number' ? `${Math.round(deck.top4Rate * 100)}%` : '-'
  const units = deck.units.slice(0, 8)
  const traits = deck.traits.slice(0, 4)

  const fontText = [
    'TFT LAB', 'DECK GUIDE', 'SET 18', '패치', '평균', '위', '순방', '표본', '판', '유닛', '코',
    '#', '%', '/', '·', '-',
    deck.name, tier, avg, top4, String(deck.sampleSize), String(deck.unitCost),
    ...units.map((unit) => unit.name),
    ...traits.map((trait) => `${trait.name} ${trait.count}`),
  ].join('')

  const font = await loadKoreanFont(fontText)
  const fontFamily = font ? 'NotoKR' : 'sans-serif'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #070a0f 0%, #0b1016 55%, #131a20 100%)',
          padding: '48px 56px',
          fontFamily,
          color: '#e9ecef',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 54,
                height: 54,
                borderRadius: 14,
                background: 'linear-gradient(135deg, #e0b15c, #b8892f)',
                color: '#0a0c0f',
                fontSize: 26,
                fontWeight: 700,
              }}
            >
              T
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>TFT LAB</div>
              <div style={{ fontSize: 16, color: '#8b949e' }}>SET 18 · DECK GUIDE</div>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              padding: '8px 16px',
              borderRadius: 999,
              border: '1px solid rgba(224,177,92,0.4)',
              background: 'rgba(224,177,92,0.12)',
              color: '#e0b15c',
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            {`평균 ${avg}등`}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 64,
              height: 64,
              borderRadius: 10,
              border: `1px solid ${theme.border}`,
              background: theme.bg,
              color: theme.color,
              fontSize: 34,
              fontWeight: 700,
            }}
          >
            {tier}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 54, fontWeight: 700, letterSpacing: -1.5 }}>{deck.name}</div>
            <div style={{ display: 'flex', marginTop: 6, fontSize: 20, color: '#9aa4ae' }}>
              {`TOP4 ${top4} · 표본 ${deck.sampleSize}판 · ${deck.units.length}유닛 · ${deck.unitCost}코`}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          {units.map((unit) => (
            <div
              key={`${unit.lolchessKey}-${unit.index ?? 'x'}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                width: 112,
              }}
            >
              <img
                src={unit.imgUrl}
                alt={unit.name}
                width={96}
                height={96}
                style={{ width: 96, height: 96, borderRadius: 10, objectFit: 'cover' }}
              />
              <div style={{ display: 'flex', fontSize: 15, color: '#c9d1d9' }}>{unit.name}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {traits.map((trait) => (
              <div
                key={trait.key}
                style={{
                  display: 'flex',
                  padding: '7px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(148,163,184,0.28)',
                  background: 'rgba(148,163,184,0.1)',
                  fontSize: 17,
                  color: '#c9d1d9',
                }}
              >
                {`${trait.name} ${trait.count}`}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', fontSize: 17, color: '#6e767f' }}>Riot 실측 매치 표본 기반</div>
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

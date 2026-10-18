'use client'

import { useRouter } from 'next/navigation'
import { SiteHeader } from '../components/SiteHeader'
import { MetaDashboard } from '../components/MetaDashboard'

export default function RankPage() {
  const router = useRouter()
  return (
    <>
      <SiteHeader
        active="meta"
        onChange={(tab) => router.push(tab === 'coach' ? '/?tab=coach' : '/')}
      />
      <MetaDashboard showTitle />
      <footer className="rk-footer">
        <span>출처 Riot 실측 매치 표본</span>
        <span>TFT LAB is not endorsed by Riot Games</span>
      </footer>
    </>
  )
}

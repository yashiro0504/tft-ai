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
        onChange={(tab) => router.push(tab === 'coach' ? '/' : '/?tab=meta')}
      />
      <MetaDashboard showTitle />
      <footer className="rk-footer">
        <span>출처 Riot 실측 매치 표본</span>
        <span>TFT LAB is not endorsed by Riot Games</span>
        <span>이 서비스는 라이엇 게임즈와 제휴하거나 승인받지 않았습니다.</span>
      </footer>
    </>
  )
}

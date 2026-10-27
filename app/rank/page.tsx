'use client'

import { useRouter } from 'next/navigation'
import { SiteHeader } from '../components/SiteHeader'
import { MetaDashboard } from '../components/MetaDashboard'
import { SiteFooter } from '../components/SiteFooter'

export default function RankPage() {
  const router = useRouter()
  return (
    <>
      <SiteHeader
        active="meta"
        onChange={(tab) => router.push(tab === 'coach' ? '/' : '/?tab=meta')}
      />
      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
        <MetaDashboard showTitle />
      </main>
      <SiteFooter />
    </>
  )
}

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { EntityDetail } from '@/app/components/EntityDetail'
import { getEntityPage, listEntitySlugs } from '@/lib/entityData'
import { entityMetadata } from '@/lib/entityMeta'

/** 통계는 DB 집계(10분 캐시)를 따라 10분마다 다시 만든다. JSON 에 없는 신규 시너지도 요청 시 생성된다. */
export const revalidate = 600

export function generateStaticParams() {
  return listEntitySlugs('trait').map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  return entityMetadata(await getEntityPage('trait', slug))
}

export default async function TraitPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const data = await getEntityPage('trait', slug)
  if (!data) notFound()
  return <EntityDetail data={data} />
}

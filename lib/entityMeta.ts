import type { Metadata } from 'next'
import type { EntityPageData } from './entityData'
import { ENTITY_PATH } from './entitySlug'
import { SITE_URL } from './site'

const KIND_LABEL = { champion: '기물', item: '아이템', trait: '시너지' } as const

/** 상세 페이지 title · description · canonical · OG */
export function entityMetadata(data: EntityPageData | null): Metadata {
  if (!data) return { title: '찾을 수 없습니다', robots: { index: false, follow: false } }

  const canonical = `${SITE_URL}${ENTITY_PATH[data.kind]}/${data.slug}`
  const s = data.stat
  const statText = s
    ? `평균 ${s.avgPlacement.toFixed(2)}등 · TOP4 ${Math.round(s.top4Rate * 100)}% · 표본 ${s.sampleSize.toLocaleString()}판`
    : '통계 수집 중'
  const relatedText =
    data.kind === 'champion' ? '추천 아이템(BIS)' : data.kind === 'item' ? '많이 드는 기물' : '소속 기물'
  const title = `${data.name} ${KIND_LABEL[data.kind]} 통계 — ${statText}`
  const description = `TFT 시즌 18 ${data.name} ${KIND_LABEL[data.kind]}. ${statText} (${data.filterText}). ${relatedText}과 많이 쓰는 덱을 확인하세요.`

  return {
    title,
    description,
    alternates: { canonical },
    robots: s && !s.lowSample ? undefined : { index: false, follow: true },
    openGraph: {
      title,
      description,
      url: canonical,
      type: 'article',
      siteName: 'TFT LAB',
      locale: 'ko_KR',
      images: data.img ? [{ url: data.img }] : undefined,
    },
    twitter: { card: 'summary', title, description },
  }
}

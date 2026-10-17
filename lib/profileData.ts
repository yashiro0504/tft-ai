import { cache } from 'react'
import { loadSummonerData, type LoadedSummonerData } from './tftService'

/**
 * 프로필 페이지/OG 이미지가 공유하는 로더.
 * React `cache` 로 같은 요청 안에서 generateMetadata 와 페이지가 중복 호출하지 않게 한다.
 * (Riot 응답 자체도 lib/cache.ts 의 2계층 캐시에 저장된다.)
 */
export const loadProfile = cache(
  async (name: string, tag: string, limit = 10): Promise<LoadedSummonerData> => {
    return loadSummonerData(name, tag, limit, false)
  }
)

/** URL 세그먼트 검증 (지원 지역/길이) */
export function isValidProfileParams(region: string, name: string, tag: string): boolean {
  if (region.toLowerCase() !== 'kr') return false
  if (!name || name.length > 32) return false
  if (!tag || tag.length > 10) return false
  return true
}

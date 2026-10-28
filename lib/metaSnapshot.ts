import { getMetaDeckSnapshot } from './tftStats'
import { deckReportMeta } from './deckReport'
import { errorFields, logEvent } from './observability'
import type { TftMetaResponse } from './types'

/**
 * 메타 화면(/meta 페이지 · /api/tft/meta → 홈 메타 탭 · 홈 추천 덱)의 덱을 덱 성적표와 같은 스냅샷으로 맞춘다 (서버 전용).
 * 메타 화면은 모두 이 함수 하나로 덱을 채운다 — 한쪽만 래더 JSON 을 읽어 갱신이 멈춘 것처럼 보이던 구조(2026-10-28)를 없앤다.
 * 스냅샷을 못 읽으면 래더 JSON 덱 그대로 + 실패 표시(fallbackReason) — 화면이 '같은 데이터'라고 말하지 않게.
 */
export async function withDeckSnapshot(base: TftMetaResponse): Promise<TftMetaResponse> {
  try {
    const snapshot = await getMetaDeckSnapshot()
    if (!snapshot.decks?.length) throw new Error('empty snapshot')
    // 최상위 patch 는 JSON 탭(기물·아이템 등) 것 그대로 — 덱 패치는 decksMeta.patch
    return { ...base, decks: snapshot.decks, decksMeta: deckReportMeta(snapshot) }
  } catch (err) {
    logEvent('warn', 'api_meta_snapshot_failed', errorFields(err))
    return {
      ...base,
      decksMeta: {
        source: 'json',
        updatedAt: base.deckMeta?.sourceUpdatedAt ?? base.deckMeta?.generatedAt,
        matches: base.deckMeta?.matchCount,
        fallbackReason: 'db_error',
      },
    }
  }
}


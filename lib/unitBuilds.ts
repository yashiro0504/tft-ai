import buildsData from './unitBuilds.json'
import { translateItem } from './constants'
import { byPickCount, statChampKey } from './statsShared'
import type { MetaBuildRanking } from './types'

/**
 * 기물 빌드 = 기물 1개가 아이템 3개를 함께 든 판 (메타 BIS 탭 "3개 함께").
 *
 * 기물×아이템(unit_item)은 아이템 1개 단위라 "BIS 3개를 같이 들면 몇 등인가"를 답하지 못한다.
 * 조합 종류가 많아 일별 영구 집계 대신 덱 클러스터처럼 패치 × 티어 필터 단위로 하루 1회 다시 만든다 (기간 필터 없음).
 *  - DB:   stat_unit_build (supabase/migrations/0008, 수집기 scripts/collect/builds.js)
 *  - JSON: lib/unitBuilds.json (scripts/buildUnitBuilds.js — 래더 보드, 매일 collect-ladder 워크플로)
 * 두 경로 모두 아래 행 모양이고, 기물마다 판 수 많은 세트 상위 10개(5판 이상)만 남긴다.
 */
export interface UnitBuildRow {
  /** 기물 api_id (예: TFT18_Ahri) */
  unit: string
  /** 아이템 api_id 3개 (정렬) */
  items: string[]
  games: number
  placement_sum: number
  top4: number
  wins: number
  /** 같은 집계에서 이 기물이 나온 수 (채용률 분모) */
  unit_games: number
}

const r2 = (x: number) => Math.round(x * 100) / 100
const r3 = (x: number) => Math.round(x * 1000) / 1000

/**
 * 행 → 화면 모양. 기물 키는 statChampKey 로 맞춘다 (GnarSmall·Gnar 처럼 api_id 가 달라도 같은 기물이면 합친다).
 * 채용률 분모는 합쳐진 api_id 마다 unit_games 를 한 번씩 더한다.
 */
export function toBuildRankings(rows: UnitBuildRow[]): MetaBuildRanking[] {
  const unitGames = new Map<string, Map<string, number>>()
  const acc = new Map<string, { champKey: string; itemKeys: string[]; games: number; placementSum: number; top4: number }>()
  for (const r of rows) {
    if (!r.unit || r.items?.length !== 3 || !(r.games > 0)) continue
    const champKey = statChampKey(r.unit)
    const denom = unitGames.get(champKey) ?? new Map<string, number>()
    denom.set(r.unit, r.unit_games)
    unitGames.set(champKey, denom)
    const itemKeys = [...r.items].sort()
    const key = `${champKey}|${itemKeys.join(',')}`
    const a = acc.get(key) ?? { champKey, itemKeys, games: 0, placementSum: 0, top4: 0 }
    a.games += r.games
    a.placementSum += r.placement_sum
    a.top4 += r.top4
    acc.set(key, a)
  }
  return [...acc.entries()]
    .map(([key, a]): MetaBuildRanking => {
      const denom = [...(unitGames.get(a.champKey)?.values() ?? [])].reduce((s, n) => s + n, 0)
      return {
        key,
        champKey: a.champKey,
        itemKeys: a.itemKeys,
        // itemKeys 와 같은 순서 (lib/statsShared buildCompSets 가 인덱스로 맞춘다)
        items: a.itemKeys.map((k) => {
          const t = translateItem(k)
          return { key: k, name: t.name, iconUrl: t.iconUrl }
        }),
        avgPlacement: r2(a.placementSum / a.games),
        top4Rate: r3(a.top4 / a.games),
        sampleSize: a.games,
        pickRate: denom > 0 ? r3(Math.min(1, a.games / denom)) : 0,
      }
    })
    .sort(byPickCount)
}

interface BuildsFile {
  generatedAt?: string | null
  sourceUpdatedAt?: string | null
  /** 집계에 쓴 보드의 패치별 수 (래더 보드 → 공식 패치 노트 게시 시각 기준) */
  patches?: Record<string, number>
  builds: UnitBuildRow[]
}

const file = buildsData as BuildsFile

/** JSON 폴백 빌드 (래더 보드 스냅샷). 파일이 비었으면 [] — 화면은 '3개 함께' 줄을 그리지 않는다 */
export function jsonBuildRankings(): MetaBuildRanking[] {
  return toBuildRankings(file.builds ?? [])
}

export const JSON_BUILDS_INFO = { updatedAt: file.sourceUpdatedAt ?? file.generatedAt ?? undefined, patches: file.patches ?? {} }

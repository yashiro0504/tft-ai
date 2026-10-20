# TFT LAB UI·기능 백로그 — 2026-10-20

- **기준 커밋**: `f82f37a` (`fix/review-followup2-2026-10-20`, G1~G2 포함)
- **배경**: R1~R11·F1~F6·G1~G2는 모두 **정확성·안정성·데이터·테스트·문서** 작업이다.
  사용자가 체감하는 UI/기능 개선은 아직 없다. 이 문서는 그 다음 스프린트 후보를 근거와 함께 고정한다.
  (G1~G2 완료 커밋: `41463bc`, `2bf6a0e`)
- **사용법**: §3의 "1차 스프린트"부터 Claude Code에 넘기고, U3~U6은 제품 결정 후 진행한다.

---

## 사용법 (Claude Code에 붙여넣기 — 1차 스프린트)

```text
저장소 루트에서 docs/UI-FEATURE-BACKLOG-2026-10-20.md 를 읽고,
"§3. 1차 스프린트"의 U1 → U2 → U6 순서로 구현해줘.
U3~U6 중 1차에 없는 항목은 건드리지 마.
이슈 1건 = 커밋 1개, 각 항목의 "완료 조건"을 테스트/명령 출력으로 증명해줘.
작업 브랜치: feat/ui-backlog-2026-10-20
```

---

## 1. 현재 UI 감사 (있는 것 / 없는 것)

### 잘 되어 있는 것 (유지)

- 메타 대시보드: 패치·티어·기간 필터, 표본 부족 회색, ± 표준오차, 근거 칩, DB/JSON 폴백 배지
- 상세 모달: `role="dialog"` + `aria-modal` + Escape 닫기, 엔티티 상세 페이지 링크
- 엔티티 상세: BIS·잘 쓰는 기물·소속 시너지·연관 덱, DB 덱 "DB 집계" 표시
- AI 코칭: SSE 인트로 스트리밍, 전적 갱신 버튼·쿨다운, 공유 버튼, 스켈레톤/빈 상태
- 대부분의 화면이 모바일 미디어쿼리(`max-width: 760px`)를 가짐

### 비어 있는 것 (이번 백로그 대상)

| ID | 유형 | 문제 | 근거 |
| --- | --- | --- | --- |
| **U1** | 🐞 버그 | DB 집계 덱의 "덱 페이지" 링크가 404이거나 다른 패치의 JSON 덱을 보여 준다 | `MetaDashboard.tsx:768-775`는 항상 `/deck/${id}` 링크, `app/deck/[id]/page.tsx:22-24`는 JSON 덱만 조회 |
| **U2** | UX | 필터·탭 상태가 URL에 없어 새로고침/공유/뒤로가기에서 초기화된다 | `MetaDashboard.tsx:170` `useState`, `useSearchParams`/`router` 없음 |
| **U3** | 기능 | 메타 표에 **추세/델타**가 없다. 지금은 스냅샷 한 장 | 일별 집계 테이블(`stat_*_daily`)은 있으나 `tft_stat_query`는 기간 합계만 반환 |
| **U4** | 기능 | 조건부 탐색기(`/api/tft/explore`)가 없다 (Phase C) | `docs/DATA-PLATFORM.md` Phase C, `0005`의 `unit_ids` GIN 인덱스 주석 처리 |
| **U5** | SEO/탐색 | sitemap·내부 링크가 빌드 타임 JSON 기준이라 DB-only 엔티티/덱이 노출되지 않는다 | `app/sitemap.ts:14-29`는 `getDeckViews()`/`listEntitySlugs()`(JSON)만 사용 |
| **U6** | 기능 | 내 전적(경기 카드)에서 기물/아이템을 눌러 메타 상세로 이동할 수 없다 | `MatchCard.tsx`에 `Link`/`entityHref` 없음 |

---

## 2. 항목 상세

### U1. DB 집계 덱 상세 페이지 — P0 (버그) 🐞

**문제**

R8에서 엔티티 페이지의 DB 덱 링크는 막았지만, **메타 대시보드 덱 상세 패널**은 여전히
`/deck/${deck.id}`로 링크한다. `/deck/[id]`는 `lib/decksData.json`만 조회하므로:

- DB에만 있는 덱 id → **404**
- JSON과 id가 겹치는 덱 → **다른 패치·다른 수치의 페이지** (R8과 같은 문제)

공유 버튼도 같은 URL을 공유하므로 404/불일치가 외부로 퍼진다.

**근거**

```tsx
// app/components/MetaDashboard.tsx:767-776
<Link href={`/deck/${deck.id}`} className="rk-dlink">덱 페이지</Link>
<ShareButton path={`/deck/${deck.id}`} label="공유" ... />
```

```tsx
// app/deck/[id]/page.tsx:22-24, 66-69
const getDeck = cache((id: string): DeckView | null => {
  return getDeckViews().find((deck) => deck.id === id) ?? null   // JSON만
})
...
const deck = getDeck(id)
if (!deck) notFound()
```

**설계 (택 1)**

- **A안(권장)**: `/deck/[id]`가 **JSON → DB 순으로 해석**한다.
  - `lib/decks.ts`에 `getDeckById(id, { patch?, tier? })` 추가:
    1) JSON `getDeckViews()`에서 찾고
    2) 없으면 `getDecks({ patch, tier })`(최신 패치·마스터+)에서 찾고
    3) 그래도 없으면 해당 id가 있는 (패치·티어) 조합을 `getDecks`로 순회(최신 패치부터, 최대 4티어).
  - 쿼리 파라미터 `?patch=16.20&tier=master`를 지원하고, 없으면 최신 패치·마스터+.
  - `generateMetadata`·본문이 같은 해석 함수를 쓰게 한다.
  - `revalidate = 600` 유지. DB 실패 시 JSON 폴백.
- **B안(최소)**: DB 덱은 링크/공유 버튼을 숨기고 "DB 집계" 배지만 (현재 엔티티 페이지와 동일).
  버그는 없어지지만 덱 상세 기능은 계속 없다.

**완료 조건**

- [ ] DB에만 있는 덱 id로 `/deck/<id>` 요청 시 200 + 올바른 패치/티어 수치
- [ ] JSON과 id가 겹치는 DB 덱은 `?patch=&tier=` 기준으로 정확히 표시(없으면 최신 패치)
- [ ] 없는 id는 404, `generateMetadata`도 noindex
- [ ] 메타 대시보드 링크·공유 버튼이 실제 존재하는 페이지만 가리킴
- [ ] 엔티티 페이지의 DB 덱도 (A안이면) 다시 링크 가능하게 복원
- [ ] `npm run typecheck` · `npm run build` · 관련 스모크 통과

---

### U2. 메타 필터·탭 URL 동기화 — P1 (퀵윈) 🔗

**문제**

패치·티어·기간·탭이 `useState`에만 있어 새로고침하면 기본값으로 돌아가고,
특정 필터 화면을 링크로 공유할 수 없다. 뒤로가기도 동작하지 않는다.

**근거**

```tsx
// app/components/MetaDashboard.tsx:159-174
const [tab, setTab] = useState<TabId>('decks')
const [filter, setFilter] = useState<StatFilter>(() => ({
  patch: filters?.defaults.patch ?? null,
  tier: filters?.defaults.tier ?? 'master',
  days: filters?.defaults.days ?? 7,
}))
```

**수정 지시**

1. 초기값을 `useSearchParams()`에서 읽는다. 값 검증은 기존 `parseStatFilter()` 재사용.
2. `filter`/`tab` 변경 시 `router.replace(`/meta?${qs}`, { scroll: false })`로 URL을 맞춘다.
   - 기본값과 같으면 파라미터를 생략해 URL을 깔끔하게 유지.
   - `patch=null`(최신)은 파라미터 생략.
3. `filter`를 URL에서 복원할 때 `useEffect`가 중복 fetch하지 않도록
   `loadedRef`(이미 존재)와 초기 key를 맞춘다.
4. 탭도 `?tab=champions` 형태로 공유 가능하게 한다(선택).
5. 서버 컴포넌트(`app/meta/page.tsx`)는 기존 기본 필터 SSR을 유지한다(URL은 클라이언트에서 복원).

**완료 조건**

- [ ] `/meta?patch=16.20&tier=challenger&days=3`으로 진입 시 해당 필터로 로드
- [ ] 필터 변경 후 새로고침·링크 공유·뒤로가기에서 상태 유지
- [ ] 기본값에서는 URL에 불필요한 파라미터가 없음
- [ ] 필터 변경 시 네트워크 요청이 1회만 발생(중복 fetch 없음)

---

### U3. 메타 추세·델타 (일별 집계 활용) — P1 (차별화) 📈

**문제**

지금 메타 표는 "현재 스냅샷"만 보여 준다. 어떤 기물이 뜨는지/지는지, 패치 내 변화가 보이지 않는다.
그런데 `stat_unit_daily`·`stat_item_daily`·`stat_trait_daily`에 **일별 데이터가 이미 영구 저장**되어 있다.

**설계**

1. 조회 RPC 추가: `tft_stat_trend(p_type, p_key, p_patch, p_tier_min, p_days)` →
   `(game_date, games, avg_placement, top4_rate, pick_rate)` 시계열.
   `security definer` + `stable` + `search_path` 고정, anon grant는 `tft_stat_query`와 동일.
2. API: `GET /api/tft/stats?type=unit&trend=7&key=Ahri` (또는 `includeTrend=1`로 rows에 `series` 포함).
   CDN 캐시는 기존 `STATS_CACHE_HEADERS` 재사용.
3. UI:
   - 표에 `Δ7일` 컬럼(평균등수 변화, 음수가 개선) 또는 스파크라인.
   - 상세 모달/엔티티 페이지에 7일 라인차트(간단한 SVG, 외부 라이브러리 없이).
   - 표본 부족 구간은 점선/회색 처리.
4. 성능: 기간 7일 × 키 1개라 행이 작다. 표 전체에 Δ를 넣을 때는 RPC를 **한 번에** 호출해 N+1을 피한다.

**완료 조건**

- [ ] RPC·API가 7일 시계열을 반환하고 PGlite 테스트로 SQL/JS 규칙 일치 확인
- [ ] 표 또는 상세에 Δ/스파크라인 표시, 표본 부족 처리
- [ ] 기존 `/api/tft/stats` 응답 스키마 하위 호환(필드 추가만)
- [ ] p95 < 300ms(CDN miss) 유지

---

### U4. 조건부 탐색기 `/api/tft/explore` — P2 (대형, Phase C) 🔎

**문제**

"이 기물 2개 + 이 아이템을 든 보드의 통계"를 볼 수 없다. 원본 `tft_boards.unit_ids`와
`units` 배열이 이미 있어 조건 검색이 가능하지만 GIN 인덱스가 주석 처리되어 있다.

**근거**

```sql
-- supabase/migrations/0005_tft_stats.sql:52-53
-- create index tft_boards_unit_ids_gin on public.tft_boards using gin (unit_ids);
```

**설계**

1. `create index tft_boards_unit_ids_gin on public.tft_boards using gin (unit_ids);` 활성화(0007).
2. RPC `tft_explore(p_units smallint[], p_items smallint[], p_patch, p_tier_min, p_days)`:
   - `unit_ids @> p_units`, 아이템은 `units` 배열을 펼쳐 `p_items` 포함 여부.
   - 반환: 보드 수, 평균등수, TOP4, 1등, 대표 덱/기물.
3. API + UI 필터 빌더(기물/아이템 다중 선택, 최소 표본).
4. 표본 하한·rate limit·캐시는 기존 정책 재사용.

---

### U5. sitemap·내부 링크를 DB 데이터까지 — P1 (SEO) 🧭

**문제**

`sitemap.xml`과 대시보드 내부 링크가 빌드 타임 JSON만 사용한다.
DB 집계에만 있는 신규 기물·시너지·덱은 검색 노출과 내부 탐색에서 빠진다.

**근거**

```ts
// app/sitemap.ts:14-29
getDeckViews().map(...)               // JSON 덱만
listEntitySlugs(kind)                 // JSON 스냅샷만
```

**수정 지시**

- sitemap을 `revalidate` 가능한 라우트(`app/sitemap.ts`는 빌드 타임)로 두되,
  DB가 설정된 경우 `getDecks`/`getStats`(최신 패치)로 엔티티·덱 slug를 합집합으로 만든다.
  DB 실패 시 기존 JSON으로 폴백.
- U1(A안) 완료 후 DB 덱 URL도 sitemap에 포함.
- `MatchCard`의 **기물**(`unit.id` 보유)에 `entityHref('champion', unit.id)` 링크를 추가한다.
  아이템·시너지는 한글 이름만 있어 바로 슬러그를 만들 수 없다 → U6의 이름→키 리졸버가 준비된 뒤 확장.
- `robots`는 표본 부족 페이지 noindex 정책 유지.

**완료 조건**

- [ ] sitemap에 DB-only 엔티티/덱이 포함되고, DB 장애 시 JSON 폴백
- [ ] 경기 카드에서 기물 → 상세 페이지 이동
- [ ] 순환 링크/중복 URL 없음, 404 링크 없음

---

### U6. 경기 카드 ↔ 메타 상세 연결 — P2 (작은 기능) 🔗

**문제**

내 전적에서 본 기물/아이템을 메타 페이지에서 다시 찾아가야 한다. 경기 카드에는 링크가 없다.

**데이터 구조 제약**

- 기물: `SlimMatchUnit.id`(예: `DA_18_Ahri`)가 있어 `entityHref('champion', unit.id)`로 바로 링크 가능.
- 아이템: `SlimMatchUnit.items`가 **한글 이름 배열**이라 슬러그를 바로 만들 수 없다.
- 시너지: `SlimMatchTrait.name`도 한글 이름만 있다.

**수정 지시 (1차: 기물만)**

- `MatchCard`의 기물 아이콘/이름을 `/champions/[slug]` 링크로 감싼다(`entityHref('champion', unit.id)`).
- 링크 클릭이 카드 펼침/선택 동작과 충돌하지 않게 `stopPropagation`.
- 모바일에서 탭 영역이 너무 작아지지 않게 아이콘 단위로만 링크하고 `aria-label`을 붙인다.

**(선택) 2차: 아이템·시너지까지**

- `lib/entityLookup.ts` 같은 이름→키 리졸버를 만든다(`lib/tftData.json`의 `itemMap`/`traitMap`을 역인덱싱).
- 동명 아이템/시너지(예: 상징·변형) 충돌 시 **링크하지 않는다**(모호성 우선).
- `scripts/testRollup.js` 또는 새 테스트에 리졸버 케이스를 추가한다.

**완료 조건**

- [ ] 경기 카드에서 기물 → `/champions/[slug]` 이동
- [ ] 카드 펼침/접힘 동작 회귀 없음
- [ ] 키보드 포커스·`aria-label` 확인
- [ ] (2차 시) 아이템·시너지 링크가 모호한 이름은 생략

---

## 3. 1차 스프린트 (권장)

**목표**: "지금 화면에서 실제로 불편한 것"을 먼저 없앤다. **U1 → U2 → U6**.

> 실행용 상세 지시서: **`docs/UI-SPRINT1-2026-10-20.md`** (S1~S3, 커밋 계획·검증·결정 필요 지점 포함)

| 순서 | 항목 | 이유 | 예상 규모 |
| --- | --- | --- | --- |
| 1 | **U1** DB 덱 페이지 | 404/다른 패치 링크는 명백한 버그. 공유 URL 신뢰도 직결 | M |
| 2 | **U2** 필터 URL 동기화 | 새로고침·공유·뒤로가기. 작은 변경으로 체감 큼 | S |
| 3 | **U6** 경기 카드 링크 | 개인 전적 → 메타 상세로 자연스러운 탐색 | S |

**2차 스프린트 후보**: U3(추세) → U5(SEO) → U4(탐색기).
U3는 데이터가 이미 있어 차별화가 크고, U4는 Riot 원본·GIN 인덱스가 필요해 가장 크다.

### 1차 스프린트 검증

```powershell
npm run typecheck
npm run test:collect
npm run test:rollup
npm run lint
npm run build

# 라이브
npm run start -- -p 3100
# - DB 덱 링크 200 / 없는 id 404
# - /meta?patch=..&tier=..&days=.. 새로고침 유지
# - 경기 카드 기물 클릭 → /champions/...
```

---

## 4. 결정이 필요한 지점

- **U1 A안 vs B안**: DB 덱 상세 페이지를 만들지(A), 링크를 숨길지(B). A안은 `stat_comp` 조회가 추가되지만 기능 가치가 큼.
- **U1의 patch/tier 기본값**: id가 여러 패치/티어에 존재할 수 있어 `?patch=&tier=`를 canonical로 둘지 결정 필요.
- **U3 노출 범위**: 표 전체 Δ vs 상세 모달만. 표 전체는 RPC 응답 크기·p95 영향을 확인해야 함.
- **U4 범위**: Phase C 전체(API+UI+인덱스) vs 읽기 전용 탐색기만 먼저.
- **U5 sitemap**: DB 장애 시 빌드가 실패하지 않도록 `try/catch` + JSON 폴백 필수.

---

## 5. 완료 후 문서 갱신

- 이 문서 §1 표의 U1/U2/U6 상태를 `[x]` + 커밋 hash로 바꾼다.
- 완료 스냅샷(테스트/라이브 결과)을 §3 아래에 추가한다.
- G1~G2는 이미 완료됐다(`41463bc`, `2bf6a0e`, 문서 `f82f37a`). U1은 `stat_comp` **읽기**만 추가하므로
  용량 가드(G1)·신선도 판정(G2)과 독립이다. 그래도 배포 전 `npm run test:ops`와 `test:collect`를 함께 실행한다.
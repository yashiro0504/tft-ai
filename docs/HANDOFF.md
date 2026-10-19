# TFT LAB 개발 핸드오프 (WorkBody AI용)

최종 갱신: 2026-10-18 · 기준 브랜치: `feat/p3-gate` (P0-1~3 · P1-4~5 · P2-6~7 · P3 게이트 집계 준비 완료) · 라이브: https://www.tftlab.kr

이 문서는 **다른 개발 에이전트가 이 저장소를 이어받아 작업**할 수 있도록 현재 상태,
아키텍처, 우선순위, 금지사항, 검증 절차를 정리한 것입니다. 먼저 이 문서 →
`docs/P0-OPERATIONS.md` → `docs/supabase-auth.md` → `docs/DATA_PIPELINE.md` →
`docs/P3-GATE.md` 순으로 읽으세요.

---

## 0. 워크스페이스 / 저장소

| 항목 | 값 |
| --- | --- |
| 로컬 경로 | `C:\Users\Richard\AppData\Local\Cline\tft-ai` |
| GitHub | https://github.com/yashiro0504/tft-ai |
| 기본 브랜치 | `main` |
| Node / npm | 22.14.0 / 10.9.2 |
| 스택 | Next.js 15.5 · React 19 · TypeScript · Tailwind 3.4 |
| 배포 | Vercel (Production = www.tftlab.kr) |
| DB/인증 | Supabase (코드 준비 완료, **Vercel env 미등록 상태**) |
| 계측 | 자체 이벤트 수집 (`POST /api/events`) — Supabase `events` 테이블(0002) 또는 구조화 로그 |
| 캐시 | Upstash Redis + 인메모리 L1 |
| 봇 차단 | Cloudflare Turnstile (검색에만 적용) |

### 민감정보
- `.env.local` 은 gitignore 대상이며 **절대 커밋 금지**.
- Vercel/GitHub/Cloudflare/Upstash/Supabase 키는 금고 또는 각 콘솔에만 존재.
- Riot 개발 키는 **24시간마다 만료**되며, 매일 10:00 KST 자동 교체 루틴이 Vercel + GitHub secret을 갱신 중.

---

## 1. 로컬 실행 / 검증

```powershell
cd C:\Users\Richard\AppData\Local\Cline\tft-ai
npm ci
npm run dev            # http://localhost:3000 (Turnstile/Redis 미설정이면 자동 비활성)

npm run typecheck
npx eslint <변경 파일>  # 전체 lint 는 느림(1~2분)
npm run build

npm run meta:check     # metaStats.json 무결성
npm run decks:check    # decksData.json 무결성
npm run test:augment   # 증강 집계 회귀 테스트
npm run check:ops -- https://www.tftlab.kr --strict   # 배포 후 운영 게이트
```

- `.env.local` 에는 `RIOT_API_KEY`, `RIOT_REGION`, `DEEPSEEK_API_KEY`, `SEEDS` 등이 있다.
- 로컬 키는 만료됐을 수 있다(401). 그 경우 Riot 관련 검증은 생략하고, 배포 후 `check:ops`로 확인.
- Windows에서 `@next/swc-win32-x64-msvc` 경고가 나오지만 WASM 폴백으로 빌드는 성공한다(기존 환경 이슈).

---

## 2. 절대 지켜야 할 것 (하드 룰)

1. **비밀키 커밋 금지**. 문서에도 실제 키/토큰을 쓰지 말 것.
2. **Riot 키 교체 루틴을 깨지 말 것** — GitHub secret `RIOT_API_KEY`와 Vercel env를 함께 갱신한다.
3. **Turnstile·쿼터·LLM 예산 가드를 우회/제거하지 말 것**.
   - 검색: Turnstile + IP/계정 쿼터
   - 분석/종합: IP/계정 쿼터 + 일일 LLM 예산
4. **덱 데이터 교체 시 반드시** `npm run build:decks` → `npm run decks:check` → `npm run build`.
5. **UI 토큰/디자인을 바꾸면** `/`, `/rank`, `/meta`, `/deck/[id]`, `/profile/...`, `/pro` 를 모두 확인.
6. **main 직접 push 지양**. 브랜치 → PR → CI 통과 → 머지.
7. **Riot 정책**: 공식 제품으로 오인시키는 표현·로고 금지, "not endorsed by Riot Games" 고지 유지.

## 3. 아키텍처 / 데이터 흐름

```
[Riot API]
   │  GitHub Actions: collect-ladder.yml (매일 06:00 KST)
   ▼
lib/metaStats.json  ──►  scripts/buildDeckCompsFromStats.js  ──►  lib/decksData.json
   │                         (championTraits.json 참조)              │
   └──────────────► lib/metaPayload.ts (API/페이지 공용 빌더) ◄──────┘
                              │
                ┌─────────────┴──────────────┐
                ▼                            ▼
        /api/tft/meta                 /meta (ISR 5분, 덱만 SSR)
                │                            │
                └────────► MetaDashboard ◄───┘
                                │
                       /deck/[id] (SSG 24개)
```

- **수집**: `.github/workflows/collect-ladder.yml` → `metaStats.json` 갱신 → 덱 재생성 → 두 파일 커밋 → Vercel 재배포.
- **캐시**: `lib/cache.ts` L1 메모리 + Upstash Redis REST(선택, fail-open). Riot account 24h / matchIds 45s / match 상세 30d.
- **쿼터**: `lib/quota.ts`(IP, Redis) + `lib/userQuota.ts`(로그인, Supabase RPC). Supabase 미설정/오류 시 IP로 폴백.
- **LLM 예산**: `lib/llmBudget.ts` — 일일 상한 초과 시 결정론적 폴백(`isFallback: true`).
- **Turnstile**: `lib/turnstile.ts` — 검색 라우트만. Cloudflare 장애 시 fail-open.

### 라우트

| 경로 | 렌더 | 설명 |
| --- | --- | --- |
| `/` | Client | 메타 탭 + AI 코치 탭(검색/분석) |
| `/rank` | Client | 메타 대시보드 단독 (canonical root) |
| `/meta` | ISR 5분 | 덱만 SSR, 다른 탭은 첫 전환 시 lazy fetch |
| `/profile/[region]/[name]/[tag]` | ISR 2분 | 소환사 전적 + OG 이미지 |
| `/deck/[id]` | SSG 24개 + ISR 5분 | 덱 공유 페이지 + OG 이미지 |
| `/login` | Dynamic | Discord 로그인 (Supabase 미설정 시 안내) |
| `/auth/callback` | Dynamic | Supabase OAuth 콜백 |
| `/api/tft/search` | Dynamic | Riot 검색 (Turnstile·쿼터) |
| `/api/tft/match` | Dynamic | 경기 1건 AI 분석 (쿼터·LLM) |
| `/api/tft/match/stream` | Dynamic | 경기 1건 AI 분석 SSE (stage → result, TTFB 즉시) |
| `/api/tft/overview` | Dynamic | 종합 분석 (쿼터·LLM) |
| `/api/tft/meta` | Dynamic | 메타 전체 payload (CDN 캐시 헤더) |
| `/api/me` | Dynamic | 로그인 사용자·플랜·사용량 |
| `/api/events` | Dynamic | 제품 이벤트 수집 (204, no-store, rate limit) |
| `/api/health` | Dynamic | 운영 상태 |
| `/robots.txt`, `/sitemap.xml` | Static | sitemap에 덱 24개 포함 |

### 핵심 파일

| 파일 | 역할 |
| --- | --- |
| `app/page.tsx` | 메인(메타/코치 탭), 검색·Turnstile·공유 |
| `app/components/MetaDashboard.tsx` | 5탭 대시보드, 필터, 모바일 바텀시트 |
| `app/components/MetaDetailModal.tsx` | 기물/아이템/시너지 상세 모달 |
| `app/components/MetaRanking.tsx` | 기존 계약 유지용 래퍼 |
| `app/components/MatchCard.tsx` | 경기 카드 + 경기별 AI 분석 |
| `app/components/FeedbackReport.tsx` | AI 리포트 렌더 |
| `app/deck/[id]/page.tsx` | 덱 공유 페이지 (보드/구성/유닛/시너지) |
| `app/profile/.../page.tsx` | 소환사 전적 SSR |
| `lib/metaPayload.ts` | `/api/tft/meta` + `/meta` 공용 빌더 |
| `lib/metaSlim.ts` | `/meta` 초기 payload 슬림화 |
| `lib/decks.ts` | 덱 데이터 정규화/통계 계산 |
| `lib/traitBreakpoints.json` | 세트 18 시너지 발동 단위(breakpoint) — 덱 생성·검증 공용 |
| `scripts/buildTraitBreakpoints.js` | breakpoint 생성기 (Community Dragon) |
| `lib/rank.ts` | 티어 표시 포맷/색상 헬퍼 (순수 함수) |
| `app/components/RankBadge.tsx` | 티어·LP·승패·승률 배지 (홈 카드 + 프로필 공용) |
| `lib/favorites.ts` | 즐겨찾기 검증/CRUD (Supabase RLS 기반, 최대 20개) |
| `lib/recentSearches.ts` | 비로그인 최근 검색 5개 (localStorage + 갱신 이벤트) |
| `app/components/SavedSearches.tsx` | 검색창 아래 최근 검색/즐겨찾기 칩 |
| `app/api/favorites/route.ts` | 즐겨찾기 GET/POST/DELETE (로그인 필요) |
| `lib/supabase/*` | 서버/브라우저 클라이언트, 세션 |
| `lib/userQuota.ts` | 로그인 사용자 RPC 쿼터 |
| `lib/turnstile.ts` | 검색 봇 차단 |
| `lib/llm.ts` | DeepSeek/Gemini + 프롬프트 + 예산 가드 |
| `lib/matchAnalysis.ts` | 경기 1건 분석 파이프라인 (JSON·SSE 공용, 캐시 포함) |
| `lib/analysisStream.ts` | SSE 파서 + JSON 폴백 (`analyzeMatchStream`/`analyzeMatchJson`) |
| `lib/eventSchema.ts` | 이벤트 이름 허용 목록 + PII 정제 규칙 (클라·서버 공용) |
| `lib/analytics.ts` | 클라이언트 `track()` / `trackOnce()` (sessionStorage UUID, keepalive) |
| `lib/events.ts` | 서버 이벤트 저장 (Supabase insert → 실패 시 구조화 로그) |
| `app/api/events/route.ts` | 이벤트 수집 API (204, no-store, IP 레이트리밋) |
| `middleware.ts` | Supabase 세션 쿠키 갱신 |
| `supabase/migrations/0001_auth_quota.sql` | profiles/usage_daily/RLS/RPC |
| `supabase/migrations/0002_events.sql` | events 테이블 (insert-only RLS) |
| `supabase/migrations/0003_favorites.sql` | favorites 테이블 (본인만 CRUD, 중복 방지) |
| `supabase/migrations/0004_events_visitor.sql` | events.visitor_id (익명 방문자, D7 리텐션용) |
| `supabase/queries/p3_gate.sql` | P3 게이트 집계 SQL (DAU·퍼널·Pro 의향·D1/D7) |
| `docs/P3-GATE.md` | P3 게이트 지표 정의·표본 기준·판정 절차 |

### 완료된 상태 (요약)

- 메타 5탭 대시보드(덱/BIS/기물/시너지/아이템), 상대 티어, 아이템 분류 필터, 상세 모달
- 모바일 바텀시트, 360px 표 열 정리, 라이트 테마 토큰 보정
- `/meta` SSR 733KB → 218KB (gzip 70KB → 22KB)
- `/profile` SSR + OG, `/deck` SSG 24개 + OG
- 외부 롤체지지 추천 덱 제거 → Riot 표본 자체 집계 (`riot-meta-aggregate`)
- Turnstile·Redis·LLM 예산·일일 쿼터, `/api/health`
- Discord 로그인·플랜·사용자 쿼터 코드 완료 (Supabase env 미등록)
- CI: lint/typecheck/meta/decks/build + **SSR 스모크**
- 매일 10:30 KST `Ops Check` 워크플로우 (Riot 키 만료 + strict 점검)
- **P0-1 제품 이벤트 계측 완료**: `/api/events`(204·no-store·IP 레이트리밋), 이벤트 9종 화이트리스트,
  `events` 테이블 마이그레이션(insert-only RLS), Supabase 미설정 시 구조화 로그, `track()`/`trackOnce()`,
  개인정보처리방침에 수집 항목·보관 기간(90일) 반영
- **P0-2 랭크/티어 표시 완료**: `TFT-LEAGUE-V1` 연동(10분 캐시, 실패 시 null 폴백), 홈 프로필 카드·
  `/profile`·OG 이미지에 티어/LP/승패 표시, 배치 중은 “배치 중”
- **P0-3 즐겨찾기/최근 검색 완료**: `favorites` 테이블(본인만 CRUD·중복 방지), `/api/favorites`,
  비로그인 최근 검색 5개(localStorage), 검색창 아래 칩 UI
- **P1-4 AI 분석 스트리밍 완료**: `/api/tft/match/stream`(SSE stage→result), 첫 응답 39ms(기존 8.7s),
  JSON 폴백 유지, `eval:reports` 신뢰성 게이트 통과
- **P1-5 덱 구성 품질 완료**: `traitBreakpoints.json`(35종) + breakpoint 인지 그리디로 덱 재생성,
  미발동 시너지 8 → **0**, `decks:check` 에 breakpoint·정합성 검사 추가

## 4. 개발 우선순위 (이 순서대로)

> 전제: **결제/구독 UI는 아직 만들지 않는다.** 계정·쿼터 배관은 유지하되, 유료화는 아래 게이트 통과 후.
> 제품의 현재 약점은 기능 수가 아니라 **재방문 이유 부재**와 **첫 경험 마찰**이다.

### P0-1. 이벤트 계측 (0.5~1일) — ✅ 완료 (2026-10-18)

- 목표: 검색 → 분석 → 공유/로그인 전환과 이탈 지점을 숫자로 본다.
- 구현 (완료)
  - `POST /api/events` (rate limit 120/분/IP, Turnstile 불필요, `no-store`, 성공 시 **204**)
  - 이벤트 9종: `search_submit`, `search_success`, `analysis_click`, `analysis_success`, `tab_view`,
    `deck_open`, `share_click`, `login_click`, `pro_waitlist_click`
  - payload: `{ name, sessionId, visitorId, props, route }` — **Riot ID/이메일/PUUID 등 PII 미수집**
    (`lib/eventSchema.ts` 가 키 이름 + 값 패턴을 이중 차단, 서버에서 재정제)
    - `visitorId` 는 localStorage 익명 UUID (P3 D7 리텐션 집계용). 구버전은 서버가 `sessionId` 로 폴백.
  - 저장: Supabase 설정 시 `events` 테이블(`0002_events.sql` + `0004_events_visitor.sql`, insert-only RLS),
    미설정 시 구조화 로그(`analytics_event`)
  - 클라이언트: `lib/analytics.ts` 의 `track()` / `trackOnce()` (sessionStorage 세션 + localStorage 방문자 ID, `keepalive`)
- 배선 위치
  | 이벤트 | 위치 |
  | --- | --- |
  | `search_submit` / `search_success` | `app/page.tsx` |
  | `analysis_click` / `analysis_success` | `app/page.tsx`(종합), `app/components/MatchCard.tsx`(경기별) |
  | `tab_view` | `app/page.tsx`(홈), `app/components/MetaDashboard.tsx`(메타 5탭) |
  | `deck_open` | `app/components/DeckViewTracker.tsx`(덱 페이지), `MetaDashboard`(덱 카드 링크) |
  | `share_click` | `app/components/ShareButton.tsx` (surface: coach_result/deck_page/meta_deck_row) |
  | `login_click` | `app/components/UserMenu.tsx` |
  | `pro_waitlist_click` | `app/pro/ProWaitlistButton.tsx` (surface: `pro_page`) |
- 완료 조건 충족
  - `/api/events` 204 · 이벤트가 로그/Supabase에 남음 (로컬 검증 완료)
  - `npm run build` + typecheck/eslint 통과, 개인정보처리방침에 수집 항목·보관 기간 추가
- 남은 운영 작업: Supabase 프로젝트 생성 후 `0002_events.sql` → `0004_events_visitor.sql` 실행 →
  Vercel env 등록 시 자동으로 DB 저장으로 전환

### P0-2. 랭크/티어 표시 (1~2일) — ✅ 완료 (2026-10-18)

- 목표: “내 위치”를 보여줘 재방문 이유를 만든다.
- 구현 (완료)
  - `lib/riot.ts` 에 `getTftLeagueByPuuid(puuid, platform)` 추가
    - `GET https://{platform}.api.riotgames.com/tft/league/v1/by-puuid/{puuid}`
    - 응답 배열에서 `queueType === 'RANKED_TFT'` 선택 → `TftRankInfo` 로 정규화
    - **404(배치 중)/429/401/네트워크 오류는 모두 `null` 폴백** (앱이 깨지지 않는다)
  - 캐시 `rank:{platform}:{puuid}` TTL **10분**(`CACHE_TTL.RANK`). 배치 중(`null`)도 캐시해
    미배치 계정이 매 검색마다 Riot 을 호출하지 않는다.
  - `lib/tftService.ts` — matchIds 와 **병렬 조회**(지연 증가 없음), `LoadedSummonerData.rank` 추가
  - `/api/tft/search` 응답의 `summonerProfile.rank` 로 노출 (`calculateProfileStats` 6번째 인자)
  - UI: `app/components/RankBadge.tsx` (티어 색상·LP·승패·승률) → 홈 프로필 카드 + `/profile` 페이지
  - `/profile` metadata description 에 티어/LP 포함, 프로필 OG 이미지에 티어 칩 추가
  - `lib/rank.ts` — 표시 포맷/티어 색상 헬퍼 (서버·클라이언트 공용, 순수 함수)
- 완료 조건 충족
  - 랭크 표시 ✅ (데모/실계정 경로 동일 코드), 10분 캐시 ✅, 429/404 시 null 폴백 ✅
  - `TFT-LEAGUE-V1` 사용은 이미 Riot 신청서에 명시됨
- 남은 확인: **실제 Riot 키로 실계정 티어 표시 확인** (로컬 키 만료로 배포 후 확인 필요)

### P0-3. 즐겨찾기 + 최근 검색 (1일) — ✅ 완료 (2026-10-18)

- 목표: 매번 Riot ID를 입력하지 않게 한다.
- 구현 (완료)
  - 마이그레이션 `0003_favorites.sql`: `favorites(user_id, region, game_name, tag_line, created_at)`
    + RLS(본인만 SELECT/INSERT/DELETE, UPDATE 정책 없음)
    + 유니크 인덱스 `(user_id, region, lower(game_name), upper(tag_line))` → **중복 방지**
    + `anon` 권한 회수, `authenticated` 에 select/insert/delete 만 부여
  - `/api/favorites` GET/POST/DELETE (로그인 필요, IP 60회/분 레이트리밋)
    - GET: 최신순 최대 20개. 미설정 시 200 + `configured:false` + 빈 목록(익명 모드)
    - POST: `{gameName, tagLine, region?}` — 이미 있으면 200(`created:false`), 20개 초과 409
    - DELETE: `?gameName=&tagLine=&region=` — 없으면 200(`removed:false`)
    - 인증은 `getAuthUser()` + anon key + RLS. **service role key 미사용**
  - 비로그인: `lib/recentSearches.ts` — localStorage 최근 5개(중복 시 맨 앞으로), × 삭제,
    `RECENT_UPDATED_EVENT` 로 컴포넌트 간 동기화
  - UI: `app/components/SavedSearches.tsx` — 검색창 아래 “최근 검색 / 즐겨찾기” 칩
    (최근 칩 ☆ 로 즐겨찾기 추가, 즐겨찾기 칩 ★ 로 해제, 클릭 시 즉시 재검색)
  - 개인정보처리방침: 즐겨찾기·최근 검색 수집 항목/보관 기간/로컬 저장소 고지 추가
- 완료 조건 충족
  - 비로그인 최근 검색 5개 ✅ (브라우저 검증), 로그인 즐겨찾기 CRUD ✅ (코드·API 계약),
    중복 방지 ✅ (유니크 인덱스 + 앱 레벨 사전 확인), 삭제 ✅
- 남은 확인: Supabase 프로젝트 생성 후 `0003_favorites.sql` 적용 → 로그인 상태에서 실제 CRUD 확인
  (로컬은 Supabase 미설정이라 익명 경로만 실행 검증)

### P1-4. AI 분석 스트리밍 + 품질 (2~3일) — ✅ 완료 (2026-10-18)

- 목표: 8초 동기 대기를 줄이고 리포트 품질을 측정한다.
- 구현 (완료)
  - `POST /api/tft/match/stream` (SSE) 신규 — 기존 `/api/tft/match` JSON 은 **그대로 유지**
    - 이벤트: `stage`(`start`/`match`/`analyzing` + 한국어 문구) → `result`(기존 JSON과 동일 형태) / `error`
    - 헤더: `text/event-stream`, `no-store, no-transform`, `X-Accel-Buffering: no`
    - 15초 하트비트(`: ping`)로 프록시/서버리스 유휴 종료 방지
    - 쿼터·레이트리밋은 **스트림을 열기 전에 1회** 처리 (초과 시 일반 JSON 429)
  - `lib/matchAnalysis.ts` — JSON·SSE 라우트 공용 파이프라인 (매치 해석 → 캐시 → LLM → 캐시 저장)
  - `lib/analysisStream.ts` — SSE 파서 + `analyzeMatchJson` 폴백
  - 클라이언트(`MatchCard`): 스트림 우선 → 진행 문구를 버튼에 표시 → 실패 시 처리
    - **404/405(구버전 배포)에서만** JSON 으로 폴백 (쿼터 이중 소모 방지)
    - 카드 언마운트 시 `AbortController` 로 스트림 중단
- 실측 (로컬, demo 매치)
  | 경로 | 첫 응답(TTFB) | 전체 |
  | --- | --- | --- |
  | `POST /api/tft/match` (JSON) | 8.67s | 8.67s |
  | `POST /api/tft/match/stream` (SSE, uncached) | **0.039s** (첫 stage) | 8~39s (LLM) |
  | SSE 캐시 히트 | **0.025s** | 0.027s |
- 품질 회귀: `npm run eval:reports -- --runs 2` → 성공률 100% · 폴백 0% · grounding 100%(37/37) · 점수=코드 산출 2/2 · **게이트 통과**
- 설계 메모: 리포트가 **구조화 JSON**이라 토큰 단위 텍스트 렌더 대신 “단계 이벤트 + 최종 결과” 방식으로 구현했다.
  부분 JSON 파싱 리스크 없이 체감 대기(첫 피드백 39ms)를 없애는 것이 목적이다.
- 캐시 히트도 쿼터를 소모하는 기존 정책은 **변경하지 않았다**(과금 정책 변경은 별도 결정 사항).

### AI 분석 v2 — 점수·표본·접지 (2026-10-19)

- 배경: 2-2에 1유닛 3성으로 끝난 판이 `B(77)`를 받고 "보드 완성도 90/100"으로 표시되는 신뢰 문제가 있었다. 종합 분석에서도 초반 종료 판이 평균에 섞였고, 응답의 `feedback.mode`가 항상 `single`로 내려왔다.
- 변경
  - `lib/quality.ts` 신규 — `stageOfRound`, `expectedLevel`, `isEarlyGame`, `lowSampleReason`
  - `lib/scoring.ts` **v2** — 완성도를 `보드 충원율 × 2성 비율`로 계산(1유닛 3성 만점 방지), 초반 종료 경기 집계 제외(`excludedMatches`, `lowSample`, `sampleWarning`)
  - `lib/coaching.ts` — 경제 점수를 `레벨 격차 + 초반 페널티 + 잔여 골드`로 재정의, 단일 경기는 `이 경기`/복수는 `평균` 문구 분기
  - `lib/summarize.ts` — 단일 경기 프롬프트에 로비 상위 3명(레벨·기물·시너지)과 로비 평균 레벨 추가, 초반 종료 표본 표시
  - `lib/llm.ts` — 프롬프트 버전 `2026-10-19.1`, `feedback.mode` 버그 수정, 표본 품질·이름/코스트 환각 금지·경합 의미 지침 추가
  - `lib/grounding.ts` — 다른 세트 시너지명·6코스트 등 엔티티 경고(`warnings`) 추가, 스테이지-라운드 표기의 수치 오탐 제거
  - `FeedbackReport` — `표본 부족` 배지, 표본 경고, 이름/코스트 경고 표시
  - `scripts/evalReports.js` — mode 불일치·표본 부족·이름 경고 집계
- 검증 (로컬, DeepSeek)
  - 단일(2-2): 77/B → **60/C**, `lowSample=true`, grounding 100%
  - 단일(6-1 5등): 64/C, 로비 평균 레벨 7.6 인용, grounding 93%(계산값 0.6 1건)
  - 종합(3경기): 71/B, 초반 1경기 제외(`matches=2`, `excludedMatches=1`), grounding 100%
  - `npm run eval:reports -- --runs 1`: 성공 100% · 폴백 0% · grounding 100% · mode OK · 경고 0 · **게이트 통과**

### AI 분석 D+C — 즉시 지표 + 인트로 토큰 스트리밍 (2026-10-19)

- 목표: 8~10초 동안 아무것도 안 보이는 체감 대기를 줄인다. 구조화 JSON 전체를 토큰 스트리밍하는 대신,
  **즉시 계산되는 지표(D)** 와 **짧은 인트로 2~3문장(C)** 을 먼저 보여준다.
- 구현
  - `MatchCard` — `MatchQuickStats`
    - **분석 전에도 상시 노출**: 등수/레벨/골드/유닛/2성+/시너지/완성도/아이템/경합을 `computeMatchScore` 로 즉시 계산
    - 분석 중에는 같은 패널이 “AI 코치가 분석 중”으로 바뀌며 인트로를 표시
    - `isEarlyGame` 이면 `표본 부족: 2-2 초반 종료` 를 함께 표시
  - `lib/llm.ts` — `generateCoachIntro` 신규
    - 전체 리포트와 **병렬**로 DeepSeek `stream: true` 호출 (`max_tokens 240`)
    - **문장 단위 청킹**: 첫 청크는 16자에서 바로, 이후 문장부호/48자마다 전송 → UI 업데이트 125회 → **7회**
    - **인트로 6h 캐시**: `intro:{matchId}:{mode}:{introVersion}`. 프롬프트에 소환사명을 넣지 않아 매치 단위 캐시가 안전하다
    - Gemini 키만 있으면 단일 응답을 한 번에 전송, 둘 다 실패하면 결정론적 문장으로 폴백
    - `getLlmBudgetStatus` / `recordLlmUsage` 적용
  - `lib/matchAnalysis.ts` — `onMatch(match, displayName)` 콜백 추가 (매치 해석 직후, LLM 전)
  - `app/api/tft/match/stream/route.ts` — `delta` 이벤트 추가, `onMatch`에서 인트로 시작, 결과 전송 후 늦은 델타 차단
  - `lib/analysisStream.ts` — `onDelta` 콜백 + `delta` 이벤트 파싱 (결과 이후 델타 무시)
- 실측 (`next start` 프로덕션 빌드, 캐시 초기화 후)
  | 시나리오 | 첫 delta | delta 수 | result |
  | --- | --- | --- | --- |
  | 1차 생성 | **1.21s** | **6** | 9.31s |
  | 2차 (전체 리포트 미스 + 인트로 캐시 히트) | **28ms** | 1 | 8.62s |
  - 인트로 169자, 인트로와 전체 리포트가 병렬이라 전체 소요 시간은 기존과 동일
- 비용: 분석 1회당 DeepSeek 호출 1회 추가(최대 240 output tokens). 인트로 캐시 히트 시 추가 호출 없음. 실패는 전체 리포트에 영향 없음.

### P1-5. 덱 구성 품질 (1~2일) — ✅ 완료 (2026-10-18)

- 목표: 알고리즘 덱이 “실제로 나올 법한” 구성이 되게 한다.
- 구현 (완료)
  - `lib/traitBreakpoints.json` 신규 — 세트 18 시너지 **발동 단위(breakpoint)** 35종
    - 소스: Community Dragon `cdragon/tft/{ko_kr,en_us}.json` (DDragon `tft-trait.json` 에는 `effects` 가 없다)
    - 키를 3중 등록(정규화 apiName / 영문명 / 한글명) → `championTraits.json` 의 표기 차이 흡수
    - 생성: `npm run build:traits` (`scripts/buildTraitBreakpoints.js`, 별칭 3건 하드코딩)
  - `scripts/buildDeckCompsFromStats.js` — **breakpoint 인지 그리디**로 교체
    - 다음 breakpoint 를 정확히 채우는 유닛 최고점, 이미 최대 단계인 시너지는 가산 최소(초과 기용 방지)
    - 표시 시너지는 **발동된 것만**(count ≥ 첫 breakpoint), 고유 시너지(breakpoint 1)는 제외
  - `scripts/checkDecks.js` 강화
    - 시너지 **미발동(count < 첫 breakpoint)** / **최대 단계 초과(count > max)** → 실패
    - 시너지 count 재계산 대조, `unitCost`·`unitCount` 정합성 검사
    - 캐리 BIS 2개 미만 → 경고(데이터 부족), breakpoint 미등록 시너지 → 경고
- 개선 효과 (재생성 전후 실측)
  | 지표 | 이전 | 이후 |
  | --- | --- | --- |
  | 시너지 항목 수 | 67 | 96 |
  | 미발동 시너지(죽은 유닛) | **8** | **0** |
  | 최대 단계 초과 | 1 | 0 |
  | 덱당 표시 시너지 | 2~3 | 4 (전부 발동) |
- 완료 조건 충족
  - 24덱 유지 ✅, `decks:check` 통과 ✅ (경고 1건: 카직스 BIS 1개 — 표본 부족), `/deck/[id]` 24개 200 ✅
  - 덱 ID 20개 유지 · 4개 교체(`auto-amumu/diana/morgana/scuttlecrab` → `auto-ivern/draven/khazix/maokai`)

### P2-6. 모바일/라이트/PWA (1~2일) — ✅ 완료 (2026-10-18)

- 구현
  - `app/manifest.ts` — `standalone`, 테마/배경색, 192·512·maskable 아이콘, 바로가기 2종
    (`/rank`, `/?tab=coach`)
  - `scripts/generateIcons.js` (`npm run icons`) — `app/icon.svg` 원본 → PNG 4종
    (192/512/maskable/apple-touch) + `app/favicon.ico`(16/32/48) 생성
  - `app/layout.tsx` — `manifest`·`applicationName`·`appleWebApp`·`icons`, viewport
    `themeColor`(라이트/다크 media query)
  - `lib/themeColor.ts` + `SiteHeader` — 테마 토글 시 `meta[name="theme-color"]`를 실제 테마와 동기화
  - `app/globals.css` — `--subtle` 대비 상향(다크 4.86+, 라이트 4.84+), 스크롤바 색 토큰화
  - `app/rank/rank.css` — muted 대비 4.25 → **5.24(다크) / 5.08(라이트)**, 푸터 색 토큰화
  - `SiteHeader` — 360px에서 로고/탭 `shrink-0`·`whitespace-nowrap`으로 헤더 줄바꿈 방지
  - preconnect — `ddragon.leagueoflegends.com`, `raw.communitydragon.org`,
    `fonts.gstatic.com`
- 검증 (2026-10-18, 로컬 + 라이브)
  - `npm run typecheck` ✅ · `npm run build` ✅ (37 pages, `/manifest.webmanifest`·`/icon.svg` 라우트 생성)
  - `/manifest.webmanifest` 200 `application/manifest+json`, 아이콘 192/512/maskable/apple-touch 200
  - Chrome CDP `Page.getInstallabilityErrors` → **`[]`** (설치 가능), manifest 파싱 오류 0
  - 360px 헤드리스 Chrome: `/`, `/rank`, `/meta`, `/deck/auto-ezreal`, `/login`, `/privacy`,
    `/terms` × 다크/라이트 → **가로 스크롤 0 · 콘솔 오류 0**
  - Lighthouse mobile (라이브 `https://www.tftlab.kr`) — performance **94** · SEO **100**,
    accessibility 96(대비 30건) → 색상 보정 후 로컬 accessibility **100**(대비 0건)
  - 로컬 `next start`의 performance 70은 CDN/압축이 없는 환경 때문이다. 프로덕션(Vercel)에서는 90+.
- 남은 메모
  - **service worker/오프라인 캐시는 미구현**. 설치형 웹앱 요건(매니페스트·아이콘·standalone)은 충족.
    오프라인이 필요해지면 별도 작업으로 추가한다.
  - 이미지 최적화(`next/image`·WebP)는 후속. 현재 DDragon PNG를 26px로 축소 표시해
    Lighthouse `modern-image-formats`/`uses-responsive-images` 지적이 남아 있다.
  - 아이콘 원본을 바꾸면 `npm run icons` → 생성물 4종 + `app/favicon.ico` 커밋.

### P2-7. Pro 대기자 페이지 (0.5일) — ✅ 완료 (2026-10-18) — **결제 아님**

- 구현
  - `app/pro/page.tsx` — 예정 가격 **₩3,900/월**, 혜택 3종(AI 분석 50회/일·Pro 배지·우선 지원),
    FAQ, 무료 플랜 CTA. 모든 혜택에 “출시 예정안” 고지
  - `app/pro/ProWaitlistButton.tsx` — “Pro 출시 알림 받기” 버튼
    - `pro_waitlist_click` 전송: `{ surface: 'pro_page', priceKrw: 3900, billing: 'monthly' }`
    - 이메일·Riot ID·결제 정보 수집 없음, `localStorage('tftlab:pro-waitlist')`로 중복 클릭 방지
    - 클릭 후 `aria-live` 완료 문구 + 새로고침 후에도 완료 상태 유지
  - 진입 링크 — `SimpleHeader`(모바일 포함), `SiteHeader`(lg+ `PRO`), `SiteFooter`,
    `UserMenu` 드롭다운(`Pro 플랜 · 준비 중`), `sitemap.xml`(`/pro`, monthly, 0.6)
- 검증 (2026-10-18)
  - `npm run build` ✅ — `/pro` Static 2.69 kB
  - `/pro` 200 · canonical/OG/Twitter 메타 정상 · sitemap에 `/pro` 포함
  - 360px 헤드리스 Chrome: 다크/라이트 **가로 스크롤 0 · 콘솔 오류 0**
  - 버튼 클릭 → `POST /api/events` **204**, payload: `pro_waitlist_click` + `surface/priceKrw/billing`
  - 새로고침 후 “알림 신청 완료” 유지 (localStorage)
  - Lighthouse mobile `/pro` — accessibility **100** · best-practices **100** · SEO **100** (대비 0건)
- 하지 않은 것
  - **결제/PG 연동 없음**, 이메일 수집 없음. P3 게이트 통과 전에는 붙이지 않는다.
  - “알림”은 현재 사이트 공지로만 안내한다. 이메일 알림이 필요하면 동의·수집·보관 정책을
    먼저 추가해야 한다.

### P3. 결제 (게이트 통과 후에만) — ⏸ 대기

최소 기준:
- D7 리텐션 ≥ 15%
- 검색 대비 AI 분석 실행률 ≥ 30%
- “없으면 아쉽다” ≥ 40% (베타 10~20명)
- Pro 의향 클릭 ≥ 5%
- 사전 구매 의향 5명 이상
→ 통과 시 토스페이먼츠(정기결제) + 사업자/통신판매업/환불 정책.

집계 준비:
- 전체 SQL: `supabase/queries/p3_gate.sql` (데이터 품질 → DAU → 검색→분석 → Pro 의향 → D1/D7 → 게이트 요약)
- 지표 정의·표본 기준·판정 절차: `docs/P3-GATE.md`
- 리텐션 전제: `0004_events_visitor.sql` 적용 + 새 클라이언트 배포 후 **최소 13일** 데이터
- “없으면 아쉽다” 설문은 이벤트로 측정 불가 → 베타 참여자 수동 설문(4~5점 비율)
- 검증: sqlglot PostgreSQL 파싱 + PGlite 픽스처 실행 (`docs/P3-GATE.md` §5)

## 5. 현재 미완료 / 사용자(운영자)가 해야 할 일

| 항목 | 상태 | 담당 |
| --- | --- | --- |
| Supabase 프로젝트 + Discord OAuth + env 등록 | **미완료** — 코드만 준비됨 | 운영자 |
| Supabase `0002_events.sql` 적용 | **미완료** — 미적용 시 이벤트는 구조화 로그로만 적재(기능 정상) | 운영자 |
| Supabase `0003_favorites.sql` 적용 | **미완료** — 미적용 시 즐겨찾기 API 503(최근 검색은 정상) | 운영자 |
| Supabase `0004_events_visitor.sql` 적용 | **미완료** — 미적용 시 이벤트 insert 실패(로그 적재로 폴백), D7 계산 불가 | 운영자 |
| Riot 프로덕션 키 승인 | **Pending Review** | Riot |
| Vercel Pro 전환 (상업화 전) | 미완료 | 운영자 |
| DeepSeek/Gemini 월 스펜드 리밋 | 미완료 | 운영자 |
| 커뮤니티 공개 홍보 | 보류 (프로덕션 키 승인 후) | 운영자 |

Supabase 설정 절차: `docs/supabase-auth.md`  
설정 후 확인: `/login` → Discord → `/api/me` → `usage_daily` 증가 → `/api/health` `integrations.supabase=true`.

---

## 6. 알려진 함정 / 주의사항

1. **`NEXT_PUBLIC_*` 는 빌드 타임 인라인**
   - Vercel에서 **Config(Plain)** 타입으로 저장하고 **새 빌드/재배포**해야 반영된다.
   - Secret/Sensitive 로 저장하면 클라이언트 번들에 안 들어간다(Turnstile에서 겪은 함정).
2. **개발 키 24시간 만료**
   - 10:00 KST 자동 교체 루틴이 Vercel + GitHub secret을 갱신한다.
   - 이 루틴을 끄거나 secret 이름을 바꾸지 말 것.
   - 10:30 KST `Ops Check`가 401/403이면 실패 알림을 보낸다.
3. **덱 ID는 `auto-<carry>` 형식**
   - 예: `/deck/auto-soraka`. 기존 hex ID는 404가 된다.
   - CI 스모크는 `grep -oE '/deck/[A-Za-z0-9_-]+'` 를 사용한다. hex로 되돌리지 말 것.
4. **`championTraits.json` 은 “사실 관계”만 추출한 파일**
   - 세트 18 기물→시너지 매핑은 DDragon/CDragon에 없어서 기존 데이터에서 1회 추출했다.
   - `npm run extract:traits` 로 재생성 가능. 큐레이션 덱은 포함하지 않는다.
5. **`/meta` 는 덱만 SSR**
   - `lib/metaSlim.ts` + `deferSections`. 다른 탭은 첫 전환 시 `/api/tft/meta` 로 전체 로드.
   - 초기 payload에 다시 전체 데이터를 넣으면 733KB로 회귀한다.
6. **덱 파일 교체 후 필수 검증**
   - `npm run build:decks` → `npm run decks:check` → `npm run build`.
   - CI `Deck data sanity` 단계가 있다.
7. **RLS 정책**
   - `profiles` 는 SELECT만, UPDATE 정책 없음 → 사용자가 스스로 Pro 변경 불가.
   - `usage_daily` 쓰기는 RPC(security definer)만.
   - service role key는 사용하지 않는다.
8. **쿼터 폴백**
   - Supabase RPC 실패 시 IP 쿼터로 폴백(fail-open). `quota_user_rpc_failed` 로그 확인.
9. **Turnstile**
   - 검색에만 적용. 장애 시 fail-open. `TURNSTILE_ENFORCE=false` 는 비상시에만.
10. **로컬 SWC 경고**
    - `@next/swc-win32-x64-msvc ... not a valid Win32 application` 은 기존 환경 이슈. WASM 폴백으로 빌드 성공.
11. **`/rank` canonical**
    - 루트 metadata의 canonical(`/`)을 상속한다. 공유용 URL로 쓰려면 canonical 정책 결정 필요.
12. **이벤트 테이블은 insert-only**
    - `events` 는 anon/authenticated 에 **INSERT 권한만** 부여했다. SELECT 를 열면 세션 단위 행동이
      그대로 노출되므로 열지 말 것. 집계는 SQL Editor/서비스 롤에서만.
    - 이벤트 이름은 화이트리스트(`lib/eventSchema.ts`)다. 새 이벤트를 추가할 때는 **양쪽(스키마 상수)과
      개인정보처리방침**을 함께 갱신한다.
    - `props` 에 Riot ID/이메일을 넣지 말 것. 서버가 차단하지만 조용히 사라지므로 디버깅이 어렵다.
    - 보관 90일 권장: `delete from public.events where created_at < now() - interval '90 days';`
    - `pro_waitlist_click` 은 `/pro` 의 `ProWaitlistButton` 에서 전송한다(로그인 불필요, PII 없음).
13. **랭크는 부가 정보다 — 실패해도 검색이 죽으면 안 된다**
    - `getTftLeagueByPuuid` 는 404/429/401/네트워크 오류에서 **null** 을 반환하고 예외를 던지지 않는다.
    - `rank:{platform}:{puuid}` 10분 캐시. `null`(배치 중)도 캐시하므로 미배치 계정도 Riot 을 반복 호출하지 않는다.
    - 검색 1회당 Riot 호출이 **+1** 늘었다(matchIds 와 병렬이라 지연은 거의 동일). 키 한도가 빠듯하면
      `CACHE_TTL.RANK` 를 늘릴 것.
    - 데모 모드(`isDemo`/키 없음)는 예시 랭크(GOLD II)를 반환한다. 응답의 `isDemo: true` 와 UI의
      “체험 모드” 배지로 실제 전적과 구분된다.
14. **즐겨찾기는 로그인 사용자 전용**
    - `favorites` 는 `anon` 권한을 회수했고 `authenticated` 에만 select/insert/delete 를 준다.
      **UPDATE 정책은 의도적으로 없다**(추가/삭제만 존재).
    - 중복 방지는 `(user_id, region, lower(game_name), upper(tag_line))` 유니크 인덱스 +
      앱 레벨 사전 확인. 동시 요청은 `23505` 를 성공으로 처리한다.
    - 개수 상한(20)은 **애플리케이션**에서만 강제한다. DB 제약이 아니므로 API 를 우회하면 늘어날 수 있다.
    - 삭제는 `ilike` 대신 목록에서 정규화 키로 찾아 **id 기준 삭제**한다.
      (Riot ID 에 `%`/`_` 가 들어가도 안전)
    - Supabase 미설정 시 GET 은 200 + `configured:false`(빈 목록), POST/DELETE 는 401 을 반환한다.
15. **SSE 스트림은 쿼터를 먼저 소모한다**
    - `/api/tft/match/stream` 은 스트림을 열기 전에 레이트리밋·쿼터를 처리한다.
      → **200 이 왔다는 것은 쿼터가 이미 차감됐다는 뜻**이므로, 스트림 중간 실패 시 재요청하면 이중 과금된다.
      클라이언트는 404/405(구버전 배포)에서만 JSON 으로 폴백한다.
    - 프록시 버퍼링을 막으려면 `no-transform` + `X-Accel-Buffering: no` 를 유지한다.
    - 15초 하트비트(`: ping`)를 제거하면 유휴 타임아웃으로 스트림이 끊길 수 있다.
    - 리포트는 구조화 JSON 이라 토큰 단위 렌더를 하지 않는다. 단계(stage) 이벤트만 보낸다.
16. **덱 재생성은 breakpoint 를 거쳐야 한다**
    - `lib/traitBreakpoints.json` 이 없거나 낡으면 “발동도 안 되는 시너지”가 덱에 들어간다.
      세트가 바뀌면 `npm run build:traits` 로 재생성하고, `npm run build:decks` → `npm run decks:check` → `npm run build`.
    - `decks:check` 는 이제 **미발동(count < 첫 breakpoint)** 과 **최대 단계 초과**를 실패로 처리한다.
    - 재생성하면 덱 ID(`auto-<carry>`)가 일부 바뀔 수 있다. 구 URL 은 404 가 되므로
      sitemap·외부 공유 링크를 함께 확인한다. (2026-10-18 재생성 시 20개 유지 · 4개 교체)

---

## 7. Definition of Done / PR 규칙

- 브랜치: `feat/*`, `fix/*`, `chore/*`
- PR 본문에 **변경 요약 / 검증 명령 결과 / 스크린샷(UI)** 포함
- CI 그린: lint · typecheck · meta:check · decks:check · build · **SSR smoke**
- 배포 후: `npm run check:ops -- https://www.tftlab.kr --strict`
- UI 변경 시: `/`, `/rank`, `/meta`, `/deck/[id]`, `/profile/...`, `/pro` 360px·데스크톱·라이트 테마 확인
- 문서 갱신: `docs/HANDOFF.md`(이 문서), `docs/P0-OPERATIONS.md`, 필요 시 `docs/supabase-auth.md`
- **비밀키/토큰 커밋 금지** (문서 예시도 placeholder만)

---

## 8. 유용한 URL

| 대상 | URL |
| --- | --- |
| 라이브 | https://www.tftlab.kr |
| Health | https://www.tftlab.kr/api/health |
| Sitemap | https://www.tftlab.kr/sitemap.xml |
| GitHub Actions | https://github.com/yashiro0504/tft-ai/actions |
| Vercel | https://vercel.com/dashboard |
| Supabase | https://supabase.com/dashboard |
| Cloudflare Turnstile | https://dash.cloudflare.com → Turnstile |
| Upstash | https://console.upstash.com |

---

## 9. 첫 3일 추천 계획

| 일차 | 작업 | 산출물 |
| --- | --- | --- |
| 1일 | ✅ P0-1 이벤트 계측 (완료) | `/api/events`, `events` 테이블/로그, 클라이언트 `track()` |
| 2일 | ✅ P0-2 랭크/티어 API + 프로필 카드 (완료) | `tft/league/v1` 연동, 10분 캐시, `RankBadge` |
| 3일 | ✅ P0-3 즐겨찾기/최근 검색 (완료) | Supabase/localStorage, 검색 UI |

P1(SSE/품질, 덱 품질)과 P2-6~7(모바일/PWA, Pro 대기자)까지 완료. 다음은 P3 유료화 게이트 판정.

---

## 10. 결정이 필요한 열린 질문

1. 익명 무료 분석 한도를 **10 → 3~5회**로 낮출지 (로그인 유도)
2. `/rank` 를 canonical로 승격할지, `/` 로 통합할지
3. Pro 가격: 월 ₩3,900 vs 시즌 패스 ₩9,900
4. 결제 PG: 토스페이먼츠 vs Stripe
5. PWA를 지금 할지, 유입 채널(디스코드 봇)을 먼저 할지

> 이 문서와 코드가 충돌하면 **코드가 진실**이다. 변경 후 이 문서를 갱신할 것.




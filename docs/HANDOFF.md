# TFT LAB 개발 핸드오프 (WorkBody AI용)

최종 갱신: 2026-10-18 · 기준 커밋: `feat/p0-1-events` (P0-1 이벤트 계측 완료) · 라이브: https://www.tftlab.kr

이 문서는 **다른 개발 에이전트가 이 저장소를 이어받아 작업**할 수 있도록 현재 상태,
아키텍처, 우선순위, 금지사항, 검증 절차를 정리한 것입니다. 먼저 이 문서 →
`docs/P0-OPERATIONS.md` → `docs/supabase-auth.md` → `docs/DATA_PIPELINE.md` 순으로 읽으세요.

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
5. **UI 토큰/디자인을 바꾸면** `/`, `/rank`, `/meta`, `/deck/[id]`, `/profile/...` 를 모두 확인.
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
| `lib/supabase/*` | 서버/브라우저 클라이언트, 세션 |
| `lib/userQuota.ts` | 로그인 사용자 RPC 쿼터 |
| `lib/turnstile.ts` | 검색 봇 차단 |
| `lib/llm.ts` | DeepSeek/Gemini + 프롬프트 + 예산 가드 |
| `lib/eventSchema.ts` | 이벤트 이름 허용 목록 + PII 정제 규칙 (클라·서버 공용) |
| `lib/analytics.ts` | 클라이언트 `track()` / `trackOnce()` (sessionStorage UUID, keepalive) |
| `lib/events.ts` | 서버 이벤트 저장 (Supabase insert → 실패 시 구조화 로그) |
| `app/api/events/route.ts` | 이벤트 수집 API (204, no-store, IP 레이트리밋) |
| `middleware.ts` | Supabase 세션 쿠키 갱신 |
| `supabase/migrations/0001_auth_quota.sql` | profiles/usage_daily/RLS/RPC |
| `supabase/migrations/0002_events.sql` | events 테이블 (insert-only RLS) |

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

## 4. 개발 우선순위 (이 순서대로)

> 전제: **결제/구독 UI는 아직 만들지 않는다.** 계정·쿼터 배관은 유지하되, 유료화는 아래 게이트 통과 후.
> 제품의 현재 약점은 기능 수가 아니라 **재방문 이유 부재**와 **첫 경험 마찰**이다.

### P0-1. 이벤트 계측 (0.5~1일) — ✅ 완료 (2026-10-18)

- 목표: 검색 → 분석 → 공유/로그인 전환과 이탈 지점을 숫자로 본다.
- 구현 (완료)
  - `POST /api/events` (rate limit 120/분/IP, Turnstile 불필요, `no-store`, 성공 시 **204**)
  - 이벤트 9종: `search_submit`, `search_success`, `analysis_click`, `analysis_success`, `tab_view`,
    `deck_open`, `share_click`, `login_click`, `pro_waitlist_click`
  - payload: `{ name, sessionId, props, route }` — **Riot ID/이메일/PUUID 등 PII 미수집**
    (`lib/eventSchema.ts` 가 키 이름 + 값 패턴을 이중 차단, 서버에서 재정제)
  - 저장: Supabase 설정 시 `events` 테이블(`0002_events.sql`, insert-only RLS),
    미설정 시 구조화 로그(`analytics_event`)
  - 클라이언트: `lib/analytics.ts` 의 `track()` / `trackOnce()` (sessionStorage UUID, `keepalive`)
- 배선 위치
  | 이벤트 | 위치 |
  | --- | --- |
  | `search_submit` / `search_success` | `app/page.tsx` |
  | `analysis_click` / `analysis_success` | `app/page.tsx`(종합), `app/components/MatchCard.tsx`(경기별) |
  | `tab_view` | `app/page.tsx`(홈), `app/components/MetaDashboard.tsx`(메타 5탭) |
  | `deck_open` | `app/components/DeckViewTracker.tsx`(덱 페이지), `MetaDashboard`(덱 카드 링크) |
  | `share_click` | `app/components/ShareButton.tsx` (surface: coach_result/deck_page/meta_deck_row) |
  | `login_click` | `app/components/UserMenu.tsx` |
  | `pro_waitlist_click` | **미배선** — `/pro` 페이지(P2-7) 생성 시 연결 |
- 완료 조건 충족
  - `/api/events` 204 · 이벤트가 로그/Supabase에 남음 (로컬 검증 완료)
  - `npm run build` + typecheck/eslint 통과, 개인정보처리방침에 수집 항목·보관 기간 추가
- 남은 운영 작업: Supabase 프로젝트 생성 후 `0002_events.sql` 실행 → Vercel env 등록 시 자동으로 DB 저장으로 전환

### P0-2. 랭크/티어 표시 (1~2일) — 🔜 **다음 작업** (가장 큰 가치)

- 목표: “내 위치”를 보여줘 재방문 이유를 만든다.
- 구현
  - `lib/riot.ts` 에 `getTftLeagueByPuuid(puuid, platform)` 추가
    - `GET https://{platform}.api.riotgames.com/tft/league/v1/by-puuid/{puuid}`
    - 응답 배열에서 `queueType === 'RANKED_TFT'` 선택
    - 캐시 `rank:{platform}:{puuid}` TTL 10분, 실패 시 null
  - `/api/tft/search` 응답에 `rank` 추가 (Riot 1콜 증가, 캐시로 완화)
  - 프로필 카드/`/profile` 페이지에 티어·LP·윈/로스 표시, 없으면 “배치 중”
  - `check:ops`/health에 영향 없음
- 완료 조건
  - 실제 계정으로 티어 표시, 10분 캐시, Riot 429/404 시 앱이 깨지지 않음
  - `TFT-LEAGUE-V1` 사용은 이미 Riot 신청서에 명시됨

### P0-3. 즐겨찾기 + 최근 검색 (1일)

- 목표: 매번 Riot ID를 입력하지 않게 한다.
- 구현
  - 마이그레이션 `0003_favorites.sql`: `favorites(user_id, region, game_name, tag_line, created_at)` + RLS(본인만 CRUD)
  - `/api/favorites` GET/POST/DELETE (로그인 필요)
  - 비로그인: `localStorage` 최근 5개
  - UI: 헤더 계정 메뉴 아래 또는 검색창 아래 “최근/즐겨찾기” 칩
- 완료 조건
  - 로그인/비로그인 모두 동작, 중복 방지, 삭제 가능

### P1-4. AI 분석 스트리밍 + 품질 (2~3일)

- 목표: 8초 동기 대기를 줄이고 리포트 품질을 측정한다.
- 구현
  - `/api/tft/match` 에 `stream: true` 옵션 또는 `/api/tft/match/stream`
  - 쿼터는 **요청 시작 시 1회만** 소모, 캐시 히트 시 즉시 반환
  - `ReadableStream` + `text/event-stream`, 클라이언트는 점진 렌더 + 실패 시 기존 JSON 폴백
  - `npm run eval:reports -- --runs 2` 로 품질 회귀 확인
- 완료 조건
  - 체감 TTFB 개선, 스트림 중단/에러 시 사용자 메시지, 캐시 동작 유지

### P1-5. 덱 구성 품질 (1~2일)

- 목표: 알고리즘 덱이 “실제로 나올 법한” 구성이 되게 한다.
- 구현
  - 시너지 breakpoint 데이터 추가(`lib/traitBreakpoints.json` 등) 후 유닛 선택 시 상한 적용
  - 캐리/탱커 역할 구분이 없으면 최소한 코스트 분포·시너지 수 상한만 적용
  - `decks:check` 기준 강화(시너지 breakpoint 위반, 코스트 0 등)
- 완료 조건
  - 24덱 유지, `decks:check`/CI 통과, `/deck/[id]` 구성 UI 정상

### P2-6. 모바일/라이트/PWA (1~2일)

- 360px 실기기에서 표·바텀시트·모달 확인 (이미 1차 구현됨)
- 라이트 테마 실사용 점검(대비/그림자/오버레이)
- `app/manifest.ts` + 아이콘 + `theme-color` (설치형 웹앱)
- 완료 조건
  - Lighthouse 모바일 90+ 목표(성능/접근성), 360px 가로 스크롤 없음

### P2-7. Pro 대기자 페이지 (0.5일) — **결제 아님**

- `/pro` 페이지: 가격(예: ₩3,900/월) + “출시 알림 받기” 버튼
- 클릭 이벤트만 수집(`pro_waitlist_click`), 결제 연동 없음
- 유료화 게이트(아래) 통과 전에는 결제를 붙이지 않는다.

### P3. 결제 (게이트 통과 후에만)

최소 기준:
- D7 리텐션 ≥ 15%
- 검색 대비 AI 분석 실행률 ≥ 30%
- “없으면 아쉽다” ≥ 40% (베타 10~20명)
- Pro 의향 클릭 ≥ 5%
- 사전 구매 의향 5명 이상
→ 통과 시 토스페이먼츠(정기결제) + 사업자/통신판매업/환불 정책.

## 5. 현재 미완료 / 사용자(운영자)가 해야 할 일

| 항목 | 상태 | 담당 |
| --- | --- | --- |
| Supabase 프로젝트 + Discord OAuth + env 등록 | **미완료** — 코드만 준비됨 | 운영자 |
| Supabase `0002_events.sql` 적용 | **미완료** — 미적용 시 이벤트는 구조화 로그로만 적재(기능 정상) | 운영자 |
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
    - `pro_waitlist_click` 은 `/pro` 페이지가 아직 없어 **미배선** 상태다(P2-7에서 연결).

---

## 7. Definition of Done / PR 규칙

- 브랜치: `feat/*`, `fix/*`, `chore/*`
- PR 본문에 **변경 요약 / 검증 명령 결과 / 스크린샷(UI)** 포함
- CI 그린: lint · typecheck · meta:check · decks:check · build · **SSR smoke**
- 배포 후: `npm run check:ops -- https://www.tftlab.kr --strict`
- UI 변경 시: `/`, `/rank`, `/meta`, `/deck/[id]`, `/profile/...` 360px·데스크톱·라이트 테마 확인
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
| 2일 | P0-2 랭크/티어 API + 프로필 카드 | `tft/league/v1` 연동, 캐시, UI |
| 3일 | P0-3 즐겨찾기/최근 검색 | Supabase/localStorage, 검색 UI |

그 다음 P1(SSE/품질, 덱 품질) → P2(모바일/PWA, Pro 대기자) 순.

---

## 10. 결정이 필요한 열린 질문

1. 익명 무료 분석 한도를 **10 → 3~5회**로 낮출지 (로그인 유도)
2. `/rank` 를 canonical로 승격할지, `/` 로 통합할지
3. Pro 가격: 월 ₩3,900 vs 시즌 패스 ₩9,900
4. 결제 PG: 토스페이먼츠 vs Stripe
5. PWA를 지금 할지, 유입 채널(디스코드 봇)을 먼저 할지

> 이 문서와 코드가 충돌하면 **코드가 진실**이다. 변경 후 이 문서를 갱신할 것.




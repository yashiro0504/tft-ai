# P0 운영 가이드 — 계측 · Riot 방어막 · 영구 캐시

이 문서는 2026-10-18 P0 작업(계측 + Riot 호출 보호 + 2계층 캐시 + meta CDN 캐시)의
운영 방법을 정리한 것입니다.

## 1. 무엇이 바뀌었나

| 영역 | 변경 |
| --- | --- |
| 계측 | `lib/observability.ts` 구조화 JSON 로그 + 인프로세스 카운터, `GET /api/health` 추가 |
| Riot | `lib/riot.ts` 타임아웃(5s) · 429/5xx 재시도(2회) · `Retry-After` 준수 · 전역 동시성 5 |
| 캐시 | `lib/cache.ts` L1 메모리 + L2 Redis(Upstash/Vercel KV REST, 선택). Redis 장애는 fail-open |
| Riot 호출 절감 | Account(24h) · Summoner(6h) · matchIds(45s) · 매치 상세(30d, 불변) 캐시 |
| 랭크 | `TFT-LEAGUE-V1` by-puuid 조회, `rank:{platform}:{puuid}` **10분 캐시**, 실패 시 `null` 폴백 |
| 분석 캐시 | `analysis:{matchId}:{puuid}:{mode}:{COACH_PROMPT_VERSION}` — 재분석 LLM 호출 0회 |
| meta | `/api/tft/meta` 5분 메모 + `Cache-Control: public, s-maxage=300, stale-while-revalidate=3600` |
| LLM | Gemini 모델을 `gemini-2.5-flash`로 교체(1.5-flash 종료), 45s 타임아웃, 토큰/비용 계측 |

## 2. 환경변수

필수는 기존과 동일(`RIOT_API_KEY`, `DEEPSEEK_API_KEY`)이며, 아래는 선택입니다.

```
RIOT_PLATFORM=kr
RIOT_TIMEOUT_MS=5000
RIOT_MAX_RETRIES=2
RIOT_MAX_CONCURRENCY=5
RIOT_MAX_RETRY_WAIT_MS=2000

GEMINI_MODEL=gemini-2.5-flash
LLM_TIMEOUT_MS=45000

# 분산 캐시 (미설정 시 메모리만)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
CACHE_L1_MAX_TTL_MS=300000
REDIS_TIMEOUT_MS=800

LOG_LEVEL=info
HEALTH_TOKEN=
META_MEMO_TTL_MS=300000
```

### Upstash Redis 연결 (5분)

1. https://console.upstash.com 에서 Redis 데이터베이스 생성(무료 티어 가능)
2. REST URL / REST TOKEN 복사
3. Vercel 프로젝트 환경변수에 `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` 추가 후 재배포
4. `GET /api/health` 에서 `cache.backend` 가 `redis+memory` 인지 확인

## 3. 검증

```powershell
npm run typecheck
npm run lint
npm run build

npm run dev
# 다른 터미널
curl http://localhost:3000/api/health
curl -X POST http://localhost:3000/api/tft/search -H "Content-Type: application/json" `
     -d '{"gameName":"Hide on bush","tagLine":"KR1","limit":2}'
```

정상 동작 시 로그에 아래 이벤트가 JSON 한 줄로 남습니다.

- `riot_call` — `label`, `status`, `ms`, `attempt`
- `api_search` / `api_match` / `api_overview` / `api_meta` — `ms`, `cacheSource`
- `llm_call` — `provider`, `inputTokens`, `outputTokens`, `estimatedUsd`
- `riot_retry`, `riot_retry_skipped`, `riot_call_failed`

## 4. 지켜볼 지표

| 지표 | 목표 | 보는 법 |
| --- | --- | --- |
| `riot.status.429` 비율 | < 0.1% | 로그 집계 또는 /api/health |
| `cache.hit.*` 비율 | > 80% | `cache.hit.memory` + `cache.hit.redis` vs `cache.miss` |
| `llm.call.*` 대비 `llm.cache_hit.match_analysis` | 캐시 히트가 더 많아야 함 | 카운터 |
| `llm.cost_usd_micros` | 일 예산 이내 | 카운터(마이크로 USD) |
| `api_*` p95 | 검색 < 2s, 분석 < 15s | `ms` 필드 |

> 카운터는 인스턴스 로컬입니다. 전역 지표가 필요하면 Vercel Log Drain 등으로 로그를 보내
> `event` 기준으로 집계하세요.

## 5. 아직 남은 P0 항목

1. **Riot 프로덕션 키 신청** — 개발 키 한도(20 req/s, 100 req/2min)는 코드로 늘릴 수 없습니다.
   공개 URL + 이용약관 + 개인정보처리방침이 필요하므로 사이트 공개 후 바로 신청하세요.
2. **봇 차단** — Cloudflare Turnstile을 검색 폼에 붙이고, IP/세션 토큰버킷을 Redis로 이전.
3. **LLM 제공자 하드 스펜드 리밋** — DeepSeek/Gemini 콘솔에서 월 한도 설정.
4. **프로덕션 demo fallback 제거** — 키 만료 시 가짜 전적이 노출되지 않도록 500으로 실패 처리.
5. **분석 비동기화(SSE)** — 현재 단일 요청에서 Riot + LLM을 동기 처리하므로 서버리스 타임아웃 위험이 남아 있습니다.

## 6. 롤백

- Redis만 끄기: `UPSTASH_REDIS_REST_URL`/`TOKEN` 제거 → 자동으로 L1 메모리 캐시로 동작
- meta CDN 캐시 끄기: `app/api/tft/meta/route.ts` 의 `META_CACHE_HEADERS` 제거
- Riot 재시도 끄기: `RIOT_MAX_RETRIES=0`

## 7. 일일 쿼터 · LLM 예산 (P0-2 비용 방어)

| 항목 | 기본값 | env |
| --- | --- | --- |
| 검색(IP당/일) | 50회 | `QUOTA_SEARCH_PER_DAY` |
| 경기 AI 분석(IP당/일) | 10회 | `QUOTA_ANALYSIS_PER_DAY` |
| 종합 AI 분석(IP당/일) | 10회 | `QUOTA_OVERVIEW_PER_DAY` |
| LLM 일일 예산 | 3 USD | `LLM_DAILY_BUDGET_USD` |

- 0 이하는 **무제한**(가드 비활성)입니다.
- 쿼터는 KST 자정에 초기화되며, Redis 설정 시 인스턴스 간 공유됩니다.
- 초과 시 `429` + `Retry-After` 와 함께 `quota` 객체를 반환합니다.
- LLM 예산 초과 시 제공자 호출 없이 **결정론적 폴백 리포트**(`isFallback: true`)를 반환합니다.
- Redis가 없으면 인메모리 폴백이라 서버리스 다중 인스턴스에서는 느슨해집니다. **운영은 Redis 설정을 권장**합니다.

### 프로덕션 데모 폴백

`NODE_ENV=production` 에서 `RIOT_API_KEY` 가 없으면 검색/분석은 `503` 으로 실패합니다.
(데모 데이터를 실제 전적으로 오인하는 사고 방지. `isDemo: true` 를 명시한 요청만 데모 허용)

### 확인

```powershell
curl http://localhost:3000/api/health
# limits.perDay, limits.llmBudget, warnings 확인
```

`/api/health` 의 `warnings` 에 아래가 뜨면 아직 설정이 필요합니다.

- `프로덕션에 RIOT_API_KEY 미설정` → 배포 환경변수 확인
- `LLM 일일 예산 초과` → 예산 상향 또는 다음날 리셋 대기

## 8. 봇 차단 (Cloudflare Turnstile)

검색은 Riot API 13콜을 유발하므로, 봇이 검색 폼을 직접 두드리는 것을 막는다.

### 설정

1. https://dash.cloudflare.com → Turnstile → 사이트 추가
   - 도메인: 배포 도메인 (로컬 테스트는 `localhost` 추가)
   - 위젯 모드: Managed
2. Vercel 환경변수 등록
   ```
   NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site key>
   TURNSTILE_SECRET_KEY=<secret key>
   ```
3. 재배포 후 `/` 에서 위젯이 보이고, 검색이 정상 동작하는지 확인

### 동작

- **검색(`/api/tft/search`)에만 적용**된다. (Riot 호출이 집중되는 진입점)
- 경기별/종합 AI 분석은 일일 쿼터 + LLM 예산 가드로 보호한다.
- 토큰은 1회용이므로 검색 후 위젯을 자동 reset 한다.
- `TURNSTILE_ENFORCE=false` 로 즉시 해제할 수 있다.
- Cloudflare 장애/타임아웃 시에는 **fail-open**(통과)하고 `turnstile_unavailable` 로그를 남긴다.
- 사이트 키만/시크릿만 설정하면 `/api/health` 경고가 뜬다.

### 확인

```powershell
# 키 미설정: 검색 정상 (가드 비활성)
curl -X POST http://localhost:3000/api/tft/search -H "Content-Type: application/json" `
     -d '{"gameName":"Demo","tagLine":"KR1","isDemo":true,"limit":1}'

# 시크릿만 설정: 토큰 없으면 403
# 응답: {"success":false,"code":"TURNSTILE_FAILED", ...}
```

## 9. URL 라우팅 · OG 이미지

### 라우트

| 경로 | 렌더링 | 캐시 |
| --- | --- | --- |
| `/meta` | 서버(ISR) — 메타 랭킹 전체를 HTML로 제공 | `revalidate = 300` |
| `/profile/kr/{name}/{tag}` | 서버(ISR) — 소환사 전적 + 경기 카드 | `revalidate = 120` |
| `/profile/kr/{name}/{tag}/opengraph-image` | `next/og` PNG (1200×630) | 300s |

- 홈 검색 결과의 **"전적 페이지 링크 복사"** 버튼이 프로필 URL을 복사합니다.
- sitemap에는 `/`, `/meta`, `/terms`, `/privacy`가 포함됩니다. (프로필은 열거 불가)
- canonical/OG URL은 `NEXT_PUBLIC_SITE_URL` 기준이므로 **배포 시 반드시 설정**하세요.

### OG 이미지의 한글 폰트

전체 한글 폰트(수 MB)를 번들하지 않고, 이미지에 실제로 쓰는 글자만
Google Fonts `text=` 서브셋으로 요청해 TTF로 받아 렌더링합니다.
- 실패 시 기본 폰트로 폴백(한글이 깨질 수 있음) → `/api/health`가 아니라 OG 응답 로그 확인
- 폰트 응답은 모듈 캐시에 보관(같은 텍스트 반복 시 재요청 없음)

### 주의: 서버 렌더링은 쿼터/Turnstile을 거치지 않는다

`/profile/...` 은 RSC에서 직접 `loadSummonerData` 를 호출하므로 API 라우트의
IP 쿼터·Turnstile을 bypass한다. 대신 아래로 보호된다.

1. **ISR(120s)**: 같은 URL은 2분에 1번만 Riot을 호출
2. **2계층 캐시**: account 24h / summoner 6h / matchIds 45s / match 상세 30d
3. 검증된 파라미터(지역 `kr`, 이름 32자·태그 10자 제한)

트래픽이 커지면 프로필 URL에 서명 토큰을 요구하거나 CDN 캐시를 늘리는 것을 검토한다.

### 알려진 제약

- `/meta` HTML이 약 800KB(전체 랭킹 포함)이라 모바일 초기 로딩이 무겁다.
  필요하면 탭별 분할 라우트(`/meta/champions` 등)로 쪼갠다.
- 프로필은 `kr`만 지원한다. 다른 지역은 `lib/profileData.ts`의 검증과
  `loadSummonerData` 지역 매핑을 함께 확장해야 한다.

## 10. 증강 수집 진단

**결론: 세트 18은 Riot 매치 응답에 증강 데이터를 제공하지 않는다.**
(실경기 fixture 3건 + 400경기 표본 모두 `participants[].augments = []`, 사용자 확인 완료)

제품/프롬프트도 이에 맞춰 정리했다.

- 증강이 없는 경기에서는 **"증강 메타 대조" UI 섹션을 렌더링하지 않음**
- LLM 프롬프트에서 증강 라인을 제거하고, "증강 평가/추측 금지 + 다른 6축에 집중" 지시
- 홈 소개 문구에서 "증강 선택" 제거
- `hasAugmentMeta` 는 하드코딩이 아니라 실제 수집 데이터에서 계산

수집 파이프라인에는 향후 세트 변경/스키마 변경을 대비한 진단을 남겨두었다.

- **스키마 방어**: `augments`, `augment_names`, `augmentNames`, `augment` + 문자열/객체 배열
- **진단 카운터**: 참가자 / 필드 존재 / 값 있음 / 슬롯
- **원인 로그**: "필드 자체 없음(스키마 변경)" vs "필드는 있으나 값이 빔(세트 미제공)" 구분

```powershell
npm run inspect:match -- "Hide on bush#KR1"   # 원본 응답 스키마 확인
npm run test:augment                          # 집계 회귀 테스트 (외부 API 불필요)
```

| 로그 | 의미 | 조치 |
| --- | --- | --- |
| `필드 존재 N명 · 값 있음 0명` | Riot이 빈 배열 제공 | 현재 상태. 증강 UI 숨김 |
| `필드 존재 0명` | 스키마 변경 | `AUGMENT_FIELDS`에 새 필드명 추가 |
| `슬롯 > 0` | 정상 수집 | `augments` 객체가 채워지고 LLM/UI 자동 반영 |

## 11. 덱 데이터 자체 집계 (교체 완료)

`lib/decksData.json` 은 더 이상 외부 사이트 추천 덱이 아니라, **Riot 래더 표본을 자체 집계**해
생성한 데이터다. (2026-10-18 교체 · `source: riot-meta-aggregate` · 24덱)

### 구성 방식

- 캐리: `metaStats.champions` 중 표본 200판 이상, 코스트 2~5
- BIS: `metaStats.combos` 에서 표본 20판 이상, 평균등수 상위 3개 (상징/엠블럼 제외)
- 주변 유닛: 캐리와 시너지가 겹치는 기물을 겹침 수 → 평균등수 순으로 최대 8유닛
- 활성 시너지가 2개 미만인 덱은 제외
- 보드 좌표(`index`)는 **null** → 덱 페이지/상세는 **"구성" 그리드**로 렌더링

### 데이터 소스

- `lib/metaStats.json` — Riot 실측 집계
- `lib/tftData.json` — 이름/아이콘(Data Dragon)
- `lib/championTraits.json` — 기물→시너지 **사실 관계** 매핑(67종, `extract:traits`로 재생성)
- 큐레이션된 덱 구성은 사용하지 않음

### 재생성 / 검증

```powershell
npm run build:decks        # lib/decksData.json 라이브 교체
npm run build:deck-preview # lib/decksData.preview.json (검토용)
npm run decks:check        # 무결성 검사 (CI에서도 실행)
npm run extract:traits     # championTraits.json 재추출
```

### 현재 결과

- 덱 24개, 유닛 매칭률 **0.97**, 중복 유닛 조합 0
- 활성 시너지 2~4개, 유닛 코스트 합 14~30
- 아이콘/이름/아이템 누락 0
- 티어: 대시보드는 **표 내 상대 순위**, 덱 페이지는 평균등수 절대 기준


## 12. Go-live 게이트 (운영 설정 점검)

배포 후 아래 명령으로 Riot/LLM/Redis/Turnstile/sitemap/덱 페이지를 한 번에 점검한다.

```powershell
npm run check:ops -- https://www.tftlab.kr           # 리포트 모드
npm run check:ops -- https://www.tftlab.kr --strict  # 미충족 시 exit 1
```

현재 프로덕션 진단 결과(2026-10-18):

- ✅ health / Riot / LLM / sitemap(38 URLs, 덱 34) / 덱 페이지
- ❌ **Redis 미설정** → 쿼터·LLM 예산이 인스턴스별로만 동작
- ❌ **Turnstile 미설정** → 검색 봇 차단 없음

### Redis (5분)

1. https://console.upstash.com → Create Database (리전: 서울/도쿄 권장)
2. REST URL / REST TOKEN 복사
3. Vercel → Settings → Environment Variables (Production + Preview)
   ```
   UPSTASH_REDIS_REST_URL=...
   UPSTASH_REDIS_REST_TOKEN=...
   ```
4. Redeploy → `/api/health` 의 `cache.backend` 가 `redis+memory` 인지 확인

### Turnstile (10분)

1. Cloudflare Dashboard → Turnstile → Add site
   - Hostnames: `www.tftlab.kr`, `tftlab.kr`, `localhost`
   - Widget mode: Managed
2. Vercel 환경변수 등록 후 **재배포** (site key는 빌드 타임에 인라인)
   ```
   NEXT_PUBLIC_TURNSTILE_SITE_KEY=...
   TURNSTILE_SECRET_KEY=...
   ```
3. `npm run check:ops -- https://www.tftlab.kr --strict`
   - 토큰 없는 검색이 **403**으로 차단되는지 자동 확인

### 상업화 전

- Vercel **Pro** 플랜 (Hobby는 상업적 이용 금지)
- DeepSeek/Gemini 콘솔에서 **월 하드 스펜드 리밋** 설정
- `check:ops --strict` 통과를 배포 게이트로 사용

## 13. 일일 운영 점검 (GitHub Actions)

`.github/workflows/ops-check.yml`

- **매일 10:30 KST** (01:30 UTC) — 10:00 KST 키 교체 루틴 이후 실행
- 수동 실행: Actions → Ops Check → Run workflow (URL 입력 가능)

### 검사 항목

1. **Riot 키 유효성** (repository secret `RIOT_API_KEY`로 Account API 직접 호출)
   - `200/404/429` → 키 유효
   - `401/403` → 만료/무효 → **워크플로우 실패** (키 교체 루틴 확인)
2. **`check:ops --strict`**
   - health / Redis / Turnstile / 토큰 없는 검색 403 / sitemap·덱 페이지
3. 결과를 **Job Summary**에 기록

### 알림

- 실패 시 GitHub Actions 알림(메일)이 발송된다. Settings → Notifications 에서
  Actions 실패 알림이 켜져 있는지 확인.
- GitHub는 **60일간 레포 활동이 없으면 예약 워크플로우를 비활성화**할 수 있다.
  (주기적 커밋 또는 수동 Run workflow로 유지)

> 사이트(Vercel)의 키와 GitHub secret은 키 교체 루틴이 함께 갱신한다.
> 한쪽만 갱신되면 이 워크플로우 또는 `/api/health`에서 차이가 드러난다.

## 14. 계정 · 플랜 · 사용자 쿼터 (Supabase)

- 로그인: Discord OAuth (Supabase Auth) — **선택 사항**
- 미설정 시: 로그인 UI 숨김 + 기존 IP 기준 쿼터로 동작
- 설정 시: 로그인 사용자는 `profiles.plan` 에 따라 free 10 / pro 50 (AI 분석 기준) 적용
- 사용량은 `usage_daily` 에 KST 일자로 저장, RPC 로 원자적 증가

설정 절차: **`docs/supabase-auth.md`** 참고

환경변수:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
QUOTA_ANALYSIS_PRO_PER_DAY=50
```

확인:

```powershell
curl https://www.tftlab.kr/api/me
# configured/user/plan/usage/limits 확인
```

## 15. 제품 이벤트 계측 (P0-1)

검색 → 분석 → 공유/로그인 전환을 숫자로 보기 위한 자체 계측이다. 외부 분석 SDK 는 쓰지 않는다.

### 계약

```
POST /api/events
Content-Type: application/json
{ "name": "search_submit", "sessionId": "<uuid>", "props": { "surface": "coach" }, "route": "/" }

→ 204 No Content (Cache-Control: no-store)
→ 400 알 수 없는 이벤트 / sessionId 형식 오류
→ 429 IP당 120회/분 초과
→ 405 POST 외 메서드
```

- 이벤트 이름은 **화이트리스트**만 허용: `search_submit`, `search_success`, `analysis_click`,
  `analysis_success`, `tab_view`, `deck_open`, `share_click`, `login_click`, `pro_waitlist_click`
- `sessionId` 는 브라우저 sessionStorage 의 UUID (탭 단위, 브라우저 종료 시 소멸)
- **PII 미수집**: `props` 키 이름 차단 목록 + 이메일 패턴 차단 + 서버 재정제.
  경로는 `/profile/[region]/[name]/[tag]` 로 마스킹된다.
- Turnstile 은 적용하지 않는다(집계용). 남용은 IP 레이트리밋으로 완화한다.

### 저장 위치

| 조건 | 저장 |
| --- | --- |
| Supabase env 설정 + `0002_events.sql` 적용 | `public.events` (insert-only RLS) |
| Supabase 미설정/오류 | 구조화 로그 `analytics_event` (Vercel Log Drain 으로 집계) |

적용: Supabase SQL Editor 에서 `supabase/migrations/0002_events.sql` 실행.

### 확인

```powershell
curl -i -X POST http://localhost:3000/api/events -H "Content-Type: application/json" `
  -d '{"name":"search_submit","sessionId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","props":{"surface":"coach"},"route":"/"}'
# HTTP/1.1 204 No Content, cache-control: no-store

curl -s -X POST http://localhost:3000/api/events -H "Content-Type: application/json" `
  -d '{"name":"nope","sessionId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890"}'
# {"success":false,"error":"알 수 없는 이벤트입니다."}
```

서버 로그(Supabase 미설정 시):

```json
{"level":"info","event":"analytics_event","name":"search_submit","sessionId":"...","route":"/","props":{"surface":"coach"}}
```

### 집계 쿼리

```sql
-- 이벤트별 최근 7일 건수
select name, count(*) from public.events
 where created_at > now() - interval '7 days'
 group by name order by 2 desc;

-- 일별 세션 수
select date_trunc('day', created_at) as day, count(distinct session_id) as sessions
  from public.events where created_at > now() - interval '14 days'
  group by 1 order by 1 desc;

-- 검색 대비 분석 실행률 (게이트 지표)
select
  count(*) filter (where name = 'search_success') as searches,
  count(*) filter (where name = 'analysis_click') as analysis_clicks
from public.events where created_at > now() - interval '7 days';
```

### 보관

90일 보관을 권장한다. pg_cron 이 없으면 운영자가 주기적으로 실행한다.

```sql
delete from public.events where created_at < now() - interval '90 days';
```

### 이벤트 추가 절차

1. `lib/eventSchema.ts` 의 `ANALYTICS_EVENT_NAMES` 에 이름 추가
2. 배선할 컴포넌트에서 `track('새_이벤트', { ... })` 호출
3. `app/privacy/page.tsx` 수집 항목/목적에 반영 (필요 시)
4. `npm run typecheck && npx eslint <변경 파일> && npm run build`

## 16. 랭크/티어 표시 (P0-2)

- 엔드포인트: `GET https://{platform}.api.riotgames.com/tft/league/v1/by-puuid/{puuid}` (TFT-LEAGUE-V1)
- 큐: 응답 배열에서 `queueType === 'RANKED_TFT'` 만 사용
- 캐시: `rank:{platform}:{puuid}` **10분**(`CACHE_TTL.RANK`). 배치 중(`null`)도 캐시한다.
- 폴백: **404(배치 미완료) / 429 / 401 / 타임아웃 / 네트워크 오류 → `null`**.
  랭크는 부가 정보이므로 실패해도 검색·프로필은 정상 동작하고 UI는 “배치 중”을 표시한다.
- 노출 위치: `/api/tft/search` → `summonerProfile.rank`, 홈 프로필 카드, `/profile` 페이지,
  `/profile/.../opengraph-image` (티어 칩)
- 비용: 검색 1회당 Riot 호출 **+1** (matchIds 와 병렬 조회라 체감 지연은 거의 동일)

### 확인

```powershell
# 배치 중/미조회 계정은 rank: null, UI 는 "배치 중"
curl -s -X POST http://localhost:3000/api/tft/search -H "Content-Type: application/json" `
  -d '{"gameName":"Hide on bush","tagLine":"KR1","limit":2}' | Select-String rank

# 데모(키 없음/isDemo) 는 예시 랭크를 반환하며 isDemo:true 로 구분된다
curl -s -X POST http://localhost:3000/api/tft/search -H "Content-Type: application/json" `
  -d '{"gameName":"Demo","tagLine":"KR1","isDemo":true,"limit":1}'
```

### 모니터링

| 로그/카운터 | 의미 |
| --- | --- |
| `riot.cache_hit.rank` | 캐시 히트 (10분 TTL) |
| `riot_league_fallback` + `status` | 랭크 조회 실패 → null 폴백 (404 는 정상) |
| `riot.league_fallback.401` 급증 | Riot 키 만료 → 키 교체 루틴 확인 |

## 17. 즐겨찾기 · 최근 검색 (P0-3)

### 동작

| 상태 | 저장 위치 | 개수 |
| --- | --- | --- |
| 비로그인 | 브라우저 `localStorage` (`tftlab:recent`) | 최대 5개 |
| 로그인 | Supabase `public.favorites` (RLS 본인만) | 최대 20개 |

- UI: 검색창 아래 “최근 검색 / 즐겨찾기” 칩. 클릭 시 즉시 재검색, ☆/★ 로 즐겨찾기 토글, × 로 최근 검색 삭제.
- 최근 검색은 로그인 여부와 무관하게 항상 기록된다. (기기 로컬)
- 최근 검색에는 개인정보가 서버로 전송되지 않는다.

### API

```
GET    /api/favorites                          → 200 {favorites:[...], max:20}
POST   /api/favorites  {gameName, tagLine}     → 201(신규) / 200(이미 있음) / 409(20개 초과)
DELETE /api/favorites?gameName=..&tagLine=..   → 200 {removed:true|false}
→ 비로그인 401, Supabase 미설정 GET 은 200(configured:false, 빈 목록)
```

### 설정

1. Supabase SQL Editor 에서 `supabase/migrations/0003_favorites.sql` 실행
2. Vercel env(`NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY`) 등록 후 재배포
3. `/` 에서 로그인 → 검색 → 최근 칩의 ☆ → 즐겨찾기 줄에 나타나는지 확인

### 확인 쿼리

```sql
-- 사용자별 즐겨찾기 수
select user_id, count(*) from public.favorites group by user_id order by 2 desc;

-- 최근 추가
select region, game_name, tag_line, created_at
  from public.favorites order by created_at desc limit 20;
```

### 주의

- `favorites` 는 **anon 권한이 없다**(로그인 필수). 서버도 `service role key` 를 쓰지 않는다.
- UPDATE 정책은 의도적으로 없다. 값 수정이 필요하면 삭제 후 추가한다.
- 개수 상한 20 은 API 레벨 강제다. DB 제약이 아니므로 새 경로를 추가할 때 상한을 다시 적용해야 한다.
- 마이그레이션 미적용 상태에서는 GET 이 503(`즐겨찾기를 불러오지 못했습니다.`)을 반환하고
  UI 는 즐겨찾기 줄을 숨긴다. 최근 검색은 정상 동작한다.












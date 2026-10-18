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






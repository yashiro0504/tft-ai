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



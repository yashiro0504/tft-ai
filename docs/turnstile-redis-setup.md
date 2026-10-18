# Turnstile / Redis 운영 설정 기록

2026-10-18, TFT LAB 공개 전 보안·캐시 설정을 마무리하며 남긴 기록입니다.

## Upstash Redis (분산 캐시)

- DB 이름: `tftlab-cache`
- 리전: N. Virginia (`us-east-1`) — Vercel 함수 실행 리전(`iad1`)과 동일
- 플랜: Free (250MB / 10GB 대역폭)
- Vercel 환경변수 (Production + Preview)
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`
- 확인: `/api/health` → `cache.backend = "redis+memory"`, `redisConfigured = true`

## Cloudflare Turnstile (검색 봇 차단)

- 위젯 이름: `TFT LAB`
- 위젯 모드: Managed
- 호스트네임: `www.tftlab.kr`, `tftlab.kr`, `localhost`
- Vercel 환경변수 (Production + Preview)
  - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (Config 타입으로 둘 것 — Secret/Sensitive 로 저장하면 클라이언트 번들에 인라인되지 않는다)
  - `TURNSTILE_SECRET_KEY` (Secret)
- 확인
  - `/api/health` → `turnstile.configured = true`, `enforced = true`, `siteKeyConfigured = true`
  - 토큰 없이 `POST /api/tft/search` → `403 TURNSTILE_FAILED`
- 일시 해제가 필요하면 `TURNSTILE_ENFORCE=false` 로 재배포 (fail-open 정책)

## 참고

- `NEXT_PUBLIC_*` 는 빌드 시점에 인라인된다. 값을 추가·변경한 뒤에는 **Redeploy(기존 캐시 미사용)** 또는 새 커밋으로 배포해야 반영된다.
- Cloudflare 계정은 Turnstile 전용으로 새로 만든 계정을 사용 중이며, 기존 온루틴 DNS 존과는 무관하다.

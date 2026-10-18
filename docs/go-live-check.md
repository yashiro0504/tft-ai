# Go-live 점검 결과 (2026-10-18)

`check:ops --strict` 가 요구하는 항목을 실제 프로덕션(https://www.tftlab.kr)에서 확인한 기록입니다.

| 항목 | 결과 |
|---|---|
| `/api/health` 200 · status ok | ✅ |
| Riot 키 설정 | ✅ `integrations.riot = true` |
| LLM 키 설정 | ✅ `integrations.deepseek = true` |
| Redis 분산 캐시 | ✅ `cache.backend = redis+memory`, `redisConfigured = true` |
| Turnstile 강제 + site key | ✅ `configured/enforced/siteKeyConfigured = true` |
| 토큰 없는 검색 차단 | ✅ `POST /api/tft/search` → 403 `TURNSTILE_FAILED` |
| sitemap 덱 URL | ✅ 34개 |
| 덱 페이지 응답 | ✅ 200 |
| health 경고 | ✅ 없음 (warnings: []) |

## 배포 시 주의

- `NEXT_PUBLIC_*` 값은 빌드에 인라인된다. 값을 추가/수정한 뒤 **Redeploy 만으로는 반영되지 않는 경우가 있었다**(이전 배포의 환경변수 스냅샷 사용). 새 커밋으로 배포하거나 빌드 캐시를 끄고 재배포할 것.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` 는 Cloudflare 대시보드의 값과 **문자 단위로 일치**해야 한다(끝자리 누락 시 위젯이 "Troubleshoot" 오류를 표시).

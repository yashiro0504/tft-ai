# P3 유료화 게이트 — 집계 가이드

최종 갱신: 2026-10-18
관련 파일: `supabase/queries/p3_gate.sql`, `supabase/migrations/0004_events_visitor.sql`,
`docs/HANDOFF.md`

## 0. 전제

- `public.events` 는 **insert-only** 다. 집계는 Supabase Dashboard → SQL Editor(postgres/service role)에서만 실행한다.
- `0002_events.sql` 적용 후 **`0004_events_visitor.sql`** 을 적용하고, 새 클라이언트를 배포해야 한다.
  - `0004` 는 localStorage 기반 `visitor_id` 를 추가한다. 기존 행은 `session_id` 로 백필된다.
- `events` 보관 기간은 90일을 권장한다. 그보다 긴 리텐션은 계산할 수 없다.
- **D7 리텐션은 최소 13일치 데이터가 쌓인 뒤**에 의미가 있다. 배포 직후에는 `INSUFFICIENT` 로 나온다.
- 일자 경계는 **KST(Asia/Seoul)** 기준이다.

## 1. 지표 정의와 게이트

| 지표 | 정의 | 분모 | 게이트 | SQL 섹션 |
| --- | --- | --- | --- | --- |
| D7 리텐션 | 첫 방문일(KST) +7일에 다시 활동한 방문자 | 첫 방문 후 13~35일 지난 코호트 | **≥ 15%** | 4 |
| 검색→AI 분석 실행률 | 같은 세션에서 `search_submit` 후 `analysis_click` 발생 | 검색 세션 | **≥ 30%** | 2 |
| Pro 의향 클릭률 | `pro_waitlist_click` 이 있는 고유 방문자 | 기간 내 활성 방문자 | **≥ 5%** | 3 |
| 사전 구매 의향 | `pro_waitlist_click` 고유 방문자 수 | — | **≥ 5명** | 3·5 |
| “없으면 아쉽다” | 베타 설문 5점 척도에서 4~5점 비율 | 베타 참여자 10~20명 | **≥ 40%** | 수동 설문 |

### 세부 정의

- **D7**: `visitor_id` 의 첫 이벤트 날짜를 코호트로 잡고, 정확히 7일째 되는 날(KST) 이벤트가 있으면 retained.
  - `d7plus`(7~13일 내 재방문)는 표본이 적을 때 보조로 본다. 게이트 판정은 strict D7.
  - `visitor_id = session_id` 인 폴백 행은 리텐션에서 제외한다(구버전/0004 이전 데이터).
- **검색→분석**: 세션 단위 전환이다. 한 세션에서 검색만 하고 끝났는지, 분석 버튼까지 눌렀는지를 본다.
  - `analysis_click` 은 실행 시도, `analysis_success` 는 성공이다. 게이트는 클릭 기준.
- **Pro 의향**: 기간 내 이벤트가 있는 고유 `visitor_id` 중 `pro_waitlist_click` 이 있는 비율.
  - 검색자 기준 비율(`pro_intent_pct_of_searchers`)도 함께 출력되지만 판정은 활성 방문자 기준.
- **사전 구매 의향**: Pro 대기자 버튼을 누른 고유 방문자 수. 5명 이상이면 통과.
- **설문**: 이벤트로 측정할 수 없다. 베타 참여자에게 “TFT LAB이 없으면 아쉬울 것 같다”를
  1~5점으로 묻고 4~5점 비율을 계산한다. 응답 원문/개인정보는 별도 동의 없이 이벤트 테이블에 넣지 않는다.

## 2. 실행 방법

1. Supabase SQL Editor 에서 `supabase/migrations/0002_events.sql`, `0004_events_visitor.sql` 을 적용한다.
2. `supabase/queries/p3_gate.sql` 전체를 붙여넣고 실행한다.
3. 섹션별 결과를 확인한다.
   - 0: 데이터 품질(`fallback_pct`) — 5% 이상이면 0004 배포 전 데이터가 섞인 것이다.
   - 1: DAU/세션 추이
   - 2: 검색→분석 전환
   - 3: Pro 의향
   - 4: D1/D7/D7+
   - 5: 게이트 요약(`PASS` / `FAIL` / `INSUFFICIENT`)
4. `INSUFFICIENT` 는 표본 30명 미만이다. 기준을 낮추지 말고 데이터를 더 모은다.
5. 설문 결과를 같은 기간으로 집계해 5번째 지표를 수동으로 채운다.

## 3. 데이터 품질 / 해석 주의

- **방문자 ID 초기화**: 시크릿 모드, 브라우저 데이터 삭제, 기기 변경 시 새 `visitor_id` 가 발급된다.
  → D7 리텐션은 실제보다 **낮게** 나올 수 있다(보수적 추정).
- **폴백 행**: `0004` 이전 이벤트는 `visitor_id = session_id` 다. 리텐션/퍼널에서 제외하거나
  배포 후 13일이 지난 뒤부터 판정한다.
- **봇/중복**: `/api/events` 는 IP당 분당 120건으로 제한하지만, 완전한 봇 차단은 아니다.
  비정상적으로 DAU 대비 이벤트가 많으면 `route`/`name` 분포를 확인한다.
- **표본 30명 미만**: 비율은 우연에 흔들린다. `INSUFFICIENT` 로 두고 베타 참여자를 늘린다.
- **90일 보관**: `delete from public.events where created_at < now() - interval '90 days';`
  를 주기적으로 실행한다. 삭제 후에는 과거 코호트 리텐션을 재계산할 수 없다.

## 4. 판정 규칙

- 5개 지표가 모두 `PASS` → **P3(결제) 준비 시작**. PG/약관/환불 정책을 별도 검토한다.
- D7만 `INSUFFICIENT` → 데이터를 더 모은다. 임계값을 낮추지 않는다.
- 검색→분석이 30% 미만 → 결제보다 **첫 경험/CTA 개선**이 먼저다.
- Pro 의향이 5% 미만 → 가격·혜택·문구를 조정하고 `/pro` 유입 경로를 점검한다.
- 판정 결과는 날짜·표본·수치를 이 문서에 기록한다.

## 5. 검증 (2026-10-18)

- `sqlglot` PostgreSQL 파서: `p3_gate.sql` **6개 문**, `0004_events_visitor.sql` **11개 문** 통과.
- PGlite(Postgres WASM)에 12건 픽스처를 넣고 전체 SQL 실행:
  - 검색 세션 4 / 분석 세션 2 → **50.00%**
  - 활성 방문자 6 / Pro 클릭 2 → **33.33%**, 사전 구매 의향 2명
  - D7 코호트 3 / 유지 1 → **33.33%** (D1·D7+ 동일)
  - 표본이 30명 미만이라 게이트 요약은 모두 **`INSUFFICIENT`** (설계대로)
- 실제 Supabase에서는 `0004` 적용 + 새 클라이언트 배포 후 13일 이상 데이터로 실행한다.
  PGlite 결과는 SQL semantics 검증용이며 운영 수치가 아니다.

## 6. 프라이버시

- `visitor_id` 는 **임의 UUID** 이며 이메일·Riot ID·IP 등 개인정보를 포함하지 않는다.
- 사이트 간 추적, 광고, 제3자 판매에 사용하지 않는다.
- 저장 위치: 브라우저 `localStorage` (`tftlab:visitor`). 서버 이벤트 기록은 최대 90일.
- 이메일 알림/결제 정보 수집을 추가하려면 동의·보관·파기 정책을 먼저 개정한다.
  현재 `/pro` 는 클릭 이벤트만 수집한다.

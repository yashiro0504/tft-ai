# 데이터 플랫폼 v2 설계 — DB 저장 · 수집 확대 · 티어/패치/기간 필터

> 상태: **Phase A·B 구현 완료 (2026-10-20)** · 운영 설정 대기 (§12, §13) · Phase C 설계
> 결정: Supabase 무료 플랜 · KR 마스터+ · 원본 최근 1패치 보관 · 프로덕션 키는 운영자가 별도 신청
> 목표: 롤체지지 / MetaTFT 수준의 통계 기능(티어·패치·기간 필터, 기물×아이템 조건 통계, 덱 티어표)을
> 받칠 수 있는 데이터 기반을 만든다.
> 실행 가이드(현행 스크립트 사용법)는 [DATA_PIPELINE.md](DATA_PIPELINE.md) 를 본다.

---

## 0. 요약

| 항목 | 지금 | v2 |
| --- | --- | --- |
| 저장 | `data/ladderBoards.json`(CI에서 매번 새로 만듦) → 집계 JSON 을 git 커밋 | **Supabase Postgres**: 원본 보드 + 일별 집계 테이블 |
| 표본 | KR 마스터+ 60명 × 8판, 하루 최대 400판 (누적 안 됨) | 티어 구간별 시드, **하루 수천~수만 판 누적** |
| 필터 | 없음 (단일 스냅샷) | **패치 · 티어(챌/그마+/마스터+/다이아+) · 최근 N일** |
| 서빙 | 빌드 타임 import (`lib/metaStats.json`) | `/api/tft/stats` + CDN 캐시, 빌드와 분리 |
| Riot 키 | 개발 키 (24시간 만료, 공개 서비스 금지) | **프로덕션 키** (500/10초 · 30,000/10분) |

가장 먼저 할 일은 코드가 아니라 **Riot 프로덕션 키 신청**이다 (§2).

---

## 1. 현재 구조와 한계

```
GitHub Actions (매일 06:00 KST)
  └ collectLadderBoards.js  — 챌/그마/마스터 상위 60명 × 최근 8판, 최대 400판
      → data/ladderBoards.json   (커밋 안 함 → 다음 실행에 사라짐)
  └ buildMetaStatsLadder.js / buildDecksFromBoards.js
      → lib/metaStats.json (150KB), lib/decksData.json (470KB)  → git 커밋 → Vercel 재빌드
앱: lib/meta.ts, lib/decks.ts 가 JSON 을 빌드 타임에 import
```

한계:

1. **누적이 안 된다.** CI 러너는 매번 빈 상태라 `ladderBoards.json` 이 400판으로 다시 시작한다.
   현재 덱 데이터 1,244판도 로컬 수동 실행분이다. 기물 65종 기준 기물당 표본이 수십 건 수준이다.
2. **차원이 없다.** 패치·티어·날짜가 집계에 남지 않아 필터를 만들 수 없다 (`patch: "set18"` 고정).
3. **데이터가 코드와 묶여 있다.** 통계 갱신 = 커밋 + 전체 재빌드. 하루 1회 이상 갱신이 어렵다.
4. **증강 데이터가 없다.** 세트 18 매치에서 Riot 이 증강을 주지 않는다 (DATA_PIPELINE §9-1).
   MetaTFT 는 자체 데스크톱 앱(오버레이)으로 수집한다. → v2 범위 밖, §10 참고.
5. **라운드별 데이터가 없다.** match-v1 은 최종 보드만 준다. 레벨업·리롤 타이밍 통계는 불가.

---

## 2. 전제 조건

### 2-1. Riot 프로덕션 키 (필수, 선행)

Riot 정책상 **개발 키·개인 키로 공개 서비스를 운영할 수 없다.** 지금 배포된 사이트가 개발 키를 쓰고 있다면
정책 위반 상태이므로, 규모와 상관없이 프로덕션 키로 옮겨야 한다.

| 키 | 한도 (지역별 별도) | 용도 |
| --- | --- | --- |
| 개발 키 | 24시간 만료 | 프로토타입 |
| 개인 키 | 20/1초 · 100/2분 | 비공개 소규모 |
| **프로덕션 키** | **500/10초 · 30,000/10분부터** | 공개 서비스 |

- 신청: Developer Portal → *Register Project* → Production. 동작하는 프로토타입이 필요하다 (지금 사이트로 충분).
- 승인 기간은 프로젝트·지역마다 다르다. **신청을 오늘 넣고, 승인 전까지 Phase A 는 개발 키로 만든다.**
- 프로덕션 키는 만료되지 않으므로 aside 자동 갱신은 필요 없어진다. GitHub secret · Vercel env 는 그대로 교체한다.

### 2-2. Supabase 용량

이미 인증·이벤트에 Supabase 를 쓰고 있으므로 같은 프로젝트에 스키마를 추가한다. §8 추정상
원본 보드 1패치 ≈ 150~250MB 라서 **무료(500MB)로는 1패치 보관이 한계**다. Pro(8GB) 또는 보관 기간 축소를 결정해야 한다.

---

## 3. 목표 아키텍처

```
                 ┌──────────── 수집기 (GitHub Actions, 매시간 · ≤50분) ────────────┐
 league-v1  ──▶ │ ① 시드 갱신: 티어 구간별 선수 목록 (일 1회)                         │
 match-v1   ──▶ │ ② 선수별 새 매치 ID (startTime 커서) → DB 에 없는 ID 만             │
                 │ ③ 매치 상세 → 정규화 → tft_matches / tft_boards INSERT (멱등)       │
                 │ ④ 일별 집계 UPSERT (그날·그 패치·그 티어 구간만 재계산)            │
                 └───────────────────────────────┬──────────────────────────────────┘
                                                 ▼
                          Supabase Postgres  ─  raw(보관 2패치) + daily rollup(영구)
                                                 ▼
   Next.js  /api/tft/stats?patch=&tier=&days=  ── s-maxage 600 ──▶ CDN ──▶ 메타 대시보드 · 기물/아이템 페이지
            /api/tft/decks?patch=&tier=        (덱 클러스터: 집계 잡이 테이블로 저장)
```

원칙:

- **원본은 DB, 화면은 집계만 읽는다.** 사용자 요청이 원본 보드 테이블을 훑지 않게 한다 (탐색기 제외, §6-3).
- **수집은 멱등.** 같은 매치를 두 번 받아도 결과가 같다 (`match_id` PK + `on conflict do nothing`).
- **Riot 한도를 사용자 검색과 나눠 쓴다.** 수집기는 전체 한도의 60% 까지만 쓴다 (§4-4).
- **개인정보 최소화.** 통계 테이블에는 닉네임·PUUID 원문을 넣지 않는다 (§7).

---

## 4. 수집기 설계

### 4-1. 시드 (누구의 판을 받을 것인가)

티어 구간별로 선수를 고르고, 그 선수의 랭크 판을 "그 구간 판"으로 본다.

| 구간 (`tier_bucket`) | 출처 | 선수 수 (초기값) |
| --- | --- | --- |
| CHALLENGER | `league/v1/challenger` | 전원 (KR 약 300) |
| GRANDMASTER | `league/v1/grandmaster` | 전원 (약 700) |
| MASTER | `league/v1/master` | LP 상위 1,000 |
| DIAMOND | `league/v1/entries/DIAMOND/{I..IV}` | 페이지 순회 1,000 |
| (후순위) EMERALD | `league/v1/entries/EMERALD/...` | 필요 시 |

- `tft_seed_players(puuid_hash, puuid_enc, tier, lp, refreshed_at, last_match_at)` 에 저장하고 하루 1회 갱신한다.
- **판의 티어 = 시드 선수의 티어**로 근사한다. 같은 판이 여러 시드로 들어오면 가장 높은 티어를 쓴다.
  (MetaTFT 도 로비 평균 티어 근사를 쓴다. 로비 8명 전원의 리그 조회는 판당 8회 호출이라 하지 않는다.)

### 4-2. 증분 수집

```
for 선수 in 시드 (last_match_at 오래된 순, 이번 실행 예산만큼):
    ids = match-v1 /by-puuid/{puuid}/ids?startTime={last_match_at}&count=20
    new = ids - (DB 에 있는 match_id)          # 한 번의 IN 쿼리
    for id in new: 상세 조회 → 세트/큐 확인(set 18, queue 1100) → INSERT
    last_match_at = max(game_datetime)
```

- `startTime` 커서 덕분에 이미 본 판을 다시 받지 않는다. 상위권 선수끼리 판이 겹치므로 실제 상세 호출은 ID 수보다 훨씬 적다.
- 실패한 판은 `tft_fetch_failures` 에 남기고 다음 실행에서 3회까지 재시도한다.

### 4-3. 실행 환경

- **GitHub Actions 매시간 cron**, `timeout-minutes: 55`, `concurrency` 로 겹침 방지 (지금 워크플로를 확장).
- 실행 결과는 DB 에만 쓰고 **git 커밋을 하지 않는다** → Vercel 재빌드 없음.
- 볼륨이 Actions 한도(월 2,000분, 공개 저장소면 무제한)를 넘으면 소형 VM/Fly.io 워커로 옮긴다.

### 4-4. 호출 예산 (프로덕션 키 기준, asia 라우팅)

| 항목 | 값 |
| --- | --- |
| 한도 | 30,000 / 10분 = 50/초 |
| 수집기 상한 | **60% = 30/초** (나머지는 사용자 검색·분석) |
| 1시간 실행 50분 | 최대 약 90,000 호출 |
| 판당 호출 | 상세 1 + ID 목록 몫 약 0.3 ≈ 1.3 |
| 시간당 신규 판 | 상위권 판 생성 속도에 막힘 (KR 다이아+ 기준 하루 수만 판 예상) |

- 수집기와 앱이 같은 키를 쓰므로 429 가 나면 수집기가 먼저 물러난다 (`Retry-After` + 지수 백오프, 앱은 기존 재시도 유지).
- 개발 키(100/2분)로는 시간당 약 3,000 호출 → **하루 수천 판이 한계**. Phase A 검증용으로만 쓴다.

---

## 5. 스키마

Phase A 테이블의 실제 정의는 [supabase/migrations/0005_tft_stats.sql](../supabase/migrations/0005_tft_stats.sql) 이다.
아래 초안과 달라진 점 (구현 중 실측으로 바꿈):

- **보드 형식**: jsonb 객체 대신 고정 폭 `smallint[]` — `units` = [기물, 성급, 아이템×3] × N, `traits` = [시너지, 인원, 단계] × N.
  PGlite(Postgres 16) 실측 **판당 12.6KB → 2.6KB**. 해석은 `scripts/collect/normalize.js` 의 `decodeUnits / decodeTraits`.
- **패치**: Riot `game_version` 이 `"TFT Unreal Version ?.?.?.?"` 로 바뀌어 패치 번호가 없다. 수집기가 매 실행 Data Dragon
  최신 버전을 `tft_patches(patch, first_seen_at)` 에 기록하고, 판의 패치 = 판 시각 이전에 처음 보인 패치 중 최신으로 정한다
  (경계 오차는 수집 간격 1시간 이내).
- **GIN 인덱스 보류**: `unit_ids` GIN 은 판당 1.6KB 라 탐색기(Phase C)에서 만든다.
- **last_round**: Riot 원값(누적 라운드 수)을 그대로 저장한다.
- **티어**: 처음 받은 시드의 티어로 기록하고, 더 높은 티어 시드에서 다시 만나면 `tft_raise_tier` 로 올린다.
- 추가 테이블: `tft_patches`, `tft_fetch_failures`(3회까지 재시도), `tft_collect_runs`(실행 기록).
- RPC: `tft_ingest_match`(매치+보드 8행 한 트랜잭션, 멱등) · `tft_raise_tier` · `tft_prune_raw` · `tft_raw_size_mb` — 모두 service role 전용.

초안 (Phase B 집계 테이블 참고용):

```sql
-- 사전: 기물·아이템·시너지 ID → 번호 (세트가 바뀌어도 누적)
create table tft_dict (
  id smallserial primary key,
  kind text not null check (kind in ('unit','item','trait')),
  api_id text not null,               -- TFT18_Ahri
  unique (kind, api_id)
);

create table tft_matches (
  match_id text primary key,          -- KR_7234567890
  platform text not null,             -- kr
  set_number smallint not null,
  patch text not null,                -- game_version 에서 파싱: '15.20'
  queue_id smallint not null,
  game_at timestamptz not null,
  game_date date not null,            -- KST 기준 날짜 (일별 집계 키)
  game_length_sec smallint,
  tier_bucket text not null,          -- CHALLENGER | GRANDMASTER | MASTER | DIAMOND
  collected_at timestamptz not null default now()
);
create index on tft_matches (patch, tier_bucket, game_date);

-- 보드 1개 = 참가자 1명의 최종 상태 (판당 8행)
create table tft_boards (
  match_id text not null references tft_matches on delete cascade,
  placement smallint not null,
  level smallint not null,
  last_round smallint not null,       -- 스테이지*10+라운드 (5-2 → 52)
  gold_left smallint,
  damage smallint,
  unit_ids smallint[] not null,       -- 탐색기용 (GIN)
  units jsonb not null,               -- [{u:12, s:2, i:[40,51,7]}]  u=unit, s=성급, i=아이템
  traits jsonb not null,              -- [{t:3, n:6, tier:2}]
  primary key (match_id, placement)
);
create index on tft_boards using gin (unit_ids);

-- 일별 집계 (영구 보관). 같은 모양으로 trait / item / unit_item / comp 테이블을 둔다.
create table stat_unit_daily (
  game_date date not null,
  patch text not null,
  tier_bucket text not null,
  unit smallint not null,
  star smallint not null,             -- 0 = 성급 무관 합계
  games int not null,
  placement_sum int not null,
  top4 int not null,
  wins int not null,
  primary key (game_date, patch, tier_bucket, unit, star)
);
-- stat_item_daily(item), stat_trait_daily(trait, tier), stat_unit_item_daily(unit, item)

-- 덱(조합) 클러스터: 집계 잡이 패치·티어 구간별로 다시 만든다
create table stat_comp (
  patch text, tier_bucket text, comp_id text,
  core_units smallint[], games int, placement_sum int, top4 int, wins int,
  sample_board jsonb, updated_at timestamptz,
  primary key (patch, tier_bucket, comp_id)
);
```

- RLS: 통계 테이블은 `select` 공개(anon), 쓰기는 service role 만. 원본 테이블(`tft_boards`, `tft_seed_players`)은 anon 접근 불가.
- `game_date` 를 KST 로 두면 "최근 7일" 이 한국 사용자 체감과 맞는다.

---

## 6. 집계와 서빙

### 6-1. 일별 집계

- 수집기 ④단계에서 **이번 실행에 들어온 (game_date, patch, tier_bucket) 조합만** 다시 계산해 UPSERT 한다.
  원본에서 `group by` 하므로 재실행해도 결과가 같다.
- 덱 클러스터(`buildDecksFromBoards.js` 로직)는 1일 1회, 패치 × 티어 구간별로 원본을 읽어 `stat_comp` 를 다시 만든다.

### 6-2. 필터 정의

| 필터 | 값 | 계산 |
| --- | --- | --- |
| 패치 | 최신 패치(기본) · 이전 패치 | `patch = ?` |
| 티어 | 챌린저 · 그마+ · 마스터+(기본) · 다이아+ | `tier_bucket in (...)` (누적 구간) |
| 기간 | 3일 · 7일(기본) · 패치 전체 | `game_date >= today - N` |

- 응답 = 일별 행을 `sum` 해서 `avg_placement = placement_sum / games`, `top4_rate`, `win_rate`, `pick_rate = games / (판 수×8)`.
- **표본 하한**: 기물·아이템 `games ≥ 30`, 기물×아이템 `≥ 20`, 덱 `≥ 15` 미만은 회색 처리 + "표본 부족" (지금 `minGames` 규칙 확장).
- 신뢰구간을 같이 내려 준다: 평균등수 표준오차 ≈ `2.29 / √games` (등수 1~8 균등분포 표준편차 기준) → UI 에 ± 표시.

### 6-3. API

| 경로 | 내용 | 캐시 |
| --- | --- | --- |
| `GET /api/tft/stats?type=unit&patch=&tier=&days=` | 기물·아이템·시너지 표 | `s-maxage=600, stale-while-revalidate=3600` |
| `GET /api/tft/stats?type=unit_item&unit=` | 기물별 아이템 추천 (BIS). `unit` 은 슬러그(`ahri`)·수집 키(`Ahri`)·Riot ID(`TFT18_Ahri`) 모두 허용, 응답 `unit` = 맞춘 슬러그, `totalBoards` 는 거르기 전 분모 | 동일 |
| `GET /api/tft/decks?patch=&tier=` | 덱 티어표 | 동일 |
| `GET /api/tft/meta/filters` | 사용 가능한 패치·표본 수 | 10분 |

Phase C 예정 (미구현):

| 경로 | 내용 | 캐시 |
| --- | --- | --- |
| `GET /api/tft/explore?units=&items=` | 조건부 통계 (원본 GIN 쿼리) | 30분 · 요청 rate limit |

- 기존 `lib/metaStats.json` / `decksData.json` 은 **폴백**으로 남긴다 (DB 장애 시·로컬 개발). 앱은 API → 실패 시 JSON 순서로 읽는다.
  DB 오류(`db_error`)가 나면 그 키는 20초 동안 DB 를 다시 기다리지 않고 바로 JSON 으로 폴백한다 (`lib/tftStats.ts` failMemo).
- AI 코칭 프롬프트의 `[메타 실측 통계]`도 같은 API 의 "최신 패치 · 마스터+ · 7일" 값을 쓴다 → 리포트에 패치·표본 n 이 정확히 찍힌다.

---

## 7. 개인정보 · 정책

- 통계 테이블에는 닉네임·태그·PUUID 를 넣지 않는다 (지금 `collectLadderBoards.js` 원칙 유지).
- 시드 테이블은 다음 호출을 위해 PUUID 가 필요하므로 `puuid_enc`(수집기에서 AES-256-GCM 암호화) + `puuid_hash`(HMAC-SHA256)로 저장하고 anon 접근을 막는다.
  두 키는 GitHub secret `TFT_SEED_KEY` 하나에서 HKDF 로 만든다 (`scripts/collect/seedCrypto.js`). 키를 잃어도 시드는 다음 날 리그 목록에서 다시 만들어진다.
  그동안 복호화할 수 없는 시드는 건너뛰고(커서만 밀고) 나머지 시드로 수집을 계속하며, 건수를 `tft_collect_runs.note` 에 남긴다.
- 원본 보드 보관: **최근 1패치** (`KEEP_PATCHES`, 무료 플랜 결정). 매 실행 끝에 `tft_prune_raw` 로 이전 패치를 지운다. 일별 집계(Phase B)는 영구 보관.
  집계 갱신이 실패한 실행에서는 원본 정리를 건너뛴다(집계되지 않은 원본을 지우지 않도록, `note` 에 사유).
- Riot 정책상 통계·전적 표시는 허용 범위이며, 페이지 하단 비제휴 고지는 이미 있다. 프로덕션 키 신청서에 수집 범위(티어·지역·보관 기간)를 그대로 적는다.

---

## 8. 용량 · 비용 (실측 반영, 1패치 ≈ 14일)

| 항목 | 값 |
| --- | --- |
| 원본 1판 (실측) | 테이블+기본키 **2.6KB** (jsonb 형식이면 12.6KB) |
| 무료 플랜 가드 | `MAX_RAW_MB=400` → 약 15.5만 판 |
| 기본 수집량 | 시간당 200판(`MAX_MATCHES`) × 23회 ≈ 하루 4,600판 → 패치당 약 6.4만 판 ≈ **170MB** |
| 다이아+ 확대 시 | 하루 1만 판 → 패치당 14만 판 ≈ 360MB (무료 한도 근접 → Pro 고려) |
| 일별 집계 | 기물 65 × 성급 4 × 티어 4 × 14일 ≈ 1.5만 행/패치 (수 MB) |
| 기물×아이템 | 65 × 약 60 × 4 × 14 ≈ 22만 행/패치 (수십 MB) |

→ 마스터+ · 1패치 보관은 무료 플랜으로 충분하다. 다이아+ 를 2패치 보관하거나 Phase B 집계까지 쌓이면 **Supabase Pro($25/월, 8GB)** 를 검토한다.

---

## 9. 단계별 계획

### Phase A — DB 적재 (2~3일)

- [x] `supabase/migrations/0005_tft_stats.sql` (사전·matches·boards·patches·seed·실패·실행 기록, RLS, RPC 4개) — PGlite 로 검증
- [x] `scripts/collectDb.js` + `scripts/collect/` : 시드 갱신 · 증분 수집(startTime 커서) · 멱등 적재 · 실패 재시도 · 용량 가드 · 패치 정리
- [x] 패치 달력(Data Dragon) · `tier_bucket` · KST 날짜
- [x] `.github/workflows/collect-db.yml` : 매시간(21시 UTC 제외), DB 쓰기만 (기존 JSON 워크플로는 폴백으로 유지)
- [x] 테스트: `npm run test:collect` (가짜 Riot · 메모리 저장소, CI 포함), 실제 Riot 드라이런 `npm run collect:db:dry`
- [ ] **운영 설정 (§12)** 후 3일 연속 실행 — 완료 기준: 누적 판 수 증가, 중복 0, 실패율 < 1%

### Phase B — 집계 + 필터 서빙 (3~4일)

- [x] `supabase/migrations/0006_tft_rollups.sql`: 일별 집계 5종(+ `stat_daily_totals` 픽률 분모), 공개 select RLS,
      `tft_refresh_rollup(date, patch, tier)` (조합 단위로 지우고 원본에서 다시 넣음 · 원본 정리된 패치는 건드리지 않음),
      공개 조회 RPC `tft_stat_query` · `tft_stat_filters`, 덱 교체 `tft_replace_comps`, `tft_raw_combos`
- [x] 수집기 ④단계: 이번 실행에 적재·티어 상향된 조합만 재계산. 하루 1회(`DECK_REFRESH_HOURS`)는 원본 전체 조합 재계산 +
      최신 패치 덱 클러스터(`scripts/collect/decks.js`, `buildDecksFromBoards.js` 의 `buildDecks` 재사용, 티어 필터 4종)
- [x] `/api/tft/stats`, `/api/tft/decks`, `/api/tft/meta/filters` (`lib/tftStats.ts`, DB 실패 시 JSON 폴백, `source` 로 구분)
- [x] 메타 대시보드에 패치·티어·기간 필터, 표본 부족(회색·티어 제외·맨 아래)·± 표시
- [x] AI 프롬프트의 메타 통계를 같은 집계(최신 패치 · 마스터+ · 7일)로 교체 (`COACH_PROMPT_VERSION` 2026-10-20.1)
- [x] 테스트: `npm run test:rollup` (JS 집계 · 덱 클러스터 · JSON 폴백, CI 포함). `@electric-sql/pglite`(devDependency)로 0005+0006 을
      실제로 돌려 SQL 결과 = JS 결과(필터 160조합) · 멱등 · 티어 상향 · RLS · `lib/tftStats` 응답까지 비교. CI 는 `REQUIRE_PGLITE=1` 로 건너뜀을 실패 처리
- [x] 기물·아이템·시너지 상세 페이지 (`/champions/[slug]` 추천 아이템(BIS) · `/items/[slug]` · `/traits/[slug]`, `lib/entityData.ts`) — 같은 집계, DB 덱은 `/deck` 링크 없이 'DB 집계' 표시
- [ ] 운영: 0006 적용 후 `npm run collect:db:rollup` 1회 (§13) · 필터 조합별 p95 측정
- 완료 기준: 필터 조합별 응답 p95 < 300ms(CDN 미스 기준), JSON 폴백 동작 확인

### Phase C — 확장 (프로덕션 키 승인 후)

- [ ] 시드를 다이아까지 확대, 시간당 수집량 상향
- [ ] 조건부 탐색기(`/api/tft/explore`) — 기물×아이템 BIS 는 Phase B 의 `/champions/[slug]` 로 구현됨
- [ ] `/deck/[id]` 를 DB 덱(`stat_comp`) 기반으로 전환 (지금은 빌드 타임 JSON 덱만 페이지가 있음)
- [ ] 보관 정리 잡, 대시보드에 "수집 현황"(오늘 판 수·패치별 표본)
- [ ] (선택) 다른 지역 (JP/NA) — 지역별 한도가 따로라 같은 구조로 확장

---

## 10. 범위 밖 · 나중에

- **증강 통계**: Riot API 미제공. 데스크톱 오버레이 앱(Overwolf 등) 없이는 불가.
- **라운드별 레벨업·리롤 통계**: 최종 보드만 제공되어 불가. 6축의 "템포"도 최종 레벨 기준 근사로 남는다.
- **LP 그래프(프로필)**: Riot 이 LP 기록을 주지 않는다. 검색·즐겨찾기 시점마다 `rank_snapshots` 를 쌓는 별도 기능으로 설계한다 (이 문서의 DB 를 같이 쓴다).

---

## 11. 결정이 필요한 것

1. **프로덕션 키 신청** — 지금 넣을지 (권장: 즉시)
2. **Supabase 플랜** — 무료로 마스터+ 1패치 보관부터 vs Pro 로 다이아+ 2패치
3. **수집 범위** — 초기 티어 구간(마스터+ / 다이아+), 지역(KR 단독)
4. **수집 실행 위치** — GitHub Actions 매시간 (권장) vs 상시 워커
5. **원본 보관 기간** — 1패치 vs 2패치

---

## 12. Phase A 운영 설정 (운영자)

1. **SQL 실행** — Supabase 대시보드 → SQL Editor 에 `supabase/migrations/0005_tft_stats.sql` 전체를 붙여 실행 (재실행 안전).
2. **시드 키 만들기** — 로컬에서 한 번:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
   ```
3. **GitHub Repository secrets** (Settings → Secrets and variables → Actions)
   | 이름 | 값 |
   | --- | --- |
   | `SUPABASE_URL` | Supabase Project URL (`NEXT_PUBLIC_SUPABASE_URL` 과 같음) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` 키 (**Vercel·클라이언트에 넣지 말 것**) |
   | `TFT_SEED_KEY` | 2번에서 만든 값 |
   | `RIOT_API_KEY` | 기존 그대로 |
4. **첫 실행** — Actions → *Collect Matches to DB* → Run workflow (`dry_run: true` 로 한 번, 이어서 `false`).
5. **확인 쿼리** (SQL Editor)
   ```sql
   select started_at, finished_at, matches_added, matches_skipped, failures, riot_calls, note
     from tft_collect_runs order by id desc limit 10;
   select patch, tier_bucket, count(*) from tft_matches group by 1, 2 order by 1 desc, 2;
   select tft_raw_size_mb();
   ```
6. **프로덕션 키 승인 후** — Repository *variables* 에 `RIOT_MIN_INTERVAL_MS=34` (한도 60%), 필요하면 `MAX_MATCHES` 상향.
   GitHub secret · Vercel env 의 `RIOT_API_KEY` 를 함께 교체한다.

조절 변수 (Repository variables, 없으면 기본값): `RIOT_MIN_INTERVAL_MS`(2500) · `MAX_MATCHES`(200) · `SEED_TIERS`(challenger,grandmaster,master) · `MASTER_LIMIT`(1000) · `KEEP_PATCHES`(1) · `MAX_RAW_MB`(400)

> 개발 키를 쓰는 동안은 기본 간격 2500ms(약 48회/2분)로 키 한도(100회/2분)의 절반만 쓴다. 나머지는 사이트의 전적 검색 몫이다.

---

## 13. Phase B 운영 설정 (운영자, §12 이후)

1. **SQL 실행** — SQL Editor 에 `supabase/migrations/0006_tft_rollups.sql` 전체를 붙여 실행 (재실행 안전).
   0006 전에 수집기가 돌면 집계 단계만 경고("집계 실패 — 0006 적용 여부…")를 남기고 수집은 정상으로 끝난다.
2. **기존 원본으로 집계 채우기** — 로컬에서 한 번 (Riot 호출 없음, service role 필요):
   ```bash
   npm run collect:db:rollup
   ```
   안 해도 다음 수집 실행 중 하루 1회 전체 재계산이 같은 일을 한다.
3. **Vercel env** — 앱은 이미 있는 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` 로 집계를 읽는다 (추가 설정 없음).
   집계를 끄고 JSON 만 쓰려면 `TFT_STATS_SOURCE=json`. DB 응답 대기 한도는 `STATS_DB_TIMEOUT_MS`(기본 3000).
4. **확인**
   ```sql
   select * from tft_stat_filters();
   select * from tft_stat_query('unit', (select patch from tft_stat_filters() limit 1), 'MASTER', 7) order by games desc limit 10;
   select patch, tier_min, count(*), max(updated_at) from stat_comp group by 1, 2;
   ```
   앱: `/api/tft/meta/filters` 의 `source` 가 `db` 면 `/meta` 에 필터가 나타난다. `json` 이면 `fallbackReason` 을 본다
   (`supabase_not_configured` · `empty` · `db_error`).

수집기는 `MAX_MINUTES` 보다 7분 일찍 수집을 멈춰 덱 클러스터 몫을 남긴다. 그래도 미루면 `note` 에 남기고, 최신 패치 덱이 24시간 이상
갱신되지 않았으면 경고한다(위 `stat_comp` 의 `max(updated_at)` 확인 → `npm run collect:db:rollup` 으로 수동 갱신).

조절 변수: `DECK_REFRESH_HOURS`(20, 덱 클러스터·전체 재계산 주기) · `COMP_MIN_GAMES`(8, 저장할 덱 최소 판수 — 화면은 15판 미만을 표본 부족으로 표시)

표본 규칙 (§6-2): 기물·아이템·시너지 30판, 기물×아이템 20판, 덱 15판 미만은 표본 부족(회색 · 상대 티어 제외 · 정렬 맨 아래).
평균등수 옆 ± 는 표준오차 2.29/√n. 덱 티어표는 기간 필터 없이 패치 전체로 하루 1회 묶는다.

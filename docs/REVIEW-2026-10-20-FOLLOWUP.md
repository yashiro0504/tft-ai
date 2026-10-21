# TFT LAB 후속 작업 지시서 — 2026-10-20 (Claude Code용)

- **기준 커밋**: `e3988c5` (`fix/review-2026-10-20`) — R1~R11 반영·검증 완료
- **선행 문서**: `docs/REVIEW-2026-10-20.md` (R1~R11, 모두 완료)
- **이 문서의 범위**: 1차 리뷰에서 **의도적으로 남긴 잔여 리스크 + 품질 보강**. R1~R11을 다시 하지 않는다.
- **읽는 순서**: 이 문서 → `docs/HANDOFF.md`(하드 룰) → `docs/DATA-PLATFORM.md` §13

---

## 사용법 (Claude Code에 붙여넣기)

```text
저장소 루트에서 docs/REVIEW-2026-10-20-FOLLOWUP.md 를 읽고 "0. 작업 규칙"을 지켜서
F1부터 순서대로 처리해줘. R1~R11은 이미 완료됐으니 건드리지 마.
이슈 1건 = 커밋 1개, 각 항목의 "완료 조건"을 테스트/명령 출력으로 증명해줘.
작업 브랜치: fix/review-followup-2026-10-20
```

---

## 0. 작업 규칙 (필수)

1. `fix/review-2026-10-20`(또는 최신 `main`)에서 `fix/review-followup-2026-10-20` 브랜치를 딴다.
2. **이슈 1건 = 커밋 1개**. 예: `fix(collect): 용량 가드가 집계 실패 중 원본을 지우지 않게`.
3. R1~R11에서 수정된 동작(캐시 불변, prune 가드, PGlite CI, unit 슬러그, 404, DB 덱 링크, 시드 격리, health 필드)을 되돌리지 않는다.
4. `.claude/`, `tftlab-*.md`, `data/ladderBoards.json` 등 untracked 파일은 건드리지 않는다.
5. 비밀키·실서비스 DB 쓰기 금지. SQL 검증은 PGlite(설치됨) 또는 스테이징만.
6. 각 커밋 후 아래를 실행하고 PR 본문에 붙인다.

```powershell
npm run typecheck
npm run test:axes
npm run test:collect
npm run test:rollup      # PGlite SQL 패리티 포함 (REQUIRE_PGLITE=1 은 CI)
npm run meta:check
npm run decks:check
npx eslint <변경한 파일들>
```

---

## 1. 이슈 요약

| ID | 심각도 | 제목 | 주요 파일 | 상태 |
| --- | --- | --- | --- | --- |
| F1 | 🟠 Medium | `MAX_RAW_MB` 용량 가드가 집계 실패와 무관하게 원본을 prune | `scripts/collectDb.js`, `scripts/testCollect.js` | [x] `92e1356` |
| F2 | 🟡 Low | `/api/health`가 LLM 오류 `body`를 토큰 없이 공개 | `app/api/health/route.ts`, `lib/llmStatus.ts` | [x] `76f2cf8` |
| F3 | 🟡 Low | unit 필터·네거티브 캐시 테스트 커버리지 갭 | `scripts/testRollup.js` | [x] `01137cd` |
| F4 | ⚪ Doc | 리뷰 MD 내용은 갱신됨 — 저장소 커밋만 남음 | `docs/REVIEW-2026-10-20.md` | [x] `7a126d9` |
| F5 | 🟡 Low | DB 덱 비링크 행의 클래스/접근성 정리 | `app/components/EntityDetail.tsx`, `app/entity.css` | [x] `4cae868` |
| F6 | ⚪ Ops | 덱 클러스터 신선도 경고를 운영 표면에 연결 | `docs/DATA-PLATFORM.md`, (선택) `scripts/checkOps.js` | [x] `04cb5e3` |

### 검증 완료 스냅샷 (2026-10-20, `04cb5e3`)

```text
typecheck ✅ · test:axes ✅ · test:collect ✅(+F1 용량 가드 4케이스)
test:rollup ✅ EXIT:0 (F2 redact · F3 DA_*/Base·stats failMemo + PGlite SQL 패리티)
lint ✅ EXIT:0 · build ✅(250 pages) · meta:check ✅ · decks:check ✅

라이브(next start):
  /api/health → status=ok, lastLlmHttpError=null, "body" 키 없음 (F2)
  ?type=unit_item&unit=ahri / DA_18_Ahri / TFT18_Ahri → 모두 15행, unit="ahri" (F3)
  ?type=unit_item (unit 없음) → 879행 (R1 캐시 불변 유지)
  /champions|items|traits/a%25b → 404 (R7 유지)
  check:ops --db → Supabase 미설정 시 "덱 신선도 점검 건너뜀" 안내 (F6)

미검증(환경 제약):
  - F1 소프트/하드 한도는 메모리 저장소 테스트로만 확인 (실 Supabase 용량 가드 미실행)
  - F6 checkOps --db 의 24h/72h 판정은 Supabase 미설정으로 실제 DB 응답 미검증
```

**권장 순서**: F1 → F4 → F2 → F3 → F5 → F6

---

## 2. 상세 지시

### F1. `MAX_RAW_MB` 용량 가드가 집계 실패와 무관하게 원본을 prune 🟠

**문제**

R2에서 **실행 끝(5단계) prune**은 `shouldPrune(aggregates)`로 막았지만,
**시작 시 용량 가드(0단계)** 는 여전히 집계 상태를 보지 않고 `store.prune()`을 호출한다.
0006 미적용·RPC 오류로 집계가 계속 실패하는 동안 원본이 400MB를 넘으면,
집계되지 않은 이전 패치 원본이 삭제된다. 또한 prune 후에도 한도를 넘으면 수집을 건너뛰므로
"데이터를 지웠는데 수집도 못 하는" 상태가 된다.

**근거**

```ts
// scripts/collectDb.js:239-248
// 0) 용량 가드 (무료 플랜)
let sizeMb = await store.rawSizeMb()
if (sizeMb > CFG.maxRawMb) {
  const removed = await store.prune(CFG.keepPatches)   // ← 집계 상태와 무관
  sizeMb = await store.rawSizeMb()
  log.warn(`  원본 ${sizeMb}MB > 한도 ${CFG.maxRawMb}MB → 정리 ${removed}판`)
  if (sizeMb > CFG.maxRawMb) {
    stats.note = `용량 한도 초과(${sizeMb}MB) — 수집 건너뜀`
    ...
    return
  }
}
```

**수정 방향 (권장: 소프트/하드 한도 분리)**

- `MAX_RAW_MB`(기본 400) = **소프트 한도**: 초과하면 기본적으로 **prune 하지 않고** 수집만 중단.
  `stats.note`와 로그에 "집계 실패 중이거나 수동 정리가 필요" 사유를 남긴다.
- `PRUNE_ON_LIMIT=1`(기본 0) = 운영자가 명시적으로 켤 때만 소프트 한도에서 prune.
- `MAX_RAW_MB_HARD`(기본 480) = **하드 한도**: 이 값을 넘으면 집계 상태와 무관하게 prune 허용
  (DB 자체가 죽는 것을 막는 최후 수단). 하드 한도 prune 시 `log.error` + `note` 필수.
- `shouldPrune()`과 별개로 `shouldPruneOnLimit(sizeMb, cfg)` 같은 순수 함수로 분리해 테스트한다.

```ts
function shouldPruneOnLimit(sizeMb) {
  if (sizeMb > CFG.maxRawMbHard) return true              // 하드: 항상
  if (sizeMb > CFG.maxRawMb) return CFG.pruneOnLimit     // 소프트: opt-in
  return false
}
```

**테스트 (`scripts/testCollect.js`)**

- 소프트 한도 초과 + `PRUNE_ON_LIMIT` 미설정 → `main()`이 `store.prune`을 호출하지 않고
  기존 매치(`KR_OLD` 등)가 남아 있으며 `note`에 사유가 있는지.
- `PRUNE_ON_LIMIT=1` → prune 호출.
- 하드 한도 초과 → 설정과 무관하게 prune.
  (메모리 저장소의 `rawSizeMb`를 원하는 값으로 덮어써 시뮬레이션)

**완료 조건**

- [ ] 소프트 한도 기본 동작이 "prune 없이 수집 중단 + note"로 바뀜
- [ ] 3가지 분기(소프트/opt-in/하드) 테스트 통과
- [ ] `docs/DATA-PLATFORM.md` §13 또는 `.env.example`에 `PRUNE_ON_LIMIT`/`MAX_RAW_MB_HARD` 설명 추가

---

### F2. `/api/health`가 LLM 오류 `body`를 토큰 없이 공개 🟡

**문제**

R11에서 `lastLlmHttpError`를 health에 노출했는데, `body`(최대 300자)가 포함된다.
`HEALTH_TOKEN`이 설정되지 않은 배포에서는 누구나 볼 수 있다. API 키는 아니지만
provider 오류 상세·요청 ID·조직 정보 등이 포함될 수 있어 공개 표면에는 부적절하다.
(로그 `llm_http_error`에는 body가 이미 남으므로 진단 목적은 충족된다.)

**근거**

```ts
// app/api/health/route.ts:59-63, 79-80
const llmError = lastLlmHttpError()
...
lastLlmHttpError: llmError,   // { provider, model, status, body, at }
```

```ts
// lib/llmStatus.ts
export interface LlmHttpError { provider; model; status; body; at }
```

**수정 방향**

- 공개 응답(토큰 없음): `{ provider, model, status, at }`만. `body`는 제거.
- 인증된 응답(`HEALTH_TOKEN` 통과)에서만 `body` 포함(또는 `?verbose=1` + 토큰).
- `lib/llmStatus.ts`에 순수 함수 `redactLlmError(e, { includeBody })`를 두고 health가 사용.
- `warnings` 문구는 그대로 유지(모델·status만 사용).

**테스트**

- `redactLlmError`가 `includeBody=false`일 때 `body` 키를 포함하지 않는지.
- (가능하면) `next start` 스모크에서 `/api/health` 응답에 `body` 문자열이 없는지 확인.
  `HEALTH_TOKEN` 설정 시 토큰 없이는 401, 토큰 있으면 body 포함.

**완료 조건**

- [ ] 공개 `/api/health` 응답에 `body`가 없음
- [ ] 토큰 인증 시에만 상세 body 확인 가능
- [ ] 기존 `warnings`·`integrations.deepseekModel` 동작 유지

---

### F3. unit 필터·네거티브 캐시 테스트 커버리지 갭 🟡

**문제**

R1/R6 테스트는 슬러그·수집 키·`TFT18_` 접두사까지만 검증한다.
실제 DB 키에는 `DA_18_Ahri`, `Lux18_Base`처럼 `DA_` 계열도 흔하고,
R5 테스트는 `getMetaFilters` 실패 경로만 검증해 **stats 키 자체의 failMemo**는 실행되지 않는다.
또한 R1의 라우트 레벨(캐시 객체를 실제로 반환하는 경로) 검증은 순수 함수 테스트에 의존한다.

**근거**

```js
// scripts/testRollup.js:215
const variants = [slug, String(someChamp), `TFT18_${someChamp}`, slug.toUpperCase()]
// → DA_18_ / DA_ 접두사 변형 없음
```

```js
// scripts/testRollup.js:230-249
// DB 타임아웃 테스트는 getMetaFilters 실패에서 short-circuit 되어
// getStats 의 failMemo(stats:<type>:...) 경로를 타지 않는다
```

**수정 지시**

1. `variants`에 `DA_18_${someChamp}`, `DA_${someChamp}`를 추가한다.
   (기대: 모두 같은 `unit` 슬러그·같은 rows)
2. `Lux18_Base`처럼 `_Base`가 붙은 원본 키를 variants에 포함해
   `entitySlug`의 `\d+base$` 제거가 실제로 동작하는지 고정한다.
3. stats 키 failMemo를 검증하는 케이스를 추가한다.
   - 가짜 클라이언트에서 `tft_stat_filters` RPC는 정상 행을 반환하고
   - `tft_stat_query` RPC만 abort/hang 시킨다.
   - 1차 `getStats`는 300ms 후 `db_error` 폴백, 2차는 즉시 폴백(`hangCalls`가 2 이상이면 실패)인지 확인.
4. (선택) R1 라우트 레벨 회귀가 필요하면 `filterStatsByUnit` 호출 전후
   `Object.is(fbCombos.rows, onlyOne.rows) === false`와 `fbCombos.rows.length` 불변을 이미 확인 중이므로,
   라우트는 "원본을 수정하지 않는다"는 주석 + 순수 함수 테스트로 충분하다고 명시한다.

**완료 조건**

- [ ] `DA_18_*`·`DA_*`·`*_Base` 변형 테스트 통과
- [ ] stats 키 failMemo(필터 성공 + 통계 RPC 실패) 테스트 통과
- [ ] 기존 R1/R5/R6 테스트 유지

---

### F4. 리뷰 MD가 아직 untracked ⚪

**현재 상태 (2026-10-20 갱신됨)**

- `docs/REVIEW-2026-10-20.md`의 R1~R11 상태는 이미 `[x]` + 커밋 hash로 갱신됨.
- 검증 완료 스냅샷(typecheck/test/lint/build/라이브)도 문서 §1에 추가됨.
- §5에 이 후속 문서 링크가 연결됨.
- **남은 일은 커밋뿐**: 두 MD 모두 아직 `??` (untracked).

**근거**

```text
git status:
  ?? docs/REVIEW-2026-10-20.md
  ?? docs/REVIEW-2026-10-20-FOLLOWUP.md
```

**수정 지시**

1. 내용이 최신인지 확인한다(위 상태와 다르면 문서를 먼저 갱신).
2. 두 문서를 함께 커밋한다.

```powershell
git add docs/REVIEW-2026-10-20.md docs/REVIEW-2026-10-20-FOLLOWUP.md
git commit -m "docs(review): 2026-10-20 리뷰·후속 작업 지시서 추가"
```

> R1~R11 상세 절의 `- [ ]` 완료 조건은 **구현 당시의 체크리스트 기록**이다.
> 실제 완료 판정은 §1 표와 검증 스냅샷을 따른다(원 문서에도 같은 안내를 추가함).

**완료 조건**

- [ ] 두 MD가 저장소에 커밋됨
- [ ] R1~R11 표가 `[x]` + 커밋 해시 상태 유지
- [ ] 후속 문서 링크(`REVIEW-2026-10-20-FOLLOWUP.md`) 유지

---

### F5. DB 덱 비링크 행의 클래스/접근성 정리 🟡

**문제**

R8에서 DB 덱은 링크하지 않도록 바꿨지만, 마크업은 여전히 링크용 클래스(`rk-ent-rowlink`)를
`<div>`에 붙인다. 현재는 `a.rk-ent-rowlink:hover`만 스타일이 있어 시각적 문제는 없지만,
클래스 의미가 모호하고 향후 CSS 변경 시 클릭 가능한 것처럼 보일 수 있다.
"DB 집계" 배지 외에 왜 링크가 없는지에 대한 텍스트도 없다.

**근거**

```tsx
// app/components/EntityDetail.tsx:148-156
{d.linkable ? (
  <Link href={`/deck/${d.id}`} className="rk-ent-rowlink">{body}</Link>
) : (
  <div className="rk-ent-rowlink">{body}</div>   // 링크용 클래스 재사용
)}
```

```css
/* app/entity.css:63 — hover 는 a 에만 적용 */
a.rk-ent-rowlink:hover { border-color: var(--rk-accent); }
```

**수정 지시**

1. 비링크 행에 `is-static` 클래스를 추가하고 `title`로 사유를 제공한다.

```tsx
<div className="rk-ent-rowlink is-static" title="DB 집계 덱은 별도 상세 페이지가 없습니다">
  {body}
</div>
```

2. CSS에 정적 행 스타일을 명시한다(커서·hover 제거, 필요하면 배경 톤다운).

```css
.rk-ent-rowlink.is-static { cursor: default; }
.rk-ent-rowlink.is-static:hover { border-color: var(--rk-line); }
```

3. "DB 집계" 배지(`<em>`)는 유지하되, 스크린리더용으로 `aria-label` 또는
   `title`이 읽히는지 확인한다(과한 `aria-disabled`는 붙이지 않는다 — 상호작용 요소가 아님).

**완료 조건**

- [ ] DB 덱 행에 `is-static`이 적용되고 링크로 보이지 않음
- [ ] JSON 덱 행은 기존 hover·링크 동작 유지
- [ ] `npx eslint app/components/EntityDetail.tsx` 통과

---

### F6. 덱 클러스터 신선도 경고를 운영 표면에 연결 ⚪

**문제**

R3에서 덱 재빌드가 미뤄지면 `tft_collect_runs.note`와 수집 로그에만 남는다.
운영자가 GitHub Actions 로그를 보지 않으면 `/api/tft/decks`가 오래된 덱을 서빙해도 알기 어렵다.
`scripts/checkOps.js`는 `/api/health`만 확인하고 DB 신선도는 보지 않는다.

**근거**

- `scripts/collectDb.js:163-177` — 미룸 시 `note` + `log.warn`만
- `scripts/checkOps.js:40-61` — health/연동 상태만 점검

**수정 지시 (권장: 문서 체크리스트 우선)**

1. `docs/P0-OPERATIONS.md`(또는 `docs/DATA-PLATFORM.md` §13)에 일일 점검 항목을 추가한다.

```sql
-- 최신 패치 덱 클러스터 신선도 (24시간 초과면 경고)
select patch, tier_min, count(*) as decks, max(updated_at) as last_built,
       now() - max(updated_at) as age
  from stat_comp
 group by 1, 2
 order by last_built desc;
```

2. 기준을 명시한다: `last_built`가 **24시간 초과**면 `npm run collect:db:rollup` 수동 실행,
   **72시간 초과**면 수집 워크플로 실패 여부·Riot 키·0006 적용 상태를 함께 확인.
3. (선택) 자동화하려면 `scripts/checkOps.js`에 `--db` 플래그를 추가해
   `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`(또는 anon + `stat_comp` select)로 위 쿼리를 실행하고,
   `--strict`에서 24시간 초과를 실패로 처리한다. 서비스 키가 없는 CI에서는 건너뛴다.

**완료 조건**

- [ ] 운영 문서에 위 SQL·임계값·조치 절차가 들어감
- [ ] (선택) `checkOps --db --strict`가 오래된 덱을 실패로 감지

---

## 3. 검증 명령과 기대 결과

```powershell
npm run typecheck        # 오류 0
npm run test:collect     # F1(용량 가드 분기) 테스트 포함 통과
npm run test:rollup      # F3 변형·stats failMemo 테스트 + PGlite SQL 패리티 통과
npm run test:axes        # 기존 점수 회귀 없음
npm run meta:check
npm run decks:check
npx eslint <변경 파일>
npm run build
```

라이브 확인(선택, `next start -p 3100` 후):

```powershell
curl.exe -s "http://127.0.0.1:3100/api/health"                 # body 필드가 없어야 함 (F2)
curl.exe -s "http://127.0.0.1:3100/api/tft/stats?type=unit_item&unit=DA_18_Ahri"  # F3
```

---

## 4. 이번 작업에서 깨면 안 되는 것

- R1: `filterStatsByUnit`가 원본 `rows`를 변경하지 않는다.
- R2: 실행 끝 prune은 `shouldPrune(aggregates)`일 때만.
- R3: `collectionDeadline = max(total − 7분, total/2)`.
- R4: `REQUIRE_PGLITE=1`에서 PGlite 미로드 시 실패.
- R5: `db_error`는 20초 네거티브 캐시, 응답 스키마 유지.
- R6: `unit`은 슬러그·수집 키·Riot ID 모두 허용, `totalBoards`는 필터 전 분모.
- R7: 잘못된 `%` 슬러그는 404.
- R8: DB 덱은 `linkable=false`, `fromDb=true`.
- R9: 복호화 실패 시드만 건너뛰고 실행 지속.
- R11: health에 `deepseekModel`·`deepseekThinking`·`lastLlmHttpError` 노출(단, F2 적용 후 body는 인증 시에만).

---

## 5. 참고: 1차 리뷰 커밋

| ID | 커밋 | 요약 |
| --- | --- | --- |
| R1 | `12e2912` | unit 필터 캐시 변조 방지 |
| R2 | `13b523c` | 집계 실패 시 prune 스킵 |
| R3 | `5408ddc` | 덱 재빌드 시간 확보 |
| R4 | `4bf7bc2` | PGlite SQL 패리티 CI |
| R5 | `1f94fd6` | DB 장애 네거티브 캐시 |
| R6 | `9c29772` | unit 슬러그 정규화 |
| R7 | `f94ba59` | 이중 디코딩 500 방지 |
| R8 | `40e1277` | DB 덱 링크 차단 |
| R9 | `d4b357c` | 시드 복호화 실패 격리 |
| R10 | `b429a34` | 데이터 플랫폼 문서 정합 |
| R11 | `e3988c5` | LLM HTTP 오류 가시성 |

검증 스냅샷: `typecheck`·`test:axes`·`test:collect`·`test:rollup`(PGlite SQL 실행)·`lint`·`build` 모두 통과,
라이브에서 캐시 불변(ahri 15 → 전체 879)·`TFT18_Ahri` 동일·잘못된 `%` 슬러그 404 확인.

---

## 6. 후속 2

F1~F6 검증 중 발견한 설정 경계·판정 정확도 보강은
**`docs/REVIEW-2026-10-20-FOLLOWUP2.md` (G1~G2)** 에서 이어서 처리한다.

- G1: `MAX_RAW_MB_HARD < MAX_RAW_MB` 설정 방어(정규화)
- G2: `check:ops --db`를 전역 최신 1행이 아니라 **최신 패치 기준**으로 판정

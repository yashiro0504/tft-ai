# TFT LAB 후속 작업 지시서 2 — 2026-10-20 (Claude Code용)

- **기준 커밋**: `04cb5e3` (`fix/review-followup-2026-10-20`) — F1~F6 반영·검증 완료
- **선행 문서**: `docs/REVIEW-2026-10-20.md`(R1~R11) → `docs/REVIEW-2026-10-20-FOLLOWUP.md`(F1~F6)
- **이 문서의 범위**: F1~F6 검증 중 발견한 **설정 경계·판정 정확도** 보강 2건(G1·G2). R/F 항목은 다시 하지 않는다.
- **읽는 순서**: 이 문서 → `docs/HANDOFF.md`(하드 룰) → `docs/DATA-PLATFORM.md` §13

---

## 사용법 (Claude Code에 붙여넣기)

```text
저장소 루트에서 docs/REVIEW-2026-10-20-FOLLOWUP2.md 를 읽고 "0. 작업 규칙"을 지켜서
G1, G2 순서로 처리해줘. R1~R11, F1~F6은 완료됐으니 되돌리지 마.
이슈 1건 = 커밋 1개, 각 항목의 "완료 조건"을 테스트/명령 출력으로 증명해줘.
작업 브랜치: fix/review-followup2-2026-10-20
```

---

## 0. 작업 규칙 (필수)

1. `fix/review-followup-2026-10-20`(또는 최신 `main`)에서 `fix/review-followup2-2026-10-20` 브랜치를 딴다.
2. **이슈 1건 = 커밋 1개**. 예: `fix(collect): 하드 한도가 소프트 한도보다 작아도 안전하게`.
3. F1~F6에서 추가된 동작(소프트/하드 가드, health body 마스킹, unit 변형 테스트, `is-static`, `check:ops --db`)을 되돌리지 않는다.
4. `.claude/`, `tftlab-*.md`, `data/ladderBoards.json` 등 untracked 파일은 건드리지 않는다.
5. 비밀키·실서비스 DB 쓰기 금지. SQL/RLS 검증은 PGlite 또는 스테이징만.
6. 각 커밋 후 아래를 실행하고 PR 본문에 붙인다.

```powershell
npm run typecheck
npm run test:axes
npm run test:collect
npm run test:rollup      # PGlite SQL 패리티 포함
npm run meta:check
npm run decks:check
npx eslint <변경한 파일들>
```

---

## 1. 이슈 요약

| ID | 심각도 | 제목 | 주요 파일 | 상태 |
| --- | --- | --- | --- | --- |
| G1 | 🟡 Low | `MAX_RAW_MB_HARD < MAX_RAW_MB` 설정이면 소프트 이하에서도 하드 prune | `scripts/collectDb.js`, `scripts/testCollect.js` | [ ] |
| G2 | 🟠 Medium | `check:ops --db`가 전역 최신 1행만 봐서 최신 패치 지연을 오판 | `scripts/checkOps.js`, `docs/DATA-PLATFORM.md` | [ ] |

**권장 순서**: G1 → G2

---

## 2. 상세 지시

### G1. `MAX_RAW_MB_HARD < MAX_RAW_MB` 설정이면 소프트 이하에서도 하드 prune 🟡

**문제**

`shouldPruneOnLimit()`은 `sizeMb > maxRawMbHard`를 먼저 검사한다.
따라서 `MAX_RAW_MB=500`, `MAX_RAW_MB_HARD=480`처럼 하드가 소프트보다 작게 설정되면
`sizeMb=490`은 **소프트 한도 이하인데도** 하드 분기로 들어가 원본을 정리한다.
`main()`의 `hard` 플래그(`sizeMb > CFG.maxRawMbHard`)도 같은 기준이라 note/`log.error`가
"하드 한도 초과"로 잘못 남는다.

**근거**

```js
// scripts/collectDb.js:62-63
maxRawMbHard: num('MAX_RAW_MB_HARD', 480),
pruneOnLimit: process.env.PRUNE_ON_LIMIT === '1',
```

```js
// scripts/collectDb.js:195-198
function shouldPruneOnLimit(sizeMb, cfg = CFG) {
  if (sizeMb > cfg.maxRawMbHard) return true   // ← hard < soft 면 오판
  if (sizeMb > cfg.maxRawMb) return cfg.pruneOnLimit
  return false
}
```

```js
// scripts/collectDb.js:256-262
if (shouldPruneOnLimit(sizeMb)) {
  const hard = sizeMb > CFG.maxRawMbHard          // ← 같은 오판
  ...
  stats.note = `하드 한도 초과(${before}MB > ${CFG.maxRawMbHard}MB) ...`
}
```

**수정 지시**

1. 한도 설정을 **한 곳에서 정규화**한다. 하드 한도는 항상 소프트 이상이어야 한다.

```js
/** 소프트/하드 한도 정규화 — 하드가 소프트보다 작으면 소프트로 올린다 (설정 실수 방어) */
function resolveLimitConfig(softMb, hardMb) {
  return { maxRawMb: softMb, maxRawMbHard: Math.max(hardMb, softMb) }
}
```

2. `CFG` 생성 시 이 함수를 사용한다.

```js
const limits = resolveLimitConfig(num('MAX_RAW_MB', 400), num('MAX_RAW_MB_HARD', 480))
// ... maxRawMb: limits.maxRawMb, maxRawMbHard: limits.maxRawMbHard
```

3. `main()`의 `hard` 판정과 note도 **정규화된 `CFG.maxRawMbHard`**만 사용한다
   (이미 CFG를 쓰므로 값만 정규화되면 자동 해결). 필요하면 기동 시 1회 경고:

```js
if (hardRaw < softRaw) log.warn(`MAX_RAW_MB_HARD(${hardRaw}) < MAX_RAW_MB(${softRaw}) → ${softRaw}로 보정`)
```

4. `module.exports`에 `resolveLimitConfig`를 추가해 테스트 가능하게 한다.

**테스트 (`scripts/testCollect.js`)**

- `resolveLimitConfig(400, 480)` → `{400, 480}`
- `resolveLimitConfig(500, 480)` → `{500, 500}` (하드가 소프트로 보정)
- `shouldPruneOnLimit`에 정규화된 cfg를 넣었을 때:
  - `sizeMb=490`, soft=500, hard=500(보정) → `false` (하드 prune 아님)
  - `sizeMb=501` → `true`
  - `sizeMb=450`, soft=400, hard=480 → `pruneOnLimit` 값에 따름
- 기존 F1 3분기 테스트가 그대로 통과해야 한다.

**완료 조건**

- [ ] 하드 < 소프트 설정에서 소프트 이하 크기가 prune되지 않음
- [ ] note·로그의 "하드 한도 초과" 문구가 실제 하드 초과일 때만 나감
- [ ] `npx eslint scripts/collectDb.js scripts/testCollect.js` 통과
- [ ] `docs/DATA-PLATFORM.md`의 한도 설명에 "하드 < 소프트면 소프트로 보정" 한 줄 추가

---

### G2. `check:ops --db`가 전역 최신 1행만 봐서 최신 패치 지연을 오판 🟠

**문제**

현재 `checkDeckFreshness()`는 `stat_comp`에서 `order=updated_at.desc&limit=1` 한 행만 읽는다.
따라서 **최신 패치의 덱이 오래됐어도**, 이전 패치가 최근에 재빌드됐다면 `ageH`가 작게 나와
"24시간 이내 갱신"으로 통과한다. 최신 패치 기준으로 봐야 하는데 전역 최댓값을 보고 있다.
문서의 SQL은 `group by patch, tier_min`으로 패치별로 보므로 문서와 스크립트 판정도 불일치한다.

**근거**

```js
// scripts/checkOps.js:149
const res = await fetch(`${url}/rest/v1/stat_comp?select=patch,tier_min,updated_at&order=updated_at.desc&limit=1`, ...)
...
const ageH = (Date.now() - Date.parse(latest.updated_at)) / HOUR
```

```sql
-- docs/DATA-PLATFORM.md:415-421 (패치별로 집계)
select patch, tier_min, count(*) as decks, max(updated_at) as last_built, now() - max(updated_at) as age
  from stat_comp
 group by 1, 2
 order by last_built desc;
```

**수정 지시**

1. **최신 패치를 먼저 결정**하고, 그 패치의 최신 `updated_at`으로 신선도를 판정한다.
   PostgREST에서 group by가 어려우므로 `select=patch,tier_min,updated_at`로 필요한 행을 받아
   클라이언트에서 집계한다(패치 수 × 티어 4 × 덱 ≤ 수백 행이라 부담 없음).

```js
/** '16.20' 처럼 숫자.숫자 패치를 비교 (모르는 형식은 문자열 비교) */
function comparePatchDesc(a, b) { ... }

/** rows → 최신 패치와 그 패치의 마지막 빌드 시각 */
function latestPatchFreshness(rows, now = Date.now()) {
  const latestPatch = [...new Set(rows.map((r) => r.patch))].sort(comparePatchDesc)[0]
  const at = rows.filter((r) => r.patch === latestPatch)
    .reduce((max, r) => Math.max(max, Date.parse(r.updated_at) || 0), 0)
  return { latestPatch, lastBuiltMs: at, ageH: at ? (now - at) / HOUR : Infinity }
}
```

2. 출력에 `패치 ${latestPatch}`와 그 패치의 나이를 명시한다.
   필요하면 최신 패치의 `tier_min`별 마지막 빌드도 한 줄씩 남긴다.
3. 최신 패치가 24h 초과면 `fail(...)`, 72h 초과면 기존 안내 문구를 유지한다.
4. **테스트 가능하게 구조 변경**: `checkOps.js` 하단의 `main().catch(...)`를
   `if (require.main === module) main().catch(...)`로 감싸고, `comparePatchDesc`·`latestPatchFreshness`를 export한다.
5. 새 테스트 스크립트 `scripts/testOps.js`를 추가하고 `package.json`에 `"test:ops": "node scripts/testOps.js"`를 넣는다.
   CI(`.github/workflows/ci.yml`)의 Rollup 테스트 다음에 `npm run test:ops`를 추가한다.

```json
// package.json scripts
"test:ops": "node scripts/testOps.js",
```

**테스트 케이스 (`scripts/testOps.js`)**

- rows에 `16.19`(최근 1시간), `16.20`(30시간 전)이 섞임 → 최신 패치 `16.20`, `ageH≈30` → **미충족**
  (기존 구현은 16.19 때문에 통과하던 케이스)
- `16.20`(2시간 전) + `16.19`(50시간 전) → 최신 패치 2시간 → 충족
- 빈 배열 → `Infinity`/미충족
- `'set18'` 같은 비숫자 패치가 섞여도 throw 없이 결정적 비교

**완료 조건**

- [ ] 최신 패치 기준으로 24h/72h 판정
- [ ] `scripts/testOps.js`가 CI에서 실행되고 위 4케이스 통과
- [ ] `node scripts/checkOps.js <URL> --db` 수동 실행 시 "패치 16.20 · N시간 전" 형태로 출력
- [ ] `docs/DATA-PLATFORM.md` §13의 SQL·설명과 스크립트 판정 기준이 일치

---

## 3. 검증 명령과 기대 결과

```powershell
npm run typecheck
npm run test:collect     # G1 resolveLimitConfig·경계 케이스 포함
npm run test:ops         # G2 latestPatchFreshness·comparePatchDesc (신규)
npm run test:rollup      # PGlite SQL 패리티 유지
npm run test:axes
npm run meta:check
npm run decks:check
npx eslint <변경 파일>
npm run build
```

수동 확인:

```powershell
# 서버 없이 순수 함수만 확인
node -e "const o=require('./scripts/checkOps'); console.log(o.latestPatchFreshness([...]))"

# 운영 점검 (Supabase env 가 있으면 실제 판정, 없으면 건너뜀)
node scripts/checkOps.js https://www.tftlab.kr --db --strict
```

기대 출력 예:

```text
db: 최신 패치 16.20 · 마지막 빌드 2026-10-20T01:00:00Z (3.2시간 전)
  ✅ 덱 클러스터 24시간 이내 갱신 (16.20)
```

---

## 4. 이번 작업에서 깨면 안 되는 것

- F1: 소프트 한도(`MAX_RAW_MB`) 기본은 **prune 없이 수집 중단 + note**, `PRUNE_ON_LIMIT=1`만 정리.
- F1: 하드 한도 초과는 설정과 무관하게 정리 + `log.error` + note.
- R2: 실행 끝 prune은 `shouldPrune(aggregates)`일 때만.
- R3: `collectionDeadline = max(total − 7분, total/2)`.
- F2: 공개 `/api/health`에 LLM 오류 `body`가 없어야 함.
- F3: `DA_18_*`·`DA_*`·`*_Base` unit 변형이 같은 결과.
- F5: DB 덱 행은 `is-static`, `/deck` 링크 없음.
- F6: `check:ops --db`는 Supabase env 없으면 건너뛰고 실패로 만들지 않는다(단, `--strict`에서 DB 점검을 실제 수행한 경우의 실패는 실패).

---

## 5. 완료 후 문서 갱신

1. 이 문서 §1 표의 G1·G2를 `[x]` + 커밋 short hash로 바꾼다.
2. 아래 **검증 스냅샷**을 채운다.

```text
typecheck ✅ · test:collect ✅ · test:ops ✅ · test:rollup ✅(PGlite) · lint ✅ · build ✅
G1: MAX_RAW_MB=500 / HARD=480 → 490MB에서 prune 없음, 501MB에서 정리
G2: 16.19 최근 + 16.20 30시간 전 → 미충족(최신 패치 기준) / 16.20 2시간 전 → 충족
```

3. `docs/REVIEW-2026-10-20-FOLLOWUP.md` 끝에
   `후속 2: docs/REVIEW-2026-10-20-FOLLOWUP2.md (G1~G2)` 링크를 추가한다.
4. 두 문서와 코드 변경을 함께 커밋한다.

```powershell
git add docs/REVIEW-2026-10-20-FOLLOWUP2.md docs/REVIEW-2026-10-20-FOLLOWUP.md
git commit -m "docs(review): 후속 2 지시서(G1~G2) 및 완료 상태 반영"
```

---

## 부록. 선행 작업 참고

| 구분 | 문서 | 커밋 |
| --- | --- | --- |
| 1차 리뷰 R1~R11 | `docs/REVIEW-2026-10-20.md` | `12e2912` ~ `e3988c5` |
| 후속 F1~F6 | `docs/REVIEW-2026-10-20-FOLLOWUP.md` | `92e1356` ~ `04cb5e3` |
| 후속 2 G1~G2 | 이 문서 | (작업 후 기입) |

검증 스냅샷(F1~F6): typecheck·test:axes·test:collect·test:rollup(PGlite)·lint·build 모두 통과,
라이브에서 health body 없음 · unit 변형 15행 · 전체 879행 · `%` 슬러그 404 확인.
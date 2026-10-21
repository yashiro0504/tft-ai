# AI 리포트 검증 스프린트 1 — 2026-10-20 (Claude Code용)

- **기준**: `f82f37a` + 현재 작업 트리 WIP(UI URL 동기화)는 **건드리지 않는다**.
- **선행 문서**: `docs/AI-EVAL-PLAN-2026-10-20.md` (실험 설계·지표·스키마 제안)
- **범위**: A0 하네스 → A1 의미 검증기/라운드 규칙 → A2 비교 사실 → A3(승인 후) 스키마 v2 → A4 토큰/추론 → A5 Gemini
- **원칙**: 한 번에 한 변수, 같은 6경기, 3회 반복, provider 강제, 캐시 우회.

---

## 사용법 (Claude Code에 붙여넣기)

```text
저장소 루트에서 docs/AI-EVAL-SPRINT1-2026-10-20.md 를 읽고 "0. 작업 규칙"을 지켜
A0 → A1 → A2 순서로 구현해줘. A3는 UI 영향 보고 후 승인받고, A4/A5는 A1~A3 결과를 본 뒤 진행해.
현재 작업 트리의 MetaDashboard/MetaRanking/app/meta/page/MetaUrlSync 변경은 건드리지 마.
각 커밋 후 지표를 tmp/eval/summary.csv 로 남기고 "완료 조건"을 출력으로 증명해.
작업 브랜치: feat/ai-eval-2026-10-20
```

---

## 0. 작업 규칙

1. `feat/ai-eval-2026-10-20` 브랜치. **1작업 = 1커밋**.
2. 현재 uncommitted UI 변경(`app/components/MetaDashboard.tsx`, `MetaRanking.tsx`, `app/meta/page.tsx`, `app/components/MetaUrlSync.tsx`)은 **수정·스테이징 금지**.
3. `.claude/`, `tftlab-*.md`, `data/ladderBoards.json` 등 untracked 파일 금지.
4. 비밀키 커밋·출력 금지. 평가 산출물에 `Authorization`/`X-Riot-Token`을 저장하지 않는다.
5. 프롬프트/스키마 변경 시 `COACH_PROMPT_VERSION`을 올리고, 평가는 **캐시를 우회**한다.
6. 각 커밋 후:

```powershell
npm run typecheck
npm run test:axes
npm run test:rollup
npm run test:ops
npm run lint
npm run build
```

---

## 1. 작업 요약

| ID | 내용 | 상태 |
| --- | --- | --- |
| A0 | 변형 평가 하네스 (`scripts/evalAiVariants.js`) + 캡처/지표 | [ ] |
| A1 | 의미 검증기(성급·아이템·시너지) + "라운드 타이밍 단정 금지" 규칙 | [ ] |
| A2 | 비교 사실 블록(로비 1등·메타 평균·BIS 일치율) | [ ] |
| A3 | 스키마 v2(중복 필드 제거) — **UI 영향 보고 후 승인** | [ ] |
| A4a | `max_tokens` 6,000 (상한만) | [ ] |
| A4b | A4a + thinking/추론 모델 | [ ] |
| A5 | Gemini 리포트 주력 비교 | [ ] |

---

## 2. 상세 지시

### A0. 변형 평가 하네스

**목표**: 같은 입력으로 모델/프롬프트 변형을 반복 실행해 **프롬프트·원시응답·결과·지표**를 남긴다.

**파일**

- 신규: `scripts/evalAiVariants.js`
- 설정: `lib/llm.ts`에서 `max_tokens` 하드코딩 제거 → `DEEPSEEK_MAX_TOKENS` env(기본 3400)
- (선택) `LLM_PROVIDER=deepseek|gemini` 강제. 없으면 기존 폴백 체인.
- 기존 `scripts/evalReports.js`는 HTTP `/overview` 기반이므로 **직접 호출 하네스**를 새로 만든다(캐시 우회·프롬프트 캡처 목적).

**CLI**

```powershell
node scripts/evalAiVariants.js --variant baseline --runs 3 --provider deepseek `
  --model deepseek-flash --max-tokens 3400 --thinking disabled --schema v1 `
  --out tmp/eval
```

- `--cases`(기본 `all`), `--runs`(기본 3), `--fixture data/evalMatches.json`.
- 변형별 디렉터리: `tmp/eval/<variant>/<case>/run-N/{prompt.txt,prompt.json,raw.txt,result.json,meta.json}`.
- **환경변수는 child process에서 설정**한다(`lib/llm`이 import 시 env를 읽기 때문). 부모 프로세스에서 require 금지.
- DeepSeek/Gemini fetch를 가로채 요청 body(messages만)와 응답 text를 저장한다. 헤더는 저장 금지.
- 결과에는 `matchId, caseName, variant, model, maxTokens, thinking, promptVersion, schemaVersion, inputTokens, outputTokens, finishReason, latencyMs, costUsd, isFallback, grounding, entityErrors, schemaValid`를 포함.

**평가 케이스(고정 6개)**

`data/evalMatches.json`에서 아래 조건으로 고른다. 모든 변형이 **같은 6개**를 쓴다.

1. 정상 5등(기준 샘플 `KR_8414975456`)
2. 1등·빈집
3. 8등·경합 높음
4. 2-2 초반 종료
5. 증강 없는 4~5등
6. multi 5경기 케이스

**지표 요약**

- `schemaValid`, `truncated(finishReason=length)`, `inputTokens`, `outputTokens`, `latencyMs`, `costUsd`
- `grounding.score`, `grounding.unsupported.length`, `entityErrors.length`
- `uniqueDataCitations`(숫자 토큰 unique / 1,000자), `repetition`(overview·axes·lecture 문장 중복률)
- `tmp/eval/summary.csv` + `summary.json`

**완료 조건**

- [ ] baseline 6경기 × 3회 실행, 각 실행 산출물 저장
- [ ] `summary.csv`에 변형별 평균/표준편차/성공률/잘림률/비용/지연
- [ ] API 키·헤더가 산출물에 없음
- [ ] `npm run typecheck`·`npm run lint` 통과

---

### A1. 의미 검증기 + 라운드 타이밍 금지 규칙

**문제**

현재 Grounding은 숫자·이름만 본다. 실제 출력의
"피들스틱·르블랑·오른 모두 3성" (피들스틱은 1성) 오류를 100점으로 통과시켰다.
또한 "레벨에 쓰지 않아서 진 겁니다"처럼 **라운드 데이터가 없는데 인과 단정**을 한다.

**1) 타입 추가 (`lib/types.ts`)**

```ts
export interface EntityFactError {
  type: 'unit_star' | 'three_star_count' | 'item_owner' | 'trait_tier'
  text: string
  expected: string
  actual: string
}
// GroundingReport
entityErrors?: EntityFactError[]
```

**2) 검증기 신규 (`lib/semanticGrounding.ts`)**

- 입력: `feedback`(서술 텍스트), `matches: SlimMatchData[]`.
- 기물 이름은 데이터의 실제 이름만 사용하고 **긴 이름 우선**으로 매칭한다(부분 문자열 충돌 방지).
- 검사:
  - `unit_star`: `"{기물} ... N성"`. `A·B·C 모두 N성` 목록 표현도 각각 검사.
  - `three_star_count`: `"3성 N개"` vs 실제 3성 개수.
  - `item_owner`: `"{기물} ... {아이템}"`이 실제 `unit.items`에 있는지(한글 이름).
  - `trait_tier`: `"{시너지} N단계"` vs `match.traits[].tier`.
- 오탐 방지: "3성작", "3성 확보" 같은 일반 표현은 개수/주어가 명확할 때만 검사.
- **한계 명시**: 이 검증기는 의미 오류를 "줄" 뿐, 완전 보장은 아니다. 평가 지표로 쓴다.

**3) 통합 (`lib/llm.ts finalize`)**

```ts
const base = validateFeedbackGrounding(fb, prompt)
const entityErrors = validateEntityFacts(fb, matches)
grounding: { ...base, entityErrors }
```

- UI(`FeedbackReport`)는 필수 변경 아님. 있으면 경고 배지 추가(선택).
- `normalizeLecture`/폴백 출력도 검증 대상에 포함한다.

**4) 시스템 규칙 추가 (`SYSTEM_INSTRUCTION`)**

```text
- 제공된 데이터에는 라운드별 레벨업·리롤·골드 곡선이 없다.
  "언제 레벨업/리롤했다"를 단정하지 말고, 최종 레벨·잔여 골드·탈락 라운드로
  추정한 경우 "최종 상태 기준으로 보면"이라고 명시하라.
- 기물의 성급·아이템 소유는 제공된 최종 보드와 정확히 일치해야 한다.
  목록으로 묶어 말할 때도 각 기물의 실제 성급을 확인하라.
```

**5) 테스트**

- 신규 `scripts/testSemanticGrounding.js` + `package.json`의 `"test:ai": "node scripts/testSemanticGrounding.js"`.
- 케이스:
  - 이번 원시 출력 문자열 → `피들스틱 3성` 오류 1건 검출
  - "베이가·알리스타·오른 3성" → 오류 0
  - "3성 5개" → 오류 0 (실제 5)
  - 아이템 소유 오류 1건, 시너지 단계 오류 1건
  - 이름이 겹치는 기물(예: 나르/나르Small) 오탐 0
- CI(`ci.yml`)와 `npm run ci`에 `test:ai` 추가.

**완료 조건**

- [ ] 이번 샘플 출력에서 의미 오류 1건 검출
- [ ] 정상 문장 오탐 0 (테스트 케이스 기준)
- [ ] `grounding.entityErrors`가 결과 JSON에 포함
- [ ] `npm run test:ai`·`typecheck`·`build` 통과

---

### A2. 비교 사실 블록 (코드 계산)

**목표**

"조언이 구체적"이 되도록, 모델이 계산하지 않아도 되는 **비교 수치**를 코드가 제공한다.
모두 서술적 사실이며 인과 단정이 아니다.

**파일**

- 신규: `lib/comparisonFacts.ts` — `buildComparisonFacts({ matches, mode, units, items, combos, decks })`
- `lib/llm.ts` `generateMetaCoachFeedback`에서 `metaFacts`와 함께 블록 생성
- `SYSTEM_INSTRUCTION`에 "비교 사실은 서술 통계이며 원인 단정 금지" 한 줄 추가

**블록 형식**

```text
[비교 사실 — 코드 산출, 서술 통계]
- 로비 1등과 비교: 레벨 -2 (7 vs 9) · 3성 0 vs 4 · 시너지 단계 합 7 vs 9 · 아이템 13 vs 12
- 로비 평균과 비교: 레벨 -0.6 (7 vs 7.6) · 3성 +1
- 가장 유사한 메타 덱: 주문술사 베이가 (유사도 0.83, 표본 120판) · 메타 평균 4.21등 vs 이 경기 5등 (+0.79)
- BIS 일치율: 베이가 2/3 (보석 건틀릿 ✓, 루덴의 폭풍 ✓, 새벽심장 ✗) · 보드 전체 3/9 (33%)
```

**계산 규칙**

1. **로비 1등**: `lobbyParticipants`의 `placement === 1`.
   - `level`, `units.length`, `units.filter(tier===3).length`,
     `traits.reduce(tier,0)`, `units.reduce(items.length,0)` 비교.
   - `LobbyParticipant`에 gold는 없으므로 골드 비교는 하지 않는다.
2. **메타 덱 유사도**: 사용자 최종 보드의 `entitySlug('champion', unit.id)` 집합과
   `decksData`/`buildDecks` 코어의 Jaccard. 임계 `>= 0.6`, 가장 높은 1개.
   - `deck.avgPlacement`(또는 `getDecks` DB 응답)와 비교. `sampleSize < 30`이면 "참고용".
3. **BIS 일치율**: 같은 필터의 `unit_item` 상위 3개(`avgPlacement` 오름차순, `sampleSize >= 20`)와
   `unit.items`를 **한글 이름**으로 대조. 보드 전체 = 매칭 수 / 아이템 보유 슬롯 수.
4. single 모드만 로비 비교, multi 모드는 경기 간(레벨/3성/아이템) 요약.
5. 값이 없으면 해당 줄을 생략한다(`NaN`, `Infinity` 금지).

**테스트**

- `scripts/testComparisonFacts.js` (또는 `testAi`)에 픽스처 3개:
  - 1등 로비 비교 값이 손계산과 일치
  - 메타 덱 유사도 임계 미만이면 줄 생략
  - BIS 일치율 분모/분자 정확
- `npm run typecheck`·`lint`·`build`.

**완료 조건**

- [ ] 프롬프트에 `[비교 사실]` 블록이 들어가고, baseline과 같은 6경기에서 값이 재현됨
- [ ] 비교 사실 추가 후 `entityFactErrors`가 증가하지 않음
- [ ] `uniqueDataCitations`가 baseline 대비 증가하는지 `summary.csv`로 비교
- [ ] 프롬프트 버전 bump + 캐시 무효화

---

### A3. 스키마 v2 (중복 필드 제거) — 승인 후

**먼저 보고할 것**

- 현재 UI가 사용하는 필드: `FeedbackReport.tsx`의 `flexibilityScore`(177), `playstyle`(230),
  `improvements`(244), `contestAnalysis`(412), `itemAnalysis`(425), `synergyAnalysis`(433),
  `economyAnalysis`(441), `actionPlan`(474).
- 제거/통합 시 **화면에서 사라지는 섹션**과 대체 UI를 표로 정리해 승인받는다.
- 기존 캐시 리포트 호환: 필드를 optional로 두고, 없으면 코드 값/축 verdict로 대체.

**스키마**

```json
{
  "metaScore": 67,
  "metaTier": "C",
  "playstyle": "...",
  "overview": "...",
  "lecture": { "topic": "...", "concept": "...", "evidence": "...", "alternative": "...", "drill": "...", "checklist": ["..."] },
  "axes": [{ "key": "economy", "verdict": "..." }, "...6개"],
  "actions": ["...", "...", "..."]
}
```

- 제거: `flexibilityScore`(→ 코드 `contest` 점수), `contestAnalysis`, `itemAnalysis`,
  `synergyAnalysis`, `economyAnalysis`, `improvements`(→`actions`), `actionPlan`.
- `MetaCoachFeedback`·`parseJsonFeedback`·`normalizeLecture`·폴백 생성기·`FeedbackReport`를 함께 수정.
- `COACH_PROMPT_VERSION` bump. `fullMarkdown`은 유지(디버깅).

**완료 조건**

- [ ] UI에서 제거 섹션 대체안이 승인됨
- [ ] 스키마 v2로 6경기 × 3회 실행, `schemaValid=100%`
- [ ] 출력 토큰이 baseline 대비 유의하게 감소(목표 1,100~1,400)
- [ ] `typecheck`·`build`·기존 테스트 통과

---

### A4a. max_tokens 6,000 (상한만)

**변경**

- `lib/llm.ts`의 하드코딩 `3400`을 `DEEPSEEK_MAX_TOKENS` env(기본 3400)로.
- 인트로(`240`)는 그대로.
- `.env.example`에 `DEEPSEEK_MAX_TOKENS` 주석 추가.

**실험**

- baseline(3400) vs 6000을 **같은 6경기 × 3회**로 비교.
- 기록: `finishReason`, `outputTokens`, `truncated`, `latency`, `cost`, 품질 지표.

**예상**

- 기준 샘플은 이미 `stop`(1,709/3,400)이므로 **변화가 작을 가능성**이 큼.
- 변화가 없으면 A4b(추론)로 넘어가고, 6000은 채택하지 않는다.

**완료 조건**

- [ ] `summary.csv`에 3400 vs 6000 비교
- [ ] 잘림률·품질·비용 차이를 수치로 보고

---

### A4b. thinking/추론 모델

**변경/실험**

- `DEEPSEEK_THINKING=enabled` 및/또는 `DEEPSEEK_MODEL=deepseek-v4-pro`(실제 스펙 확인).
- `DEEPSEEK_MAX_TOKENS=6000`과 함께, `finishReason=stop`인지 확인.
- 인트로는 flash/240 유지.
- 비교: A4a(상한만) vs A4b(추론) vs baseline.

**주의**

- thinking 토큰이 출력 상한을 잡아먹을 수 있으므로 **JSON 잘림률**을 반드시 기록.
- 비용·지연이 채택 기준(p95 < 20s, < $0.01/리포트)을 넘으면 기본값으로 채택하지 않는다.

---

### A5. Gemini 리포트 주력 비교

**변경**

- `LLM_PROVIDER=gemini`로 **강제**할 수 있게 한다(폴백 혼입 방지).
- Gemini `generationConfig`에 `responseMimeType: 'application/json'` 추가.
- 같은 6경기 × 3회, 같은 스키마(가능하면 v2)·같은 프롬프트로 비교.
- 비교: schemaValid, entityFactErrors, grounding, 한국어 품질(블라인드 1~5), latency, cost.

**완료 조건**

- [ ] DeepSeek vs Gemini 비교표(`summary.csv`)
- [ ] 폴백률 0(강제 provider 기준)
- [ ] 채택 여부와 근거를 문서화

---

## 3. 커밋 계획

| 순서 | 커밋 |
| --- | --- |
| 1 | `test(ai): 변형 평가 하네스 + 지표 요약` (A0) |
| 2 | `fix(grounding): 의미 기물/아이템 검증 + 라운드 타이밍 금지` (A1) |
| 3 | `feat(ai): 로비 1등·메타 평균·BIS 비교 사실` (A2) |
| 4 | (승인 후) `feat(ai): 리포트 스키마 v2 (중복 필드 제거)` (A3) |
| 5 | `feat(llm): DEEPSEEK_MAX_TOKENS env` (A4a) |
| 6 | `feat(llm): 추론 모델/thinking 실험` (A4b) |
| 7 | `feat(llm): Gemini 리포트 강제 provider` (A5) |

---

## 4. 검증

```powershell
npm run typecheck
npm run test:ai
npm run test:axes
npm run test:rollup
npm run test:ops
npm run lint
npm run build

# baseline
node scripts/evalAiVariants.js --variant baseline --runs 3 --provider deepseek --max-tokens 3400 --thinking disabled --schema v1 --out tmp/eval

# 비교 예시
node scripts/evalAiVariants.js --variant comparisons --runs 3 ... --out tmp/eval
node scripts/evalAiVariants.js --variant tokens6000 --runs 3 ... --max-tokens 6000 --out tmp/eval
node scripts/evalAiVariants.js --variant thinking --runs 3 ... --max-tokens 6000 --thinking enabled --out tmp/eval
```

- `tmp/eval/summary.csv`를 PR에 첨부.
- 원시 매치 확인(키 갱신 후): `node tmp/ai-run/check-raw-match.js KR_8414975456`

---

## 5. 결정 필요 / 주의

- **A3는 UI 변경을 동반**한다. 스키마 축소는 프롬프트만 바꾸는 실험이 아니다.
- **A4a의 기대 효과는 낮다**: 현재 샘플은 잘리지 않았다. A4b와 분리 측정한다.
- **A5는 동일 스키마**에서 비교해야 공정하다. v1 vs v2가 섞이면 품질 비교가 오염된다.
- **데이터 천장**: 라운드별 레벨업/리롤/골드 곡선은 없다. "언제"를 단정하는 문장은
  프롬프트 규칙 + 의미 검증기로 억제하고, 최종 상태 프록시로만 말하게 한다.
- 현재 작업 트리의 UI WIP(`MetaDashboard`, `MetaRanking`, `app/meta/page`, `MetaUrlSync`)는
  이 스프린트와 무관하므로 **건드리지 않는다**.

---

## 부록. 관련 문서/산출물

- 계획: `docs/AI-EVAL-PLAN-2026-10-20.md`
- 기준 샘플: `tmp/ai-run/REPORT.md` (프롬프트·원시응답·결과), `meta.json`
- 원시 매치 확인: `tmp/ai-run/check-raw-match.js`
- 기존 평가: `scripts/evalReports.js`(HTTP `/overview`, `nocache`)

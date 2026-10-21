# AI 리포트 검증 계획 — 2026-10-20

- **목적**: "천장이 데이터인지 모델인지"를 감이 아니라 **같은 입력·같은 지표**로 분리한다.
- **기준 샘플**: `KR_8414975456` (5등, Lv.7, 6-1, 32분 58초, 7유닛) · `deepseek-flash` · `COACH_PROMPT_VERSION 2026-10-20.2`
- **산출물**: `tmp/ai-run/` (프롬프트·원시응답·최종 JSON·실행 스크립트)

---

## 1. 원시 매치 데이터 확인 결과 (요청 사항)

### 확인한 것

- 저장소의 원시 타입 `RawTFTParticipant`는 **종료 시점 필드만** 가진다.
  `placement · level · last_round · time_eliminated · gold_left · players_eliminated · total_damage_to_players · augments · traits · units` (`lib/types.ts:23-37`)
- 파서 `extractSlimMatchData`도 같은 필드만 사용한다 (`lib/summarize.ts:86-136`).
  `last_round`는 **누적 라운드 정수**(예: 6-1 → 21)이고, 라운드별 이력이 아니다.
- `units`는 **최종 보드**이며 bench·라운드별 골드·레벨업/리롤 시각 필드가 없다.

### 실호출 결과

- `GET https://asia.api.riotgames.com/tft/match/v1/matches/KR_8414975456` → **401 Unknown apikey** (개발 키 만료).
- 키 갱신 후 `node tmp/ai-run/check-raw-match.js KR_8414975456` 로 원시 JSON의 키 목록과
  `rounds/timeline/events/levelup/roll/bench` 존재 여부를 바로 확인할 수 있게 스크립트를 남겼다.

### 결론

- **라운드별 레벨업·리롤·골드 곡선은 TFT Match-V1 응답에 없다.** LoL `match-v5`의 timeline 같은
  TFT 전용 타임라인 엔드포인트도 없다(공식 API 목록 기준).
- 따라서 "7레벨 롤링이 늦었다"는 **데이터로 증명 불가**. 현재 출력의
  "골드가 없어서가 아니라 레벨에 쓰지 않아서 진 겁니다"는 최종 상태만으로 만든 **인과 단정**이다.
- 데이터 천장 가설은 **맞다**. 단, "데이터가 없어서 일반론만 나온다"와 "모델이 의미 검증을 통과 못 한다"는
  별개이므로, 아래에서 둘을 분리 측정한다.

---

## 2. 기준 샘플에서 이미 보인 것

| 항목 | 값 | 해석 |
| --- | --- | --- |
| finish_reason | `stop` | **잘리지 않음** |
| 출력 토큰 | 1,709 / 3,400 | 상한의 절반. **토큰 상한이 병목이 아님** |
| 입력 토큰 | 4,360 (캐시 1,408) | 프롬프트가 큼 |
| Grounding | 100 (11/11) | 숫자·이름 검증은 통과 |
| 의미 오류 | 1건 | "피들스틱·르블랑·오른 모두 3성" ← 피들스틱은 **1성** |
| 비용/시간 | $0.002945 / 10.2초 | 반복 실험 비용은 낮음 |

→ **토큰 6,000 상향만으로 깊이가 바뀔 가능성은 낮다.** 깊이를 결정하는 건
① 제공되는 비교 사실 ② 출력 스키마의 중복 ③ 의미 검증 부재다.

---

## 3. 실험 설계 (같은 입력, 한 번에 하나만)

### 고정 평가 세트

같은 세트를 모든 변형에 사용한다. 1경기 과적합을 막기 위해 **6경기**를 권장한다.

| 케이스 | 선정 기준 | 목적 |
| --- | --- | --- |
| C1 | 5등·정상 종료 (현재 샘플) | 기준선 |
| C2 | 1등·빈집 | 상위권 표현 품질 |
| C3 | 8등·경합 심함 | 실패 원인 설명 |
| C4 | 2-2 초반 종료 | 표본 부족 처리 |
| C5 | 4~5등·증강 없음 | 증강 금지 규칙 |
| C6 | multi 5경기 | 종합 분석 |

### 실행 규칙

- 변형당 **3회 반복**(temperature 0.2의 분산 측정). 결과는 `tmp/eval/<variant>/<case>/run-N.json`.
- `generateMetaCoachFeedback`를 직접 호출해 **캐시를 우회**한다(라우트 캐시와 분리).
- provider를 **강제**한다(`LLM_PROVIDER=deepseek|gemini` 또는 별도 래퍼). 실패 시 폴백이 섞이면 A/B가 오염된다.
- 각 실행마다 `variant, model, max_tokens, thinking, prompt_version, input/output tokens, finish_reason, latency, cost`를 기록한다.
- 프롬프트/스키마 변경 시 `COACH_PROMPT_VERSION`을 올린다.

### 지표

| 지표 | 자동/수동 | 설명 |
| --- | --- | --- |
| schemaValid | 자동 | JSON 파싱·필수 필드·6축 key |
| truncated | 자동 | `finish_reason=length` |
| groundingScore / unsupported | 자동 | 기존 `validateFeedbackGrounding` |
| **entityFactErrors** | 자동(신규) | 기물 성급·아이템 소유·시너지 단계 오류 |
| uniqueDataCitations | 자동 | 고유 수치 인용 수 / 1,000자 |
| repetition | 자동 | overview·axes·lecture 문장 중복률 |
| latency / cost | 자동 | p50·p95, 리포트당 USD |
| humanSpec / humanAction / korean | 수동(블라인드) | 1~5점, 변형명 숨김 |

---

## 4. 실험 순서 (권장)

사용자 제안 순서(토큰 → 필드 → 비교 → Gemini)도 가능하지만,
**기준 샘플이 `stop`으로 끝났으므로 토큰 상향의 기대 효과가 낮다.** 아래 순서를 권장한다.

| 단계 | 변형 | 목적 | 예상 효과 |
| --- | --- | --- | --- |
| **E0** | 현재 그대로 | 기준선·분산 측정 | - |
| **E1** | 의미 검증기 + "라운드 타이밍 단정 금지" 규칙 | 모델 오류와 데이터 한계를 분리 | 오류 측정 가능 |
| **E2** | **비교 사실 추가** (코드 계산) | 구체성 확보 | **가장 큰 개선 기대** |
| **E3** | **스키마 축소**(중복 필드 제거) | 같은 토큰으로 근거·대안 확보 | 중~큼 |
| **E4a** | max_tokens 6,000 | 상한 여유 | 낮음(현재 stop) |
| **E4b** | E4a + thinking/추론 모델 | 추론 깊이 | 중~큼, 비용↑ |
| **E5** | Gemini를 리포트 주력으로 | 한국어 품질 비교 | 별도 판단 |

> E4는 **토큰 상한**과 **추론 모델**을 분리해서 측정한다. 둘을 동시에 바꾸면 원인을 알 수 없다.
> 인트로는 지금처럼 flash/240 토큰으로 고정한다.

---

## 5. 스키마 v2 제안 (중복 제거)

현재 출력은 상위 필드 14개 + 중첩이며, `overview`·`axes.verdict`·4개 `*Analysis`·`lecture`가
같은 내용을 반복한다. UI도 이 필드를 모두 렌더링한다(`FeedbackReport.tsx:177, 412-474`).

### 제안 스키마

```json
{
  "metaScore": 67,
  "metaTier": "C",
  "playstyle": "성향 한 줄",
  "overview": "서로 다른 축 3개 요약 (3문장)",
  "lecture": {
    "topic": "코드 지정 주제 그대로",
    "concept": "...",
    "evidence": "수치 2개 이상",
    "alternative": "...",
    "drill": "...",
    "checklist": ["...", "...", "..."]
  },
  "axes": [
    { "key": "economy", "verdict": "한 줄" },
    { "key": "itemization", "verdict": "한 줄" },
    { "key": "tempo", "verdict": "한 줄" },
    { "key": "completion", "verdict": "한 줄" },
    { "key": "synergy", "verdict": "한 줄" },
    { "key": "contest", "verdict": "한 줄" }
  ],
  "actions": ["실전 가이드 1", "실전 가이드 2", "실전 가이드 3"]
}
```

- 제거: `flexibilityScore`(코드 `contest` 점수로 대체), `contestAnalysis`, `itemAnalysis`,
  `synergyAnalysis`, `economyAnalysis`, `improvements`(→`actions`로 통합), `actionPlan`.
- 이유: 해설 4종과 축 verdict가 중복이고, 개선점/액션플랜도 중복이다. 남은 토큰을
  `lecture.evidence`·`alternative`에 쓰게 한다.
- **UI 변경 필요**: `FeedbackReport`가 제거 필드를 렌더링하므로, 축 verdict/`actions`로 대체하거나
  optional 처리한다. 기존 캐시 리포트는 `COACH_PROMPT_VERSION`을 올려 무효화한다.
- 기대: 출력 1,700 → 1,100~1,400토큰, 같은 비용으로 근거 밀도 상승.

---

## 6. 코드로 만들 "비교 사실" (E2)

프롬프트에 `[비교 사실 — 코드 산출]` 블록을 추가한다. 모두 **서술적 사실**이며 인과 단정이 아니다.

### 6-1. 로비 1등과의 차이 (single)

`match.lobbyParticipants`에서 1등을 찾아 계산한다. (`LobbyParticipant`에 gold는 없음)

```text
- 로비 1등과 비교: 레벨 -2 (7 vs 9) · 3성 0 vs 4 · 시너지 단계 합 7 vs 9 · 아이템 13 vs 12
- 로비 평균과 비교: 레벨 -0.6 (7 vs 7.6) · 3성 +1
```

### 6-2. 내 결과 vs 덱 메타 평균

사용자 최종 보드의 코어(아이템 보유 기물 + 고코스트)와 가장 유사한 메타 덱을 찾아 비교한다.

```text
- 이 보드와 가장 유사한 메타 덱: 주문술사 베이가 (유사도 0.83, 표본 120판)
- 메타 평균 4.21등 vs 이 경기 5등 (+0.79, 표본 120)
```

- 매칭은 `decksData`/`buildDecks`의 `core_units`와 Jaccard 유사도(임계 0.6)로 계산.
- 표본 `n < 30`이면 "참고용" 표시.

### 6-3. BIS 일치율 (기물별)

같은 필터의 `unit_item` 상위 3개(평균등수, `n ≥ 20`)와 실제 아이템을 **한글 이름**으로 대조한다.

```text
- 베이가: 3개 중 2개 BIS (보석 건틀릿 ✓, 루덴의 폭풍 ✓, 새벽심장 ✗)
- 알리스타: 3개 중 1개 BIS (이온 충격기 ✓)
- 보드 전체 BIS 일치율: 3/9 (33%)
```

- BIS는 "정답"이 아니라 **평균등수 상위 조합**임을 문구에 명시한다.

### 6-4. 이미 있는 비교

- 표준 레벨 대비 격차, 잔여 골드, 탈락 스테이지, 경합 강도/등급, 2성+·3성 수, 총 아이템 수.

---

## 7. 의미 검증기 (E1, 신규)

현재 Grounding은 **숫자·이름**만 본다. 이번 샘플의 "피들스틱 3성" 오류는 통과했다.

`lib/grounding.ts`(또는 `lib/semanticGrounding.ts`)에 추가:

- 기물 성급: `"{기물} ... N성"` 및 `"A·B·C 모두 N성"` 목록 표현을 파싱해 `match.units[].tier`와 비교.
- 3성 개수: `"3성 N개"`를 실제 개수와 비교.
- 아이템 소유: `"{기물} ... {아이템}"` 패턴을 실제 `unit.items`와 비교(이름 기준).
- 시너지: `"{시너지} N단계"`를 `match.traits[].tier`와 비교.
- 결과: `grounding.entityErrors: [{type, text, expected, actual}]` 추가, UI에 경고 배지(선택).
- 회귀 테스트: 이번 원시 출력을 fixture로 넣어 **피들스틱 오류가 검출**되는지 고정.

---

## 8. Gemini 비교 (E5)

- 같은 프롬프트·같은 6경기·3회 반복. provider를 강제해 폴백 혼입을 막는다.
- Gemini는 `responseMimeType: application/json`을 켜서 JSON 준수율을 맞춘다.
- 비교 항목: schemaValid, entityFactErrors, grounding, 한국어 자연스러움(블라인드), latency, cost.
- DeepSeek reasoning 모델(E4b)과 Gemini를 **같은 스키마 v2**에서 비교해야 공정하다.

---

## 9. 채택 기준

- 기준선 대비 **entityFactErrors 증가 없음**, groundingScore 하락 없음.
- `uniqueDataCitations` 또는 humanSpec 점수가 유의하게 상승.
- p95 지연 < 20초, 리포트당 비용 < $0.01(권장) 유지.
- 위를 만족할 때만 기본 모델/프롬프트를 바꾸고 `COACH_PROMPT_VERSION`을 올린다.

---

## 10. Claude Code 실행 프롬프트

```text
docs/AI-EVAL-PLAN-2026-10-20.md 를 읽고 E0부터 수행해줘.
- 고정 6경기, 변형당 3회, provider 강제, 캐시 우회
- 결과는 tmp/eval/<variant>/<case>/run-N.json 에 저장하고 지표를 CSV로 요약
- E1(의미 검증기 + 라운드 타이밍 단정 금지)과 E2(비교 사실)를 먼저 구현
- E3(스키마 v2)는 UI 영향 범위를 먼저 보고하고, 승인 후 진행
- E4a/E4b/E5는 E1~E3 결과를 본 뒤 하나씩
프롬프트/스키마를 바꾸면 COACH_PROMPT_VERSION을 올리고, 기존 캐시를 재사용하지 마.
```

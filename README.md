# 🎯 TFT AI 전략 코치 & 실전 전적 검색 웹앱 (TFT Tactical Meta Coach)

[![CI](https://github.com/yashiro0504/tft-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/yashiro0504/tft-ai/actions/workflows/ci.yml)
[![Collect Ladder Meta](https://github.com/yashiro0504/tft-ai/actions/workflows/collect-ladder.yml/badge.svg)](https://github.com/yashiro0504/tft-ai/actions/workflows/collect-ladder.yml)

> **"내 플레이가 현재 메타와 얼마나 맞았을까? 대깨였을까, 빈집 유연 운영이었을까?"**  
> 롤체지지(LOLCHESS) / OP.GG 스타일의 실시간 전적 및 로비 8명 순위 조회와 함께, **DeepSeek V3 AI**가 현재 정석 메타 적합도와 결정적인 개선 포인트를 정밀 코칭해주는 웹앱입니다.

---

## ⚡ 핵심 기능

1. **소환사 프로필 헤더 (LOLCHESS 스타일)**
   - Riot 공식 소환사 아이콘, 레벨(`Lv`), 최근 전적 기준 평균 등수, 1등 승률, 순방률(TOP 4) 실시간 집계
2. **실시간 18시즌 실전 매치 히스토리**
   - 챔피언 초상화 일러스트, 3성 골드 별(`★★★`), 코스트별(1~5코) 테두리 컬러
   - 정식 게임 내 아이템 그래픽 아이콘 및 100% 한글 시너지 엠블럼 뱃지
3. **로비 8인 전체 순위표 아코디언**
   - 각 경기별 `[로비 8명 전체 순위 보기 ▼]` 클릭 시, 1등부터 8등까지 전체 유저의 덱과 레벨, 시너지 랭킹 한눈에 열람
4. **로비 기물 경합 기반 대깨 vs 유연성(피봇) 진단**
   - 로비 내 동일 시너지/기물을 기용한 다른 플레이어 수(`경합 N명`) 실시간 계산
   - 기물이 겹쳤을 때 무리하게 대깨로 밀어붙였는지, 빈집을 찾아 유연하게 피봇했는지 진단
5. **AI 전력분석관의 4단계 정밀 코칭 리포트**
   - 메타 적합도 점수 (`Meta Score 0~100점`) & 티어 등급
   - 3대 핵심 영역 진단 (아이템 3신기 BIS 최적화, 앞/뒷라인 밸런스, 렙업 및 골드 운영)
   - 결정적 개선 포인트 3가지 (`What to Improve`)
   - 다음 경기 실전 적용 가이드 (`Action Plan`)
6. **실측 메타 조합 대시보드 (메인 화면)**
   - 기본 뷰가 **덱(보드 조합)**: 롤체지지 추천 덱의 **유닛 구성 · 성급 · 아이템 · 시너지 개수**를 보드 카드로 표시
   - 각 덱의 **실측 가중 평균등수**는 우리 래더 표본(기물별 표본 가중)으로 계산 → S~D 티어 자동 부여
   - **덱 카드 클릭 → 보드 배치 모달**: 4×7 헥스 보드에 유닛 위치·성급·아이템·캐리 강조 + 시너지/기물 상세
   - 유닛 클릭 → 기물 상세 드로어, `BIS` 탭에서 기물별 BIS 아이템 3종 세트 확인
   - 상단 `TOP 3 메타 덱` 포디움, 코스트·티어·최소표본 필터 + 평균등수/표본/TOP4/코스트 정렬

   ```bash
   # 덱 데이터 갱신 (롤체지지 메타 페이지 파싱 + 우리 통계 매칭)
   #   - 개발 서버가 켜져 있어야 기물 통계 매칭률이 높습니다(없으면 통계 없이 생성)
   npm run collect:decks
   ```

---

## 🎓 강의형 AI 코칭 (6축 진단 + 오늘의 강의)

기존 리포트가 "로비 경합" 한 축에 몰리는 문제를 구조적으로 해결했습니다.

### 1) 6축 진단 (코드 산출, LLM 아님)
`lib/coaching.ts` 가 경기 데이터에서 6개 축을 0~100점으로 계산합니다.

| 축 | 계산 근거 |
| --- | --- |
| 경제 운영 | 잔여 골드 × 탈락 스테이지 (이른 탈락 + 많은 골드 = 감점) |
| 아이템 설계 | 캐리 3칸 완성도(55%) + 보드 총 장착 수(45%) |
| 템포(레벨/리롤) | 스테이지별 표준 레벨(3-2=6, 4-1=7, 5-1=8)과의 격차 |
| 보드 완성도 | 2성+ 비율 + 3성 보너스 |
| 시너지 설계 | 활성 시너지 개수(이상 3개) + 최대 겹침 깊이 |
| 로비 수렴도 | 경합 여부 × 순방 여부 |

### 2) 강의 주제는 코드가 결정
- **가장 점수가 낮은 축**이 그 리포트의 주제가 됩니다 (예: "시너지 밀도 강의 — 얕은 판 vs 깊은 판").
- `경합` 축은 **다른 축보다 10점 이상 낮을 때만** 주제로 채택 → 더 이상 모든 리포트가 경합으로 쏠리지 않습니다.

### 3) 강의 본문 (LLM은 주제를 바꿀 수 없음)
`concept`(원리) → `why`(왜 이기는가) → `evidence`(내 데이터 근거, 수치 2개 이상) → `alternative`(그 순간의 더 나은 선택 + 타이밍) → `drill`(다음 3판 연습 과제) → `checklist`(실전 체크리스트 3~5개)

### 4) 검증
```bash
npm run eval:reports -- --runs 2   # 성공률 100% · 폴백 0% · grounding 100% · 점수 고정
```

---

## 🎨 테마 (다크 / 라이트)

- 헤더 우측 **☀/🌙 버튼**으로 전환 (롤체지지 스타일 화이트 테마 포함)
- 첫 방문 시 **시스템 설정**(`prefers-color-scheme`)을 따르고, 선택은 `localStorage('tft-theme')`에 유지
- 색상은 `app/globals.css`의 CSS 변수(`--app-bg`, `--panel`, `--ink`, `--muted`, `--line` …)와
  Tailwind 토큰(`bg-app`, `bg-panel`, `text-ink`, `text-muted`, `border-line` …)으로 관리됩니다.
- 라이트 모드에서 색상 배지/경고 칩은 자동으로 밝은 톤 + 짙은 글자로 보정됩니다.

---

## 🚀 로컬 실행 방법

```bash
# 의존성 설치
npm install

# 로컬 개발 서버 실행
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 접속!

---

## 🔑 환경 변수 설정 (`.env.local`)

```env
# Riot Developer Portal (https://developer.riotgames.com/)
RIOT_API_KEY=RGAPI-xxxx
RIOT_REGION=asia

# DeepSeek API (https://platform.deepseek.com/)
DEEPSEEK_API_KEY=sk-xxxx

# Google Gemini API (선택사항 - Fallback용)
GEMINI_API_KEY=
```

---

## 🌐 Vercel 웹앱 배포 방법

1. GitHub 저장소(`https://github.com/yashiro0504/tft-ai.git`)에 push된 프로젝트를 확인합니다.
2. [Vercel](https://vercel.com)에 로그인 후 `Add New Project`에서 `tft-ai` 저장소를 Import합니다.
3. Environment Variables(환경 변수)에 `RIOT_API_KEY`와 `DEEPSEEK_API_KEY`를 등록합니다.
4. `Deploy`를 클릭하면 즉시 전 세계에 서비스되는 웹앱으로 배포됩니다!

---

## 🧭 최신 아키텍처 (경기별 분석 + 접지 코칭)

### API 엔드포인트
| 엔드포인트 | 역할 | LLM 호출 |
|---|---|---|
| `POST /api/tft/search` | 소환사 프로필 + 최근 매치 리스트 | ❌ |
| `POST /api/tft/match` | **특정 경기(matchId) 1개 정밀 분석 (matchId 캐시)** | ✅ |
| `POST /api/tft/overview` | 로드된 여러 경기 종합 분석 | ✅ |

### 접지(Grounding) 원칙
- **계산은 코드, 해설만 AI**: 기물 경합(`lib/contest.ts`), 증강 메타 대조(`lib/meta.ts`)는 코드가 수치로 산출합니다.
- LLM은 **제공된 수치만** 근거로 서술하며, 제공되지 않은 메타/증강 통계는 "단정 불가"로 답합니다.

### 🛡️ 신뢰성 계층 (환각 탐지 · 코드 검증)
- **근거 검증(`lib/grounding.ts`)**: LLM 리포트의 수치 주장(등/명/%/G/라운드, `3.44` 같은 소수, `62/100`)을 **프롬프트에 제공된 실측 데이터와 코드로 대조**합니다.
  → 응답/UI에 `grounding { score, supported, total, unsupported[] }` 로 표시 (낮을수록 창작·환각 가능성).
- **메타 통계 화이트리스트**: `[메타 실측 통계]` 블록(기물 12 · 시너지 10 · 아이템 10 · BIS 8, `n≥10`만) 외의 수치는 인용 금지로 프롬프트에 명시.
- **출처 표기**: `provenance { patch, source, generatedAt, sample }` 를 리포트에 함께 반환해 패치·표본·수집일을 화면에 노출.
- **결정론적 점수(`lib/scoring.ts`)**: `metaScore`/`metaTier` 는 LLM이 아니라 **코드가 계산**합니다.
  - 결과(등수) **40%** + 덱 완성도 **25%** + 아이템 활용 **20%** + 경합 대응 **15%**
  - 응답에 `scoreBreakdown { total, tier, components[], matches, perMatch, version }` 포함 → UI에 구성요소별 기여도 바 표시
  - LLM에는 계산된 점수를 프롬프트로 주고 "그대로 사용"하도록 지시한 뒤, 파싱 후 **코드 값으로 덮어쓰기** (같은 경기 = 항상 같은 점수)
- **결정론 옵션**: `temperature 0.2` + JSON 모드(`response_format: json_object`), 실패 시 규칙 기반 폴백(`isFallback: true`)으로 표시.

### 🧮 경합 강도 (0~100)
```
기물 weight = 코스트 × 성급민감도(1성1.4/2성1.0/3성0.5) × (1 + (상대수-1)×0.3)
시너지 weight = 활성단계 × 그 시너지 상대 수
contestScore = 100 × raw / (raw + 25)   → 등급: 빈집/보통/경합/심각
```

---

## 📊 증강 메타 데이터 (파이프라인)

Riot 공식 API는 **집계 통계(증강 승률/평균등수)를 제공하지 않습니다.** 따라서 자체 집계합니다.

- 데이터 파일: `lib/metaStats.json`
- 상태 태그: `sample: true`(검증 전)일 때만 UI에 `샘플` 표시, LLM도 "단정 금지" 처리
- 실측 데이터 생성 (2가지 방식)
  ```bash
  # (권장) 래더 전체 표본 자동 수집 — 특정 소환사에 의존하지 않음
  #  챌린저·그랜드마스터·마스터 래더에서 표본 선수를 뽑아 최근 매치를 대량 집계
  npm run collect:ladder

  # 소환사 시드 기반 수집 (특정 고수 표본)
  npm run seeds:pick     # 챌린저 랭킹에서 시드 자동 추출 → .env.local SEEDS
  npm run collect:meta   # SEEDS 기반 수집
  ```
  → `lib/metaStats.json` 을 `sample: false` + `source: "riot-ladder" | "riot-sample"` 로 덮어씁니다.
  → 실행 시 UI/LLM이 실측 통계를 인용하게 됩니다.
- 래더 수집 옵션(환경변수): `PLAYERS`(기본 60), `MATCHES_PER_PLAYER`(8), `MAX_MATCHES`(400), `RIOT_MIN_INTERVAL_MS`(350)
- ⚠️ 증강 키 표기는 `lib/summarize.ts` 의 `cleanName()` 결과와 일치해야 합니다(스크립트가 동일 규칙 사용).
- ⚠️ Riot 개발 키는 24시간마다 만료되며, 표본이 많을수록 통계가 안정적입니다.

> 📖 **실측 데이터 수집·튜닝 상세 가이드 → [docs/DATA_PIPELINE.md](docs/DATA_PIPELINE.md)**
> (`.env.local` 자동 로드, `npm run collect:check` 키 점검, PowerShell/CMD 사용법 포함)

---

## 🧪 AI 신뢰성 평가 (회귀 테스트 · CI 게이트)

```bash
# 1) 골든셋 캡처 — 실제 경기 N개를 고정 입력으로 저장 (data/evalMatches.json)
npm run eval:capture -- "닉네임#KR1" 3

# 2) 반복 평가 — 캐시 우회로 매 실행 실제 LLM 호출 측정 (기본 2회)
npm run eval:reports
#   node scripts/evalReports.js --runs 3 --api http://localhost:3000
```

**측정 지표**
- 성공률 · 폴백률 · 평균 지연
- **근거 검증(grounding) 평균/최저**, 주장 수 대비 미확인 수치 수
- **점수 = 코드 산출 일치**(`metaScore === scoreBreakdown.total`) 및 실행 간 **점수 변동**
- 유연성 점수(LLM) 표준편차

**출력**: 콘솔 요약 + `data/evalReport.json` (생성물, gitignore)

**CI 게이트**: 아래 중 하나라도 실패하면 `exit 1`
`성공률 < 100%` · `폴백 발생` · `grounding < 85%` · `점수-코드 불일치` · `실행 간 점수 변동`

---

## 🤖 운영 자동화 (GitHub Actions)

### 워크플로

| 파일 | 트리거 | 내용 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push(`main`, `upgrade/**`) · PR | Lint → Typecheck → 데이터 점검(`meta:check`) → Build, 이어서 **AI 신뢰성 평가 게이트**(성공률 100% · 폴백 0 · grounding ≥85% · 점수 고정 검증) |
| `.github/workflows/collect-ladder.yml` | 매일 21:00 UTC(= 06:00 KST) · 수동 실행 | 래더 표본 수집 → 데이터 검증 → 순위 변동 요약 → `lib/metaStats.json` 자동 커밋/푸시 |

### 필요한 Repository Secrets

| 이름 | 필수 여부 | 설명 |
| --- | --- | --- |
| `RIOT_API_KEY` | 래더 수집 필수 | Riot 개발 키는 **24시간마다 만료**됩니다. 예약 수집을 상시 운영하려면 Personal/Production 키를 사용하거나 주기적으로 Secret 을 갱신하세요. |
| `DEEPSEEK_API_KEY` | AI 평가 필수 | 미설정 시 `eval` 잡은 안내 메시지를 남기고 건너뜁니다(빌드는 계속 검증됨). |

설정 위치: 저장소 → **Settings → Secrets and variables → Actions → New repository secret**

### 로컬/수동 실행

```bash
# GitHub CLI
gh workflow run collect-ladder.yml -f players=80 -f max_matches=600
gh workflow run collect-ladder.yml -f dry_run=true     # 수집만 하고 커밋 안 함

# 로컬 동일 파이프라인
npm run collect:ladder
npm run meta:check      # 데이터 무결성 (기물/특성/아이템/조합 최소치)
npm run meta:summary    # 직전 수집 대비 순위 변동 ▲▼ 요약
npm run ci              # lint + typecheck + meta:check + build
```

### 동작 규칙

- 수집 후 기물이 **40종 미만**이면 워크플로를 실패시켜 `lib/metaStats.json` 커밋을 차단합니다(표본 붕괴 방지).
- 커밋 대상은 `lib/metaStats.json` 하나이며, `data/metaHistory/`(로컬 아카이브)·`data/evalReport.json` 은 `.gitignore` 로 제외됩니다.
- 순위 변동(▲▼)은 **직전 커밋본 `lib/metaStats.json`** 과 비교해 자동 계산되고, Job Summary 에 상승/하락 항목이 표시됩니다.
- `concurrency` 로 중복 실행을 막고, 수집 잡은 `timeout-minutes: 40` 으로 제한합니다.
- `eval` 잡 산출물(`data/evalReport.json`, 서버 로그)은 Actions Artifact 로 업로드됩니다.

---

## 📈 순위 변동 (▲▼)

수집할 때마다 **이전 `lib/metaStats.json` 과 비교**해 기물/시너지/아이템의 순위·평균등수 변동을 계산합니다.

- 계산: `rankDelta > 0` = 순위 상승 (예: 5위 → 3위 = ▲2), `avgDelta > 0` = 평균등수 개선
- 저장: 각 항목에 `prevRank`, `rankDelta`, `avgDelta`, 루트에 `prevGeneratedAt`
- UI: 기물/시너지/아이템 행과 상세 드로어에 **▲/▼ 배지** (호버 시 평균등수 변화 툴팁), 푸터에 `변동 기준 날짜`
- 이전 수집본은 `data/metaHistory/YYYY-MM-DD.json` 로 자동 아카이브 (gitignore)

```bash
# 수집 시 자동 계산됨
npm run collect:ladder

# 이미 수집된 파일 기준으로 변동만 재계산 (미리보기 / 저장)
npm run meta:deltas
node scripts/attachMetaDeltas.js --prev data/metaHistory/2026-10-17.json --write
```

---

## 📱 모바일 UX

- **하단 탭 바** (`md` 미만): 기물 / 특성 / 아이템 / BIS 조합 / AI 코치 — 탭 전환 시 랭킹 상단으로 스크롤, 안전 영역(`safe-area-inset`) 대응
- **카드 리스트 테이블**: 기물·특성·아이템 행이 좁은 화면에서 2단 카드로 재배치되고 TOP4 바가 행 하단 전체 폭으로 이동
- **가로 스크롤 필터 바**: 코스트/티어/표본/정렬 칩이 한 줄 스와이프로 동작 (스크롤바 숨김)
- **포디움**: 모바일에서 1위가 최상단에 오도록 순서 재배치
- **상세 드로어**: 좁은 화면에서 전체 폭으로 열림
- `viewport-fit=cover` 로 iOS 노치/홈 인디케이터 영역 침범 방지

---

## 🔎 필터 · 정렬 · 단축키

- **코스트 1~5** (기물 탭) · **티어 S~D** · **최소 표본** 10+/20+/50+ 필터
- **정렬**: 평균등수 · 표본 · 3성률 · TOP4
- 아이템 탭: 일반 / 찬란한 / 유물 / 상징 / 특수 분류 필터
- **키보드**: `/` 검색 포커스, `Esc` 검색 초기화 (상세 드로어 닫기 포함)
- 코스트는 `lib/constants.ts`의 **세트18 코스트 표**(65종)를 사용합니다. (수집 데이터에 코스트가 포함되면 우선 사용하도록 확장 가능)

---

## 🎛️ 경합 임계값/가중치 튜닝

경합 분석의 모든 파라미터는 `lib/contestConfig.json` 한 곳에서 관리됩니다 (앱·스크립트 공용).

```json
{
  "starSensitivity": { "1": 1.4, "2": 1.0, "3": 0.5 },
  "frequencyStep": 0.3,
  "traitTierWeight": 1.0,
  "saturationK": 25,
  "thresholds": { "binzip": 15, "boTong": 40, "gyeonghap": 65 }
}
```

### 실측 데이터로 재보정
```bash
# 1) 표본 수집 (참가자별 경합 특징 + 등수)
RIOT_API_KEY=RGAPI-xxxx node scripts/collectContestSamples.js "닉네임#KR1" "닉네임2#KR1" ...

# 2) 그리드서치로 가중치/임계값 재산출 (미리보기)
node scripts/tuneContest.js data/contestSamples.json

# 3) 결과 반영 (실측 데이터일 때만)
node scripts/tuneContest.js data/contestSamples.json --write
```

- 튜닝 목표: **경합 raw 점수 ↔ 나쁜 등수(양의) 상관(Spearman) 최대화**
- `saturationK`: 중앙 raw → score≈50 이 되도록 자동 산출
- 등급 임계값: 점수 분포의 **분위수(40/65/85%)** 로 자동 산출
- ⛔ 안전장치: `sample:true`(검증 전/합성) 데이터로는 `--write` 가 거부됩니다. 강제하려면 `--force`.
- 하네스 검증용 합성 데이터: `node scripts/genSyntheticSamples.js` → `data/contestSamples.sample.json`



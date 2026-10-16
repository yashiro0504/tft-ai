# 🎯 TFT AI 전략 코치 & 실전 전적 검색 웹앱 (TFT Tactical Meta Coach)

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
- 현재 상태: **`sample: true` (샘플/검증 전)** → UI에 `샘플` 태그 표시, LLM도 "단정 금지"로 처리
- 실측 데이터 생성:
  ```bash
  RIOT_API_KEY=RGAPI-xxxx node scripts/buildMetaStats.js "닉네임#KR1" "닉네임2#KR1" ...
  ```
  → `lib/metaStats.json` 을 `sample: false, source: "riot-sample"` 로 덮어씁니다.
  → 실행 시 UI/LLM이 실측 통계를 인용하게 됩니다.
- ⚠️ 증강 키 표기는 `lib/summarize.ts` 의 `cleanName()` 결과와 일치해야 합니다(스크립트가 동일 규칙 사용).
- ⚠️ Riot 개발 키는 24시간마다 만료되며, 표본이 많을수록 통계가 안정적입니다.

> 📖 **실측 데이터 수집·튜닝 상세 가이드 → [docs/DATA_PIPELINE.md](docs/DATA_PIPELINE.md)**
> (`.env.local` 자동 로드, `npm run collect:check` 키 점검, PowerShell/CMD 사용법 포함)

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



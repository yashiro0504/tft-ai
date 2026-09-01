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

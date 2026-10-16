# 📊 실측 데이터 파이프라인 가동 가이드

> 경합 분석·증강 메타를 **실측 데이터로 보정**하기 위한 절차입니다.
> 스크립트는 `.env.local`을 자동 로드하므로 키를 매번 입력할 필요가 없습니다.

---

## 0. 전제 조건 (중요)

| 항목 | 설명 |
|---|---|
| **Riot API 키** | ⚠️ **개발 키(`RGAPI-`)는 24시간마다 만료**됩니다. 장기 수집은 **프로덕션 키** 필요 |
| Riot Developer Portal | https://developer.riotgames.com/ 에서 키 발급/재발급 |
| 표본 규모 | 증강당 최소 20건, 경합 표본 최소 수백 건 권장 (많을수록 정확) |
| 레이트리밋 | 스크립트가 429 시 `Retry-After` 만큼 자동 대기합니다 (기본 1.2초 간격) |

---

## 1. 준비: 키 설정 (`.env.local`)

프로젝트 루트의 `.env.local` 에 아래가 있으면 자동으로 읽습니다.

```env
RIOT_API_KEY=RGAPI-xxxxxxxx     # 또는 프로덕션 키
RIOT_REGION=asia
```

> `scripts/_env.js` 가 `.env.local` → `.env` 순으로 읽고, 이미 설정된 환경변수는 덮어쓰지 않습니다.

---

## 2. 키 유효성 먼저 점검 (권장)

수집 전에 키가 살아있는지 1회 확인합니다.

**PowerShell (Windows)**
```powershell
cd "C:\Users\이재영\Desktop\tft-ai"
npm run collect:check -- "닉네임#KR1"
```
- 성공: `✅ 키 확인 OK — 샘플 계정: ...`
- 실패: `❌ 키/계정 확인 실패: Riot API 401 ...` + 안내 문구

---

## 3. 시드 소환사 정하기

수집은 **시드 소환사들의 최근 매치**를 표본으로 삼습니다.

- **고티어(마스터+) 플레이어 5~20명** 권장 (덱 다양성·표본 품질 ↑)
- 시드는 `SEEDS` 환경변수(쉼표 구분) 또는 CLI 인자로 전달

---

## 4. 실행

### 4-1. 경합 표본 수집 → `data/contestSamples.json`
**PowerShell**
```powershell
$env:SEEDS="닉네임1#KR1,닉네임2#KR1,닉네임3#KR1"
$env:MATCHES_PER_SEED="30"     # 시드 1명당 수집할 매치 수
npm run collect:contest
```
**CMD**
```bat
set SEEDS=닉네임1#KR1,닉네임2#KR1
set MATCHES_PER_SEED=30
npm run collect:contest
```

### 4-2. 증강 메타 집계 → `lib/metaStats.json`
```powershell
npm run collect:meta
```

### 4-3. 한 번에 둘 다
```powershell
npm run collect:all
```

### 조절 가능한 환경변수
| 변수 | 기본 | 의미 |
|---|---|---|
| `SEEDS` | (필수) | `닉네임#태그` 목록 (쉼표 구분) |
| `MATCHES_PER_SEED` | 20/30 | 시드당 매치 수 |
| `SLEEP_MS` | 1200 | 요청 간 대기(레이트리밋 보호) |
| `MIN_SAMPLE` | 20 | (증강) 이 미만 표본은 제외 |
| `RIOT_REGION` | asia | 라우팅 리전 |

---

## 5. 결과 확인 (실측 전환)

수집이 끝나면 산출물이 실측으로 표시됩니다.

- `lib/metaStats.json` → `"source": "riot-sample"`, `"sample": false`
- 앱 UI: 증강 배지의 **`샘플` 태그가 사라지고** 티어/평균등수가 실측으로 표시
- LLM: "메타 통계가 제공되었다 → 수치를 인용하라" 로 자동 전환

> ⚠️ `sample:true` 상태에서는 `tune:contest --write` 가 거부됩니다(안전장치).

---

## 6. 경합 파라미터 튜닝 (선택)

표본이 충분하면 가중치/임계값을 재보정합니다.
```powershell
npm run tune:contest -- data/contestSamples.json            # 미리보기
npm run tune:contest -- data/contestSamples.json --write    # lib/contestConfig.json 반영
```
- 실측 데이터(`sample:false`)일 때만 반영되며, 강제하려면 `--force`.

---

## 7. 문제 해결

| 증상 | 원인 / 해결 |
|---|---|
| `Riot API 401/403` | 키 만료(개발 키 24h) 또는 무효 → 재발급 후 `.env.local` 갱신 |
| `Riot API 429` | 레이트리밋 → 스크립트가 자동 대기. `SLEEP_MS` 를 늘리세요 |
| `사용법: SEEDS=...` | 시드 미지정 → `SEEDS` 설정 또는 인자 전달 |
| 표본이 0건 | 시드 오타/전적 없음 → `collect:check` 로 계정 확인 |
| `data/` 파일이 안 보임 | `data/contestSamples.json` 은 `.gitignore` 대상(의도됨) |

---

## 8. 주의 (정책)

- Riot API **이용약관** 및 개발자 정책을 준수하세요. (수집량/상업적 이용 제한)
- 수집·집계 결과의 **재배포**는 별도 검토가 필요합니다.
- 본 스크립트는 개인 분석/연구 목적의 자체 집계 도구입니다.

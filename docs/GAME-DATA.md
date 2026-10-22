# 게임 기준 DB

2026-10-22 · 기물·시너지·아이템의 **사실**(코스트, 시너지, 단계, 조합법, 스킬·효과 설명)을 Community Dragon 한 곳에서 패치별로 만든다.
AI 분석·코칭 규칙·덱 빌드·검증이 모두 이 DB를 기준으로 삼는다. "이게 사실인가"를 판단하는 기준점이다.

## 왜

예전에는 같은 사실이 여러 벌이었다.

| 예전 파일 | 출처 | 문제 |
| --- | --- | --- |
| `lib/tftData.json` | Data Dragon 16.17.1 전 세트 | 세트 구분 없는 키 — 세트18 `Slayer`(약탈자)가 세트16 이름(학살자)으로 나왔다 |
| `lib/championTraits.json` | 메타 덱 데이터에서 역추출 | 영문 키가 덱 사이트 표기(`Eldritch`)라 Riot 키(`Blackthorn`)와 달랐다 |
| `lib/traitBreakpoints.json` · `lib/itemRecipes.json` | Community Dragon | 따로 생성 |
| `lib/constants` 수기표 | 손으로 | 나르 2코 vs 5코가 표마다 달랐다. `translateChampion` 코스트가 대부분 3으로 고정 |

Riot 경기 데이터의 id(`DA_18_Azir`, `DA_RedBuff`, `DA_18_Defender`)는 Community Dragon apiName 과 같은 표기라 이름을 추측하지 않고 **정확히 일치**로 찾는다.

## 파일

| 파일 | 내용 | 쓰는 곳 |
| --- | --- | --- |
| `lib/gameData.json` | 현재 세트 상세 — 기물(코스트·시너지·스탯·스킬)·시너지(단계·단계별 효과)·아이템(종류·조합법·효과) | `lib/gameData.ts` (서버·스크립트) |
| `lib/gameData.lite.json` | 요약 — 기물 슬러그·칸 수, 시너지 단계표 (16KB) | `lib/gameFacts.ts` (클라이언트 공용) |
| `lib/gameNames.json` | 전 세트 이름·아이콘 | `lib/gameNames.ts` (데모 데이터 · 다른 세트 시너지명 환각 검사) |
| `data/gameData/<버전>.json` | 패치별 보관본 | 패치 간 비교 |
| `lib/gameData.overrides.json` | **사람이 확인해 붙이는 사실** (칸 수·역할·옛 키 별칭) — 근거를 `note` 에 | 생성기가 합친다 |
| `lib/gameIds.ts` | id 정규화·조회 규칙 (데이터 없음) | 위 모듈 공용 |

클라이언트 컴포넌트가 닿는 모듈은 `lib/gameFacts` 만 쓴다. `lib/gameData` 를 import 하면 240KB 가 브라우저 번들에 들어간다 — `npm run test:gamedata` 가 막는다.

## 패치·세트가 바뀌면

```bash
npm run build:gamedata                 # 최신 패치 (Community Dragon content-metadata)
npm run build:gamedata -- --version=16.22
npm run build:gamedata -- --set=19     # 세트 변경
npm run check:gamedata                 # 생성 + 아이콘 URL 이 모두 열리는지
npm run test:gamedata                  # 골든셋·래더 보드와 대조 (CI 에서도 실행)
npm run build:decks && npm run decks:check
```

## 조회

```ts
import { findChampion, findTrait, findItem, ITEM_RECIPES } from '@/lib/gameData'
findChampion('DA_18_GnarSmall')   // apiName
findChampion('KogMaw18_AD')       // 통계 키
findChampion('베이가')             // 한글명
findTrait('Eldritch')             // 덱 데이터 옛 키 → 검은 가시 (overrides 별칭)
findItem('거물의갑옷')              // 띄어쓰기 차이 흡수
```

코스트표·기물표·단계표를 코드에 다시 만들지 말 것. Community Dragon 에 없는 사실만 `lib/gameData.overrides.json` 에 적는다.

## 검증 (`scripts/testGameData.js`)

- 골든셋(`data/evalMatches.json`) 기물 65종: DB 코스트 = Riot rarity 코스트, 아이템 한글명 모두 찾음
- 래더 보드(로컬 `data/ladderBoards.json`, 약 1만 보드): 기물 65·시너지 36·아이템 142종 id 가 **정확히** 일치,
  시너지 69,833건의 단계 수·달성 단계가 Riot 판정과 같음
- 예전 파일과 대조(이전 시점): 코스트·시너지·단계표·조합법 전부 일치 (예전 `Eldritch` = 검은 가시)

## 알려진 한계

- **스킬 수치 없음**: 세트18 스킬 변수는 Community Dragon 공개 데이터에 없다(74종 중 2종만). 스킬 설명의 `?` 가 그 자리다.
  시너지·아이템 설명은 수치까지 들어 있다 (일부 해시 변수는 `?`).
- **역할(AP 캐리·AD 캐리·탱커) 비어 있음**: 원본 `role` 이 거의 null 이다. 코칭 규칙에 필요하면 `overrides.json` 에 사람이 채운다.
- **경쟁자(Rival)**: 단계가 1·1·2명 — 같은 인원의 두 번째 단계는 조건부(카직스 진화)라 인원만으로 판정되지 않는다. `breakpoints` 는 [1, 2], `levels` 는 3개.
- **럭스 형태**: `럭스 (검은 가시)` 등 9종은 `variantOf: DA_Lux18_Base`. 경기 데이터에는 본체 id 만 나온다.
- **표기 변경**: `DA_Sentinel18` 은 게임 한국어 데이터상 **파수꾼** (예전 수기표는 감시자). 골든셋에는 옛 이름이 남아 있다.

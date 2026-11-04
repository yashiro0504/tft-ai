# 세트(시즌) 전환 런북

다음 TFT 세트가 열릴 때 데이터 파이프라인이 무엇을 자동으로 하고, 사람이 무엇을 확인해야 하는지 정리한다.
(2026-11-03 정비. 그 전에는 수집기 3곳에 `SET_NUMBER = 18` 이 박혀 있어 새 세트가 열리면 새 판을 전부 버렸다.)

## 기준은 하나: `lib/gameData.lite.json` 의 `set`

| 쓰는 곳 | 읽는 방법 |
| --- | --- |
| 사이트 (`CURRENT_SET`, 화면의 '시즌 N'·'SET N', 메타 스냅샷 캐시 키) | `lib/gameFacts` |
| 수집기 (`collectDb` · `collectLadderBoards` · `collectTopPlayers` · `buildMetaStatsLadder`) | `scripts/_season.js` (`SET_NUMBER` 환경변수로 덮어쓰기 가능) |
| 게임 데이터 빌드 기본 세트 | `scripts/buildGameData.js` (`--set=auto` · `--set=N`) |

`setFirstPatch` 는 현재 세트의 첫 패치다. 게임 데이터 빌드가 세트가 바뀐 실행에서 기록한다(세트 18 은 기록 전이라 `null`).
사이트는 이 패치보다 앞선 패치를 이전 세트로 본다 (`isCurrentSetPatch`).

## 세트 전환 당일 자동으로 일어나는 일

1. **DB 수집 (collect-db, 매시 17분)** — 기준 세트 *이상*의 랭크 판을 받는다. 새 세트 판이 보이면 그 세트로 올라가고 이후 이전 세트 판은 버린다.
   - Data Dragon 이 KR 서버 패치보다 먼저 올라가면 이전 세트 판에 새 패치 라벨이 붙는다. 수집기는 판을 넣은 패치마다
     `그 패치의 이전 세트 판`을 지우고(`purgeOlderSet`) 그 조합을 다시 집계한다 — **한 패치 = 한 세트**.
   - 게임 데이터가 아직 이전 세트면 실행 로그에 `::warning title=New TFT set::` 이 뜨고 `tft_collect_runs.note` 에 남는다.
   - 원본 정리(`KEEP_PATCHES=1`)가 새 패치를 최신으로 보고 이전 세트 원본을 지운다. **일별 집계(`stat_*_daily`)·덱 클러스터(`stat_comp`)는 영구** — 패치 필터에서 이전 세트 패치를 계속 고를 수 있다.
2. **게임 데이터 (Refresh Game Data, 3시간마다 :40)** — `--set=auto` = max(지금 세트, DB 최고 세트). DB 에 새 세트 판이 있고
   Community Dragon 에 `TFTSet{N}` 이 올라와 있으면 새 세트로 다시 만들어 main 에 커밋 → Vercel 배포.
   Community Dragon 에 새 세트가 먼저 보여도 DB 에 그 세트 판이 없으면 넘어가지 않는다 (PBE 데이터로 미리 바뀌는 사고 방지).
3. **배포 후 사이트**
   - 화면 문구·OG 이미지·메타데이터의 시즌 번호가 바뀐다.
   - 메타 덱 스냅샷 Redis 키가 `meta-deck-snapshot:v2:s{세트}` 로 바뀌어 이전 세트 스냅샷(3일 보관 사본 포함)을 더는 주지 않는다.
   - 덱 플레이북의 '이전 패치 기준' 대체는 같은 세트 패치에서만 고른다 (덱 id 가 같아도 이전 세트 덱이면 붙이지 않음).
   - 전적 분석: 게임 데이터보다 높은 세트 판도 분석 대상이다 — 배포 전 몇 시간 동안 모든 판이 '이전 시즌'으로 빠지지 않게.
4. **래더 수집 (collect-ladder, 06:00 KST)** — 래더 JSON(`metaStats.json` · `decksData.json` · `unitBuilds.json`)을 새 세트 판만으로 다시 만든다.
   순위 변동(delta)은 같은 세트끼리만 비교한다. `buildMetaStatsLadder` 는 이제 랭크 큐만 집계한다.

## 당일 사람이 확인할 것

- [ ] **Refresh Game Data 를 수동 실행** (Actions → Refresh Game Data → Run workflow). 세트 오픈 직후 DB 에 새 세트 판이 들어온 걸 확인하고 돌리면 3시간을 기다리지 않는다.
- [ ] **Collect Ladder Meta 를 수동 실행** — 래더 JSON 이 06:00 까지 이전 세트로 남는다. DB 표본이 `STATS_DB_MIN_MATCHES`(500판)에 닿기 전까지 메타 화면은 이 JSON 을 보여 준다.
- [ ] `lib/gameData.overrides.json` — 이전 세트 항목은 경고만 남기고 건너뛴다. 새 세트의 2칸 기물(예: 세트 18 장로 드래곤)·옛 키 별칭을 다시 확인해 적는다 (`docs/RULE-CHECK.md` 방법).
- [ ] `scripts/testGameData.js` 의 `FIXTURE_SET` 고정 사실(기물 이름·시너지 단계)을 새 세트 것으로 바꾼다. 지금은 세트가 다르면 건너뛰고 요약에 ⚠️ 를 남긴다.
- [ ] 골든셋 재수집: `data/evalMatches.json` 은 세트 18 판이다 (`npm run eval:capture`). `test:ai` 의 일부 고정 사실도 세트 18 기준이라 CI 가 빨개질 수 있다 — 새 세트 표본으로 갱신.
- [ ] `lib/playbookLinks.json` — 덱 id 단위 외부 링크라 세트가 바뀌면 다시 매핑한다.
- [ ] 상점 확률·덱 티어 컷 — 게임 데이터 재생성이 상점 확률을 갱신한다. 표가 바뀌면 `npm run rules:check`. 덱 티어 고정 컷(보정 평균 등수)은 첫 주 표본을 보고 다시 잰다.
- [ ] Riot 키 — 새 세트와 무관하지만 개발 키는 매일 교체가 필요하다 (프로덕션 키 승인 대기 중).

## 이전 세트 데이터는 어떻게 남는가

| 데이터 | 처리 |
| --- | --- |
| Supabase 원본 `tft_matches`·`tft_boards` | 최근 `KEEP_PATCHES` 패치만 — 새 패치가 최신이 되면 200판씩 배치로 삭제(실행당 4분 상한, 남은 판은 다음 실행) |
| 일별 집계 `stat_*_daily` · 덱 `stat_comp` · 빌드 `stat_unit_build` | 패치별 영구 보관 (패치 필터에서 선택 가능) |
| `deck_playbook` | 패치별 보관. 새 세트 덱에는 이전 세트 행을 쓰지 않는다 (`setFirstPatch`) |
| `analysis_reports` (AI 리포트) | 판 단위라 그대로 유효 — 지우지 않는다 |
| 래더 JSON · `data/ladderBoards.json` | 다음 래더 수집이 새 세트 판만으로 덮어쓴다 |
| `data/gameData/<패치>.json` | 패치별 보관본 (세트가 바뀌어도 그대로) |
| Redis 메타 스냅샷 | 키에 세트가 들어가 자연 만료 |

## 패치 전환 중 메타 스냅샷 · sitemap (2026-11-04)

- 새 패치 표본이 500판 미만이거나 새 패치 덱 클러스터가 아직 없으면, 메타 스냅샷은 **같은 세트의 마지막 DB 스냅샷 사본**을 붙잡는다 (`lib/deckSnapshotPick`, `heldReason`). 래더 JSON 으로 내려가는 건 사본이 없을 때(새 세트 첫날 등)뿐이다.
  - 16.22 첫날에는 스냅샷이 1분 간격으로 DB(16.21) ↔ 래더 JSON 을 오가, 1시간 캐시된 sitemap 덱 100개 중 53개가 404 였다.
- sitemap 은 따로 생성하는 잡이 없다. 요청 시점에 덱 페이지와 같은 함수(`lib/deckPage` `listDeckPageIds`)로 같은 Redis 스냅샷을 읽는다 (`app/sitemap.ts`, `force-dynamic`). 스냅샷이 바뀌는 건 collect-db 가 `stat_comp` 를 다시 쓸 때뿐이라 sitemap 과 덱 페이지가 같이 바뀐다.
- 감시: Meta Snapshot Check(2시간) · Ops Check(매일)가 sitemap 덱 URL **전수** 200 을 본다 (`node scripts/checkOps.js <URL> --sitemap-only --strict`). CI 스모크도 같은 검사.

## 알려진 공백

- DB 새 **세트** 표본이 500판 미만인 몇 시간 동안 메타 화면은 래더 JSON 으로 폴백한다 (같은 세트 사본이 없으므로). 래더 수집을 수동으로 돌리기 전에는 이전 세트 JSON 이다.
- `tft_stat_filters` 는 패치별로만 묶어서 패치 드롭다운에 이전 세트 패치가 섞여 보인다 (선택하면 그 세트 집계가 정상적으로 나온다).

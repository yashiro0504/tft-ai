# 덱 플레이북 (2026-10-29 지시문 4)

덱별 "정석" 수치를 tftlab 자체 매치 데이터로 계산해 `deck_playbook`(supabase/migrations/0011)에 저장하고,
AI 경기 분석 리포트의 **"이 덱의 정석과 비교"** 섹션에 쓴다.

## 원칙
- 외부 가이드 사이트(TFT Academy 등)의 글·표·추천 목록을 수집·저장·번역하지 않는다. 외부 사이트는 `lib/playbookLinks.json` 에 **source·url 만** 수동 매핑한다(덱 단위, 세트가 바뀌면 다시 매핑). DB 제약(`deck_playbook_links_ok`)이 다른 키를 거부한다.
- 모든 수치는 tftlab 보드(`tft_boards`)에서 계산한다. 메타 페이지와 같은 보드 묶음·같은 `snapshot_id` 로 만든다.
- Riot TFT 매치 API 에는 라운드별 레벨·골드·배치가 없다 → 레벨은 최종 `level` 과 탈락 `last_round` 로만 본다. 배치 팁·라운드 타이밍 팁은 만들지 않는다.

## 생성 (scripts/collect/playbook.js)
- 수집기(`collectDb.js`)가 최신 패치 덱 클러스터(`stat_comp`)를 다시 만든 직후, 마스터+ 스냅샷으로 덱마다 1회 계산·저장한다. 사용자 분석 요청마다 만들지 않는다.
- `snapshot_id = '{patch}|MASTER|{stat_comp.updated_at epoch ms}'` — 앱은 `getDecks` 응답의 `updatedAt` 으로 같은 값을 만든다(`lib/playbook.snapshotIdOf`).
- 범위: 300판+ 전체 · 100~299판 `core_units`·`carry_bis` 만 · 100판 미만 없음.
- 필드: `core_units`(80%+ 기물·★2/★3 비율) · `carry_bis`(메타 덱 카드의 캐리 아이템 = 메타 페이지 BIS + `buildRows` 3개 세트 상위 3) · `three_star`(TOP4 vs 5~8등) · `flex_units`(30~79%, 있/없 각 50판+) · `traits` · `level_profile` · `elim_profile` · `contested`(같은 로비 같은 덱 2명+ vs 1명) · `augments`(보드에 증강이 있을 때만, 지금은 null) · `tips` · `external_links`.
- 비율은 정수 %, 평균등수는 소수 둘째 자리 — 팁·리포트 숫자가 저장값과 글자 그대로 같다.

## 팁
- 입력은 그 덱의 필드 JSON 만. 팁마다 숫자 1개 이상 + `evidence`(근거 필드 키 배열).
- `validateTip`: 숫자를 evidence 필드 값과 대조(lib/grounding `collectFactNumbers`·`extractClaims`, 반올림 허용). 배치·라운드 타이밍·조합식 금지 패턴. 실패한 팁은 버리고, 남은 팁이 3개 미만이면 `tips = []`(화면은 수치만).
- `DEEPSEEK_API_KEY` 가 없으면 팁 없이 수치만 저장한다.

## AI 분석 연동 (lib/playbook.ts · lib/llm.ts)
1. 경기 덱 판정(덱 성적표와 같은 `metaExecution`·`mostSimilarDeck`) → 같은 스냅샷 플레이북(`choosePlaybook`).
2. 새 패치 표본이 300판 미만이면 이전 패치 300판+ 플레이북을 `이전 패치(16.21) 기준` 라벨과 함께 쓴다.
3. 비교표(`comparePlaybook`)를 코드로 계산: 코어 누락·별 수 vs 덱 평균 / 캐리 아이템 vs BIS / 최종 레벨·탈락 라운드 vs 프로필 / 평균등수를 깎는 대체 기물 / 같은 로비 같은 덱 경쟁자 수 vs contested.
4. 비교표 전체를 프롬프트에 넣고(근거 검증 사실에 플레이북 수치 포함), 리포트 섹션은 비교표 행 최대 3개를 코드 문장 그대로 붙인다. 섹션 문장도 근거 검증 대상이다.
5. 덱 표본 100판 미만이면 섹션 대신 `표본 부족으로 덱 기준 비교 생략` 한 줄. DB 스냅샷이 아니면(래더 JSON 폴백) 섹션을 넣지 않는다.

테스트: `node scripts/testPlaybook.js` (npm run test:ai).

# 정답셋 — 골든셋 장면 판정

2026-10-22 · 코드가 골든셋 경기마다 내는 장면(lib/keyMoments 핵심 장면 + 4등 안 판의 이긴 요인)을 사람이 **맞음 / 틀림 / 애매**로 판정해 둔다.
규칙을 고칠 때 맞던 장면을 잃지 않았는지, 틀린 장면이 줄었는지를 코드로 확인하기 위해서다. (데이터 통계 검증은 docs/RULE-CHECK.md)

| 단계 | 명령 · 위치 |
| --- | --- |
| 1. 판정 페이지 만들기 | `npm run labels:page` → `tmp/labelPage.html` (골든셋 26경기 · 장면 80개, 2026-10-22 기준) |
| 2. 판정 | 비공개 claude.ai 페이지 https://claude.ai/artifact/HR87YpJY1st2HcK9KC7dxe — 누르는 즉시 페이지 저장소에 저장 |
| 3. 저장소로 옮기기 | Claude 세션에서 페이지 db 의 `labels` · `missed` 를 내려받아 `npm run labels:import -- <폴더>` → `data/goldenLabels.json` (커밋) |
| 4. 검사 | `npm run test:labels` (CI 에 포함) |

- 장면 id = `경기id:종류` (이긴 요인은 `경기id:win:분류`). 문구가 바뀌어도 판정이 따라가고, 바뀐 장면은 "다시 볼 것" 으로 표시된다.
- `test:labels` 실패 조건은 하나: **맞음으로 판정한 장면이 더 이상 안 나올 때.** 틀림으로 판정한 장면이 아직 나오는 것은 경고(고칠 목록)다.
- 규칙을 바꿔 장면 목록이 달라지면 1단계를 다시 하고 같은 페이지에 다시 게시한다 — 이미 단 판정은 유지되고 새 장면만 미판정으로 뜬다.
- 골든셋은 10-19 캡처라 옛 시너지·기물 이름이 남아 있어, 지금 앱이 보여 줄 이름으로 바꿔 읽는다 (scripts/_goldenScenes · scripts/_boards fixtureTraits).

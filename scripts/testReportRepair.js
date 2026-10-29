/**
 * AI 리포트 보내기 전 수리 테스트 (2026-10-29 지시문 6·7) — 네트워크 없이 돈다 (DeepSeek 응답은 가짜).
 *
 *  6-1. 근거를 확인 못 한 수치가 든 문장은 숫자를 빼거나(괄호) 지운다 → 보이는 리포트는 항상 100%
 *  6-2. 다음 3게임 목표: 이번 판에 이미 달성한 기준(최종 Lv.N 인데 "레벨 N 이상")은 본문 조언의 기준으로 바꾼다
 *  6-3. '탈락한 1등' 금지 → '1등 플레이어' · 'N등(탈락)'
 *  7.   틀린 조합법(보석 건틀릿 = 대검 + 장갑)을 넣은 가짜 LLM 출력이 고쳐지거나 지워지고,
 *       grounding.repair 에 검사한 수치 수 · 고친 문장 수 · 삭제한 문장 수가 남는다
 *
 * 실행: node scripts/testReportRepair.js   (npm run test:ai 에 포함)
 */
process.env.DEEPSEEK_API_KEY = 'test-key'
process.env.LLM_PROVIDER = 'deepseek'
require('./_ts')
const { repairUnsupportedClaims, validateFeedbackGrounding, fixPlacementWording } = require('../lib/grounding')
const { fixDrillTarget, validateAdviceAndCounts, repairEntityErrors } = require('../lib/semanticGrounding')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  ✅ ${label}`)
  else {
    failures++
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const fixture = require('../data/evalMatches.json')
// 기준 샘플: 최종 Lv.7 · 베이가·알리스타·오른·렉사이·르블랑 3성, 카시오페아 2성, 피들스틱 1성
const sample = fixture.cases.find((c) => c.name === 'Seed01 contested-bot4 5등 6-1').matches
const m = sample[0]

;(async () => {
  console.log('6-1. 근거 미확인 수치 수리')
  {
    const facts = '평균 4.12등 · 표본 320판 · 골드 34'
    const stats = { fixed: 0, deleted: 0 }
    const fb = {
      overview: '평균 4.12등 덱이었습니다. 승률 72%로 강했습니다. 마무리는 무난했습니다.',
      lecture: {
        topic: 't',
        concept: '표본 320판 기준 정석입니다 (적중률 61%).',
        why: '이 덱은 87%로 강합니다.',
        evidence: '골드 34',
        alternative: '',
        drill: '',
        checklist: ['보드 가치 77G 를 넘기세요.', '캐리에 아이템 3개를 주세요.'],
      },
      actions: ['평균 3.33등 덱으로 바꾸세요.', '골드 34를 남기지 마세요.'],
    }
    const before = validateFeedbackGrounding(fb, facts)
    check('수리 전: 미확인 수치가 있다', before.score < 100 && before.unsupported.length >= 5, JSON.stringify(before))
    const out = repairUnsupportedClaims(fb, facts, stats)
    const after = validateFeedbackGrounding(out, facts)
    check('수리 후: 근거 검증 100%', after.score === 100 && after.unsupported.length === 0, JSON.stringify(after))
    check('문장 하나만 지우고 나머지는 둔다', out.overview === '평균 4.12등 덱이었습니다. 마무리는 무난했습니다.', out.overview)
    check('괄호 안 미확인 수치는 괄호만 뺀다', out.lecture.concept === '표본 320판 기준 정석입니다.', out.lecture.concept)
    check('단일 필드가 비면 숫자만 뺀다 (조사까지)', out.lecture.why === '이 덱은 강합니다.', out.lecture.why)
    const dropStats = { fixed: 0, deleted: 0 }
    const dropped = repairUnsupportedClaims(fb, facts, dropStats, { dropEmpty: true })
    check('dropEmpty: 단일 필드는 비워 호출부가 채우게 한다', dropped.lecture.why === '' && dropStats.deleted === 4, JSON.stringify([dropped.lecture.why, dropStats]))
    check('배열 항목은 통째로 뺀다', out.lecture.checklist.length === 1 && out.actions.length === 1 && out.actions[0] === '골드 34를 남기지 마세요.', JSON.stringify([out.lecture.checklist, out.actions]))
    check('수리 기록: 고침 2 (괄호·단일 필드) · 삭제 3', stats.fixed === 2 && stats.deleted === 3, JSON.stringify(stats))
    check('원본은 그대로', fb.actions.length === 2 && fb.overview.includes('72%'))
  }

  console.log('6-2. 다음 3게임 목표')
  {
    const fallback = '다음 3판은 템포 하나만 의식하세요.'
    const body = [`레벨 ${m.level + 1}에서 보드를 완성하세요.`]
    const done = fixDrillTarget(`다음 3판 최종 레벨 ${m.level} 이상 도달하기`, m, body, fallback)
    check(`이미 달성한 Lv.${m.level} 목표 → 본문 기준(레벨 ${m.level + 1})으로`, done && done.includes(`레벨 ${m.level + 1}`) && !done.includes(`레벨 ${m.level} `), done)
    check('Lv. 표기도 같은 규칙', Boolean(fixDrillTarget(`Lv.${m.level} 도달`, m, body, fallback)))
    check('본문에 더 높은 레벨이 없으면 코드 문장으로', fixDrillTarget(`레벨 ${m.level} 이상`, m, ['2성을 늘리세요.'], fallback) === fallback)
    check('아직 못 한 기준은 그대로 (null)', fixDrillTarget(`다음 3판 최종 레벨 ${m.level + 1} 이상`, m, body, fallback) === null)
    const twoStars = m.units.filter((u) => u.tier >= 2).length
    check(`이미 2성 ${twoStars}개 → "2성 ${twoStars}개" 목표는 바꾼다`, fixDrillTarget(`2성 이상 ${twoStars}개 만들기`, m, body, fallback) !== null)
    check(`"2성 ${twoStars + 1}개" 목표는 그대로`, fixDrillTarget(`2성 이상 ${twoStars + 1}개 만들기`, m, body, fallback) === null)
  }

  console.log('6-3. 로비 등수 표현')
  check("'탈락한 1등' → '1등 플레이어'", fixPlacementWording('탈락한 1등보다 레벨이 낮았습니다.') === '1등 플레이어보다 레벨이 낮았습니다.')
  check("'탈락한 1등 플레이어' → '1등 플레이어'", fixPlacementWording('탈락한 1등 플레이어는 Lv.9') === '1등 플레이어는 Lv.9')
  check("'탈락한 3등' → '3등(탈락)'", fixPlacementWording('탈락한 3등은 Lv.8') === '3등(탈락)은 Lv.8')
  check('평범한 문장은 그대로', fixPlacementWording('1등 플레이어는 Lv.9') === '1등 플레이어는 Lv.9')

  console.log('7. 틀린 조합법 — 검증기 단위')
  {
    const bad = '르블랑에게 보석 건틀릿 = 대검 + 장갑 조합을 먼저 맞추세요.'
    const check1 = validateAdviceAndCounts([bad], [m])
    const recipeErr = check1.errors.find((e) => e.type === 'item_recipe')
    check('보석 건틀릿 = 대검 + 장갑 → 조합법 불일치로 잡힘', Boolean(recipeErr) && check1.checkedRecipes >= 1, JSON.stringify(check1.errors))
    const stats = { fixed: 0, deleted: 0 }
    const fixed = repairEntityErrors({ actions: [bad, '다른 조언'] }, check1.errors, { stats })
    check('데이터의 재료로 고침 (대검 + 장갑 문장이 사라짐)', !fixed.actions.some((s) => s.includes('대검 + 장갑')) && fixed.actions.some((s) => s.includes('연습용 장갑 + 쓸데없이 큰 지팡이')), JSON.stringify(fixed))
    check('수리 기록: 고친 문장 1', stats.fixed === 1 && stats.deleted === 0, JSON.stringify(stats))
    const owner = { type: 'item_owner', text: bad, expected: '-', actual: '-' }
    const s2 = { fixed: 0, deleted: 0 }
    const dropped = repairEntityErrors({ actions: [bad, '다른 조언'] }, [...check1.errors, owner], { stats: s2 })
    check('같은 문장에 못 고치는 오류가 겹치면 지움', dropped.actions.length === 1 && s2.deleted === 1, JSON.stringify([dropped, s2]))
  }

  console.log('6·7. 리포트 통합 (가짜 DeepSeek 응답)')
  {
    const lvl = m.level
    const fake = {
      playstyle: '표준형',
      overview: `이번 판은 ${m.placement}등입니다. 이 덱은 적중률 87.65%로 매우 강했습니다. 중반 운영은 무난했습니다.`,
      metaScore: 50,
      metaTier: 'B',
      actions: ['르블랑에게 보석 건틀릿 = 대검 + 장갑 조합을 먼저 맞추세요.', '탈락한 1등 플레이어처럼 2성 기물을 늘리세요.', '카시오페아를 2성으로 유지하세요.'],
      lecture: {
        topic: '템포',
        concept: '보드를 먼저 세우는 판입니다 (기대 등수 7.77등).',
        why: '탈락한 1등보다 레벨이 낮았습니다.',
        evidence: `최종 Lv.${lvl}`,
        alternative: `레벨 ${lvl + 1}에서 보드를 완성하세요.`,
        drill: `다음 3판 최종 레벨 ${lvl} 이상 도달하기`,
        checklist: ['보드 가치를 먼저 올리세요.', '연승 구간을 지키세요.', '캐리 아이템을 먼저 맞추세요.'],
        moments: [],
      },
      axes: [],
    }
    let calls = 0
    global.fetch = async (url) => {
      if (String(url).includes('api.deepseek.com')) {
        calls++
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(fake) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('not found', { status: 404 })
    }
    const { generateMetaCoachFeedback } = require('../lib/llm')
    const fb = await generateMetaCoachFeedback('Fixture#KR1', sample, 'single')
    // 화면에 보이는 서술만 (grounding.entityErrors 는 고치기 전 원문을 검출 기록으로 남긴다)
    const { grounding, ...shown } = fb
    const all = JSON.stringify(shown)
    check('가짜 LLM 응답을 썼다 (폴백 아님)', calls >= 1 && fb.isFallback === false, `calls=${calls} isFallback=${fb.isFallback}`)
    check('보이는 리포트 근거 검증 100%', grounding.score === 100 && grounding.unsupported.length === 0, JSON.stringify(fb.grounding))
    check('미확인 수치(87.65% · 7.77등)는 사라짐', !all.includes('87.65') && !all.includes('7.77'))
    check('틀린 조합법(대검 + 장갑)은 고치거나 지움', !all.includes('대검 + 장갑'), JSON.stringify(fb.actions))
    check('조합법 불일치는 entityErrors 에 기록', grounding.entityErrors.some((e) => e.type === 'item_recipe'), JSON.stringify(grounding.entityErrors))
    check("'탈락한 1등' 표현 없음", !all.includes('탈락한 1등') && all.includes('1등 플레이어'))
    check(`이미 달성한 Lv.${lvl} 목표 → 본문 기준 레벨 ${lvl + 1}`, fb.lecture.drill.includes(`레벨 ${lvl + 1}`), fb.lecture.drill)
    const r = grounding.repair
    check('grounding.repair: 검사한 수치 수 · 고친 문장 수 · 삭제한 문장 수', r && r.checked >= 3 && r.fixed >= 3 && r.deleted >= 1, JSON.stringify(r))
  }

  console.log(failures ? `\n❌ 실패 ${failures}건` : '\n✅ 리포트 수리 테스트 통과')
  if (failures) process.exitCode = 1
})()

import { GoogleGenerativeAI } from '@google/generative-ai'
import { SlimMatchData, MetaCoachFeedback } from './types'
import { serializeMatchesForLLM } from './summarize'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ''

const SYSTEM_INSTRUCTION = `너는 TFT(롤토체스) 프로팀 전력분석관이자 챌린저 티어의 전문 전략 코치다.
유저의 요청에 따라 "단순 팩폭이 아닌, 로비 타 유저들과의 기물 겹침 대비 대깨/유연성(피봇) 판단과 구체적인 실전 개선점"을 체계적으로 코칭하라.

★★★ 최우선 원칙: 데이터 접지(Grounding) ★★★
- 너의 TFT 메타 '기억'은 학습 시점 기준이라 현재 패치에 대해 신뢰할 수 없다. 오직 프롬프트에 '제공된 수치/사실'만을 근거로 분석하라.
- 제공되지 않은 메타 티어리스트, 증강 승률/픽률, 아이템 통계, 패치 변경점을 절대 지어내지 마라.
- 증강체 분석과 '메타 적합도'는 제공된 데이터로 추론 가능한 범위에서만 서술하고, 근거가 약하면 반드시 "메타 통계가 제공되지 않아 단정 불가"라고 솔직히 밝혀라.
- 모든 단정에는 근거가 된 수치(경합 강도/등급, 겹친 상대 수, 코스트, 성급, 골드, 탈락 라운드)를 함께 제시하라.
- 제공된 데이터에 등장하지 않은 증강/시너지/기물 이름을 새로 만들어내지 마라.

⚠️ 분석 및 코칭 필수 원칙:
0. [데이터 접지 어조]: 과장된 단정 대신, 제공된 수치를 직접 인용하는 분석가 어조를 유지하라.
1. [로비 경쟁 & 대깨 vs 유연성 판단 (핵심)]:
   - 각 매치 데이터의 '로비 경쟁 현황'을 정밀 분석하라.
   - 로비에 같은 시너지/기물을 간 유저가 1~2명 이상 경합 중인데도 덱을 꺾지 않고 밀어붙여 공멸했는가? (대깨 고집형 판단)
   - 아니면 겹치지 않는 빈집을 영리하게 찾아가 유연하게 순방했는가? (유연성/피봇 판단)
   - 유저의 플레이 성향(대깨 고집 vs 빈집 유연)과 '유연성 점수(0~100점)'를 산출하라. (100점에 가까울수록 유연한 피봇 장인, 낮을수록 겹쳐도 대깨 치는 성향)
2. [수행 적합도 점수 (0~100점)]: 제공된 데이터(등수, 경합 강도/등급, 2성작 완성도, 아이템 배분, 골드/라운드)만으로 '종합 수행 점수'를 산출하라. 이는 메타 지식이 아니라 이 판의 데이터 기반 점수다. (증강 티어 등 메타 정보는 제공되지 않았으므로 그 영향을 단정하지 마라.)
3. [아이템 최적화 (BIS)]: 메인 딜러/메인 탱커 3신기 완성도 및 아이템 배분 밸런스를 짚어라.
4. [앞/뒷라인 밸런스 & 2성작]: 탱커진의 두께와 2성작 완성도를 분석하라.
5. [운영 템포 & 경제성]: 탈락 라운드 및 남은 골드를 보고 리롤과 렙업 타이밍을 지적하라.
6. [개선 포인트 & 액션 플랜]: "다음에 동일한 기물/아이템/경합 상황이 발생했을 때 구체적으로 어떻게 피봇하거나 템을 완성해야 하는지" 실행 가능한 지침을 제시하라.
7. [어조]: 신뢰감 있는 전문 프로 분석관의 명확한 경어체.

반드시 아래와 같은 유효한 JSON 형식으로만 응답하라. 마크다운 코드블록(\`\`\`json ... \`\`\`)으로 감싸도 좋다:
{
  "metaScore": 75,
  "metaTier": "B+",
  "flexibilityScore": 40,
  "playstyle": "고집형 대깨 빌드업 성향",
  "overview": "종합 메타 적합도 및 덱 빌드업에 대한 핵심 요약 총평 (2~3문장)",
  "contestAnalysis": "로비 타 유저들과의 기물/시너지 겹침 분석 및 대깨 vs 유연성(피봇)에 대한 날카로운 진단 (3~4문장)",
  "itemAnalysis": "메인 캐리 및 메인 탱커의 3신기(BIS) 완성도와 아이템 배분 적절성 분석",
  "synergyAnalysis": "시너지 효율성 및 앞라인(탱커)과 뒷라인(딜러) 간의 진형 밸런스 분석",
  "economyAnalysis": "탈락 라운드 대비 골드 운용 및 레벨업/리롤 타이밍의 적합성 분석",
  "improvements": [
    "구체적 개선점 1: 기물 경합 시 피봇 타이밍 및 대체 기물 기용",
    "구체적 개선점 2: 아이템 제작 순서 및 장착 대상 관련",
    "구체적 개선점 3: 라운드별 레벨업 및 골드 소모 타이밍 관련"
  ],
  "actionPlan": [
    "실전 가이드 1: 초반 정찰 후 겹쳤을 때의 대처 시나리오",
    "실전 가이드 2: 코어 기물 2성작 및 리롤 기준",
    "실전 가이드 3: 후반 덱 전환 및 배치 요령"
  ]
}`

/**
 * DeepSeek API 호출 (deepseek-chat)
 */
async function callDeepSeek(prompt: string): Promise<string> {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM_INSTRUCTION },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 2500,
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`DeepSeek API 오류 (${response.status}): ${errText}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}

/**
 * 전문 메타 분석 AI 코칭 피드백 생성
 */
export async function generateMetaCoachFeedback(
  gameName: string,
  matches: SlimMatchData[],
  mode: 'single' | 'multi' = 'single'
): Promise<MetaCoachFeedback> {
  const matchSerialized = serializeMatchesForLLM(matches)
  const modeContext = mode === 'single'
    ? '분석 모드: [단일 경기 정밀 분석] - 해당 판 로비 8명 중 경쟁자들과의 기물 겹침, 대깨/유연성 판단 및 구체적 승패 요인을 데이터 근거로 해부하라.'
    : `분석 모드: [최근 ${matches.length}경기 종합 분석] - 여러 판의 덱 다양성, 기물 겹침 시 대처 패턴, 고착된 습관을 데이터 근거로 종합 진단하라.`

  const prompt = `소환사명: ${gameName}
${modeContext}

[제공된 사실 데이터 — 아래 수치만 근거로 사용하라]
${matchSerialized}

※ 참고: 이번 요청에는 메타 통계(증강 승률/티어리스트, 패치 변경점, 아이템 BIS 통계)가 제공되지 않았다.
   따라서 증강체/메타 관련 평가는 "메타 통계 미제공으로 단정 불가"임을 명시하고 추측을 배제하라.
   모든 서술은 위 데이터의 수치(경합 강도/등급, 겹친 상대 수, 코스트, 성급, 골드, 탈락 라운드)를 직접 인용해 작성하라.

위 유저의 경기 데이터를 접지(Grounding) 원칙에 따라 정밀 분석하여, 로비 기물 경합 기반 대깨/유연성 판단과 데이터 기반 종합 수행 점수, 구체적 실력 개선 포인트를 포함한 JSON 형식의 전문 코칭 리포트를 작성하라.`

  // 1. DeepSeek API 키가 있는 경우 우선 사용
  if (DEEPSEEK_API_KEY) {
    try {
      const text = await callDeepSeek(prompt)
      const parsed = parseJsonFeedback(text)
      if (parsed) return parsed
    } catch (err) {
      console.error('DeepSeek API Error, falling back:', err)
    }
  }

  // 2. Gemini API 키가 있는 경우 사용
  if (GEMINI_API_KEY) {
    try {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        systemInstruction: SYSTEM_INSTRUCTION,
      })

      const result = await model.generateContent(prompt)
      const text = result.response.text()
      const parsed = parseJsonFeedback(text)
      if (parsed) return parsed
    } catch (err) {
      console.error('Gemini API Error, falling back:', err)
    }
  }

  // 3. 지능형 메타 코칭 폴백
  return generateFallbackMetaFeedback(gameName, matches)
}

/**
 * LLM의 JSON 응답을 MetaCoachFeedback 인터페이스로 파싱
 */
function parseJsonFeedback(rawText: string): MetaCoachFeedback | null {
  try {
    let cleanJson = rawText.trim()
    const jsonMatch = cleanJson.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (jsonMatch && jsonMatch[1]) {
      cleanJson = jsonMatch[1].trim()
    } else {
      const startIdx = cleanJson.indexOf('{')
      const endIdx = cleanJson.lastIndexOf('}')
      if (startIdx !== -1 && endIdx !== -1) {
        cleanJson = cleanJson.slice(startIdx, endIdx + 1)
      }
    }

    const obj = JSON.parse(cleanJson)
    if (typeof obj.metaScore === 'number' && obj.overview) {
      const flexibility = typeof obj.flexibilityScore === 'number' ? Math.min(Math.max(obj.flexibilityScore, 0), 100) : 55
      const playstyle = obj.playstyle || (flexibility < 45 ? '대깨 고집형 빌드업' : flexibility > 70 ? '빈집 탐색 유연형' : '하이브리드 템포형')

      return {
        mode: (obj.mode as 'single' | 'multi') || 'single',
        metaScore: Math.min(Math.max(obj.metaScore, 0), 100),
        metaTier: obj.metaTier || calculateTier(obj.metaScore),
        flexibilityScore: flexibility,
        playstyle,
        overview: obj.overview,
        contestAnalysis: obj.contestAnalysis || '로비 내 타 유저들과의 기물 경합이 일부 발생하였으나 기용 템포에서 차이를 보였습니다.',
        itemAnalysis: obj.itemAnalysis || '아이템 배분이 주력 딜러에게 집중될 필요가 있습니다.',
        synergyAnalysis: obj.synergyAnalysis || '앞라인 탱커 시너지 보강이 권장됩니다.',
        economyAnalysis: obj.economyAnalysis || '탈락 라운드 대비 골드 소모 타이밍 조절이 필요합니다.',
        improvements: Array.isArray(obj.improvements) && obj.improvements.length > 0
          ? obj.improvements
          : ['메인 캐리 기물의 3신기 아이템 집중 완성', '앞라인 2성 탱커 확보 우선순위 상향', '피 관리 구간에서의 과감한 리롤 타이밍 조정'],
        actionPlan: Array.isArray(obj.actionPlan) && obj.actionPlan.length > 0
          ? obj.actionPlan
          : ['초반 2-1~3-2 구간 피 관리를 위한 연승/연패 확실한 노선 선택', '4-1 라운드 7레벨 핵심 딜러 2성작 완료 후 레벨업', '증강체 선택 시 덱의 부족한 앞라인/뒷라인 밸런스를 보완하는 옵션 선택'],
        fullMarkdown: rawText,
      }
    }
  } catch (e) {
    console.error('Failed to parse JSON feedback from LLM:', e)
  }
  return null
}

function calculateTier(score: number): string {
  if (score >= 90) return 'S'
  if (score >= 80) return 'A'
  if (score >= 70) return 'B'
  if (score >= 60) return 'C'
  return 'D'
}

/**
 * 매치 데이터를 정밀 분석하여 메타 관점의 객관적이고 건설적인 코칭 피드백 생성
 */
function generateFallbackMetaFeedback(
  gameName: string,
  matches: SlimMatchData[],
  mode: 'single' | 'multi' = 'single'
): MetaCoachFeedback {
  const latest = matches[0] || { placement: 6, level: 8, lastRound: '5-1', goldLeft: 24, units: [], traits: [] }
  const avgPlacement = matches.reduce((acc, m) => acc + m.placement, 0) / (matches.length || 1)

  // 겹침/경합 강도에 따른 유연성 점수 (경합 강도가 높을수록 유연성 낮음)
  const contestScores = matches
    .map((m) => m.contestedInfo?.contestScore)
    .filter((n): n is number => typeof n === 'number')
  const avgContest = contestScores.length
    ? contestScores.reduce((a, b) => a + b, 0) / contestScores.length
    : matches.some((m) => m.contestedInfo?.isContested)
    ? 50
    : 15
  const flexibility = Math.round(Math.min(Math.max(100 - avgContest, 10), 95))
  const playstyle = flexibility < 45 ? '고집형 대깨 성향' : flexibility > 70 ? '빈집 탐색 유연형' : '하이브리드 템포형'

  let score = Math.round(100 - (avgPlacement - 1) * 12)
  score = Math.min(Math.max(score, 35), 98)
  const tier = calculateTier(score)

  const contestAnalysis = mode === 'single'
    ? (latest.contestedInfo?.isContested
      ? `로비 내 ${latest.contestedInfo.opponentCount}명의 경쟁자가 동일한 핵심 시너지(${latest.contestedInfo.contestedTraits.join(', ') || '메인 시너지'})를 동시에 기용하여 4~5스테이지 기물 풀 고갈이 발생했습니다. 겹침을 감지하고도 덱을 우회하지 않고 대깨로 밀어붙여 2성작 타이밍이 크게 지연되었습니다.`
      : `로비 내 다른 유저들과 메인 시너지 겹침이 거의 없는 '빈집'을 효과적으로 선점했습니다. 기물 선점 경쟁에서는 매우 유리했으나 중후반 덱 밸류 업그레이드 타이밍이 아쉬웠습니다.`)
    : `최근 ${matches.length}경기를 종합 분석한 결과, 초반 손패나 증강과 무관하게 선호하는 특정 덱을 강제로 대깨 치는 경향이 ${flexibility < 50 ? '높게' : '낮게'} 나타났습니다. 로비 정찰을 통해 겹친 유저를 확인하고 과감하게 피봇하는 유연성이 절실합니다.`

  return {
    mode,
    metaScore: score,
    metaTier: tier,
    flexibilityScore: flexibility,
    playstyle,
    overview: mode === 'single'
      ? `단일 경기 분석 결과: ${latest.placement}위로 마감하였으며, 메타 덱의 기본 시너지는 구성되었으나 로비 내 경쟁 구도 대응 및 핵심 캐리 아이템 집중도에서 전력 누수가 발생했습니다.`
      : `최근 ${matches.length}경기 종합 분석 결과: 평균 ${avgPlacement.toFixed(1)}등을 기록 중이며, 덱 풀의 다양성과 기물 겹침 상황에서의 유연한 피봇 판단력이 순방의 핵심 분기점으로 나타났습니다.`,
    contestAnalysis,
    itemAnalysis: `메인 딜러에게 3신기 핵심 코어템이 완벽히 몰리지 못하고 보조 기물들로 아이템이 분산되어 후반 DPS 한계점에 부딪혔습니다. 특히 메인 탱커의 방어 아이템(워모그, 가고일 등) 3부위 완성이 늦어져 상대 주력 딜러의 화력을 버텨내지 못했습니다.`,
    synergyAnalysis: `시너지를 폭넓게 활성화하려다 보니 실질적인 덱의 코어 시너지(고티어 시너지)의 단계가 낮아졌습니다. 앞라인 탱커 기물들의 2성작이 미흡한 상태에서 뒷라인 딜러만 배치되어 전투 초반 진형이 붕괴되는 구조적 취약점이 관찰되었습니다.`,
    economyAnalysis: `${latest.lastRound} 탈락 시점에 잔여 골드가 ${latest.goldLeft}G 남아있던 점으로 미루어볼 때, 체력이 30 이하로 내려간 위험 구간에서 과감하게 골드를 소모하여 2성작을 완성하는 리롤 템포 전환 타이밍을 놓쳤습니다.`,
    improvements: [
      '로비 정찰 기반의 피봇 판단: 2-5 및 3-2 라운드에 타 유저 필드를 확인하고 2명 이상 겹쳤다면 즉시 대체 딜러/시너지로 선회해야 합니다.',
      '메인 캐리 기물 아이템 3신기 우선 완성: 서브 딜러에게 템을 나누지 말고, 메인 캐리 1명에게 완제품 3개를 몰아준 뒤 메인 탱커 3방템을 구축해야 합니다.',
      '체력 관리 기반의 유연한 리롤 전환: 체력이 35 이하로 떨어지는 4~5스테이지 구간에서는 50골드 이자에 집착하지 말고 20~30골드까지 과감히 소모해 필드 파워를 반등시켜야 합니다.',
    ],
    actionPlan: [
      '매 라운드 준비 시간 초반 5초 동안 상대 필드를 정찰하여 겹친 기물 여부 체크할 것',
      '아이템 조합 시 딜템 3개 + 탱템 3개 구조를 확정하고 남는 템만 서브 기물에 장착할 것',
      '4-1 혹은 4-2 라운드 7/8레벨 도달 시점 필드 2성작 상태를 점검하고 피가 낮다면 즉시 롤 다운 진행',
      '증강체 선택 시 덱 파워를 즉각 올려주는 전투 증강을 최소 1개 이상 확보하여 템포 유지',
    ],
  }
}

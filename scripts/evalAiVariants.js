/**
 * AI 리포트 변형 평가 하네스 (docs/AI-EVAL-SPRINT1-2026-10-20.md A0).
 *
 * 같은 6경기 × N회로 모델/프롬프트 변형을 직접 호출(generateMetaCoachFeedback)해
 * 프롬프트 · 원시 응답 · 결과 · 지표를 남기고, 출력 폴더의 모든 변형을 summary.csv 로 묶는다.
 * - 리포트 함수는 캐시를 쓰지 않는다(캐시는 API 라우트에 있음) → 매 실행이 실제 LLM 호출이다.
 * - lib/llm 은 import 시점에 env 를 읽으므로 변형 설정은 자식 프로세스 env 로 넘긴다(부모는 lib/llm 을 require 하지 않음).
 * - 요청 본문(messages 등)과 응답 본문만 저장한다. Authorization 등 헤더·키는 저장하지 않는다.
 *
 * 사용:
 *   node scripts/evalAiVariants.js --variant baseline --runs 3 --provider deepseek \
 *     --model deepseek-flash --max-tokens 3400 --thinking disabled --schema v1 --out tmp/eval
 *   node scripts/evalAiVariants.js --summary-only --out tmp/eval      # 실행 없이 요약만 다시 계산
 *   node scripts/evalAiVariants.js --rescore baseline --out tmp/eval  # 저장된 원시 응답을 현재 의미 검증기로 다시 채점 (API 호출 없음)
 * 옵션: --cases all|1,2,..  --fixture data/evalMatches.json  --tier free|pro (pro = Pro 플랜 설정: DEEPSEEK_PRO_*)
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')

/**
 * 고정 평가 케이스 6개 (data/evalMatches.json 의 case 이름). 모든 변형이 같은 6개를 쓴다.
 * 픽스처에 "진짜 빈집 1등"·"경합 높은 8등"이 없어 조건에 가장 가까운 판을 골랐다(괄호 = contestScore).
 */
const EVAL_CASES = [
  { id: 1, label: 'normal-5th', name: 'Seed01 contested-bot4 5등 6-1', note: '정상 5등 기준 샘플 KR_8414975456 (37)' },
  { id: 2, label: 'win-least-contest', name: 'Seed02 win 1등 6-5', note: '1등 중 경합 최저 (46, 빈집 1등은 초반 종료뿐)' },
  { id: 3, label: '8th-most-contest', name: 'Seed05 bottom 8등 4-6', note: '8등 중 경합 최고 (32)' },
  { id: 4, label: 'early-2-2', name: 'Seed01 early 1등 2-2', note: '2-2 초반 종료 (표본 부족 경로)' },
  { id: 5, label: 'no-augment-4th', name: 'Seed01 contested-top4 4등 5-6', note: '증강 없는 4등 (픽스처 전부 증강 0)' },
  { id: 6, label: 'multi-5', name: 'Seed01 최근 5경기', note: 'multi 5경기' },
]

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else {
      out[key] = next
      i++
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 지표                                                                */
/* ------------------------------------------------------------------ */

const AXES = ['economy', 'itemization', 'tempo', 'completion', 'synergy', 'contest']

function extractJson(text) {
  let s = String(text || '').trim()
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenced) s = fenced[1].trim()
  else {
    const a = s.indexOf('{')
    const b = s.lastIndexOf('}')
    if (a !== -1 && b !== -1) s = s.slice(a, b + 1)
  }
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/** 스키마 v1 (lib/llm SYSTEM_INSTRUCTION 의 JSON 형식) 필수 필드 */
function schemaErrorsV1(obj) {
  if (!obj || typeof obj !== 'object') return ['not_json']
  const errs = []
  const str = (k, o = obj) => typeof o[k] === 'string' && o[k].trim().length > 0
  const arr = (k, o = obj) => Array.isArray(o[k]) && o[k].length > 0 && o[k].every((x) => typeof x === 'string')
  if (typeof obj.metaScore !== 'number') errs.push('metaScore')
  for (const k of ['metaTier', 'playstyle', 'overview', 'contestAnalysis', 'itemAnalysis', 'synergyAnalysis', 'economyAnalysis']) if (!str(k)) errs.push(k)
  if (typeof obj.flexibilityScore !== 'number') errs.push('flexibilityScore')
  for (const k of ['improvements', 'actionPlan']) if (!arr(k)) errs.push(k)
  const l = obj.lecture
  if (!l || typeof l !== 'object') errs.push('lecture')
  else {
    for (const k of ['topic', 'concept', 'why', 'evidence', 'alternative', 'drill']) if (!str(k, l)) errs.push(`lecture.${k}`)
    if (!arr('checklist', l)) errs.push('lecture.checklist')
  }
  const keys = Array.isArray(obj.axes) ? obj.axes.filter((a) => a && typeof a.verdict === 'string' && a.verdict.trim()).map((a) => a.key) : []
  for (const k of AXES) if (!keys.includes(k)) errs.push(`axes.${k}`)
  return errs
}

/** 스키마 v2 (2026-10-21.3) — v1 의 중복 해설·flexibilityScore·improvements·actionPlan 제거, actions 추가 */
function schemaErrorsV2(obj) {
  if (!obj || typeof obj !== 'object') return ['not_json']
  const errs = []
  const str = (k, o = obj) => typeof o[k] === 'string' && o[k].trim().length > 0
  if (typeof obj.metaScore !== 'number') errs.push('metaScore')
  for (const k of ['metaTier', 'playstyle', 'overview']) if (!str(k)) errs.push(k)
  if (!Array.isArray(obj.actions) || obj.actions.length < 3 || !obj.actions.every((x) => typeof x === 'string' && x.trim())) errs.push('actions')
  const l = obj.lecture
  if (!l || typeof l !== 'object') errs.push('lecture')
  else {
    for (const k of ['topic', 'concept', 'why', 'evidence', 'alternative', 'drill']) if (!str(k, l)) errs.push(`lecture.${k}`)
    if (!Array.isArray(l.checklist) || !l.checklist.length) errs.push('lecture.checklist')
  }
  const keys = Array.isArray(obj.axes) ? obj.axes.filter((a) => a && typeof a.verdict === 'string' && a.verdict.trim()).map((a) => a.key) : []
  for (const k of AXES) if (!keys.includes(k)) errs.push(`axes.${k}`)
  // v1 잔재가 남아 있으면 스키마 위반 (토큰 절감 확인용)
  for (const k of ['flexibilityScore', 'contestAnalysis', 'itemAnalysis', 'synergyAnalysis', 'economyAnalysis', 'improvements', 'actionPlan']) if (k in obj) errs.push(`v1:${k}`)
  return errs
}

/** 서술 문자열 전부 (점수·등급·축 key 제외) */
function narrativeStrings(obj) {
  const out = []
  const walk = (v, key) => {
    if (typeof v === 'string') {
      if (!['metaTier', 'key'].includes(key)) out.push(v)
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k)
  }
  walk(obj, '')
  return out
}

/** 서술 1,000자당 고유 숫자 토큰 수 — 데이터를 얼마나 다양하게 인용했는가 */
function uniqueDataCitations(obj) {
  const text = narrativeStrings(obj).join('\n')
  if (!text.length) return 0
  const nums = new Set(text.match(/\d+(?:\.\d+)?/g) || [])
  return Math.round((nums.size / (text.length / 1000)) * 100) / 100
}

/**
 * 라운드 타이밍 단정 (A1 규칙: 데이터에 라운드별 레벨업·리롤 기록이 없다) / "최종 상태 기준" 유보 표현 수.
 * 사전식 휴리스틱 — 추세 비교용 지표다.
 */
const TIMING_CLAIM_RE = /레벨업(?:을|이)?\s*(?:늦|미루|미뤘|지연|놓)|늦게\s*레벨|레벨(?:업)?에\s*(?:골드를\s*)?쓰지\s*않|리롤(?:에|로)\s*골드를\s*(?:과하게|너무|많이)?\s*(?:쓴|썼|소모했|낭비)|\d-\d(?:에|에서)\s*(?:레벨업|리롤)(?:을|를)?\s*(?:했|하지\s*않았|안\s*했)|타이밍을\s*놓/g
const TIMING_HEDGE_RE = /최종\s*상태\s*기준|최종\s*(?:보드|레벨)\s*기준|추정/g
function timingCounts(obj) {
  const text = narrativeStrings(obj).join('\n')
  return { timingClaims: (text.match(TIMING_CLAIM_RE) || []).length, timingHedges: (text.match(TIMING_HEDGE_RE) || []).length }
}

/**
 * 강의 규칙 위반 (lib/semanticGrounding.validateCoachingRules): 리롤형 레벨 지적 · 평균 수준 운영도를 약점으로 ·
 * 덱 "갔어야" 단정 · 후보 없이 빈집 덱 추천 · 피봇 시점 단정. facts = 모델에 준 프롬프트 전문.
 */
function ruleCounts(obj, facts, matches, mode) {
  const { feedbackTexts, validateCoachingRules } = require('../lib/semanticGrounding')
  const { buildCoachingPlan } = require('../lib/coaching')
  const verdicts = Object.fromEntries((Array.isArray(obj.axes) ? obj.axes : []).map((a) => [a && a.key, a && a.verdict]))
  const list = validateCoachingRules(feedbackTexts(obj, verdicts), { facts, deckType: buildCoachingPlan(matches).deckType, mode })
  return { ruleViolations: list.length, ruleViolationList: list }
}

function bigrams(s) {
  const t = s.replace(/[^\p{L}\p{N}]/gu, '')
  const set = new Set()
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2))
  return set
}

/**
 * overview · axes verdict · lecture 문장 중복률: 앞 문장과 글자 bigram Jaccard ≥ 0.6 인 문장 비율.
 * (축끼리·강의와 겹치는 복붙 문장을 잡는다)
 */
function repetition(obj) {
  if (!obj) return null
  const parts = [obj.overview, ...(Array.isArray(obj.axes) ? obj.axes.map((a) => a && a.verdict) : [])]
  if (obj.lecture) for (const k of ['concept', 'why', 'evidence', 'alternative', 'drill']) parts.push(obj.lecture[k])
  const sentences = parts
    .filter((p) => typeof p === 'string')
    .flatMap((p) => p.split(/(?<=[.!?。])\s+|\n+/))
    .map((s) => s.trim())
    .filter((s) => s.replace(/[^\p{L}\p{N}]/gu, '').length >= 8)
  if (!sentences.length) return 0
  const grams = sentences.map(bigrams)
  let dup = 0
  for (let i = 1; i < grams.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = grams[i]
      const b = grams[j]
      let inter = 0
      for (const g of a) if (b.has(g)) inter++
      const union = a.size + b.size - inter
      if (union && inter / union >= 0.6) {
        dup++
        break
      }
    }
  }
  return Math.round((dup / sentences.length) * 1000) / 1000
}

/** 산출물에 API 키 값·인증 헤더가 없는지 확인 (있으면 그 실행 폴더를 지우고 중단) */
function assertNoSecrets(dir) {
  const secrets = ['DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'RIOT_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
    .map((k) => String(process.env[k] || '').trim())
    .filter((v) => v.length >= 10)
  for (const f of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, f), 'utf-8')
    if (secrets.some((k) => text.includes(k)) || /authorization|x-riot-token|x-goog-api-key/i.test(text)) {
      fs.rmSync(dir, { recursive: true, force: true })
      throw new Error(`산출물에 키/인증 헤더가 들어갔습니다 — ${dir} 삭제 후 중단`)
    }
  }
}

/* ------------------------------------------------------------------ */
/* 워커 (자식 프로세스): 실제 호출 + 캡처                                 */
/* ------------------------------------------------------------------ */

async function runWorker(cfg) {
  require('./_env').loadEnv()
  require('./_ts')
  const { generateMetaCoachFeedback, COACH_PROMPT_VERSION } = require('../lib/llm')
  const fixture = require(path.resolve(ROOT, cfg.fixture))
  const PRICE = {
    deepseek: { in: Number(process.env.DEEPSEEK_PRICE_INPUT_PER_M) || 0.3, cached: Number(process.env.DEEPSEEK_PRICE_CACHED_INPUT_PER_M) || 0.006, out: Number(process.env.DEEPSEEK_PRICE_OUTPUT_PER_M) || 1.2 },
    gemini: { in: Number(process.env.GEMINI_PRICE_INPUT_PER_M) || 0.3, cached: Number(process.env.GEMINI_PRICE_INPUT_PER_M) || 0.3, out: Number(process.env.GEMINI_PRICE_OUTPUT_PER_M) || 2.5 },
  }

  // DeepSeek · Gemini 호출을 가로채 요청 본문과 응답 본문만 남긴다 (헤더 저장 안 함)
  const realFetch = global.fetch
  let calls = []
  global.fetch = async (url, init = {}) => {
    const u = String(url)
    const provider = u.includes('api.deepseek.com') ? 'deepseek' : u.includes('generativelanguage.googleapis.com') ? 'gemini' : null
    if (!provider) return realFetch(url, init)
    let body = null
    try {
      body = JSON.parse(init.body)
    } catch {
      /* 스트림 등 */
    }
    const startedAt = Date.now()
    const res = await realFetch(url, init)
    const text = await res.clone().text()
    calls.push({ provider, status: res.status, latencyMs: Date.now() - startedAt, request: body, responseText: text })
    return res
  }

  const selected = EVAL_CASES.filter((c) => cfg.cases === 'all' || String(cfg.cases).split(',').map(Number).includes(c.id))
  for (const c of selected) {
    const fc = fixture.cases.find((x) => x.name === c.name)
    if (!fc) throw new Error(`픽스처에 케이스 없음: ${c.name}`)
    for (let run = 1; run <= cfg.runs; run++) {
      calls = []
      const dir = path.join(cfg.out, cfg.variant, `${c.id}-${c.label}`, `run-${run}`)
      fs.mkdirSync(dir, { recursive: true })
      const startedAt = Date.now()
      let result = null
      let error = null
      try {
        result = await generateMetaCoachFeedback(`${fc.gameName}#${fc.tagLine}`, fc.matches, fc.mode, { tier: cfg.tier })
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      }
      const totalMs = Date.now() - startedAt
      // 리포트 호출 = response_format(JSON) 이 있는 DeepSeek 요청 또는 Gemini generateContent
      const report = calls.find((x) => x.provider === 'deepseek' && x.request && x.request.response_format) || calls.find((x) => x.provider === 'gemini') || null

      let usage = {}
      let finishReason = null
      let content = ''
      if (report && report.provider === 'deepseek') {
        const data = (() => {
          try {
            return JSON.parse(report.responseText)
          } catch {
            return null
          }
        })()
        usage = (data && data.usage) || {}
        finishReason = data && data.choices && data.choices[0] ? data.choices[0].finish_reason : null
        content = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || ''
      } else if (report && report.provider === 'gemini') {
        const data = (() => {
          try {
            return JSON.parse(report.responseText)
          } catch {
            return null
          }
        })()
        const cand = data && data.candidates && data.candidates[0]
        content = (cand && cand.content && cand.content.parts && cand.content.parts.map((p) => p.text).join('')) || ''
        finishReason = cand ? String(cand.finishReason || '').toLowerCase() : null
        const um = (data && data.usageMetadata) || {}
        usage = { prompt_tokens: um.promptTokenCount, completion_tokens: um.candidatesTokenCount }
      }
      const parsed = extractJson(content)
      const inputTokens = usage.prompt_tokens || 0
      const cachedTokens = usage.prompt_cache_hit_tokens || 0
      const outputTokens = usage.completion_tokens || 0
      const price = report ? PRICE[report.provider] : null
      const costUsd = price
        ? ((inputTokens - cachedTokens) * price.in + cachedTokens * price.cached + outputTokens * price.out) / 1_000_000
        : 0
      const schemaErrors = cfg.schema === 'v2' ? schemaErrorsV2(parsed) : schemaErrorsV1(parsed)
      const g = result && result.grounding
      const meta = {
        variant: cfg.variant,
        caseId: c.id,
        caseLabel: c.label,
        caseName: c.name,
        matchIds: fc.matches.map((m) => m.matchId),
        mode: fc.mode,
        run,
        provider: report ? report.provider : null,
        model: report && report.request ? report.request.model || process.env.GEMINI_MODEL || null : null,
        maxTokens: report && report.request ? report.request.max_tokens ?? null : null,
        thinking: report && report.request && report.request.thinking ? report.request.thinking.type : null,
        promptVersion: COACH_PROMPT_VERSION,
        schemaVersion: cfg.schema,
        httpStatus: report ? report.status : null,
        inputTokens,
        cachedTokens,
        outputTokens,
        // thinking 모드: 출력 토큰 중 추론 토큰 (출력 상한을 같이 쓴다)
        reasoningTokens: (usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens) || 0,
        finishReason,
        truncated: finishReason === 'length' || finishReason === 'max_tokens',
        latencyMs: report ? report.latencyMs : null,
        totalMs,
        costUsd: Math.round(costUsd * 1e6) / 1e6,
        isFallback: result ? Boolean(result.isFallback) : true,
        schemaValid: Boolean(parsed) && schemaErrors.length === 0,
        schemaErrors,
        groundingScore: g ? g.score : null,
        groundingUnsupported: g ? g.unsupported.length : null,
        groundingWarnings: g && g.warnings ? g.warnings.length : 0,
        entityErrors: g && Array.isArray(g.entityErrors) ? g.entityErrors.length : null,
        entityErrorList: g && Array.isArray(g.entityErrors) ? g.entityErrors : [],
        uniqueDataCitations: parsed ? uniqueDataCitations(parsed) : null,
        repetition: parsed ? repetition(parsed) : null,
        ...(parsed ? timingCounts(parsed) : { timingClaims: null, timingHedges: null }),
        ...(parsed && report && report.request
          ? ruleCounts(parsed, JSON.stringify(report.request.messages || report.request.contents || []), fc.matches, fc.mode)
          : { ruleViolations: null, ruleViolationList: [] }),
        error,
      }

      if (report && report.request) {
        const msgs = report.request.messages || report.request.contents || []
        fs.writeFileSync(
          path.join(dir, 'prompt.txt'),
          report.provider === 'deepseek'
            ? msgs.map((m) => `===== ${m.role} =====\n${m.content}`).join('\n\n')
            : JSON.stringify(report.request, null, 2)
        )
        const { messages, contents, systemInstruction, ...params } = report.request
        fs.writeFileSync(path.join(dir, 'prompt.json'), JSON.stringify({ provider: report.provider, params, messages: messages || contents, systemInstruction }, null, 2))
        fs.writeFileSync(path.join(dir, 'raw.txt'), `status=${report.status}\n\n${report.responseText}\n`)
      }
      fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2))
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
      assertNoSecrets(dir)
      process.stderr.write(
        `  [${cfg.variant}] ${c.id}-${c.label} run-${run}: ${meta.provider ?? 'none'} ${meta.finishReason ?? '-'} ` +
          `out=${outputTokens} ${meta.latencyMs ?? '-'}ms $${meta.costUsd} schema=${meta.schemaValid ? 'ok' : schemaErrors.join('|')} ` +
          `grounding=${meta.groundingScore ?? '-'} entity=${meta.entityErrors ?? '-'}${meta.isFallback ? ' FALLBACK' : ''}${error ? ` ERROR ${error}` : ''}\n`
      )
    }
  }
}

/* ------------------------------------------------------------------ */
/* 요약 (부모)                                                          */
/* ------------------------------------------------------------------ */

function readMetas(outDir) {
  const metas = []
  if (!fs.existsSync(outDir)) return metas
  for (const variant of fs.readdirSync(outDir)) {
    const vdir = path.join(outDir, variant)
    if (!fs.statSync(vdir).isDirectory()) continue
    for (const cs of fs.readdirSync(vdir)) {
      const cdir = path.join(vdir, cs)
      if (!fs.statSync(cdir).isDirectory()) continue
      for (const run of fs.readdirSync(cdir)) {
        const f = path.join(cdir, run, 'meta.json')
        if (fs.existsSync(f)) metas.push(JSON.parse(fs.readFileSync(f, 'utf-8')))
      }
    }
  }
  return metas
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const std = (xs) => {
  if (xs.length < 2) return xs.length ? 0 : null
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}
const pct = (xs, p) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]
}
const r = (x, d = 3) => (x == null || Number.isNaN(x) ? '' : Math.round(x * 10 ** d) / 10 ** d)

const NUMERIC = ['outputTokens', 'reasoningTokens', 'inputTokens', 'cachedTokens', 'latencyMs', 'costUsd', 'groundingScore', 'groundingUnsupported', 'entityErrors', 'uniqueDataCitations', 'repetition', 'timingClaims', 'timingHedges', 'ruleViolations']

function summarize(rows) {
  const nums = (k) => rows.map((x) => x[k]).filter((v) => typeof v === 'number')
  const out = {
    runs: rows.length,
    successRate: r(rows.filter((x) => !x.isFallback && x.schemaValid).length / rows.length),
    schemaValidRate: r(rows.filter((x) => x.schemaValid).length / rows.length),
    truncatedRate: r(rows.filter((x) => x.truncated).length / rows.length),
    fallbackRate: r(rows.filter((x) => x.isFallback).length / rows.length),
    costTotalUsd: r(nums('costUsd').reduce((a, b) => a + b, 0), 5),
    latencyP95Ms: pct(nums('latencyMs'), 95) ?? '',
  }
  for (const k of NUMERIC) {
    out[`${k}Mean`] = r(mean(nums(k)), k === 'costUsd' ? 6 : 2)
    out[`${k}Std`] = r(std(nums(k)), k === 'costUsd' ? 6 : 2)
  }
  return out
}

function toCsv(records) {
  if (!records.length) return ''
  const cols = Object.keys(records[0])
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...records.map((rec) => cols.map((c) => esc(rec[c])).join(','))].join('\n') + '\n'
}

function writeSummary(outDir) {
  const metas = readMetas(outDir)
  const byVariant = new Map()
  for (const m of metas) {
    if (!byVariant.has(m.variant)) byVariant.set(m.variant, [])
    byVariant.get(m.variant).push(m)
  }
  const variants = [...byVariant.entries()].map(([variant, rows]) => {
    const first = rows[0]
    return {
      variant,
      provider: first.provider,
      model: first.model,
      maxTokens: first.maxTokens,
      thinking: first.thinking,
      promptVersion: first.promptVersion,
      schema: first.schemaVersion,
      cases: new Set(rows.map((x) => x.caseId)).size,
      ...summarize(rows),
    }
  })
  const cases = []
  for (const [variant, rows] of byVariant) {
    const ids = [...new Set(rows.map((x) => x.caseId))].sort((a, b) => a - b)
    for (const id of ids) {
      const cr = rows.filter((x) => x.caseId === id)
      cases.push({ variant, caseId: id, caseLabel: cr[0].caseLabel, ...summarize(cr) })
    }
  }
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'summary.csv'), toCsv(variants))
  fs.writeFileSync(path.join(outDir, 'summary-cases.csv'), toCsv(cases))
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ generatedAt: new Date().toISOString(), cases: EVAL_CASES, variants, perCase: cases }, null, 2))
  return { variants, cases }
}

/* ------------------------------------------------------------------ */

/**
 * 저장된 raw.txt 의 모델 JSON 을 현재 의미 검증기(lib/semanticGrounding)로 다시 채점한다.
 * 코드가 채운 강의(normalizeLecture)는 포함하지 않는 "모델 원문" 기준이다 → entityErrorsSource='raw'.
 */
function rescore(outDir, variant, fixturePath) {
  require('./_ts')
  const { validateEntityFacts, feedbackTexts } = require('../lib/semanticGrounding')
  const fixture = require(path.resolve(ROOT, fixturePath))
  const vdir = path.join(outDir, variant)
  let n = 0
  for (const cs of fs.readdirSync(vdir)) {
    for (const run of fs.readdirSync(path.join(vdir, cs))) {
      const dir = path.join(vdir, cs, run)
      const metaFile = path.join(dir, 'meta.json')
      const rawFile = path.join(dir, 'raw.txt')
      if (!fs.existsSync(metaFile) || !fs.existsSync(rawFile)) continue
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'))
      const body = fs.readFileSync(rawFile, 'utf-8').replace(/^status=\d+\s*/, '')
      let content = ''
      try {
        const data = JSON.parse(body)
        content = data.choices ? data.choices[0].message.content : data.candidates[0].content.parts.map((p) => p.text).join('')
      } catch {
        continue
      }
      const obj = extractJson(content)
      if (!obj) continue
      const matches = fixture.cases.find((c) => c.name === meta.caseName).matches
      const verdicts = Object.fromEntries((Array.isArray(obj.axes) ? obj.axes : []).map((a) => [a && a.key, a && a.verdict]))
      const list = validateEntityFacts(feedbackTexts(obj, verdicts), matches)
      meta.entityErrors = list.length
      meta.entityErrorList = list
      meta.entityErrorsSource = 'raw'
      Object.assign(meta, timingCounts(obj))
      const promptFile = path.join(dir, 'prompt.txt')
      if (fs.existsSync(promptFile)) Object.assign(meta, ruleCounts(obj, fs.readFileSync(promptFile, 'utf-8'), matches, meta.mode))
      fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2))
      n++
    }
  }
  return n
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.worker) return runWorker(JSON.parse(Buffer.from(String(args.worker), 'base64').toString('utf-8')))

  const out = path.resolve(ROOT, String(args.out || 'tmp/eval'))
  if (args.rescore) {
    console.log(`다시 채점: ${args.rescore} ${rescore(out, String(args.rescore), String(args.fixture || 'data/evalMatches.json'))}회`)
  } else if (!args['summary-only']) {
    const variant = String(args.variant || 'baseline')
    if (!/^[\w.-]+$/.test(variant)) throw new Error('--variant 는 영문·숫자·-_. 만')
    const cfg = {
      variant,
      runs: Number(args.runs || 3),
      cases: String(args.cases || 'all'),
      schema: String(args.schema || 'v1'),
      tier: args.tier === 'pro' ? 'pro' : 'free',
      fixture: String(args.fixture || 'data/evalMatches.json'),
      out,
    }
    const env = { ...process.env }
    if (args.provider) env.LLM_PROVIDER = String(args.provider)
    if (args.model) env.DEEPSEEK_MODEL = String(args.model)
    if (args['max-tokens']) env.DEEPSEEK_MAX_TOKENS = String(args['max-tokens'])
    if (args.thinking) env.DEEPSEEK_THINKING = String(args.thinking)
    if (args['gemini-model']) env.GEMINI_MODEL = String(args['gemini-model'])
    // 평가 중 이벤트 로그(JSON 한 줄)는 경고 이상만
    env.LOG_LEVEL = env.LOG_LEVEL || 'warn'
    // 같은 변형을 다시 돌리면 이전 산출물을 지운다 (다른 변형은 유지)
    fs.rmSync(path.join(out, variant), { recursive: true, force: true })
    const nCases = cfg.cases === 'all' ? EVAL_CASES.length : cfg.cases.split(',').length
    console.log(`변형 ${variant}: ${nCases}경기 × ${cfg.runs}회 · provider=${env.LLM_PROVIDER || '(체인)'} · max_tokens=${env.DEEPSEEK_MAX_TOKENS || 3400} · thinking=${env.DEEPSEEK_THINKING || 'disabled'} · tier=${cfg.tier}`)
    const res = spawnSync(process.execPath, [__filename, '--worker', Buffer.from(JSON.stringify(cfg)).toString('base64')], {
      env,
      stdio: ['ignore', 'inherit', 'inherit'],
      cwd: ROOT,
    })
    if (res.status !== 0) {
      console.error(`워커 실패 (exit ${res.status})`)
      process.exitCode = 1
    }
  }
  const { variants } = writeSummary(out)
  console.log(`\n요약 → ${path.relative(ROOT, path.join(out, 'summary.csv'))}`)
  for (const v of variants) {
    console.log(
      `  ${v.variant}: runs=${v.runs} 성공=${v.successRate} 스키마=${v.schemaValidRate} 잘림=${v.truncatedRate} 폴백=${v.fallbackRate} ` +
        `out=${v.outputTokensMean}±${v.outputTokensStd} p95=${v.latencyP95Ms}ms 비용합=$${v.costTotalUsd} ` +
        `grounding=${v.groundingScoreMean} entity=${v.entityErrorsMean === '' ? '-' : v.entityErrorsMean} cite=${v.uniqueDataCitationsMean} rep=${v.repetitionMean} ` +
        `timing=${v.timingClaimsMean} hedge=${v.timingHedgesMean}`
    )
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}

module.exports = { EVAL_CASES, schemaErrorsV1, schemaErrorsV2, uniqueDataCitations, repetition, extractJson }

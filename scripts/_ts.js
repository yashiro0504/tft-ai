/**
 * Node 스크립트에서 lib/*.ts 를 직접 require 하기 위한 최소 훅.
 *
 * - 설치된 typescript 의 transpileModule 로 CommonJS 변환만 한다 (타입 검사 없음, 새 의존성 없음).
 * - `@/` 경로 별칭과 확장자 없는 상대 경로(.ts/.tsx)를 해석한다.
 *
 * 사용법: require('./_ts'); const { buildCoachingPlan } = require('../lib/coaching')
 */
const fs = require('fs')
const path = require('path')
const Module = require('module')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')

const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  let req = request
  if (req.startsWith('@/')) req = path.join(ROOT, req.slice(2))
  if (req.startsWith('.') || path.isAbsolute(req)) {
    const base = path.isAbsolute(req) ? req : path.join(path.dirname(parent?.filename || ROOT), req)
    for (const ext of ['', '.ts', '.tsx', '/index.ts']) {
      const candidate = base + ext
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return originalResolve.call(this, candidate, parent, ...rest)
      }
    }
  }
  return originalResolve.call(this, req, parent, ...rest)
}

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = function (module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        resolveJsonModule: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: filename,
    })
    module._compile(outputText, filename)
  }
}

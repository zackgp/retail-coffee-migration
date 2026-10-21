/* eslint-disable import/no-dynamic-require, global-require, no-eval, import/no-commonjs -- this file emulates the webpack runtime on top of jest's dynamic require() */
/* global window, document */
// Minimal emulation of the webpack runtime that `src/main.coffee` / `src/apps.coffee` rely on,
// so the whole legacy app can be loaded inside jest (jsdom). Used by the CoffeeScript
// migration guardrails (PLAN.md G4/G5) and smoke tests (G9).
//
// What it emulates (see webpack.config.js):
//   - resolve.alias (`main$`, `sagamore$`, `sync$`, `jst$`, `sr/`, `vendor/`, `templates/`...) and
//     resolve.extensions order, read from webpack.config.js itself;
//   - `require.context(dir, recursive, regex)` inside entry files;
//   - script-loader for src/vendor/**/*.js (evaluated in the global scope, once);
//   - imports-loader `wrapper=window` for the entry files (top-level `this` is `window`);
//   - .css/.scss -> empty module; .eco/.ejs templates -> stub template functions.
// Everything else goes through jest's normal `require` (and therefore jest's transforms,
// moduleNameMapper and module registry), so modules are shared with the rest of the test.
import fs from 'node:fs'
import path from 'node:path'
import CoffeeScript from 'coffeescript'
import ts from 'typescript'
import { MONOLITH, SRC } from './tool_paths'

export { SRC }

function readWebpackResolve() {
  const text = fs.readFileSync(path.join(MONOLITH, 'webpack.config.js'), 'utf8')
  const aliasBlock = text.match(/alias:\s*\{([\s\S]*?)\n\s*\},/)
  const exact = {}
  const prefix = {}
  const re = /['"]?([\w@/.-]+?)(\$?)['"]?\s*:\s*absPath\(\s*['"]([^'"]+)['"]\s*\)/g
  let m = re.exec(aliasBlock[1])
  while (m) {
    const target = path.join(MONOLITH, m[3])
    if (m[2] === '$') exact[m[1]] = target
    else prefix[m[1]] = target
    m = re.exec(aliasBlock[1])
  }
  const extBlock = text.match(/extensions:\s*\[([^\]]*)\]/)[1]
  const extensions = [...new Set(extBlock.match(/['"][^'"]+['"]/g).map((s) => s.slice(1, -1)))]
  return { exact, prefix, extensions }
}

const WEBPACK = readWebpackResolve()

// Entry files webpack wraps with imports-loader?wrapper=window and that jest cannot load on its
// own (require.context, entry-only aliases). They are compiled and run by this runtime.
const ENTRY_NAMES = ['main', 'apps', 'sagamore', 'sync', 'templates', 'vendor', 'test', 'specs']
const ENTRY_FILES = new Set(ENTRY_NAMES.flatMap((n) => [path.join(SRC, `${n}.coffee`), path.join(SRC, `${n}.js`)]))

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile()
  } catch (e) {
    return false
  }
}

function tryFile(base) {
  if (isFile(base)) return base
  const withExt = WEBPACK.extensions.map((e) => base + e).find(isFile)
  if (withExt) return withExt
  return WEBPACK.extensions.map((e) => path.join(base, `index${e}`)).find(isFile) || null
}

const cleanSpec = (spec) => spec.replace(/^[^!]*!/, '').replace(/\?.*$/, '')

function isInternalSpec(spec) {
  const clean = cleanSpec(spec)
  const [head] = clean.split('/')
  return clean.startsWith('.') || path.isAbsolute(clean) || WEBPACK.exact[clean] !== undefined || WEBPACK.prefix[head] !== undefined
}

/** Absolute path for an internal spec, or null when it cannot be resolved / is a package. */
export function resolveSpec(spec, fromFile) {
  const clean = cleanSpec(spec)
  if (WEBPACK.exact[clean]) return tryFile(WEBPACK.exact[clean])
  if (path.isAbsolute(clean)) return tryFile(clean)
  if (clean.startsWith('.')) return tryFile(path.resolve(path.dirname(fromFile), clean))
  const [head, ...rest] = clean.split('/')
  if (WEBPACK.prefix[head] !== undefined) return tryFile(path.join(WEBPACK.prefix[head], ...rest))
  return null
}

function walk(dir, recursive, out = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((ent) => {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (recursive) walk(p, recursive, out)
    } else out.push(p)
  })
  return out
}

// Non-entry modules that call require.context (jest's require has no `.context`).
const CONTEXT_MODULES = walk(path.join(SRC, 'sagamore'), true).filter(
  (f) => /\.(js|jsx|ts|tsx)$/.test(f) && !/__(tests|mocks)__/.test(f) && fs.readFileSync(f, 'utf8').includes('require.context('),
)

function transpile(file, source) {
  if (file.endsWith('.coffee')) return CoffeeScript.compile(source, { bare: true })
  return ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      allowJs: true,
    },
  }).outputText
}

/**
 * Creates a runtime. `options.stubs` maps a spec or absolute path to a module value
 * (e.g. `{ highcharts: {} }`).
 */
export function createWebpackRuntime(options = {}) {
  const stubs = options.stubs || {}
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
  const cache = new Map()
  const loaded = []

  function runEntry(file, module, requireFor, thisArg = window) {
    const code = transpile(file, fs.readFileSync(file, 'utf8'))
    // eslint-disable-next-line no-new-func
    const fn = new Function('require', 'module', 'exports', `${code}\n//# sourceURL=${file}`)
    fn.call(thisArg, requireFor(file), module, module.exports)
  }

  function load(spec, fromFile) {
    if (has(stubs, spec)) return stubs[spec]
    const resolved = resolveSpec(spec, fromFile)
    if (!resolved) {
      if (isInternalSpec(spec)) throw new Error(`webpack_runtime: cannot resolve '${spec}' from ${fromFile}`)
      return require(spec)
    }
    if (has(stubs, resolved)) return stubs[resolved]
    if (cache.has(resolved)) return cache.get(resolved).exports
    const module = { exports: {} }
    cache.set(resolved, module)
    loaded.push(resolved)
    if (/\.(s?css|less)$/.test(resolved)) return module.exports
    if (/\.(eco|ejs)$/.test(resolved)) {
      const name = path.relative(SRC, resolved)
      const template = () => `<!-- template ${name} -->`
      template.templatePath = name
      module.exports = template
      return template
    }
    if (resolved.startsWith(path.join(SRC, 'vendor') + path.sep) && resolved.endsWith('.js')) {
      // script-loader: evaluate in the global scope
      ;(0, eval)(`${fs.readFileSync(resolved, 'utf8')}\n//# sourceURL=${resolved}`)
      return module.exports
    }
    if (ENTRY_FILES.has(resolved)) {
      // eslint-disable-next-line no-use-before-define
      runEntry(resolved, module, makeRequire)
      return module.exports
    }
    module.exports = require(resolved)
    return module.exports
  }

  function makeRequire(fromFile) {
    const req = (spec) => load(spec, fromFile)
    req.context = (dir, recursive = true, regex = /^\.\/.*$/) => {
      const [head, ...rest] = dir.split('/')
      const base = dir.startsWith('.')
        ? path.resolve(path.dirname(fromFile), dir)
        : path.join(WEBPACK.prefix[head] ?? path.join(MONOLITH, 'node_modules', head), ...rest)
      const keys = walk(base, recursive)
        .map((f) => `./${path.relative(base, f).split(path.sep).join('/')}`)
        .filter((k) => regex.test(k))
        .sort()
      const ctx = (key) => load(path.join(base, key), fromFile)
      ctx.keys = () => keys
      ctx.resolve = (key) => path.join(base, key)
      ctx.id = base
      return ctx
    }
    return req
  }

  // Route modules that use require.context through this runtime, also when jest itself
  // requires them from other modules (shared registry via jest.doMock).
  CONTEXT_MODULES.forEach((file) => {
    jest.doMock(file, () => {
      const module = { exports: {} }
      runEntry(file, module, makeRequire, undefined)
      return module.exports
    })
  })

  // webpack-only aliases that jest resolves differently or not at all (e.g. `node_env` is an
  // npm package for jest but src/node_env.js for webpack; `app-monolith` is unknown to jest).
  const JEST_MAPPED = new Set(['sr', 'vendor', 'jest_helpers', 'sagamore_init_shim'])
  Object.entries(WEBPACK.exact).forEach(([name, target]) => {
    const file = tryFile(target)
    if (!file || JEST_MAPPED.has(name) || !file.startsWith(SRC)) return
    if (ENTRY_FILES.has(file)) jest.doMock(name, () => load(name, path.join(SRC, 'index.js')), { virtual: true })
    else jest.doMock(name, () => require(file), { virtual: true })
  })
  Object.entries(WEBPACK.prefix).forEach(([name, target]) => {
    const file = tryFile(target)
    if (!file || JEST_MAPPED.has(name) || !file.startsWith(SRC)) return
    jest.doMock(name, () => require(file), { virtual: true })
  })

  return {
    require: (spec) => load(spec, path.join(SRC, 'index.js')),
    loaded,
    /** [absolutePath, module.exports] for every module loaded through this runtime */
    modules: () => [...cache.entries()].map(([file, m]) => [file, m.exports]),
  }
}

/** Loads `src/vendor` then `src/main` in the order karma-entry.js / the apps entry use. */
export function loadMain(options = {}, runtime = createWebpackRuntime(options)) {
  // a real page always has at least one <script> (vendor/custom.modernizr relies on it)
  if (!document.getElementsByTagName('script').length) document.head.appendChild(document.createElement('script'))
  runtime.require('vendor')
  runtime.require('main')
  return runtime
}

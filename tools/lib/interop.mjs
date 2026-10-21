// G3 (PLAN.md §3, §4 step 6, §6.4): static interop checks on the *current* module graph.
//
// Unlike inventory.mjs's predictInterop() (what will break once a coffee target becomes ESM),
// these rules report what is broken right now, given each target's actual export shape.
//
//   checkInterop(graph, { files, manifest, shims, allowlist, knownDuplicates, sources }) -> { findings, stale }
//     files: iterable of monolith-relative paths; only edges whose from/to share a module key
//            (globKey) with one of them are checked (rules 5-7 likewise). Omit for everything.
//     sources: Map(file -> text) overriding disk reads (self-tests with in-memory analyses).
//
// A finding is { severity: 'error'|'warning', rule, from, line, to, message, karma, key }.
// `key` is `rule|from|to`, the allowlist key.
//
// Rules (error unless noted):
//   require-esm-default   require('x') of an ES module with export default, used without .default
//   namespace-misuse      import * as X (or require() of a named-only ES module) called/constructed/
//                         rendered/extended, or X.<name> not exported
//   named-missing         import {a} / export {a} from / {a} = require / require().a: a not exported
//   named-from-cjs-value  (warning) the same against a CJS value module whose keys are not static
//   default-missing       import X (used) from a named-only ES module or a module exporting nothing;
//                         require().default of a module without a default
//   shim-stale            (warning) shims.d.ts still declares a module that is no longer coffee
//   coffee-js-duplicate   x.coffee next to x.js/jsx/ts/tsx (warning for batches.json knownDuplicates)
//   mock-shape            (warning) jest.mock factory shape vs. how the test's loaded modules read it
//   unresolved            (warning) internal spec that does not resolve
// Importers that jest.mock the target with a factory are checked against the factory's shape, and
// specs with a webpack loader prefix (`inject-loader?...!x`) are not shape-checked.
import fs from 'node:fs'
import path from 'node:path'
import { compileCoffee } from './analyze.mjs'
import { globKey, knownDuplicates } from './batches.mjs'
import { loadTs } from './deps.mjs'
import { isKarma, isVendor } from './files.mjs'
import { DATA_DIR, abs } from './paths.mjs'

export const MANIFEST_FILE = path.join(DATA_DIR, 'coffee_manifest.txt')
export const ALLOWLIST_FILE = path.join(DATA_DIR, 'interop_allowlist.json')
const SHIM_FILES = ['shims.d.ts'] // apps/monolith-relative; src/**/*.d.ts are added from the graph

export const RULES = {
  'require-esm-default': 'error',
  'namespace-misuse': 'error',
  'named-missing': 'error',
  'named-from-cjs-value': 'warning',
  'default-missing': 'error',
  'shim-stale': 'warning',
  'coffee-js-duplicate': 'error',
  'mock-shape': 'warning',
  unresolved: 'warning',
  'allowlist-stale': 'warning',
}

// ------------------------------------------------------------------ inputs

export function readManifest(file = MANIFEST_FILE) {
  if (!fs.existsSync(file)) return new Set()
  return new Set(
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')),
  )
}

/** { "rule|from|to": "reason" } from interop_allowlist.json (`entries`). */
export function readAllowlist(file = ALLOWLIST_FILE) {
  if (!fs.existsSync(file)) return new Map()
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  return new Map(Object.entries(raw.entries || {}))
}

/** `declare module '...'` statements: [{ file, line, spec }] */
export function readShims(graph) {
  const files = [...SHIM_FILES, ...graph.files.filter((f) => f.endsWith('.d.ts') && !isVendor(f))]
  const out = []
  for (const f of files) {
    if (!fs.existsSync(abs(f))) continue
    for (const [i, line] of fs.readFileSync(abs(f), 'utf8').split('\n').entries()) {
      const m = line.match(/^\s*declare\s+module\s+['"]([^'"]+)['"]/)
      if (m) out.push({ file: f, line: i + 1, spec: m[1] })
    }
  }
  return out
}

// ------------------------------------------------------------------ helpers

const isTs = (f) => /\.tsx?$/.test(f)
const VALUE_KINDS = ['call', 'new', 'jsx', 'extends', 'value', 'computed']
const valueUses = (u, kinds = VALUE_KINDS) => (u ? kinds.filter((k) => u[k].length).map((k) => `${k} L${u[k].join(',L')}`) : [])
const hasAnyUse = (u) => !!u && (VALUE_KINDS.some((k) => u[k].length) || Object.keys(u.members).length > 0)
const fmtNames = (ns) => ns.map((n) => `'${n}'`).join(', ')

const sourceCache = new Map()
let sourceOverrides = null
function source(file) {
  if (sourceOverrides?.has(file)) return sourceOverrides.get(file)
  if (!sourceCache.has(file)) {
    let s = ''
    try {
      s = fs.readFileSync(abs(file), 'utf8')
    } catch {
      // deleted / unreadable
    }
    sourceCache.set(file, s)
  }
  return sourceCache.get(file)
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** TS-only exports the analyzer does not record (interface / type / declare). */
function isTypeExport(file, name) {
  if (!/\.tsx?$/.test(file)) return false
  const n = escapeRe(name)
  const s = source(file)
  return (
    new RegExp(`\\bexport\\s+(?:declare\\s+)?(?:interface|type|namespace|module)\\s+${n}\\b`).test(s) ||
    new RegExp(`\\bexport\\s+type\\s*\\{[^}]*\\b${n}\\b[^}]*\\}`).test(s) ||
    new RegExp(`\\bexport\\s+declare\\s+(?:const|let|var|function|class|enum|abstract\\s+class)\\s+${n}\\b`).test(s)
  )
}

// ------------------------------------------------------------------ export model

/**
 * Static keys of a `module.exports = <value>` module, for named access to CJS value modules:
 *   module.exports = deepFreeze({ a, b })          -> {a, b}, closed
 *   X = { a, b }; X.c = ...; module.exports = X     -> {a, b, c}, closed
 *   X = createReactClass(...); X.Y = ...; module.exports = X -> {Y}, open
 * Returns { names, open }. Anything not understood is open.
 */
function cjsValueKeys(file) {
  const open = { names: new Set(), open: true }
  if (!/\.(coffee|jsx?)$/.test(file)) return open
  let code = source(file)
  if (file.endsWith('.coffee')) {
    try {
      code = compileCoffee(code)
    } catch {
      return open
    }
  }
  const ts = loadTs()
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX)
  const unparen = (n) => {
    while (n && ts.isParenthesizedExpression(n)) n = n.expression
    return n
  }
  const isModuleExports = (n) => ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'module' && n.name.text === 'exports'
  const literalKeys = (obj, out) => {
    let closed = true
    for (const p of obj.properties) {
      if (ts.isSpreadAssignment(p) || !p.name || ts.isComputedPropertyName(p.name)) closed = false
      else out.add(p.name.text)
    }
    return closed
  }
  // top-level assignments, flattening comma / chained `a = b = c`
  const assigns = []
  const collect = (e) => {
    e = unparen(e)
    if (!e || !ts.isBinaryExpression(e)) return
    if (e.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      collect(e.left)
      collect(e.right)
    } else if (e.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      let right = unparen(e.right)
      while (ts.isBinaryExpression(right) && right.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        assigns.push({ left: right.left, right: null })
        right = unparen(right.right)
      }
      assigns.push({ left: e.left, right })
    }
  }
  for (const st of sf.statements) {
    if (ts.isExpressionStatement(st)) collect(st.expression)
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) assigns.push({ left: d.name, right: unparen(d.initializer) })
    }
  }
  // chained assignments: every left of a chain gets the final right
  for (let i = assigns.length - 1, last = null; i >= 0; i -= 1) {
    if (assigns[i].right) last = assigns[i].right
    else assigns[i].right = last
  }
  const exp = assigns.filter((a) => isModuleExports(a.left)).pop()
  if (!exp) return open
  let value = exp.right
  if (ts.isCallExpression(value) && value.arguments.length === 1 && /freeze/i.test(value.expression.getText(sf))) {
    const arg = unparen(value.arguments[0])
    if (ts.isObjectLiteralExpression(arg)) value = arg
  }
  const names = new Set()
  if (ts.isObjectLiteralExpression(value)) return { names, open: !literalKeys(value, names) }
  // module.exports = require('x'): the value may itself be an ES module namespace (has .default)
  if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === 'require') return { ...open, reexport: true }
  if (!ts.isIdentifier(value)) return open
  const id = value.text
  let closed = true
  let seen = false
  for (const a of assigns) {
    const l = a.left
    if (ts.isIdentifier(l) && l.text === id) {
      seen = true
      if (a.right && ts.isObjectLiteralExpression(a.right)) closed = literalKeys(a.right, names) && closed
      else closed = false
    } else if (ts.isPropertyAccessExpression(l) && ts.isIdentifier(l.expression) && l.expression.text === id) names.add(l.name.text)
    else if (ts.isElementAccessExpression(l) && ts.isIdentifier(l.expression) && l.expression.text === id) closed = false
  }
  // mutation through helpers (_.extend(X, ...), Object.assign(X, ...)) keeps the set open
  if (new RegExp(`\\b(?:extend|assign|defaults|mixin)\\(\\s*${escapeRe(id)}\\b`).test(code)) closed = false
  return { names, open: !(seen && closed) }
}

/**
 * What a module exposes to importers.
 *   kind: 'esm' | 'cjs-object' | 'cjs-value' | 'none' | 'unknown'
 *   names: Set of known non-default export names (ESM named, resolved through `export *`; CJS keys)
 *   hasDefault: ESM `export default` (or `export { x as default }`)
 *   open: names is incomplete (export * from CJS/external/unresolved, cjs spread, cjs-value)
 */
function createExportModel(graph) {
  const memo = new Map()
  function info(file, stack = new Set()) {
    if (memo.has(file)) return memo.get(file)
    const a = graph.analyses.get(file)
    if (!a) return { kind: 'unknown', names: new Set(), hasDefault: false, open: true }
    const ex = a.exports
    let r
    if (ex.module === 'esm') {
      r = { kind: 'esm', names: new Set(ex.named), hasDefault: ex.default, open: false }
      if (stack.has(file)) return r // cycle: names gathered so far
      stack.add(file)
      for (const spec of ex.star) {
        const { resolved, external } = graph.resolver.resolve(spec, file)
        if (!resolved || external) {
          r.open = true
          continue
        }
        const t = info(resolved, stack)
        for (const n of t.names) if (n !== 'default') r.names.add(n)
        if (t.open || t.kind === 'unknown' || t.kind === 'cjs-value') r.open = true
      }
      stack.delete(file)
    } else if (ex.cjs === 'value') {
      const v = cjsValueKeys(file)
      r = { kind: 'cjs-value', names: new Set([...ex.cjsKeys, ...v.names]), hasDefault: false, open: v.open, reexport: !!v.reexport }
    } else if (ex.cjs === 'object') {
      r = { kind: 'cjs-object', names: new Set(ex.cjsKeys), hasDefault: false, open: ex.cjsOpenKeys }
    } else {
      r = { kind: 'none', names: new Set(), hasDefault: false, open: false }
    }
    memo.set(file, r)
    return r
  }
  return info
}

/** Export model of a jest.mock factory (the importer sees the factory's object, not the module). */
function mockModel(factory) {
  if (!factory || factory.kind !== 'object') return { kind: 'unknown', names: new Set(), hasDefault: false, open: true }
  const keys = factory.keys.filter((k) => k !== '__esModule' && k !== '[computed]')
  if (factory.esModule) {
    return { kind: 'esm', names: new Set(keys.filter((k) => k !== 'default')), hasDefault: keys.includes('default'), open: factory.spread, mocked: true }
  }
  return { kind: 'cjs-object', names: new Set(keys), hasDefault: false, open: factory.spread || factory.keys.includes('[computed]'), mocked: true }
}

// ------------------------------------------------------------------ rules

export function checkInterop(graph, opts = {}) {
  sourceOverrides = opts.sources ?? null // tests: Map(file -> source) for files not on disk
  const manifest = opts.manifest ?? readManifest()
  const shims = opts.shims ?? readShims(graph)
  const allowlist = opts.allowlist ?? new Map()
  const dupAllowed = opts.knownDuplicates ?? knownDuplicates()
  const keys = opts.files ? new Set([...opts.files].map(globKey)) : null
  const inScope = (f) => !keys || (f != null && keys.has(globKey(f)))
  const exportsOf = createExportModel(graph)

  const findings = []
  const add = (rule, from, line, to, message) => {
    findings.push({ severity: RULES[rule], rule, from, line, to, message, karma: !!from && isKarma(from), key: `${rule}|${from}|${to ?? ''}` })
  }

  // Splits non-default names into missing (target's key set is closed and lacks them) and
  // unknown (target is a CJS value module whose keys cannot be determined).
  const classifyNames = (t, target, names, fromFile) => {
    const missing = []
    const unknown = []
    if (t.kind === 'unknown') return { missing, unknown }
    for (const n of names) {
      if (n === 'default' || t.names.has(n)) continue
      if (isTs(fromFile) && isTypeExport(target, n)) continue
      if (!t.open) missing.push(n)
      else if (t.kind === 'cjs-value') unknown.push(n)
    }
    return { missing, unknown }
  }
  // `X = require()` as seen in compiled coffee: `{a} = require('x')` becomes `ref = require('x'); a = ref.a`
  const isCoffeeTemp = (imp, from) => from.endsWith('.coffee') && /^ref\d*$/.test(imp.local)
  const bindingDesc = (imp, from) => (isCoffeeTemp(imp, from) ? `{…} = require('${imp.spec}')` : `${imp.local} = require('${imp.spec}')`)
  const memberList = (u, ns, prefix = '') => ns.map((n) => `${prefix}.${n} L${u.members[n].join(',L')}`).join(', ')

  // jest.mock(spec, factory) in the importer: its own imports see the factory's object
  const mockedIn = new Map()
  for (const [from, a] of graph.analyses) {
    for (const m of a.mocks) {
      if (!m.resolved || !m.factory) continue
      if (!mockedIn.has(from)) mockedIn.set(from, new Map())
      mockedIn.get(from).set(m.resolved, m.factory)
    }
  }

  for (const e of graph.edges) {
    const { from, to, imp } = e
    if (isVendor(from) || e.external) continue
    if (!inScope(from) && !inScope(to)) continue
    if (!to) {
      // rule 8
      const dts = imp.spec.startsWith('sr/') && graph.fileSet.has(`src/sagamore/${imp.spec.slice(3)}.d.ts`)
      add('unresolved', from, imp.line, null, `cannot resolve '${imp.spec}' (${imp.kind})${dts ? ' (only a .d.ts exists: type-only import)' : ''}`)
      continue
    }
    if (!graph.analyses.has(to)) continue // css/scss/vendor: no export model
    if (imp.spec.includes('!')) continue // webpack loader (inject-loader etc.) changes the module's shape
    const factory = mockedIn.get(from)?.get(to)
    const t = factory ? mockModel(factory) : exportsOf(to)

    switch (imp.kind) {
      case 'require':
        checkRequire(imp, from, to, t)
        break
      case 'esm-namespace':
        checkNamespace(imp, from, to, t)
        break
      case 'esm-named':
        checkNamed(imp, from, to, t)
        break
      case 'esm-default':
        checkDefault(imp, from, to, t)
        break
      default:
        break // side-effect, re-export-star/namespace, dynamic import: nothing static to check
    }
  }

  // rule 1 (+ rule 3 for require member / destructure, + `.default` on a module without one)
  function checkRequire(imp, from, to, t) {
    const { access } = imp
    const src = `require('${imp.spec}')`
    if (access === 'side-effect' || t.kind === 'unknown') return
    const esm = t.kind === 'esm'
    const what = describeTarget(t)
    if (access === 'default') {
      // module.exports = X: X.default is undefined unless X explicitly has a `default` key
      const valueDefault = t.kind === 'cjs-value' && !t.mocked && !t.reexport && !t.names.has('default')
      if (esm ? !t.hasDefault && !t.open : valueDefault || (!t.open && !t.names.has('default'))) add('default-missing', from, imp.line, to, `${src}.default but ${what} has no default export`)
      return
    }
    if (access === 'member' || access === 'destructure') {
      const names = access === 'member' ? [imp.name] : imp.names
      const { missing, unknown } = classifyNames(t, to, names, from)
      const desc = access === 'member' ? `${src}.${imp.name}` : `{ ${names.join(', ')} } = ${src}`
      if (missing.length) {
        if (esm && t.hasDefault && access === 'member') add('require-esm-default', from, imp.line, to, `${desc}: '${imp.name}' is not a named export of ${what}; use ${src}.default.${imp.name}`)
        else add('named-missing', from, imp.line, to, `${desc}: ${fmtNames(missing)} not exported by ${what}`)
      }
      if (unknown.length) add('named-from-cjs-value', from, imp.line, to, `${desc}: ${fmtNames(unknown)} read from a CommonJS value module; cannot check statically`)
      return
    }
    if (!esm) {
      // compiled coffee destructuring `{a} = require('x')` -> `ref = require('x'); a = ref.a`
      if (access === 'binding' && isCoffeeTemp(imp, from)) {
        const u = imp.usage
        const { missing, unknown } = classifyNames(t, to, Object.keys(u.members), from)
        const desc = bindingDesc(imp, from)
        if (missing.length) add('named-missing', from, imp.line, to, `${desc} reads ${memberList(u, missing)}, not exported by ${what}`)
        if (unknown.length) add('named-from-cjs-value', from, imp.line, to, `${desc} reads ${memberList(u, unknown)} from a CommonJS value module; cannot check statically`)
      }
      return
    }
    // ESM target: require() returns the namespace object
    if (['call', 'new', 'value', 'computed'].includes(access)) {
      if (t.hasDefault) add('require-esm-default', from, imp.line, to, `${src} used directly (${imp.reExport ? 'module.exports = ' : ''}${access}) without .default; ${what} returns a namespace object`)
      else if (access === 'call' || access === 'new') add('namespace-misuse', from, imp.line, to, `${src} ${access === 'call' ? 'called' : 'constructed'}; ${what} returns a namespace object`)
      return
    }
    if (access === 'binding') {
      const u = imp.usage
      const { missing } = classifyNames(t, to, Object.keys(u.members), from)
      const desc = bindingDesc(imp, from)
      if (t.hasDefault) {
        const uses = valueUses(u)
        const parts = []
        if (uses.length) parts.push(`used as ${uses.join('; ')}`)
        if (missing.length) parts.push(`accesses non-exported ${memberList(u, missing)}`)
        if (parts.length) add('require-esm-default', from, imp.line, to, `${desc} without .default, ${parts.join('; ')}; ${what} returns a namespace object`)
      } else {
        const uses = valueUses(u, ['call', 'new', 'jsx', 'extends'])
        if (uses.length) add('namespace-misuse', from, imp.line, to, `${desc} used as ${uses.join('; ')}; ${what} returns a namespace object`)
        if (missing.length) add('named-missing', from, imp.line, to, `${desc} accesses ${memberList(u, missing)}, not exported by ${what}`)
      }
    }
  }

  // rule 2
  function checkNamespace(imp, from, to, t) {
    const u = imp.usage
    const uses = valueUses(u, ['call', 'new', 'jsx', 'extends'])
    if (uses.length) add('namespace-misuse', from, imp.line, to, `import * as ${imp.local} used as ${uses.join('; ')}; a namespace object is not callable/constructible${t.hasDefault ? ' (use the default import)' : ''}`)
    const members = Object.keys(u.members)
    const { missing } = classifyNames(t, to, members, from)
    if (members.includes('default') && t.kind === 'esm' && !t.hasDefault && !t.open) missing.push('default')
    if (missing.length) add('namespace-misuse', from, imp.line, to, `import * as ${imp.local}: ${memberList(u, missing, imp.local)} not exported by ${describeTarget(t)}`)
  }

  // rule 3
  function checkNamed(imp, from, to, t) {
    const verb = imp.reExport ? 'export {…} from' : 'import {…} from'
    if (t.kind === 'unknown') return
    // a TS importer that never uses the binding as a value may import a type we cannot see
    const names = imp.names.filter((n) => !(isTs(from) && !imp.reExport && !hasAnyUse(n.usage) && isTs(to)))
    const { missing, unknown } = classifyNames(t, to, names.map((n) => n.imported), from)
    if (names.some((n) => n.imported === 'default') && (t.kind === 'esm' ? !t.hasDefault && !t.open : t.kind === 'none')) missing.unshift('default')
    if (missing.length) add('named-missing', from, imp.line, to, `${verb} '${imp.spec}': ${fmtNames(missing)} not exported by ${describeTarget(t)}`)
    if (unknown.length) add('named-from-cjs-value', from, imp.line, to, `${verb} '${imp.spec}': ${fmtNames(unknown)} read from a CommonJS value module; cannot check statically`)
  }

  // rule 4
  function checkDefault(imp, from, to, t) {
    if (!hasAnyUse(imp.usage)) return
    if (t.kind === 'esm' && !t.hasDefault && !t.open) add('default-missing', from, imp.line, to, `import ${imp.local} from '${imp.spec}' but ${describeTarget(t)} has only named exports (${imp.local} is undefined)`)
    else if (t.kind === 'none') add('default-missing', from, imp.line, to, `import ${imp.local} from '${imp.spec}' but the module exports nothing`)
    else if (t.kind === 'cjs-value' && !t.mocked && !t.reexport && !t.names.has('default') && imp.usage && imp.usage.members && imp.usage.members.default) {
      add('default-missing', from, imp.line, to, `import ${imp.local} from '${imp.spec}' already is the CommonJS value; ${imp.local}.default is undefined`)
    }
  }

  // rule 5
  const staleShims = []
  for (const s of shims) {
    const { resolved } = graph.resolver.resolve(s.spec, s.file)
    if (!resolved || !graph.fileSet.has(resolved) || resolved.endsWith('.coffee')) continue
    if (!manifest.has(globKey(resolved))) continue
    staleShims.push({ ...s, resolved })
  }
  for (const s of staleShims) {
    if (!inScope(s.resolved)) continue
    const importers = (graph.importersOf.get(s.resolved) || []).filter((e) => isTs(e.from) && !isVendor(e.from))
    const msg = `${s.file}:${s.line} still declares module '${s.spec}', which is no longer CoffeeScript; remove the shim (PLAN.md §4 step 7)`
    if (importers.length) for (const e of importers) add('shim-stale', e.from, e.imp.line, s.resolved, msg)
    else add('shim-stale', s.file, s.line, s.resolved, msg)
  }

  // rule 6
  const byKey = new Map()
  for (const f of graph.files) {
    if (isVendor(f) || f.endsWith('.d.ts') || !/\.(coffee|jsx?|tsx?)$/.test(f)) continue
    const k = globKey(f)
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k).push(f)
  }
  for (const [k, fs_] of byKey) {
    const coffee = fs_.filter((f) => f.endsWith('.coffee'))
    const other = fs_.filter((f) => !f.endsWith('.coffee'))
    if (!coffee.length || !other.length) continue
    if (keys && !keys.has(k)) continue
    const winner = graph.resolver.tryFile(`src/${k}`)
    for (const c of coffee) {
      for (const o of other) {
        add('coffee-js-duplicate', c, null, o, `both ${c} and ${o} exist; static imports resolve to ${winner} while require.context may load both${dupAllowed.has(k) ? ' (known pre-existing duplicate, batches.json knownDuplicates)' : ''}`)
        if (dupAllowed.has(k)) findings[findings.length - 1].severity = 'warning'
      }
    }
  }

  // rule 7
  // modules a test loads: its static import closure, not entering modules it mocks with a factory
  const outEdges = new Map()
  for (const e of graph.edges) {
    if (!e.to) continue
    if (!outEdges.has(e.from)) outEdges.set(e.from, [])
    outEdges.get(e.from).push(e.to)
  }
  function reachableFrom(test) {
    const mocked = mockedIn.get(test) || new Map()
    const seen = new Set([test])
    const queue = [test]
    while (queue.length) {
      const f = queue.pop()
      for (const to of outEdges.get(f) || []) {
        if (seen.has(to) || mocked.has(to)) continue
        seen.add(to)
        queue.push(to)
      }
    }
    return seen
  }
  for (const [from, a] of graph.analyses) {
    if (isVendor(from)) continue
    for (const m of a.mocks) {
      if (!m.resolved || !m.factory || m.factory.kind !== 'object') continue
      if (!inScope(from) && !inScope(m.resolved)) continue
      if (!graph.analyses.has(m.resolved)) continue
      const t = exportsOf(m.resolved)
      const fk = m.factory.keys
      const has = (n) => m.factory.spread || fk.includes(n)
      // Consumers that bypass ts-jest's esModuleInterop (coffee / raw require) see the factory object
      // as-is; ESM consumers compiled by ts-jest (tsconfig.test.json: esModuleInterop) get
      // `default` = the whole object when __esModule is absent, which works for both shapes.
      const reach = reachableFrom(from)
      const consumers = (graph.importersOf.get(m.resolved) || []).filter((e) => e.from !== from && reach.has(e.from) && !isVendor(e.from) && !mockedIn.get(e.from)?.has(m.resolved))
      const where = (es) => `${es.slice(0, 3).map((e) => `${e.from}:${e.imp.line}`).join(', ')}${es.length > 3 ? ` (+${es.length - 3})` : ''}`
      if (t.kind === 'esm' && t.hasDefault && !m.factory.esModule && !has('default')) {
        const broken = consumers.filter((e) => e.imp.kind === 'require' && (e.imp.access === 'default' || (e.imp.access === 'binding' && e.imp.usage.members.default)))
        if (broken.length) add('mock-shape', from, m.line, m.resolved, `jest.mock('${m.spec}') factory returns {${fk.join(', ')}} without __esModule/default, but the target has export default and is read as require().default by ${where(broken)}`)
      } else if (t.kind !== 'esm' && t.kind !== 'unknown' && m.factory.esModule) {
        const broken = consumers.filter((e) => {
          const i = e.imp
          if (i.kind === 'esm-default') return !has('default') && hasAnyUse(i.usage)
          if (i.kind !== 'require') return false
          if (i.access === 'side-effect') return false
          if (i.access === 'default') return !has('default')
          if (i.access === 'member') return !has(i.name)
          if (i.access === 'destructure') return !i.names.every(has)
          if (i.access === 'binding') return valueUses(i.usage).length > 0 || !Object.keys(i.usage.members).every(has)
          return true
        })
        if (broken.length) add('mock-shape', from, m.line, m.resolved, `jest.mock('${m.spec}') factory sets __esModule: true, but the target is ${describeTarget(t)}; ${where(broken)} would get the wrong value (require() sees the factory object as-is; a default import needs a 'default' key)`)
      }
    }
  }

  // allowlist
  const used = new Set()
  for (const f of findings) {
    if (allowlist.has(f.key)) {
      f.allowed = allowlist.get(f.key)
      used.add(f.key)
    }
  }
  const stale = keys ? [] : [...allowlist.keys()].filter((k) => !used.has(k))

  findings.sort((x, y) => (x.from || '').localeCompare(y.from || '') || (x.line ?? 0) - (y.line ?? 0) || x.rule.localeCompare(y.rule))
  return { findings, stale }
}

function describeTarget(t) {
  switch (t.kind) {
    case 'esm':
      return t.hasDefault ? (t.names.size ? 'the ES module (export default + named)' : 'the ES module (export default only)') : 'the ES module (named exports only)'
    case 'cjs-object':
      return 'the CommonJS object module'
    case 'cjs-value':
      return 'the CommonJS value module'
    case 'none':
      return 'the module (it exports nothing)'
    default:
      return 'the module'
  }
}

/** One output line. */
export function formatFinding(f) {
  const loc = f.line != null ? `${f.from}:${f.line}` : f.from
  const sev = f.allowed ? 'allowed' : f.severity
  return `${sev} [${f.rule}] ${f.karma ? '[karma] ' : ''}${loc}${f.to ? ` -> ${f.to}` : ''}: ${f.message}${f.allowed ? ` (allowlisted: ${f.allowed})` : ''}`
}

#!/usr/bin/env node
// G2 (PLAN.md §3): CoffeeScript migration inventory.
//
//   node tools/inventory.mjs                 write .work/inventory.json (+ check)
//   node tools/inventory.mjs --check         batch assignment / manifest sanity only
//   node tools/inventory.mjs --summary       remaining files/lines, per-batch status, karma spec count
//   node tools/inventory.mjs --batch B05     batch report: files, callers, interop sites, karma specs
//        [--json]                                      ... as JSON
//        [--list files|coffee|js|callers|karma|related] ... one path per line (for scripts)
//   node tools/inventory.mjs --freeze        add current .coffee modules to coffee_manifest.txt
//
// Runs on the host (after setup_host.sh) or in the sr_web container (`yarn node`). Paths are
// relative to apps/monolith. Coffee/JS/TS are all parsed with the TypeScript AST (coffee after
// compiling with the repo-pinned coffeescript 1.12.7); see lib/analyze.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { assignBatches, findBatch, globKey, isCandidateOf, knownDuplicates, loadBatches, matchesBatch } from './lib/batches.mjs'
import { describesForLines } from './lib/describes.mjs'
import { isKarma, isKarmaSpec, isJestTest, roleOf } from './lib/files.mjs'
import { buildGlobalOwners, buildGraph } from './lib/graph.mjs'
import { DATA_DIR, WORK_DIR, abs } from './lib/paths.mjs'

const MANIFEST = path.join(DATA_DIR, 'coffee_manifest.txt')
const OUT = path.join(WORK_DIR, 'inventory.json')

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n) => {
  const i = args.indexOf(n)
  return i >= 0 ? args[i + 1] : undefined
}

// ------------------------------------------------------------------ helpers

function readManifest() {
  if (!fs.existsSync(MANIFEST)) return null
  return new Set(
    fs
      .readFileSync(MANIFEST, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')),
  )
}

function usageLines(u) {
  if (!u) return []
  const out = [...u.call, ...u.new, ...u.jsx, ...u.extends, ...u.value, ...u.computed]
  for (const ls of Object.values(u.members)) out.push(...ls)
  return out
}

function importLines(imp) {
  const ls =
    imp.kind === 'esm-named' ? imp.names.flatMap((n) => usageLines(n.usage)) : usageLines(imp.usage)
  return ls.length ? ls : [imp.line]
}

function describeAccess(imp) {
  switch (imp.kind) {
    case 'require':
      if (imp.access === 'member') return `require().${imp.name}`
      if (imp.access === 'destructure') return `{ ${imp.names.join(', ')} } = require()`
      if (imp.access === 'binding') return `${imp.local} = require()${usageSummary(imp.usage)}`
      return `require() [${imp.access}]`
    case 'esm-default':
      return `import ${imp.local}${usageSummary(imp.usage)}`
    case 'esm-namespace':
      return `import * as ${imp.local}${usageSummary(imp.usage)}`
    case 'esm-named':
      return `${imp.reExport ? 'export' : 'import'} { ${imp.names.map((n) => n.imported).join(', ')} }`
    default:
      return imp.kind
  }
}

function usageSummary(u) {
  if (!u) return ''
  const parts = []
  for (const k of ['call', 'new', 'jsx', 'extends', 'value', 'computed']) if (u[k].length) parts.push(k)
  const m = Object.keys(u.members)
  if (m.length) parts.push(`.${m.slice(0, 6).join('/.')}${m.length > 6 ? '…' : ''}`)
  return parts.length ? ` (${parts.join(', ')})` : ''
}

/**
 * Predicts whether a caller's import form keeps working once the coffee target becomes ESM
 * (cjs-value -> `export default`, cjs-object -> named exports; PLAN.md §4 step 6, §6.4).
 * Returns null when fine, else a short reason.
 */
function predictInterop(imp, target) {
  const shape = target.shape
  const keys = new Set(target.exports.cjsKeys || [])
  const valueish = (u) => u && (u.call.length || u.new.length || u.jsx.length || u.extends.length || u.value.length || u.computed.length)
  if (shape === 'cjs-value') {
    if (imp.kind === 'require') {
      if (imp.access === 'default' || imp.access === 'side-effect') return null
      return 'require() without .default; target becomes export default'
    }
    if (imp.kind === 'esm-default' || imp.kind === 'esm-side-effect') return null
    if (imp.kind === 'esm-namespace') return 'namespace import; target becomes export default'
    if (imp.kind === 'esm-named') return `named import of a value module (${imp.names.map((n) => n.imported).join(', ')})`
    if (imp.kind === 'dynamic-import') return 'dynamic import: check .default use'
    return `review (${imp.kind})`
  }
  if (shape === 'cjs-object') {
    if (imp.kind === 'require') {
      if (imp.access === 'member') return keys.has(imp.name) || target.exports.cjsOpenKeys ? null : `.${imp.name} not an exported key`
      if (imp.access === 'destructure') {
        const miss = imp.names.filter((n) => !keys.has(n))
        return miss.length && !target.exports.cjsOpenKeys ? `destructures missing keys ${miss.join(', ')}` : null
      }
      if (imp.access === 'default') return 'require().default on object module'
      if (imp.access === 'binding') return valueish(imp.usage) ? 'binding used as a value (namespace object after conversion)' : null
      if (imp.access === 'side-effect') return null
      return `review require() [${imp.access}]`
    }
    if (imp.kind === 'esm-default') return 'default import; target becomes named exports only'
    if (imp.kind === 'esm-namespace' || imp.kind === 'esm-side-effect') return null
    if (imp.kind === 'esm-named') {
      const miss = imp.names.map((n) => n.imported).filter((n) => !keys.has(n))
      return miss.length && !target.exports.cjsOpenKeys ? `named import of missing keys ${miss.join(', ')}` : null
    }
    return `review (${imp.kind})`
  }
  if (shape === 'none') {
    if (imp.kind === 'esm-side-effect' || (imp.kind === 'require' && imp.access === 'side-effect')) return null
    return 'target exports nothing (side-effect module) but caller uses a value'
  }
  return null // already ESM
}

function syntaxPatterns(file) {
  if (!file.endsWith('.coffee')) return {}
  const src = fs.readFileSync(abs(file), 'utf8')
  const count = (re) => (src.match(re) || []).length
  const p = {
    class: count(/^\s*class\b|=\s*class\b/gm),
    extends: count(/\bclass\s+[\w.@]*\s+extends\b/g),
    super: count(/\bsuper\b/g),
    fatArrowMethod: count(/^\s+[\w@'"$]+\s*:\s*(\([^)]*\)\s*)?=>/gm),
    backboneExtend: count(/\.extend\s*\(?\s*$|\.extend\s*\(/gm),
    createReactClass: count(/\bcreateReactClass\b/g),
    createFactory: count(/\bcreateFactory\b/g),
    reactDOM: count(/\bReact\.DOM\b/g),
    jsx: count(/<[A-Z][\w.]*[\s/>]/g),
    existential: count(/[\w)\]]\?(?:\.|\[|\(|\s)/g),
    forOwn: count(/\bfor\s+own\b/g),
    forOf: count(/\bfor\s+[\w,\s]+\bof\b/g),
    splat: count(/\.\.\./g),
    blockRegex: count(/\/\/\//g),
    arguments: count(/\barguments\b/g),
    requireContext: count(/require\.context/g),
  }
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v))
}

// ------------------------------------------------------------------ model

function build() {
  const g = buildGraph()
  const { owners, ownerOf } = buildGlobalOwners(g.analyses)
  const batches = loadBatches()
  const coffee = g.files.filter((f) => f.endsWith('.coffee') && !f.startsWith('src/vendor/'))
  const manifest = readManifest()
  const assignment = assignBatches(batches, coffee)

  // global users: owner file -> [{file, name, line, dynamic}]
  const globalUsers = new Map()
  const seenUser = new Set()
  const addUser = (owner, rec) => {
    const k = `${owner}|${rec.file}|${rec.line}|${rec.name}|${rec.dynamic ? 1 : 0}`
    if (seenUser.has(k)) return
    seenUser.add(k)
    if (!globalUsers.has(owner)) globalUsers.set(owner, [])
    globalUsers.get(owner).push(rec)
  }
  for (const [f, a] of g.analyses) {
    for (const u of a.globals.uses) {
      const o = ownerOf(u.name, f)
      if (o) for (const of of o.files) if (of !== f) addUser(of, { file: f, name: u.name, line: u.line })
    }
    // dynamic registry lookups (Sagamore.X.Y[expr]) hit every file that assigns under X.Y
    for (const d of a.globals.dynamic) {
      for (const [name, files] of owners) {
        if (name.startsWith(`${d.name}.`)) for (const of of files) if (of !== f) addUser(of, { file: f, name: d.name, line: d.line, dynamic: true })
      }
    }
  }

  // karma helpers -> specs that (transitively) import them
  const reachCache = new Map()
  const specsReaching = (file, seen = new Set()) => {
    if (reachCache.has(file)) return reachCache.get(file)
    if (seen.has(file)) return new Set()
    seen.add(file)
    const out = new Set()
    for (const e of g.importersOf.get(file) || []) {
      if (!isKarma(e.from)) continue
      if (isKarmaSpec(e.from)) out.add(e.from)
      else for (const s of specsReaching(e.from, seen)) out.add(s)
    }
    reachCache.set(file, out)
    return out
  }

  return { g, owners, ownerOf, batches, coffee, manifest, assignment, globalUsers, specsReaching }
}

function fileRecord(m, f) {
  const a = m.g.analyses.get(f)
  const importers = {}
  for (const e of m.g.importersOf.get(f) || []) {
    const role = roleOf(e.from)
    ;(importers[role] ||= []).push({ file: e.from, line: e.imp.line, form: describeAccess(e.imp) })
  }
  const contextImporters = m.g.contextEdges.filter((c) => c.to === f).map((c) => ({ file: c.from, line: c.ctx.line }))
  const users = m.globalUsers.get(f) || []
  const staticUsers = {}
  const dynamicHits = []
  for (const u of users) {
    if (u.dynamic) dynamicHits.push({ file: u.file, registry: u.name, line: u.line })
    else (staticUsers[roleOf(u.file)] ||= []).push({ file: u.file, name: u.name, line: u.line })
  }
  const dir = path.dirname(f)
  const base = path.basename(f).replace(/\.[^.]+$/, '')
  const siblingTests = m.g.files.filter((t) => t.startsWith(`${dir}/__tests__/${base}.`) && isJestTest(t))
  const jestImporters = (importers.jest || []).map((x) => x.file)
  const karma = karmaSpecsFor(m, [f]).map((k) => k.file)
  return {
    lines: a.lines,
    batch: (m.assignment.byFile.get(f) || []).join(',') || null,
    shape: a.shape,
    exports: a.exports,
    importers,
    contextImporters,
    globals: {
      assigns: a.globals.assigns,
      staticUsers,
      dynamicRegistryHits: dynamicHits,
    },
    usesGlobals: [...new Set(a.globals.uses.map((u) => u.name))].sort(),
    dynamicLookups: a.globals.dynamic,
    envUses: a.envUses,
    syntax: syntaxPatterns(f),
    tests: {
      jest: [...new Set([...siblingTests, ...jestImporters])].sort(),
      karma,
    },
  }
}

/** PLAN.md §4.1 (a) direct import (incl. via karma helpers) and (b) Sagamore.* globals of the given files. */
function karmaSpecsFor(m, files) {
  const hits = new Map() // spec -> { reasons: Set, lines: [] }
  const add = (spec, reason, lines) => {
    if (!hits.has(spec)) hits.set(spec, { reasons: new Set(), lines: [] })
    const h = hits.get(spec)
    h.reasons.add(reason)
    h.lines.push(...lines)
  }
  for (const f of files) {
    for (const e of m.g.importersOf.get(f) || []) {
      if (!isKarma(e.from)) continue
      if (isKarmaSpec(e.from)) add(e.from, `(a) imports ${f}`, importLines(e.imp))
      else for (const s of m.specsReaching(e.from)) add(s, `(a) via helper ${e.from} -> ${f}`, [])
    }
    for (const u of m.globalUsers.get(f) || []) {
      if (!isKarma(u.file)) continue
      if (isKarmaSpec(u.file)) add(u.file, `(b) ${u.dynamic ? 'dynamic ' : ''}${u.name}`, [u.line])
      else for (const s of m.specsReaching(u.file)) add(s, `(b) via helper ${u.file}: ${u.name}`, [])
    }
  }
  return [...hits.entries()]
    .map(([file, h]) => {
      const d = h.lines.length ? describesForLines(file, h.lines) : { describes: [], fileLevel: true, its: 0 }
      return {
        file,
        lines: m.g.analyses.get(file)?.lines ?? 0,
        reasons: [...h.reasons].sort(),
        describes: d.describes,
        fileLevel: d.fileLevel,
      }
    })
    .sort((x, y) => x.file.localeCompare(y.file))
}

function batchFiles(m, b) {
  // modules of the batch = manifest keys matching the batch globs, resolved to whatever file exists now
  const keys = new Set()
  for (const f of m.coffee) if (matchesBatch(b, f)) keys.add(globKey(f))
  if (m.manifest) for (const k of m.manifest) if (matchesBatch(b, `src/${k}.coffee`)) keys.add(k)
  const files = []
  for (const k of [...keys].sort()) {
    const found = m.g.files.filter((f) => globKey(f) === k && /\.(coffee|jsx?|tsx?)$/.test(f) && !f.endsWith('.d.ts'))
    if (found.length) files.push(...found)
    else files.push({ deleted: `src/${k}` })
  }
  return files
}

// ------------------------------------------------------------------ modes

function check(m) {
  const errs = []
  const warns = []
  for (const f of m.assignment.unassigned) errs.push(`not in any batch: ${f}`)
  for (const [f, ids] of m.assignment.multiple) errs.push(`in several batches (${ids.join(', ')}): ${f}`)
  for (const b of m.batches) {
    for (const [glob, owner] of Object.entries(b.candidates)) {
      if (!m.batches.some((x) => x.id === owner)) errs.push(`${b.id}: candidate ${glob} -> unknown batch ${owner}`)
    }
  }
  if (!m.manifest) warns.push('coffee_manifest.txt missing; run --freeze')
  else {
    for (const f of m.coffee) if (!m.manifest.has(globKey(f))) warns.push(`coffee file not in coffee_manifest.txt (run --freeze): ${f}`)
  }
  // .coffee next to a same-named .js/.ts silently loses (webpack/jest resolve js first)
  const byKey = new Map()
  for (const f of m.g.files) {
    if (!/\.(coffee|jsx?|tsx?)$/.test(f) || f.endsWith('.d.ts')) continue
    const k = f.replace(/\.[^.]+$/, '')
    ;(byKey.get(k) || byKey.set(k, []).get(k)).push(f)
  }
  const allowDup = knownDuplicates()
  for (const [, fs_] of byKey) {
    if (fs_.length < 2 || !fs_.some((f) => f.endsWith('.coffee'))) continue
    if (allowDup.has(globKey(fs_[0]))) warns.push(`known pre-existing duplicate (resolve in B01): ${fs_.join(' + ')}`)
    else errs.push(`same module in several languages (.js shadows .coffee for imports; require.context loads both): ${fs_.join(' + ')}`)
  }
  for (const a of m.g.analyses.values()) if (a.compileError) errs.push(`coffee compile error: ${a.file}: ${a.compileError}`)
  return { errs, warns }
}

function report(m, { errs, warns }) {
  for (const w of warns) console.warn(`warn: ${w}`)
  for (const e of errs) console.error(`error: ${e}`)
  return errs.length ? 1 : 0
}

function modeInventory(m) {
  const files = {}
  for (const f of m.coffee) files[f] = fileRecord(m, f)
  const totalLines = Object.values(files).reduce((s, r) => s + r.lines, 0)
  const out = {
    generatedAt: new Date().toISOString(),
    totals: {
      coffeeFiles: m.coffee.length,
      coffeeLines: totalLines,
      karmaSpecs: m.g.files.filter(isKarmaSpec).length,
      shapes: countBy(Object.values(files), (r) => r.shape),
      assigningGlobals: Object.values(files).filter((r) => r.globals.assigns.length).length,
      withJestTests: Object.values(files).filter((r) => r.tests.jest.length).length,
      karmaOnly: Object.values(files).filter((r) => !r.tests.jest.length && r.tests.karma.length).length,
      untested: Object.values(files).filter((r) => !r.tests.jest.length && !r.tests.karma.length).length,
    },
    files,
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`)
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`)
  console.log(JSON.stringify(out.totals))
}

function countBy(xs, fn) {
  const o = {}
  for (const x of xs) o[fn(x)] = (o[fn(x)] || 0) + 1
  return o
}

function batchStatus(m, b) {
  const files = batchFiles(m, b)
  const keys = new Set(files.map((f) => (typeof f === 'string' ? globKey(f) : f.deleted))).size
  if (!b.include.length) return { status: 'n/a', modules: 0, coffee: 0, coffeeLines: 0 }
  const coffee = files.filter((f) => typeof f === 'string' && f.endsWith('.coffee'))
  const coffeeLines = coffee.reduce((s, f) => s + m.g.analyses.get(f).lines, 0)
  const status = coffee.length === 0 ? 'done' : coffee.length === keys ? 'todo' : 'in-progress'
  return { status, modules: keys, coffee: coffee.length, coffeeLines }
}

function modeSummary(m) {
  const lines = m.coffee.reduce((s, f) => s + m.g.analyses.get(f).lines, 0)
  const karma = m.g.files.filter(isKarmaSpec).length
  console.log(`remaining coffee: ${m.coffee.length} files / ${lines} lines; karma specs: ${karma}`)
  console.log('')
  console.log('| batch | status | modules | coffee left | coffee lines | title |')
  console.log('| --- | --- | --- | --- | --- | --- |')
  for (const b of m.batches) {
    const s = batchStatus(m, b)
    console.log(`| ${b.id} | ${s.status} | ${s.modules} | ${s.coffee} | ${s.coffeeLines} | ${b.title} |`)
  }
  console.log('')
  console.log(`§8 row: | <batch> | <status> | <PR> | ${m.coffee.length} / ${lines.toLocaleString('en-US')} | ${karma} | |`)
}

function modeBatch(m, id) {
  const b = findBatch(m.batches, id)
  const files = batchFiles(m, b)
  const present = files.filter((f) => typeof f === 'string')
  const deleted = files.filter((f) => typeof f !== 'string').map((f) => f.deleted)
  const inBatch = new Set(present)
  const coffeeFiles = present.filter((f) => f.endsWith('.coffee'))
  const jsFiles = present.filter((f) => !f.endsWith('.coffee'))
  const candidates = m.coffee.filter((f) => isCandidateOf(b, f))

  const callers = []
  const interop = []
  for (const f of present) {
    const target = m.g.analyses.get(f)
    for (const e of m.g.importersOf.get(f) || []) {
      if (inBatch.has(e.from)) continue
      callers.push({ file: e.from, role: roleOf(e.from), target: f, line: e.imp.line, form: describeAccess(e.imp) })
      if (f.endsWith('.coffee')) {
        const why = predictInterop(e.imp, target)
        if (why) interop.push({ file: e.from, role: roleOf(e.from), line: e.imp.line, target: f, form: describeAccess(e.imp), why })
      }
    }
    for (const c of m.g.contextEdges) if (c.to === f) callers.push({ file: c.from, role: roleOf(c.from), target: f, line: c.ctx.line, form: `require.context(${c.ctx.dir})` })
  }
  const mocks = []
  for (const [from, a] of m.g.analyses) {
    for (const mk of a.mocks) if (inBatch.has(mk.resolved)) mocks.push({ file: from, role: roleOf(from), line: mk.line, target: mk.resolved, factory: mk.factory })
  }
  const globals = []
  for (const f of present) {
    for (const g of m.g.analyses.get(f).globals.assigns) globals.push({ file: f, name: g.name, line: g.line })
  }
  const globalUsers = []
  const seenGU = new Set()
  for (const f of present) {
    for (const u of m.globalUsers.get(f) || []) {
      if (inBatch.has(u.file)) continue
      const k = `${u.file}|${u.line}|${u.name}`
      if (seenGU.has(k)) continue
      seenGU.add(k)
      globalUsers.push({ ...u, role: roleOf(u.file), target: f })
    }
  }
  const karma = karmaSpecsFor(m, present)
  const karmaLines = karma.reduce((s, k) => s + k.lines, 0)
  const tests = {}
  for (const f of present) {
    const r = fileRecord(m, f)
    tests[f] = r.tests.jest
  }

  const result = {
    batch: b.id,
    title: b.title,
    files: present.map((f) => ({ file: f, lines: m.g.analyses.get(f).lines, shape: m.g.analyses.get(f).shape, jestTests: tests[f] })),
    deleted,
    candidates,
    callers,
    interop,
    mocks,
    globals,
    globalUsers,
    karma,
    karmaTotals: { specs: karma.length, lines: karmaLines, splitSuggested: karma.length > 15 || karmaLines > 1500 },
  }

  const list = opt('--list')
  if (list) {
    const uniq = (xs) => [...new Set(xs)].sort()
    const sets = {
      files: present,
      coffee: coffeeFiles,
      js: jsFiles,
      callers: uniq([...callers.map((c) => c.file), ...globalUsers.filter((u) => !/\.(eco|ejs)$/.test(u.file)).map((u) => u.file), ...mocks.map((x) => x.file)]),
      karma: karma.map((k) => k.file),
    }
    sets.related = uniq([...present, ...sets.callers])
    if (!sets[list]) throw new Error(`--list expects one of ${Object.keys(sets).join('|')}`)
    for (const f of sets[list]) console.log(f)
    return
  }
  if (flag('--json')) {
    console.log(JSON.stringify(result, null, 1))
    return
  }

  const p = console.log
  p(`# ${b.id} — ${b.title}`)
  p('')
  p(`## Files (${present.length}; ${coffeeFiles.length} coffee / ${coffeeFiles.reduce((s, f) => s + m.g.analyses.get(f).lines, 0)} lines)`)
  for (const x of result.files) p(`- ${x.file} (${x.lines} lines, ${x.shape})${x.jestTests.length ? ` jest: ${x.jestTests.join(', ')}` : ' — no jest test'}`)
  for (const d of deleted) p(`- ${d} (deleted)`)
  if (candidates.length) {
    p('')
    p('## Candidates to evaluate (owned by other batches if kept)')
    for (const c of candidates) p(`- ${c}`)
  }
  p('')
  p(`## External callers (${callers.length})`)
  for (const c of callers.sort((x, y) => x.file.localeCompare(y.file))) p(`- [${c.role}] ${c.file}:${c.line} -> ${c.target}: ${c.form}`)
  p('')
  p(`## Interop sites needing attention after conversion (${interop.length})`)
  p('Predicted target shapes: cjs-value -> export default; cjs-object -> named exports. Fix callers per PLAN.md §4 step 6; karma callers are migrated (§4.1), not patched.')
  for (const x of interop) p(`- [${x.role}] ${x.file}:${x.line} -> ${x.target}: ${x.form} — ${x.why}`)
  p('')
  p(`## jest.mock of batch modules (${mocks.length}) — check factory shape (__esModule/default) after conversion`)
  for (const x of mocks) p(`- [${x.role}] ${x.file}:${x.line} -> ${x.target}: factory ${x.factory.kind}${x.factory.keys ? ` {${x.factory.keys.join(', ')}}` : ''}`)
  p('')
  p(`## Sagamore.* registered by this batch (${globals.length}) — keep unless P9`)
  for (const x of globals) p(`- ${x.name}  (${x.file}:${x.line})`)
  p('')
  p(`## Global users outside the batch (${globalUsers.length})`)
  for (const u of globalUsers.sort((x, y) => x.file.localeCompare(y.file))) p(`- [${u.role}] ${u.file}:${u.line} ${u.dynamic ? 'dynamic ' : ''}${u.name}`)
  p('')
  p(`## Karma specs to migrate per §4.1 (a)(b): ${karma.length} specs / ${karmaLines} lines${result.karmaTotals.splitSuggested ? ' — exceeds 15 specs / 1,500 lines: consider a Bxx-t batch' : ''}`)
  p('(c) specs that only exercise these modules indirectly are NOT listed — judge manually.')
  for (const k of karma) {
    p(`- ${k.file} (${k.lines} lines)`)
    for (const r of k.reasons) p(`    - ${r}`)
    if (k.describes.length) p(`    - describes: ${k.describes.join(' | ')}`)
    if (k.fileLevel) p('    - file-level hit (top-level import or helper): review the whole file')
  }
}

function modeFreeze(m) {
  const existing = m.manifest || new Set()
  const next = new Set([...existing, ...m.coffee.map(globKey)])
  const header = '# Modules (src/-relative, extensionless) that were CoffeeScript when the migration started.\n# Maintained by `inventory.mjs --freeze` (union only). Used to resolve batch files after conversion.\n'
  fs.writeFileSync(MANIFEST, header + [...next].sort().join('\n') + '\n')
  console.log(`coffee_manifest.txt: ${existing.size} -> ${next.size} modules`)
}

// ------------------------------------------------------------------ main

const m = build()
const status = check(m)
let code = 0
if (flag('--freeze')) modeFreeze(m)
else if (flag('--check')) {
  code = report(m, status)
  if (!code) console.log(`ok: ${m.coffee.length} coffee files, each in exactly one batch`)
} else if (flag('--summary')) {
  code = report(m, status)
  modeSummary(m)
} else if (opt('--batch')) {
  code = report(m, status)
  modeBatch(m, opt('--batch'))
} else {
  code = report(m, status)
  modeInventory(m)
}
process.exitCode = code

#!/usr/bin/env node
// Compares a collect.mjs output directory against the recorded baseline (G6/G8). Host or container.
//
//   node tools/compare.mjs [--baseline <dir, default <dataDir>/baseline>] [--current <dir, default <workDir>/current>]
//        [--only jest,karma,karma-static,eslint,tsc,webpack-dev,webpack-prod]
//        [--allow-removed <regex>]...  webpack modules that may disappear (dead code deleted
//                                      without replacement)
//        [--allow-added <regex>]...    webpack modules that may appear (files new on this branch)
//        [--allow-test-removal]        jest per-file passing counts may drop (tests deleted with dead code)
//        [--eslint-files <file>]       only compare eslint for files listed (one per line)
//
// Fails (exit 1) on: new jest failures or fewer passing jest tests in a file; new karma failures,
// fewer passing karma tests than it() removed, or a broken karma run; any new or patched file under
// DEPRECATED_spec; changed test-selection config (karma-entry/karma.conf/jest.config);
// new eslint errors; new tsc errors; webpack errors, circular dependencies, or unexpected
// module set changes. Shrinking things (fewer warnings) is reported, never a failure.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { APP_DIR, BASE_REF, BASELINE_DIR, MONOLITH, REPO_ROOT, TOOLS_ROOT, WORK_DIR } from './lib/paths.mjs'

const args = process.argv.slice(2)
const opts = (n) => args.flatMap((a, i) => (a === n ? [args[i + 1]] : []))
const opt = (n) => opts(n)[0]
const BASE = opt('--baseline') ? path.resolve(opt('--baseline')) : BASELINE_DIR
const CUR = opt('--current') ? path.resolve(opt('--current')) : path.join(WORK_DIR, 'current')
const ALL = ['karma-static', 'tsc', 'eslint', 'jest', 'webpack-dev', 'webpack-prod', 'karma']
const only = opt('--only') ? opt('--only').split(',') : ALL
const allowRemoved = opts('--allow-removed').map((r) => new RegExp(r))
const allowAdded = opts('--allow-added').map((r) => new RegExp(r))
const gitBase = opt('--git-base') || BASE_REF
const allowTestRemoval = args.includes('--allow-test-removal')
const eslintFiles = opt('--eslint-files')
  ? new Set(fs.readFileSync(opt('--eslint-files'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean))
  : null

const read = (dir, f) => {
  const p = path.join(dir, f)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
}
const lines = (s) => (s || '').split('\n').filter((l) => l && !l.startsWith('#'))
const summaryOf = (dir) => {
  const s = read(dir, 'summary.json')
  return s ? JSON.parse(s) : {}
}
const baseSummary = summaryOf(BASE)
const curSummary = summaryOf(CUR)

let failed = false
const out = []
function section(name, problems, notes = []) {
  const bad = problems.length > 0
  if (bad) failed = true
  out.push(`${bad ? 'FAIL' : 'ok  '} ${name}`)
  for (const p of problems.slice(0, 60)) out.push(`       ✗ ${p}`)
  if (problems.length > 60) out.push(`       … ${problems.length - 60} more`)
  for (const n of notes.slice(0, 20)) out.push(`       · ${n}`)
}
function missing(name, file) {
  const b = read(BASE, file)
  const c = read(CUR, file)
  if (b === null) {
    section(name, [`baseline ${path.relative(TOOLS_ROOT, path.join(BASE, file))} missing — run tools/baseline.sh`])
    return true
  }
  if (c === null) {
    section(name, [`current ${path.relative(TOOLS_ROOT, path.join(CUR, file))} missing — collector did not run`])
    return true
  }
  return false
}

/**
 * A migrated karma spec may only lose lines (describe/it blocks moved to jest, unused imports
 * dropped). Returns null when the current file is a line-subsequence of the git base version,
 * otherwise the first offending line.
 */
function pureDeletion(file) {
  let before
  try {
    const base = execFileSync('git', ['-C', REPO_ROOT, 'merge-base', 'HEAD', gitBase], { encoding: 'utf8' }).trim()
    before = execFileSync('git', ['-C', REPO_ROOT, 'show', `${base}:${APP_DIR}/${file}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    return `cannot read ${gitBase} version: ${String(e.message).split('\n')[0]}`
  }
  const norm = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean)
  const old = norm(before)
  const cur = norm(fs.readFileSync(path.join(MONOLITH, file), 'utf8'))
  let i = 0
  for (const l of cur) {
    while (i < old.length && old[i] !== l) i += 1
    if (i >= old.length) return `line not in the original: ${l.trim().slice(0, 80)}`
    i += 1
  }
  return null
}

const compare = {
  jest() {
    if (missing('jest (full suite vs baseline)', 'jest-failures.txt')) return
    const base = new Set(lines(read(BASE, 'jest-failures.txt')))
    const cur = lines(read(CUR, 'jest-failures.txt'))
    const s = curSummary.jest || {}
    const problems = cur.filter((l) => !base.has(l)).map((l) => `new: ${l}`)
    if (s.error) problems.push(`collector error: ${s.error.split('\n')[0]}`)
    const fixed = [...base].filter((l) => !cur.includes(l))
    // per-file passing counts: deleting / skipping tests must not go unnoticed
    const counts = (s) => new Map(lines(s).map((l) => l.split('\t')).map(([f, n]) => [f, Number(n)]))
    const bp = counts(read(BASE, 'jest-passing.txt'))
    const cp = counts(read(CUR, 'jest-passing.txt'))
    const drops = []
    for (const [f, n] of bp) if ((cp.get(f) || 0) < n) drops.push(`fewer passing tests in ${f}: ${n} -> ${cp.get(f) || 0}`)
    if (allowTestRemoval) fixed.push(...drops.map((d) => `allowed: ${d}`))
    else problems.push(...drops)
    section('jest (full suite vs baseline)', problems, [
      `${s.tests ?? '?'} tests in ${s.suites ?? '?'} suites (baseline ${baseSummary.jest?.tests ?? '?'} / ${baseSummary.jest?.suites ?? '?'})`,
      ...fixed.map((l) => `no longer failing: ${l}`),
    ])
  },

  karma() {
    if (missing('karma run vs baseline', 'karma.txt')) return
    const base = new Set(lines(read(BASE, 'karma.txt')))
    const curText = read(CUR, 'karma.txt')
    const cur = lines(curText)
    const problems = cur.filter((l) => !base.has(l)).map((l) => `new: ${l}`)
    const s = curSummary.karma || {}
    if (s.error) problems.push(`karma run broken: ${s.error.split('\n')[0]}`)
    if (s.suiteErrors) problems.push(`karma suite errors: ${s.suiteErrors}`)
    // passing karma tests may only drop by as many it() as were removed from DEPRECATED_spec
    const its = (dir) => lines(read(dir, 'karma-specs.txt')).reduce((n, l) => n + Number(l.split('\t')[1] || 0), 0)
    const b = baseSummary.karma || {}
    if (b.passed != null && s.passed != null) {
      const removedIts = its(BASE) - its(CUR)
      if (b.passed - s.passed > Math.max(0, removedIts)) problems.push(`passing karma tests dropped ${b.passed} -> ${s.passed} but only ${removedIts} it() were removed (skipped/filtered tests?)`)
    }
    section('karma run vs baseline (regression only; fix by migrating to jest, never by patching karma)', problems, [
      `${s.total ?? '?'} karma tests, ${s.failed ?? '?'} failed (baseline ${baseSummary.karma?.total ?? '?'}, ${baseSummary.karma?.failed ?? '?'} failed)`,
    ])
  },

  'karma-static'() {
    if (missing('DEPRECATED_spec unchanged except deletions (§4.1)', 'karma-specs.txt')) return
    const parse = (s) => new Map(lines(s).map((l) => {
      const [f, its, sha] = l.split('\t')
      return [f, { its: Number(its), sha }]
    }))
    const base = parse(read(BASE, 'karma-specs.txt'))
    const cur = parse(read(CUR, 'karma-specs.txt'))
    const problems = []
    const notes = []
    for (const [f, c] of cur) {
      const b = base.get(f)
      if (!b) problems.push(`new file in DEPRECATED_spec: ${f}`)
      else if (c.its > b.its) problems.push(`more it() in ${f}: ${b.its} -> ${c.its}`)
      else if (c.sha !== b.sha && c.its === b.its) problems.push(`modified without removing any it() (patching karma is forbidden): ${f}`)
      else if (c.sha !== b.sha) {
        const why = pureDeletion(f)
        if (why) problems.push(`shrunk but not by pure deletion (${why}): ${f}`)
        else notes.push(`shrunk by deletion (migrated?): ${f} ${b.its} -> ${c.its} it()`)
      }
    }
    const removed = [...base.keys()].filter((f) => !cur.has(f))
    if (removed.length) notes.push(`${removed.length} DEPRECATED_spec files removed`)
    const specs = [...cur.keys()].filter((f) => /spec\.(js|coffee)$/.test(f)).length
    notes.unshift(`${specs} karma spec files remain`)
    const bc = new Set(lines(read(BASE, 'test-config.txt')))
    for (const l of lines(read(CUR, 'test-config.txt'))) if (!bc.has(l)) problems.push(`test-selection config changed: ${l.split('\t')[0]} (only B32 may change it; re-run baseline.sh then)`)
    section('DEPRECATED_spec unchanged except deletions (§4.1)', problems, notes)
  },

  eslint() {
    if (missing('eslint errors vs baseline', 'eslint.json')) return
    const base = JSON.parse(read(BASE, 'eslint.json'))
    const cur = JSON.parse(read(CUR, 'eslint.json'))
    const problems = []
    let warnDelta = 0
    for (const [key, files] of Object.entries(cur)) {
      for (const [file, n] of Object.entries(files)) {
        if (eslintFiles && !eslintFiles.has(file)) continue
        const was = base[key]?.[file] || 0
        if (n > was) {
          if (key.startsWith('error:')) problems.push(`${file}: ${key.slice(6)} ${was} -> ${n}`)
          else warnDelta += n - was
        }
      }
    }
    if (curSummary.eslint?.error) problems.push(`collector error: ${curSummary.eslint.error.split('\n')[0]}`)
    section(`eslint errors vs baseline${eslintFiles ? ` (${eslintFiles.size} files)` : ''}`, problems, warnDelta ? [`+${warnDelta} new warnings (not a failure)`] : [])
  },

  tsc() {
    if (missing('tsc errors vs baseline', 'tsc-errors.txt')) return
    const parse = (s) => new Map(lines(s).map((l) => {
      const m = l.match(/^(.*?)(?: ×(\d+))?$/)
      return [m[1], Number(m[2] || 1)]
    }))
    const base = parse(read(BASE, 'tsc-errors.txt'))
    const cur = parse(read(CUR, 'tsc-errors.txt'))
    const problems = []
    for (const [k, n] of cur) if (n > (base.get(k) || 0)) problems.push(`${k}${n > 1 ? ` ×${n}` : ''}`)
    const gone = [...base.keys()].filter((k) => !cur.has(k))
    section('tsc errors vs baseline', problems, [`${cur.size} distinct (baseline ${base.size})`, ...gone.map((g) => `fixed: ${g}`)])
  },

  'webpack-dev'() {
    webpackCompare('dev')
  },

  'webpack-prod'() {
    webpackCompare('prod')
  },
}

function webpackCompare(mode) {
  const file = `webpack-modules-${mode}.txt`
  const name = `webpack ${mode} build + module set vs baseline`
  if (missing(name, file)) return
  const s = curSummary[`webpack-${mode}`] || {}
  const problems = []
  if (s.error) problems.push(`build failed: ${s.error.split('\n')[0]}`)
  if (s.exit) problems.push(`webpack exit ${s.exit}`)
  if (s.errors) problems.push(`${s.errors} webpack errors (see raw/webpack-${mode}.errors.txt)`)
  if (s.circular) problems.push(`${s.circular} circular dependencies`)
  const base = new Set(lines(read(BASE, file)))
  const cur = new Set(lines(read(CUR, file)))
  const added = [...cur].filter((l) => !base.has(l))
  const removed = [...base].filter((l) => !cur.has(l))
  const allowed = (l) => allowRemoved.some((r) => r.test(l.split('\t')[1]))
  const allowedAdd = (l) => allowAdded.some((r) => r.test(l.split('\t')[1]))
  for (const l of added) if (!allowedAdd(l)) problems.push(`added: ${l}`)
  for (const l of removed) if (!allowed(l)) problems.push(`removed: ${l}`)
  const notes = [
    ...removed.filter(allowed).map((l) => `allowed removal (deleted without replacement): ${l}`),
    ...added.filter(allowedAdd).map((l) => `allowed addition (file new on this branch): ${l}`),
  ]
  section(name, problems, notes)
}

for (const k of only) {
  if (!compare[k]) throw new Error(`unknown comparison ${k}`)
  compare[k]()
}
console.log(out.join('\n'))
console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: ok')
process.exitCode = failed ? 1 : 0

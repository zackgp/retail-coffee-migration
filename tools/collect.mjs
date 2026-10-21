#!/usr/bin/env node
// G6 (PLAN.md §3): collects normalized quality signals for the CoffeeScript migration.
// Runs INSIDE the sr_web container (needs yarn/PnP, Chromium); use baseline.sh / verify.sh.
//
//   node tools/collect.mjs --out <dir> [--only jest,karma,karma-static,eslint,tsc,webpack-dev,webpack-prod]
//   (<dir> relative to the work dir, default `current`)
//
// Writes (all line-number free, sorted, so they diff cleanly):
//   jest-failures.txt        failing tests / suites of `jest ./src`
//   karma.txt                karma run summary + failing specs
//   karma-specs.txt          static: every DEPRECATED_spec file, its `it` count and sha1
//   eslint.json              { "<severity>:<rule>": { "<file>": count } } of `eslint src`
//   tsc-errors.txt           `file (TSxxxx): message ×count` of `tsc --noEmit -p tsconfig.json`
//   webpack-modules-{dev,prod}.txt  `<entry|async>\t<module>` (src extensions normalized to .<ext>)
//   summary.json             counts, durations, exit codes
// Raw tool output goes to <dir>/raw/ (keep it out of git).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { MONOLITH, TOOLS_DIR, WORK_DIR } from './lib/paths.mjs'

const ALL = ['karma-static', 'tsc', 'eslint', 'jest', 'webpack-dev', 'webpack-prod', 'karma']

const args = process.argv.slice(2)
const opt = (n) => {
  const i = args.indexOf(n)
  return i >= 0 ? args[i + 1] : undefined
}
const OUT = path.resolve(WORK_DIR, opt('--out') || 'current')
const RAW = path.join(OUT, 'raw')
const only = opt('--only') ? opt('--only').split(',') : ALL
for (const k of only) if (!ALL.includes(k)) throw new Error(`unknown collector ${k}; known: ${ALL.join(',')}`)
fs.mkdirSync(RAW, { recursive: true })

const summaryFile = path.join(OUT, 'summary.json')
const summary = fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : {}
const JEST_CACHE = process.env.JEST_CACHE_DIR ? ['--cacheDirectory', process.env.JEST_CACHE_DIR] : []

function run(name, cmd, cmdArgs, env = {}) {
  const t0 = Date.now()
  process.stderr.write(`[collect] ${name}: ${cmd} ${cmdArgs.join(' ')}\n`)
  const r = spawnSync(cmd, cmdArgs, {
    cwd: MONOLITH,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 512,
  })
  const log = `${r.stdout || ''}\n----- stderr -----\n${r.stderr || ''}`
  fs.writeFileSync(path.join(RAW, `${name}.log`), log)
  const secs = Math.round((Date.now() - t0) / 1000)
  process.stderr.write(`[collect] ${name}: exit ${r.status} in ${secs}s\n`)
  return { status: r.status, log, secs }
}

const write = (file, text) => fs.writeFileSync(path.join(OUT, file), text.endsWith('\n') || !text ? text : `${text}\n`)
const relSrc = (p) => path.relative(MONOLITH, p).split(path.sep).join('/')
const firstLine = (s) => String(s || '').split('\n').map((l) => l.trim()).find(Boolean) || ''
// strip ANSI + absolute container paths from messages
const clean = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '').split(`${MONOLITH}/`).join('')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

// ------------------------------------------------------------------ collectors

const collectors = {
  'karma-static'() {
    // every file under DEPRECATED_spec: `path\t<it count>\t<sha1>`; G8 step 7 fails on new
    // files, more `it`s, or content changes that do not shrink a spec (= patching)
    const dir = path.join(MONOLITH, 'src/DEPRECATED_spec')
    const lines = walk(dir)
      .sort()
      .map((f) => {
        const src = fs.readFileSync(f)
        const its = /spec\.(js|coffee)$/.test(f) ? (src.toString('utf8').match(/(^|[^\w.])(it|fit|xit)\s*\(/g) || []).length : 0
        const sha = crypto.createHash('sha1').update(src).digest('hex').slice(0, 12)
        return `${relSrc(f)}\t${its}\t${sha}`
      })
    write('karma-specs.txt', lines.join('\n'))
    // test-selection config: changing it can silently drop tests (karma-entry filters, jest ignores)
    const configs = ['karma-entry.js', 'karma.conf.js', 'jest.config.js', 'jest.jasmine.config.js', 'tsconfig.test.json']
      .filter((f) => fs.existsSync(path.join(MONOLITH, f)))
      .map((f) => `${f}\t${crypto.createHash('sha1').update(fs.readFileSync(path.join(MONOLITH, f))).digest('hex').slice(0, 12)}`)
    write('test-config.txt', configs.join('\n'))
    const specs = lines.filter((l) => /spec\.(js|coffee)\t/.test(l))
    return { files: lines.length, specs: specs.length, its: lines.reduce((s, l) => s + Number(l.split('\t')[1]), 0) }
  },

  tsc() {
    const r = run('tsc', 'yarn', ['tsc', '--noEmit', '-p', 'tsconfig.json', '--pretty', 'false'])
    const counts = new Map()
    const re = /^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$/
    for (const line of r.log.split('\n')) {
      const m = line.match(re)
      if (!m) continue
      const key = `${clean(m[1])} (${m[2]}): ${clean(m[3])}`
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    const other = r.log.split('\n').filter((l) => /error TS\d+/.test(l) && !re.test(l)).map(clean)
    const lines = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => (n > 1 ? `${k} ×${n}` : k))
    write('tsc-errors.txt', [...lines, ...other.map((l) => `GLOBAL ${l}`)].join('\n'))
    return { exit: r.status, secs: r.secs, distinct: counts.size, errors: [...counts.values()].reduce((s, n) => s + n, 0) + other.length }
  },

  eslint() {
    const json = path.join(RAW, 'eslint.raw.json')
    // COLLECT_ESLINT_FILES=<file with one path per line> limits the run (verify.sh --quick)
    const listFile = process.env.COLLECT_ESLINT_FILES
    const targets = listFile
      ? fs.readFileSync(path.resolve(MONOLITH, listFile), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && fs.existsSync(path.join(MONOLITH, l)) && /\.(jsx?|tsx?)$/.test(l))
      : ['src']
    if (!targets.length) {
      write('eslint.json', '{}')
      return { exit: 0, secs: 0, errors: 0, warnings: 0, files: 0 }
    }
    const r = run('eslint', 'yarn', ['eslint', ...targets, '--format', 'json', '--output-file', json])
    const data = JSON.parse(fs.readFileSync(json, 'utf8'))
    const table = {}
    let errors = 0
    let warnings = 0
    for (const f of data) {
      for (const m of f.messages) {
        const sev = m.severity === 2 ? 'error' : 'warning'
        if (sev === 'error') errors += 1
        else warnings += 1
        const key = `${sev}:${m.ruleId || (m.fatal ? 'fatal' : 'unknown')}`
        const file = relSrc(f.filePath)
        table[key] ||= {}
        table[key][file] = (table[key][file] || 0) + 1
      }
    }
    const sorted = Object.fromEntries(
      Object.keys(table)
        .sort()
        .map((k) => [k, Object.fromEntries(Object.keys(table[k]).sort().map((f) => [f, table[k][f]]))]),
    )
    write('eslint.json', JSON.stringify(sorted, null, 1))
    return { exit: r.status, secs: r.secs, errors, warnings }
  },

  jest() {
    const json = path.join(RAW, 'jest.raw.json')
    // the sr_web container has ~8GB; jest's default (cores-1 workers) gets workers OOM-killed
    const workers = process.env.COLLECT_JEST_WORKERS || '4'
    const r = run('jest', 'yarn', ['jest', './src', '--ci', '--json', '--outputFile', json, `--maxWorkers=${workers}`, '--workerIdleMemoryLimit=1.5G', ...JEST_CACHE])
    const data = JSON.parse(fs.readFileSync(json, 'utf8'))
    const lines = []
    const passing = new Map()
    for (const s of data.testResults) {
      const file = relSrc(s.name)
      passing.set(file, s.assertionResults.filter((a) => a.status === 'passed').length)
      if (s.status === 'failed' && !s.assertionResults.some((a) => a.status === 'failed')) {
        lines.push(`SUITE ${file}: ${clean(firstLine(s.message)).slice(0, 200)}`)
      }
      for (const a of s.assertionResults) {
        if (a.status === 'failed') lines.push(`FAIL ${file} › ${[...a.ancestorTitles, a.title].join(' › ')}`)
      }
    }
    write('jest-failures.txt', lines.sort().join('\n'))
    write('jest-passing.txt', [...passing.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([f, n]) => `${f}\t${n}`).join('\n'))
    return {
      exit: r.status,
      secs: r.secs,
      suites: data.numTotalTestSuites,
      tests: data.numTotalTests,
      failedTests: data.numFailedTests,
      failedSuites: data.numFailedTestSuites,
    }
  },

  'webpack-dev'() {
    return webpack('dev', { NODE_ENV: 'development' })
  },

  'webpack-prod'() {
    return webpack('prod', { NODE_ENV: 'production' })
  },

  karma() {
    const junitDir = path.join(MONOLITH, 'reports/karma')
    const junit = path.join(junitDir, 'apps-karma-junit.xml')
    fs.rmSync(junit, { force: true })
    const chromeEnv = {}
    // On Apple Silicon the sr_web image is arm64 but puppeteer's cached Chrome is x86-64 and
    // cannot start; the image ships a native Debian chromium that karma.conf accepts via CHROME_BIN.
    if (!process.env.CHROME_BIN && fs.existsSync('/usr/bin/chromium')) chromeEnv.CHROME_BIN = '/usr/bin/chromium'
    const r = run('karma', 'yarn', ['exec', 'karma', 'start', '--single-run', '--browsers', 'ChromeHeadlessCustom', '--reporters', 'junit,dots'], {
      NODE_ENV: 'test',
      BABEL_ENV: 'karma',
      IS_CI_BUILD: 'true',
      NODE_OPTIONS: '--max_old_space_size=4096',
      ...chromeEnv,
    })
    if (!fs.existsSync(junit)) {
      write('karma.txt', `# karma did not produce ${relSrc(junit)} (exit ${r.status}); see raw/karma.log\nERROR karma run failed`)
      return { exit: r.status, secs: r.secs, error: 'no junit output' }
    }
    const xml = fs.readFileSync(junit, 'utf8')
    fs.copyFileSync(junit, path.join(RAW, 'karma-junit.xml'))
    const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    let total = 0
    let skipped = 0
    const failed = []
    for (const chunk of xml.split('<testcase').slice(1)) {
      // each chunk runs until the next <testcase; names may contain unescaped '>'
      total += 1
      const name = unescape((chunk.match(/\bname="([^"]*)"/) || [])[1] || '?')
      const cls = unescape((chunk.match(/\bclassname="([^"]*)"/) || [])[1] || '?')
      if (/<skipped/.test(chunk)) skipped += 1
      else if (/<failure|<error/.test(chunk)) failed.push(`FAIL ${cls.replace(/^\./, '')} › ${name}`)
    }
    const errorsInSuite = [...xml.matchAll(/<testsuite[^>]*errors="(\d+)"/g)].reduce((s, m) => s + Number(m[1]), 0)
    write('karma.txt', [`# total ${total}, failed ${failed.length}, skipped ${skipped}, suite errors ${errorsInSuite}`, ...failed.sort()].join('\n'))
    return { exit: r.status, secs: r.secs, total, passed: total - failed.length - skipped, failed: failed.length, skipped, suiteErrors: errorsInSuite }
  },
}

function normalizeModule(name) {
  let n = name.replace(/ \+ \d+ modules?$/, '').replace(/^.*!/, '')
  const nm = n.lastIndexOf('/node_modules/')
  if (nm >= 0) return `npm:${n.slice(nm + '/node_modules/'.length)}`
  n = n.replace(/^\.\//, '')
  // webpack names modules relative to `context: src`
  if (!n.startsWith('src/') && !n.startsWith('../')) n = `src/${n}`
  if (n.startsWith('src/')) n = n.replace(/\.(coffee|jsx?|tsx?)$/, '.<ext>')
  return n
}

function webpack(mode, env) {
  const json = path.join(RAW, `webpack-${mode}.raw.json`)
  const r = run(`webpack-${mode}`, 'yarn', ['node', path.join(TOOLS_DIR, 'webpack_stats.cjs'), json], {
    ...env,
    NODE_OPTIONS: '--max_old_space_size=6144',
  })
  if (!fs.existsSync(json)) {
    write(`webpack-modules-${mode}.txt`, `ERROR webpack ${mode} produced no stats (exit ${r.status}); see raw/webpack-${mode}.log`)
    return { exit: r.status, secs: r.secs, error: 'no stats' }
  }
  const stats = JSON.parse(fs.readFileSync(json, 'utf8'))
  const chunkModules = new Map() // chunk id -> Set(module)
  const addModule = (set, m) => {
    if (m.modules && m.modules.length) m.modules.forEach((x) => addModule(set, x))
    else if (m.name && !/^(webpack\/runtime|ignored )/.test(m.name)) set.add(normalizeModule(m.name))
  }
  for (const m of stats.modules || []) {
    for (const c of m.chunks || []) {
      if (!chunkModules.has(c)) chunkModules.set(c, new Set())
      addModule(chunkModules.get(c), m)
    }
  }
  const lines = new Set()
  const inEntry = new Set()
  for (const [entry, ep] of Object.entries(stats.entrypoints || {})) {
    for (const c of ep.chunks) {
      for (const mod of chunkModules.get(c) || []) {
        lines.add(`${entry}\t${mod}`)
        inEntry.add(mod)
      }
    }
  }
  for (const set of chunkModules.values()) for (const mod of set) if (!inEntry.has(mod)) lines.add(`async\t${mod}`)
  write(`webpack-modules-${mode}.txt`, [...lines].sort().join('\n'))
  const errors = (stats.errors || []).map((e) => clean(typeof e === 'string' ? e : e.message))
  fs.writeFileSync(path.join(RAW, `webpack-${mode}.errors.txt`), errors.join('\n\n'))
  return {
    exit: r.status,
    secs: r.secs,
    modules: inEntry.size,
    lines: lines.size,
    errors: errors.length,
    warnings: (stats.warnings || []).length,
    circular: errors.filter((e) => /Circular dependency/i.test(e)).length,
  }
}

for (const k of only) {
  try {
    summary[k] = collectors[k]()
  } catch (e) {
    summary[k] = { error: String(e && e.stack ? e.stack : e) }
    process.stderr.write(`[collect] ${k}: FAILED ${e && e.stack}\n`)
  }
  summary[k].collectedAt = new Date().toISOString()
  fs.writeFileSync(summaryFile, `${JSON.stringify(summary, null, 1)}\n`)
}
process.stderr.write(`[collect] done -> ${relSrc(OUT)}\n`)

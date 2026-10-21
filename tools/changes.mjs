#!/usr/bin/env node
// Lists what the current branch (+ working tree) of the TARGET checkout changed under its app dir
// (config.appDir) relative to the merge-base with the base ref (config.baseRef). Host only (needs
// git). Used by verify.sh.
//
//   node tools/changes.mjs --list <list> [--base <ref>]
//
//   changed      existing files under src/ that were added or modified
//   converted    changed .js/.jsx/.ts/.tsx (non-test) modules that were CoffeeScript at the
//                start of the migration (coffee_manifest.txt) and have no .coffee any more,
//                plus every NEW non-test code file (split/moved/index.js conversions)
//   deleted      deleted files under src/
//   removed-only deleted modules with no file of the same module key left (dead code)
//   added        files added on this branch (any extension)
//   related-src  changed code files (.coffee/.js/.jsx/.ts/.tsx) for jest --findRelatedTests
//   karma        changed/added/deleted files under src/DEPRECATED_spec
//   snapshot-problems  G4/G5 snapshot integrity. Snapshots live in this repo (<dataDir>/shapes),
//                not in the target PR, so instead of the PR diff they are checked by content:
//                every coffee module converted on this branch needs a snapshot whose
//                recordedFrom is the .coffee file and whose recordedSha (git blob sha written
//                by export_shapes.test.js) equals that .coffee at the merge base;
//                sagamore_registry.json with uncommitted changes in this repo needs
//                ALLOW_REGISTRY_CHANGE=1 (explain it in the PR / progress file)
//   tool-leaks   the target branch must not depend on this repo: files under the container
//                mount point (<appDir>/<toolsMount>/) or the old in-repo tool locations, and
//                changed files that reference coffee-tools/, jest_helpers/coffee_migration,
//                __tests__/coffee_migration or retail-coffee-migration
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { globKey } from './lib/batches.mjs'
import { APP_DIR, BASE_REF, CONTAINER, DATA_DIR, MONOLITH, REGISTRY_FILE, REPO_ROOT, SHAPES_DIR, TOOLS_ROOT, abs } from './lib/paths.mjs'

const gitOk = (cwd, ...a) => {
  try {
    return execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

const args = process.argv.slice(2)
const opt = (n) => {
  const i = args.indexOf(n)
  return i >= 0 ? args[i + 1] : undefined
}
const git = (...a) => execFileSync('git', ['-C', REPO_ROOT, ...a], { encoding: 'utf8' }).trim()

const baseRef = opt('--base') || BASE_REF
const base = git('merge-base', 'HEAD', baseRef)
const prefix = `${APP_DIR}/`
const toRel = (p) => p.slice(prefix.length)

const status = new Map() // rel -> 'A'|'M'|'D'
for (const line of git('diff', '--name-status', '--no-renames', base, '--', APP_DIR).split('\n').filter(Boolean)) {
  const [s, p] = line.split('\t')
  status.set(toRel(p), s[0])
}
for (const p of git('ls-files', '--others', '--exclude-standard', '--', APP_DIR).split('\n').filter(Boolean)) {
  status.set(toRel(p), 'A')
}

const manifest = new Set(
  fs
    .readFileSync(path.join(DATA_DIR, 'coffee_manifest.txt'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#')),
)
const inSrc = [...status.keys()].filter((f) => f.startsWith('src/')).sort()
const exists = (f) => fs.existsSync(abs(f))
const isTest = (f) => /\/__tests__\/|\/__mocks__\/|\.(test|spec)\.[jt]sx?$/.test(f) || f.startsWith('src/jest_helpers/') || f.startsWith('src/DEPRECATED_spec/')
const CODE = /\.(coffee|jsx?|tsx?)$/
const JSLIKE = (f) => /\.(jsx?|tsx?)$/.test(f) && !f.endsWith('.d.ts')


const srcKeysNow = new Set()
const walkKeys = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkKeys(p)
    else if (CODE.test(e.name)) srcKeysNow.add(globKey(path.relative(MONOLITH, p)))
  }
}
walkKeys(path.join(MONOLITH, 'src'))

const converted = inSrc.filter(
  (f) =>
    exists(f) &&
    JSLIKE(f) &&
    !isTest(f) &&
    ((manifest.has(globKey(f)) && !exists(`src/${globKey(f)}.coffee`)) || status.get(f) === 'A'),
)

const toolsRel = (p) => path.relative(TOOLS_ROOT, p)

function snapshotProblems() {
  const problems = []
  // every coffee module converted on this branch needs a snapshot recorded from that exact coffee
  // source (deletions without a replacement module are dead code and need none)
  for (const f of inSrc.filter((x) => x.endsWith('.coffee') && (status.get(x) === 'D' || !exists(x)))) {
    const key = globKey(f)
    if (!srcKeysNow.has(key)) continue
    const file = path.join(SHAPES_DIR, `${key.replace(/\//g, '__')}.json`)
    if (!fs.existsSync(file)) {
      problems.push(`src/${key}: converted from .coffee but has no ${toolsRel(file)} (run tools/record_shapes.sh before converting)`)
      continue
    }
    let snap
    try {
      snap = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (e) {
      problems.push(`${toolsRel(file)}: unreadable (${e.message})`)
      continue
    }
    if (!snap.recordedFrom || !String(snap.recordedFrom).endsWith('.coffee')) {
      problems.push(`${toolsRel(file)}: recordedFrom ${snap.recordedFrom} is not a .coffee file (re-recorded after conversion?)`)
    }
    const baseSha = gitOk(REPO_ROOT, 'rev-parse', `${base}:${APP_DIR}/src/${key}.coffee`)
    if (!baseSha) {
      problems.push(`src/${key}: was not .coffee at the merge base — shapes must be recorded from the coffee source before conversion`)
    } else if (snap.recordedSha !== baseSha) {
      problems.push(
        `${toolsRel(file)}: recordedSha ${snap.recordedSha || '(missing)'} != merge-base blob ${baseSha} of src/${key}.coffee ` +
          '(recorded from a different coffee revision, or from an older snapshot format — re-record from the base coffee)',
      )
    }
  }
  // registry snapshot lives in this repo: uncommitted changes need an explicit ack
  const regStatus = gitOk(TOOLS_ROOT, 'status', '--porcelain', '--', REGISTRY_FILE)
  if (regStatus === null) {
    console.error(`note: ${TOOLS_ROOT} is not a git repo; registry change check skipped`)
  } else if (regStatus && process.env.ALLOW_REGISTRY_CHANGE !== '1') {
    problems.push(
      `${toolsRel(REGISTRY_FILE)} has uncommitted changes — allowed only with an explanation in the PR / progress file ` +
        '(P9 or a documented deletion); after reviewing the diff re-run with ALLOW_REGISTRY_CHANGE=1',
    )
  }
  return problems
}

const LEAK_REF = /coffee-tools\/|jest_helpers\/coffee_migration|__tests__\/coffee_migration|retail-coffee-migration/

function toolLeaks() {
  const leaks = []
  for (const [f, s] of status.entries()) {
    if (f.startsWith(`${CONTAINER.toolsMount}/`) || f.startsWith('migration/coffee/')) {
      leaks.push(`${f}: tool files must not live in the target repo`)
      continue
    }
    if (s === 'D' || !exists(f)) continue
    let text
    try {
      text = fs.readFileSync(abs(f), 'utf8')
    } catch {
      continue
    }
    if (text.includes('\0')) continue
    const m = LEAK_REF.exec(text)
    if (m) leaks.push(`${f}: references "${m[0]}" (committed code/tests must be self-contained)`)
  }
  return leaks.sort()
}

const lists = {
  changed: inSrc.filter((f) => status.get(f) !== 'D' && exists(f)),
  deleted: inSrc.filter((f) => status.get(f) === 'D' || !exists(f)),
  'removed-only': inSrc.filter((f) => (status.get(f) === 'D' || !exists(f)) && CODE.test(f) && !srcKeysNow.has(globKey(f))),
  added: inSrc.filter((f) => status.get(f) === 'A' && exists(f)),
  converted,
  'related-src': inSrc.filter((f) => exists(f) && CODE.test(f) && !f.endsWith('.d.ts') && !f.startsWith('src/DEPRECATED_spec/')),
  karma: inSrc.filter((f) => f.startsWith('src/DEPRECATED_spec/')),
  'snapshot-problems': snapshotProblems(),
  'tool-leaks': toolLeaks(),
}

const which = opt('--list')
if (!which) {
  console.log(`base ${base.slice(0, 10)} (${baseRef}); ${inSrc.length} src files changed`)
  for (const [k, v] of Object.entries(lists)) console.log(`${k}: ${v.length}`)
} else if (!lists[which]) {
  console.error(`--list expects one of ${Object.keys(lists).join('|')}`)
  process.exitCode = 2
} else {
  for (const f of lists[which]) console.log(f)
}

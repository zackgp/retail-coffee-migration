#!/usr/bin/env node
// G3 (PLAN.md §3): static interop checker for the CoffeeScript -> JS migration.
//
//   node tools/check_interop.mjs                        whole src/
//   node tools/check_interop.mjs --files <paths...>     only edges touching these modules
//        [--json]    machine-readable output
//        [--quiet]   print errors and the summary only
//
// Run on the host from anywhere (after tools/setup_host.sh) or in sr_web with `yarn node`.
// --files paths may be relative to the cwd, to apps/monolith (`src/...`) or to the repo root
// (`apps/monolith/src/...`); they are matched by module key (path without extension), so a
// deleted `x.coffee` and the new `x.js` select the same module. A directory selects every file
// below it.
//
// Exit code: 1 if any non-allowlisted error, else 0. Warnings never fail.
// Rules and the allowlist (interop_allowlist.json, `rule|from|to` -> reason): see lib/interop.mjs.
import { globKey } from './lib/batches.mjs'
import { buildGraph } from './lib/graph.mjs'
import { checkInterop, formatFinding, readAllowlist } from './lib/interop.mjs'
import { normalizeInput } from './lib/paths.mjs'

const args = process.argv.slice(2)
const json = args.includes('--json')
const quiet = args.includes('--quiet')
let files = null
const fi = args.indexOf('--files')
if (fi >= 0) {
  files = []
  for (const a of args.slice(fi + 1)) {
    if (a.startsWith('--')) break
    files.push(normalizeInput(a))
  }
}
const unknown = args.filter((a) => a.startsWith('--') && !['--files', '--json', '--quiet'].includes(a))
if (unknown.length) {
  console.error(`unknown option(s): ${unknown.join(' ')}\nusage: check_interop.mjs [--files <paths...>] [--json] [--quiet]`)
  process.exit(2)
}

const graph = buildGraph()

let selected = null
if (files) {
  selected = new Set()
  for (const f of files) {
    const dir = `${f.replace(/\/$/, '')}/`
    const below = graph.files.filter((x) => x.startsWith(dir))
    if (below.length) for (const x of below) selected.add(x)
    else selected.add(f) // a file, possibly already deleted
  }
  if (!selected.size) {
    console.error('--files: no paths given')
    process.exit(2)
  }
}

const { findings, stale } = checkInterop(graph, { files: selected, allowlist: readAllowlist() })
for (const k of stale) {
  const [rule, from, to] = k.split('|')
  findings.push({ severity: 'warning', rule: 'allowlist-stale', from: '<dataDir>/interop_allowlist.json', line: null, to: null, message: `entry '${k}' no longer matches a finding (${rule} ${from} -> ${to}); remove it`, karma: false, key: k })
}

const active = findings.filter((f) => !f.allowed)
const errors = active.filter((f) => f.severity === 'error').length
const warnings = active.filter((f) => f.severity === 'warning').length
const allowed = findings.length - active.length

if (json) {
  const byRule = {}
  for (const f of active) byRule[f.rule] = (byRule[f.rule] || 0) + 1
  console.log(JSON.stringify({ files: selected && [...new Set([...selected].map(globKey))], errors, warnings, allowed, byRule, findings }, null, 2))
} else {
  for (const f of findings) {
    if (quiet && (f.allowed || f.severity !== 'error')) continue
    console.log(formatFinding(f))
  }
  console.log(`${errors} errors, ${warnings} warnings${allowed ? ` (${allowed} allowlisted)` : ''}`)
}
process.exitCode = errors ? 1 : 0

#!/usr/bin/env node
// Prints the CoffeeScript 1.12.7 compilation of a .coffee file to stdout, as a
// reference for hand translation (PLAN.md G1/G7b). Output is never written to
// disk and must not be committed.
//
// Usage:
//   node tools/coffee_compile.mjs <file.coffee> [--range a:b]
//
//   --range a:b  Only print generated lines that map to coffee lines a..b
//                (1-based, inclusive). Each contiguous chunk is preceded by a
//                `// coffee L<x>[-L<y>]` comment (the coffee lines it maps to);
//                gaps between chunks are shown as `// ...`. `--range a` means a:a.
//
// Paths may be relative to the cwd, to the repo root (`apps/monolith/src/...`),
// or absolute.
import fs from 'node:fs'
import { loadCoffee } from './lib/deps.mjs'
import { abs, normalizeInput } from './lib/paths.mjs'

function usage(msg) {
  if (msg) console.error(`error: ${msg}`)
  console.error('usage: coffee_compile.mjs <file.coffee> [--range a:b]')
  process.exit(msg ? 2 : 0)
}

function parseArgs(argv) {
  let file
  let range
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') usage()
    else if (arg === '--range' || arg.startsWith('--range=')) {
      const value = arg === '--range' ? argv[(i += 1)] : arg.slice('--range='.length)
      const m = /^(\d+)(?::(\d+))?$/.exec(value ?? '')
      if (!m) usage(`invalid --range "${value ?? ''}", expected a:b`)
      range = [Number(m[1]), Number(m[2] ?? m[1])]
      if (range[0] < 1 || range[1] < range[0]) usage(`invalid --range "${value}"`)
    } else if (arg.startsWith('-')) usage(`unknown option ${arg}`)
    else if (file) usage('only one file may be given')
    else file = arg
  }
  if (!file) usage('missing <file.coffee>')
  return { file, range }
}

function compile(coffee, src, relPath, options) {
  try {
    return coffee.compile(src, { bare: true, ...options })
  } catch (e) {
    if (e.location && coffee.helpers?.updateSyntaxError) {
      coffee.helpers.updateSyntaxError(e, src, relPath)
    }
    console.error(String(e))
    process.exit(1)
  }
}

// Returns the (0-based) coffee source lines each generated line maps to.
function sourceLinesByGeneratedLine(map, count) {
  const result = []
  for (let line = 0; line < count; line += 1) {
    const lineMap = map.lines[line]
    const sources = new Set()
    for (const mapping of lineMap ? lineMap.columns : []) {
      if (mapping) sources.add(mapping.sourceLine)
    }
    result.push(sources)
  }
  return result
}

function printRange(js, map, [from, to]) {
  const lines = js.replace(/\n$/, '').split('\n')
  const sources = sourceLinesByGeneratedLine(map, lines.length)
  const inRange = (s) => s >= from - 1 && s <= to - 1
  const selected = sources.map((set) => [...set].some(inRange))

  // Unmapped generated lines (blank lines, some `}` / `});`) belong to the chunk
  // around them when both neighbours are selected.
  for (let i = 0; i < lines.length; i += 1) {
    if (selected[i] || sources[i].size > 0) continue
    let j = i
    while (j < lines.length && !selected[j] && sources[j].size === 0) j += 1
    if (i > 0 && selected[i - 1] && j < lines.length && selected[j]) {
      for (let k = i; k < j; k += 1) selected[k] = true
    }
    i = j - 1
  }

  const out = []
  let i = 0
  while (i < lines.length) {
    if (!selected[i]) {
      i += 1
      continue
    }
    let j = i
    const covered = []
    while (j < lines.length && selected[j]) {
      for (const s of sources[j]) if (inRange(s)) covered.push(s + 1)
      j += 1
    }
    if (out.length > 0 || i > 0) out.push('// ...')
    const lo = Math.min(...covered)
    const hi = Math.max(...covered)
    out.push(lo === hi ? `// coffee L${lo}` : `// coffee L${lo}-L${hi}`)
    out.push(...lines.slice(i, j))
    i = j
  }
  if (out.length === 0) {
    console.error(`no generated code maps to coffee lines ${from}:${to}`)
    process.exit(1)
  }
  if (!selected[lines.length - 1]) out.push('// ...')
  process.stdout.write(`${out.join('\n')}\n`)
}

const { file, range } = parseArgs(process.argv.slice(2))
const relPath = normalizeInput(file)
let src
try {
  src = fs.readFileSync(abs(relPath), 'utf8')
} catch (e) {
  console.error(`error: cannot read ${relPath}: ${e.code || e.message}`)
  process.exit(1)
}
const coffee = loadCoffee()

if (!range) {
  process.stdout.write(compile(coffee, src, relPath, {}))
} else {
  const { js, sourceMap } = compile(coffee, src, relPath, { sourceMap: true, filename: relPath })
  printRange(js, sourceMap, range)
}

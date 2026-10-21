#!/usr/bin/env node
// G7b (PLAN.md §3): CoffeeScript semantic hotspot checklist.
//
//   node tools/coffee_hotspots.mjs <files.coffee|dirs…>   ad-hoc list (default out: .work/hotspots/adhoc.md)
//   node tools/coffee_hotspots.mjs --batch B05            .coffee files still in batch B05 (out: .work/hotspots/B05.md)
//        [--out <path>]      write the checklist elsewhere
//        [--fresh]           do not carry over conclusions from an existing output file
//   node tools/coffee_hotspots.mjs --check <md>           verify every item has a conclusion (verify.sh step 4b)
//
// Parses the pre-conversion .coffee with the repo-pinned coffeescript 1.12.7 `nodes()` AST
// (lib/hotspots.mjs) and lists every hotspot of PLAN.md G7b / §6 with `file:line`. Prints the
// per-category counts on stdout. Paths are relative to apps/monolith (`src/...`). Runs on the
// host (after setup_host.sh) or in the sr_web container (`yarn node`).
//
// ---------------------------------------------------------------- checklist format
//
//   ## [<category>] <title>（<n>，⚠ <m>）
//   > <hint from PLAN §6>
//   批量结论：<optional, covers the non-⚠ items of this category>
//   - [<category>] src/x.coffee:12 — <description, code in `backticks`> — 结论：<conclusion>
//   …
//   <!-- coffee_hotspots:items=<N> sha1=<hash of all item texts before " — 结论："> -->
//
// - One item per line. Only the text after "结论：" may be edited; everything before it is the
//   item key. Items whose description contains ⚠ are high risk (implicit return of false /
//   assignment / loop / if, soak call/index, bare super, bound methods, class-body statements,
//   module-level @, loop closures, heregex, React if-without-else / unbound @method callbacks…).
// - Re-generating into an existing file keeps conclusions of items whose key is unchanged and the
//   per-category 批量结论 (use --fresh to start over). Items whose line moved must be re-filled.
//
// --check <md> fails (exit 1) and lists the offending items when:
//   1. an item has no conclusion — empty, or only TODO / TBD / 待定 / 待填 / 待确认 / ? / - / … —
//      unless the item has no ⚠, its conclusion is completely EMPTY, and its category has a
//      filled 批量结论 line (an explicit TODO etc. on an item is never covered by 批量结论);
//   2. the trailing hash comment is missing, or items were added / removed / edited (the hash
//      covers the sorted item keys);
//   3. a line starting with "- [" cannot be parsed, has an unknown category, sits in another
//      category's section, or lacks " — 结论：".
// Exit 0 when everything is concluded (an empty checklist also passes).
import fs from 'node:fs'
import path from 'node:path'
import { findBatch, loadBatches, matchesBatch } from './lib/batches.mjs'
import { isVendor, listSrcFiles } from './lib/files.mjs'
import {
  CATEGORIES,
  analyzeCoffee,
  checkMarkdown,
  countByCategory,
  itemKey,
  parseMarkdown,
  renderMarkdown,
  sortItems,
} from './lib/hotspots.mjs'
import { WORK_DIR, abs, normalizeInput, rel } from './lib/paths.mjs'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n) => {
  const i = args.indexOf(n)
  if (i < 0) return undefined
  const v = args[i + 1]
  if (!v || v.startsWith('--')) die(`${n} needs a value`)
  return v
}

function die(msg) {
  console.error(`coffee_hotspots: ${msg}`)
  process.exit(2)
}

function usage() {
  const head = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1)
  const end = head.findIndex((l) => !l.startsWith('//'))
  console.log(head.slice(0, end).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
}

function runCheck(mdPath) {
  const p = path.resolve(mdPath)
  if (!fs.existsSync(p)) die(`no such file: ${mdPath}`)
  const r = checkMarkdown(fs.readFileSync(p, 'utf8'))
  for (const e of r.problems) console.log(`ERROR ${e}`)
  for (const it of r.missing) console.log(`MISSING ${rel(p)}:${it.mdLine}  ${it.key}`)
  console.log(
    `${r.ok ? 'OK' : 'FAIL'} ${rel(p)}: ${r.total} items, ${r.total - r.missing.length} concluded` +
      ` (${r.viaBulk} via 批量结论), ${r.missing.length} missing, ${r.problems.length} format errors`,
  )
  process.exit(r.ok ? 0 : 1)
}

function walkCoffee(dirRel, out) {
  for (const ent of fs.readdirSync(abs(dirRel), { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue
    const p = `${dirRel}/${ent.name}`
    if (ent.isDirectory()) walkCoffee(p, out)
    else if (p.endsWith('.coffee') && !isVendor(p)) out.add(p)
  }
}

function collectFiles() {
  const files = new Set()
  let batch = null
  const batchId = opt('--batch')
  if (batchId) {
    try {
      batch = findBatch(loadBatches(), batchId)
    } catch (e) {
      die(e.message)
    }
    for (const f of listSrcFiles()) if (f.endsWith('.coffee') && !isVendor(f) && matchesBatch(batch, f)) files.add(f)
  }
  const valued = new Set(['--batch', '--out', '--check'])
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (valued.has(a)) {
      i += 1
      continue
    }
    if (a.startsWith('--')) continue
    const f = normalizeInput(a)
    const p = abs(f)
    if (!fs.existsSync(p)) die(`no such file: ${a}`)
    if (fs.statSync(p).isDirectory()) walkCoffee(f, files)
    else if (!f.endsWith('.coffee')) die(`not a .coffee file: ${a}`)
    else files.add(f)
  }
  return { batch, files: [...files].sort() }
}

function main() {
  if (flag('--help') || flag('-h')) return usage()
  const known = new Set(['--batch', '--out', '--check', '--fresh', '--help', '-h'])
  for (const a of args) if (a.startsWith('-') && !known.has(a)) die(`unknown option ${a}`)
  const check = opt('--check')
  if (check) return runCheck(check)

  const { batch, files } = collectFiles()
  if (!files.length) {
    if (batch) {
      console.log(`${batch.id}: no .coffee files left; nothing to do.`)
      return
    }
    usage()
    process.exit(2)
  }

  const t0 = process.hrtime.bigint()
  const items = []
  for (const f of files) items.push(...analyzeCoffee(f, fs.readFileSync(abs(f), 'utf8')))
  sortItems(items)
  const ms = Number(process.hrtime.bigint() - t0) / 1e6

  const title = batch ? batch.id : 'adhoc'
  const outPath = opt('--out') ? path.resolve(opt('--out')) : path.join(WORK_DIR, 'hotspots', `${title}.md`)
  let prev = null
  if (!flag('--fresh') && fs.existsSync(outPath)) prev = parseMarkdown(fs.readFileSync(outPath, 'utf8'))
  const command = `node tools/coffee_hotspots.mjs ${batch ? `--batch ${batch.id}` : files.length > 8 ? `<${files.length} files>` : files.join(' ')}`
  const md = renderMarkdown({ title, command, files, items, prev })
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, md)

  const counts = countByCategory(items)
  const w = Math.max(...CATEGORIES.map((c) => c.id.length))
  console.log(`${title}: ${files.length} files, ${items.length} hotspots (⚠ ${items.filter((i) => i.warn).length}) in ${ms.toFixed(0)} ms`)
  for (const c of CATEGORIES) {
    const n = counts.get(c.id)
    if (c.id === 'parse-error' && !n.total) continue
    console.log(`  ${c.id.padEnd(w)}  ${String(n.total).padStart(5)}  ⚠ ${String(n.warn).padStart(4)}  ${c.title}`)
  }
  if (prev) {
    const kept = [...prev.conclusions.values()].filter((v) => v).length
    const keys = new Set(items.map(itemKey))
    const lost = prev.items.filter((i) => i.conclusion && !keys.has(i.key))
    console.log(`  carried over conclusions from the existing file: ${kept - lost.length} kept, ${lost.length} dropped (item changed)`)
    for (const i of lost) console.log(`    dropped: ${i.key} — 结论：${i.conclusion}`)
  }
  console.log(`wrote ${rel(outPath)}`)
  if (counts.get('parse-error').total) process.exitCode = 1
}

main()

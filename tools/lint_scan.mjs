#!/usr/bin/env node
// G7 (PLAN.md §3) static part: residue scan of newly converted JS files.
//
//   node tools/lint_scan.mjs <files…> [--report <out.md>]
//
// FAILS (exit 1) on:
//   - mechanical-conversion residue: __guard__/__guardMethod__/__range__/__extends/__bind/
//     __indexOf/__slice/__hasProp, decaffeinate, bulk-decaffeinate
//   - copied CoffeeScript 1.12.7 compiler output: __super__, hasProp.call, superClass,
//     slice.call(arguments, refN / _this temporaries, results.push accumulators
//   - React.DOM / createFactory
//   - any ES class that extends something other than React.Component/PureComponent/Error
//     (Backbone hierarchy must use .extend, PLAN.md §6.2), checked on the AST so aliases,
//     parentheses, multi-line and anonymous classes are covered
//   - eslint directives: whole-file `/* eslint-disable */`, inline rule config `/* eslint x: 0 */`,
//     and -line/-next-line disables without a reason (`-- <at least 10 chars>`) or TODO(coffee-deglob)
//   - == / != other than `== null` / `!= null`
// LISTS (for the Reviewer, not failures): default parameters and `cond && <jsx>` renders.
import fs from 'node:fs'
import path from 'node:path'
import { loadTs } from './lib/deps.mjs'
import { abs, normalizeInput } from './lib/paths.mjs'

const args = process.argv.slice(2)
const reportIdx = args.indexOf('--report')
const report = reportIdx >= 0 ? args[reportIdx + 1] : null
const files = args.filter((a, i) => !(reportIdx >= 0 && (i === reportIdx || i === reportIdx + 1))).map(normalizeInput)

const LINE_RULES = [
  { id: 'conversion-residue', re: /\b(__guard__|__guardMethod__|__range__|__extends|__bind|__indexOf|__slice|__hasProp)\b|bulk-decaffeinate|decaffeinate/ },
  {
    id: 'compiled-coffee-output',
    re: /\b__super__\b|\bhasProp\.call\b|\bsuperClass\b|\bslice\.call\(\s*arguments|\bref\d+\b|\b_this\b|\bresults\d*\.push\(/,
  },
  { id: 'react-dom-factory', re: /\bReact\.DOM\b|\bcreateFactory\b/ },
]
// ES classes may only extend these (anything else is treated as a Backbone-style hierarchy)
const ALLOWED_CLASS_BASES = /^(React\.)?(Component|PureComponent)$|^(Error|TypeError|RangeError)$/

const ts = loadTs()
const errors = []
const listDefaults = []
const listAndJsx = []

for (const file of files) {
  if (!fs.existsSync(abs(file))) {
    errors.push(`${file}: file not found`)
    continue
  }
  const src = fs.readFileSync(abs(file), 'utf8')
  src.split('\n').forEach((line, i) => {
    LINE_RULES.forEach((r) => {
      if (r.re.test(line)) errors.push(`${file}:${i + 1} [${r.id}] ${line.trim()}`)
    })
  })
  const kind = /\.tsx?$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind)
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1
  const text = (n) => n.getText(sf).replace(/\s+/g, ' ').slice(0, 100)

  // comments: only real eslint directives count
  const seen = new Set()
  const scanComments = (pos) => {
    for (const ranges of [ts.getLeadingCommentRanges(src, pos), ts.getTrailingCommentRanges(src, pos)]) {
      for (const c of ranges || []) {
        if (seen.has(c.pos)) continue
        seen.add(c.pos)
        const raw = src.slice(c.pos, c.end)
        const body = raw.replace(/^\/\*|\*\/$|^\/\//g, '').trim()
        const at = `${file}:${lineOf(c.pos)}`
        const directive = body.match(/^(eslint-disable(?:-next-line|-line)?|eslint-enable|eslint|global|globals)(\s|$)/)
        if (!directive) continue
        const reason = (body.match(/\s--\s*(.*)$/s) || [])[1] || ''
        if (directive[1] === 'eslint') errors.push(`${at} [eslint-inline-config] ${raw.trim().slice(0, 100)}`)
        else if (directive[1] === 'eslint-disable' && !/TODO\(coffee-deglob\)/.test(body)) {
          errors.push(`${at} [eslint-disable-block] whole-file/block eslint-disable is not allowed: ${raw.trim().slice(0, 100)}`)
        } else if (/^eslint-disable-(next-)?line$/.test(directive[1]) && !/TODO\(coffee-deglob\)/.test(body) && reason.trim().length < 10) {
          errors.push(`${at} [eslint-disable-without-reason] ${raw.trim().slice(0, 100)}`)
        }
      }
    }
  }

  const walk = (node) => {
    scanComments(node.getFullStart())
    if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.heritageClauses) {
      for (const h of node.heritageClauses) {
        if (h.token !== ts.SyntaxKind.ExtendsKeyword) continue
        let base = h.types[0] && h.types[0].expression
        while (base && ts.isParenthesizedExpression(base)) base = base.expression
        const baseText = base ? base.getText(sf).replace(/\s+/g, '') : '?'
        if (!ALLOWED_CLASS_BASES.test(baseText)) {
          errors.push(`${file}:${lineOf(node.getStart(sf))} [backbone-es-class] class ${node.name ? node.name.text : '(anonymous)'} extends ${baseText} — use Base.extend({...}) (PLAN.md §6.2)`)
        }
      }
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      if (op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken) {
        const isNull = (e) => e.kind === ts.SyntaxKind.NullKeyword
        if (!isNull(node.left) && !isNull(node.right)) errors.push(`${file}:${lineOf(node.getStart(sf))} [loose-equality] ${text(node)}`)
      }
      if (op === ts.SyntaxKind.AmpersandAmpersandToken && node.parent && ts.isJsxExpression(node.parent)) {
        listAndJsx.push(`${file}:${lineOf(node.getStart(sf))} ${text(node)}`)
      }
    }
    if (ts.isParameter(node) && node.initializer) {
      listDefaults.push(`${file}:${lineOf(node.getStart(sf))} ${text(node)}`)
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  scanComments(sf.getEnd())
}

const lines = []
lines.push(`# G7 scan (${files.length} files)`)
lines.push('')
lines.push(`## Failures (${errors.length})`)
errors.forEach((e) => lines.push(`- ${e}`))
lines.push('')
lines.push(`## Default parameters — Reviewer: CoffeeScript defaults also apply to null; JS only to undefined (${listDefaults.length})`)
listDefaults.forEach((e) => lines.push(`- ${e} — 结论：`))
lines.push('')
lines.push(`## \`cond && <jsx>\` renders — Reviewer: 0 / '' / NaN render as text; coffee \`if\` without else rendered nothing (${listAndJsx.length})`)
listAndJsx.forEach((e) => lines.push(`- ${e} — 结论：`))
const out = `${lines.join('\n')}\n`
if (report) fs.writeFileSync(path.resolve(report), out)
process.stdout.write(out)
process.exitCode = errors.length ? 1 : 0

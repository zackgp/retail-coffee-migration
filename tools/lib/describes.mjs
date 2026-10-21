// Locates the jasmine/jest `describe` / `it` blocks enclosing given lines of a spec file.
import fs from 'node:fs'
import { loadTs } from './deps.mjs'
import { abs } from './paths.mjs'

const DESCRIBE = new Set(['describe', 'fdescribe', 'xdescribe', 'context'])
const IT = new Set(['it', 'fit', 'xit', 'test'])

function titleOf(ts, arg) {
  if (!arg) return '?'
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text
  return arg.getText().slice(0, 60)
}

/** Returns every describe/it block of a JS/TS spec: { kind, title, path: string[], start, end } (1-based lines). */
export function specBlocks(relFile) {
  const ts = loadTs()
  const src = fs.readFileSync(abs(relFile), 'utf8')
  const kind = /\.tsx?$/.test(relFile) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX
  const sf = ts.createSourceFile(relFile, src, ts.ScriptTarget.Latest, true, kind)
  const line = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1
  const blocks = []
  const walk = (node, stack) => {
    let next = stack
    if (ts.isCallExpression(node)) {
      let callee = node.expression
      // describe.only / describe.each(...)(...) / it.skip
      while (ts.isPropertyAccessExpression(callee) || ts.isCallExpression(callee)) {
        callee = ts.isCallExpression(callee) ? callee.expression : callee.expression
      }
      if (ts.isIdentifier(callee) && (DESCRIBE.has(callee.text) || IT.has(callee.text))) {
        const title = titleOf(ts, node.arguments[0])
        const b = {
          kind: DESCRIBE.has(callee.text) ? 'describe' : 'it',
          title,
          path: [...stack, title],
          start: line(node.getStart(sf)),
          end: line(node.getEnd()),
        }
        blocks.push(b)
        next = b.path
      }
    }
    ts.forEachChild(node, (c) => walk(c, next))
  }
  walk(sf, [])
  return blocks
}

/**
 * For each line, the innermost enclosing describe path. Lines outside any describe
 * (e.g. top-level imports) are reported as file-level.
 * @returns {{ describes: string[], fileLevel: boolean, its: number }}
 */
export function describesForLines(relFile, lines) {
  let blocks
  try {
    blocks = specBlocks(relFile)
  } catch {
    return { describes: [], fileLevel: true, its: 0 }
  }
  const describes = blocks.filter((b) => b.kind === 'describe')
  const its = blocks.filter((b) => b.kind === 'it').length
  const hit = new Set()
  let fileLevel = false
  for (const l of lines) {
    let best = null
    for (const d of describes) if (d.start <= l && l <= d.end && (!best || d.path.length > best.path.length)) best = d
    if (best) hit.add(best.path.join(' > '))
    else fileLevel = true
  }
  return { describes: [...hit].sort(), fileLevel, its }
}

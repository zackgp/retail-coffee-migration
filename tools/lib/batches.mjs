// batches.json loading and glob matching (PLAN.md §5).
// Globs are relative to src/ and extensionless; `*` stays within a path segment,
// `**` spans any depth, `{a,b}` is alternation.
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './paths.mjs'

export const BATCHES_FILE = path.join(DATA_DIR, 'batches.json')

export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 1
        if (glob[i + 1] === '/') {
          i += 1
          re += '(?:.*/)?'
        } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{') {
      const end = glob.indexOf('}', i)
      if (end < 0) throw new Error(`unbalanced { in glob ${glob}`)
      re += `(?:${glob
        .slice(i + 1, end)
        .split(',')
        .map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
        .join('|')})`
      i = end
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

/** `src/sagamore/lib/util.coffee` -> `sagamore/lib/util` */
export function globKey(file) {
  return file.replace(/^src\//, '').replace(/\.(coffee|jsx?|tsx?|mjs|cjs)$/, '')
}

export function loadBatches() {
  const raw = JSON.parse(fs.readFileSync(BATCHES_FILE, 'utf8'))
  return raw.batches.map((b) => ({
    ...b,
    include: b.include || [],
    exclude: b.exclude || [],
    candidates: b.candidates || {},
    includeRe: (b.include || []).map(globToRegExp),
    excludeRe: (b.exclude || []).map(globToRegExp),
    candidateRe: Object.keys(b.candidates || {}).map(globToRegExp),
  }))
}

/** src/-relative extensionless module keys allowed to exist as both .coffee and .js (pre-existing on staging). */
export function knownDuplicates() {
  const raw = JSON.parse(fs.readFileSync(BATCHES_FILE, 'utf8'))
  return new Set(Object.keys(raw.knownDuplicates || {}).filter((k) => !k.startsWith('$')))
}

export function matchesBatch(batch, file) {
  const k = globKey(file)
  return batch.includeRe.some((r) => r.test(k)) && !batch.excludeRe.some((r) => r.test(k))
}

export function isCandidateOf(batch, file) {
  const k = globKey(file)
  return batch.candidateRe.some((r) => r.test(k))
}

export function findBatch(batches, id) {
  const b = batches.find((x) => x.id.toLowerCase() === String(id).toLowerCase())
  if (!b) throw new Error(`unknown batch ${id}; known: ${batches.map((x) => x.id).join(', ')}`)
  return b
}

/** Map coffee file -> [batch ids]; files with 0 or >1 batches are errors. */
export function assignBatches(batches, coffeeFiles) {
  const byFile = new Map()
  for (const f of coffeeFiles) byFile.set(f, batches.filter((b) => matchesBatch(b, f)).map((b) => b.id))
  const unassigned = coffeeFiles.filter((f) => byFile.get(f).length === 0)
  const multiple = coffeeFiles.filter((f) => byFile.get(f).length > 1).map((f) => [f, byFile.get(f)])
  return { byFile, unassigned, multiple }
}

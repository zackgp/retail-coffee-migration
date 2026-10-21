// Module resolution that mirrors apps/monolith/webpack.config.js.
// The alias table and extension order are read from webpack.config.js itself, so the
// tools follow the build when the config changes (e.g. when an entry alias moves from
// `.coffee` to `.js`).
import fs from 'node:fs'
import path from 'node:path'
import { MONOLITH, rel } from './paths.mjs'

function readWebpackResolveConfig() {
  const text = fs.readFileSync(path.join(MONOLITH, 'webpack.config.js'), 'utf8')
  const aliasBlock = text.match(/alias:\s*\{([\s\S]*?)\n\s*\},/)
  if (!aliasBlock) throw new Error('Cannot find resolve.alias in webpack.config.js')
  const exact = {}
  const prefix = {}
  for (const m of aliasBlock[1].matchAll(/['"]?([\w@/.-]+?)(\$?)['"]?\s*:\s*absPath\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const target = rel(path.join(MONOLITH, m[3]))
    if (m[2] === '$') exact[m[1]] = target
    else prefix[m[1]] = target
  }
  const extBlock = text.match(/extensions:\s*\[([^\]]*)\]/)
  if (!extBlock) throw new Error('Cannot find resolve.extensions in webpack.config.js')
  const extensions = [...new Set([...extBlock[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]))]
  return { exact, prefix, extensions }
}

export const WEBPACK = readWebpackResolveConfig()

/**
 * @param {Set<string>} fileSet monolith-relative paths of every file under src/
 */
export function createResolver(fileSet) {
  const { exact, prefix, extensions } = WEBPACK

  function tryFile(base) {
    if (fileSet.has(base)) return base
    for (const e of extensions) if (fileSet.has(base + e)) return base + e
    for (const e of extensions) if (fileSet.has(`${base}/index${e}`)) return `${base}/index${e}`
    return null
  }

  /**
   * Returns `{ resolved, external }`. `resolved` is a monolith-relative path or null.
   * `external` is true for bare package specifiers (node_modules).
   */
  function resolve(spec, fromRel) {
    const clean = spec.replace(/^[^!]*!/, '').replace(/\?.*$/, '') // drop loader prefixes / queries
    if (exact[clean]) return { resolved: tryFile(exact[clean]) ?? exact[clean], external: false }
    if (clean.startsWith('.') || clean.startsWith('/')) {
      const base = clean.startsWith('/')
        ? rel(clean)
        : path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), clean))
      return { resolved: tryFile(base), external: false }
    }
    const [head, ...rest] = clean.split('/')
    if (prefix[head] !== undefined) {
      return { resolved: tryFile(path.posix.join(prefix[head], rest.join('/'))), external: false }
    }
    return { resolved: null, external: true }
  }

  /** All files a `require.context(dir, recursive, regex)` call would pick up. */
  function resolveContext(dirSpec, fromRel, recursive, regex) {
    const { resolved } = resolve(dirSpec, fromRel)
    let dir = resolved
    if (!dir) {
      const [head, ...rest] = dirSpec.split('/')
      if (prefix[head] !== undefined) dir = path.posix.join(prefix[head], rest.join('/'))
      else if (dirSpec.startsWith('.')) dir = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), dirSpec))
    }
    if (!dir) return []
    const out = []
    for (const f of fileSet) {
      if (!f.startsWith(`${dir}/`)) continue
      const sub = f.slice(dir.length + 1)
      if (!recursive && sub.includes('/')) continue
      if (regex.test(`./${sub}`)) out.push(f)
    }
    return out
  }

  return { resolve, resolveContext, tryFile }
}

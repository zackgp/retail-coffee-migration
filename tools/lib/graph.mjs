// Builds the whole-src module graph: analyses every file (cached by mtime/size and
// tool version) and resolves each import edge with webpack's rules.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { analyzeSource } from './analyze.mjs'
import { CODE_EXT, TEMPLATE_EXT, isVendor, listSrcFiles } from './files.mjs'
import { TOOLS_DIR, WORK_DIR, abs } from './paths.mjs'
import { createResolver } from './resolve.mjs'

const CACHE_FILE = path.join(WORK_DIR, 'analysis-cache.json')

function toolVersion() {
  const h = crypto.createHash('md5')
  for (const f of ['lib/analyze.mjs', 'lib/files.mjs']) h.update(fs.readFileSync(path.join(TOOLS_DIR, f)))
  return h.digest('hex')
}

function loadCache(version) {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
    if (c.version === version) return c
  } catch {
    // no cache
  }
  return { version, entries: {} }
}

function saveCache(cache) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache))
  } catch {
    // cache is best effort
  }
}

/**
 * @returns {{
 *   files: string[], fileSet: Set<string>, analyses: Map<string, object>,
 *   resolver: ReturnType<typeof createResolver>,
 *   edges: Array<{from:string,to:string|null,external:boolean,imp:object}>,
 *   importersOf: Map<string, Array>, contextEdges: Array<{from:string,to:string,ctx:object}>
 * }}
 */
export function buildGraph({ useCache = true } = {}) {
  const files = listSrcFiles()
  const fileSet = new Set(files)
  const resolver = createResolver(fileSet)
  const version = toolVersion()
  const cache = useCache ? loadCache(version) : { version, entries: {} }
  const nextEntries = {}
  const analyses = new Map()

  for (const f of files) {
    if (isVendor(f)) continue
    if (!CODE_EXT.test(f) && !TEMPLATE_EXT.test(f)) continue
    if (f.endsWith('.d.ts')) continue
    const st = fs.statSync(abs(f))
    const key = `${st.mtimeMs}:${st.size}`
    const hit = cache.entries[f]
    let a
    if (hit && hit.key === key) a = hit.a
    else a = analyzeSource(f, fs.readFileSync(abs(f), 'utf8'))
    nextEntries[f] = { key, a }
    analyses.set(f, a)
  }
  if (useCache) saveCache({ version, entries: nextEntries })

  const edges = []
  const importersOf = new Map()
  const contextEdges = []
  for (const [from, a] of analyses) {
    for (const imp of a.imports) {
      const { resolved, external } = resolver.resolve(imp.spec, from)
      const e = { from, to: resolved, external, imp }
      edges.push(e)
      if (resolved) {
        if (!importersOf.has(resolved)) importersOf.set(resolved, [])
        importersOf.get(resolved).push(e)
      }
    }
    for (const m of a.mocks) {
      const { resolved } = resolver.resolve(m.spec, from)
      m.resolved = resolved
    }
    for (const ctx of a.contexts) {
      if (!ctx.regex) continue
      const body = ctx.regex.slice(1, ctx.regex.lastIndexOf('/'))
      const flags = ctx.regex.slice(ctx.regex.lastIndexOf('/') + 1).replace('g', '')
      let re
      try {
        re = new RegExp(body, flags)
      } catch {
        continue
      }
      for (const to of resolver.resolveContext(ctx.dir, from, ctx.recursive, re)) contextEdges.push({ from, to, ctx })
    }
  }
  return { files, fileSet, analyses, resolver, edges, importersOf, contextEdges }
}

/** Owner of a Sagamore.* path: the file assigning the longest matching prefix. */
export function buildGlobalOwners(analyses) {
  const owners = new Map() // name -> Set(files)
  for (const [f, a] of analyses) {
    for (const g of a.globals.assigns) {
      if (!owners.has(g.name)) owners.set(g.name, new Set())
      owners.get(g.name).add(f)
    }
  }
  function ownerOf(name, exceptFile) {
    let parts = name.split('.')
    while (parts.length > 1) {
      const k = parts.join('.')
      const o = owners.get(k)
      if (o) {
        const others = [...o].filter((x) => x !== exceptFile)
        if (others.length) return { name: k, files: others }
        if (o.has(exceptFile)) return { name: k, files: [exceptFile] }
      }
      parts = parts.slice(0, -1)
    }
    return null
  }
  return { owners, ownerOf }
}

// Single source of truth for every path the migration tools use (README.md "配置").
//
// The tools live in their own repo (retail-coffee-migration) and point at a springboard-retail
// checkout through config.json (+ optional, gitignored config.local.json; env overrides below).
//
//   host       REPO_ROOT = COFFEE_TARGET_REPO || config.targetRepo
//   container  sr_web.sh mounts this repo at <repoMount>/<appDir>/<toolsMount> (e.g.
//              /sr/apps/monolith/coffee-tools) and sets COFFEE_IN_CONTAINER=1, COFFEE_REPO_ROOT,
//              COFFEE_WORK_DIR. Being inside the app workspace folder lets Yarn PnP resolve the
//              target's dependencies for these scripts; `jest ./src`, `eslint src` and tsc
//              (include: src/**, migrators/**) never look at that folder.
//
// Data (batches.json, manifest, allowlists, baseline/, shapes/, registry snapshot) lives in
// <dataDir>; scratch (caches, hotspot checklists, verify/baseline runs) in <workDir>. Both must
// be inside this repo so that the container sees them through the mount.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** tools/ (this repo's code directory) */
export const TOOLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** root of the retail-coffee-migration repo */
export const TOOLS_ROOT = path.resolve(TOOLS_DIR, '..')
export const IN_CONTAINER = process.env.COFFEE_IN_CONTAINER === '1'

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw new Error(`${file}: ${e.message}`)
  }
}

function merge(a, b) {
  if (!b) return a
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v
  }
  return out
}

function loadConfig() {
  const base = readJson(path.join(TOOLS_ROOT, 'config.json'))
  if (!base) throw new Error(`missing ${path.join(TOOLS_ROOT, 'config.json')}`)
  return merge(base, readJson(path.join(TOOLS_ROOT, 'config.local.json')))
}

export const CONFIG = loadConfig()

const expandHome = (p) => (p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p)

function requireEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set (COFFEE_IN_CONTAINER=1 expects sr_web.sh to set it)`)
  return v
}

/** Resolves a path relative to TOOLS_ROOT and refuses anything outside it (the container only sees this repo). */
function insideTools(p, what) {
  const r = path.resolve(TOOLS_ROOT, expandHome(p))
  const relToRoot = path.relative(TOOLS_ROOT, r)
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    throw new Error(`${what} (${r}) must be inside ${TOOLS_ROOT}: the sr_web container only sees this repo through its mount`)
  }
  return r
}

export const APP_DIR = String(CONFIG.appDir).replace(/^\/+|\/+$/g, '')
export const REPO_ROOT = IN_CONTAINER
  ? requireEnv('COFFEE_REPO_ROOT')
  : path.resolve(expandHome(process.env.COFFEE_TARGET_REPO || CONFIG.targetRepo || ''))
export const MONOLITH = path.join(REPO_ROOT, APP_DIR)
export const SRC = path.join(MONOLITH, 'src')

if (!fs.existsSync(path.join(MONOLITH, 'package.json'))) {
  throw new Error(
    `target app not found: ${MONOLITH}\n` +
      '  set "targetRepo" in config.local.json (or COFFEE_TARGET_REPO) to a springboard-retail checkout',
  )
}

export const DATA_DIR =
  IN_CONTAINER && process.env.COFFEE_DATA_DIR ? process.env.COFFEE_DATA_DIR : insideTools(CONFIG.dataDir || 'data', 'dataDir')
export const BASELINE_DIR = path.join(DATA_DIR, 'baseline')
export const SHAPES_DIR = path.join(DATA_DIR, 'shapes')
export const REGISTRY_FILE = path.join(DATA_DIR, 'sagamore_registry.json')
export const PUBLIC_GLOBALS_FILE = path.join(DATA_DIR, 'public_globals.json')

// Gitignored scratch space (host deps excluded, see HOST_DEPS_DIR). Use a different workDir per
// target worktree (COFFEE_WORK_DIR or config.local.json) when running several at once.
export const WORK_DIR = IN_CONTAINER
  ? requireEnv('COFFEE_WORK_DIR')
  : insideTools(process.env.COFFEE_WORK_DIR || CONFIG.workDir || '.work', 'workDir')

/** coffeescript 1.12.7 + typescript for the host-side tools (tools/setup_host.sh). */
export const HOST_DEPS_DIR = path.join(TOOLS_ROOT, '.host-deps')

export const BASE_REF = process.env.COFFEE_BASE_REF || CONFIG.baseRef || 'origin/staging'

const c = CONFIG.container || {}
const cMonolith = path.posix.join(c.repoMount || '/sr', APP_DIR)
export const CONTAINER = {
  composeFiles: c.composeFiles || [],
  service: c.service || 'sr_web',
  projectName: c.projectName || 'sr-coffee',
  repo: c.repoMount || '/sr',
  monolith: cMonolith,
  toolsMount: c.toolsMount || 'coffee-tools',
  tools: path.posix.join(cMonolith, c.toolsMount || 'coffee-tools'),
}

/** Container path for a host path inside this repo. */
export function toContainer(hostPath) {
  const r = path.relative(TOOLS_ROOT, path.resolve(hostPath))
  if (r.startsWith('..') || path.isAbsolute(r)) throw new Error(`${hostPath} is not inside ${TOOLS_ROOT}`)
  return path.posix.join(CONTAINER.tools, r.split(path.sep).join('/'))
}

/** Path relative to the app dir, always with forward slashes (e.g. `src/sagamore/app.coffee`). */
export function rel(abs) {
  return path.relative(MONOLITH, abs).split(path.sep).join('/')
}

export function abs(relPath) {
  return path.isAbsolute(relPath) ? relPath : path.join(MONOLITH, relPath)
}

/**
 * Normalizes user input to an app-relative path. Accepts absolute paths, paths relative to the
 * target repo root (`apps/monolith/src/...`), paths relative to the cwd, and app-relative paths
 * (`src/...`) from anywhere (e.g. when running from this repo).
 */
export function normalizeInput(p) {
  if (path.isAbsolute(p)) return rel(path.resolve(p))
  if (p.startsWith(`${APP_DIR}/`)) return rel(path.join(REPO_ROOT, p))
  const fromCwd = path.resolve(process.cwd(), p)
  if (fs.existsSync(fromCwd) && !path.relative(MONOLITH, fromCwd).startsWith('..')) return rel(fromCwd)
  return rel(path.join(MONOLITH, p))
}

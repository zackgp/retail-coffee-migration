#!/usr/bin/env node
// Standalone bootstrap: intentionally does not load target-repo configuration or dependencies.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const TOOLS_ROOT = fs.realpathSync(fileURLToPath(new URL('../', import.meta.url)))
const SKILLS = ['coffee-migration-ticket', 'coffee-migration']
const INSTALLER = 'retail-coffee-migration/tools/install_skills.mjs'
const METADATA = 'install.json'
const HELP = `Usage: node tools/install_skills.mjs [--dest <skills-parent-dir>] [--dry-run | --check]

Install coffee-migration-ticket and coffee-migration using Node >=18 (no dependencies).
  --dest <dir>  Skills parent directory; defaults to ~/.agents/skills via os.homedir().
                Relative paths resolve from the current working directory.
  --dry-run     Run both safety preflights and report changes without writing anything.
  --check       Read-only; exit 0 only if both installed skills match this checkout.
  --help        Show this help without inspecting skills or creating directories.

Only unchanged, managed installations can be updated. No force/overwrite option.
Each skill gets install.json with toolsRoot, source, and SHA-256 file hashes.
`

function options(args) {
  const result = { dest: path.join(os.homedir(), '.agents', 'skills') }
  const seen = new Set()
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!['--dest', '--dry-run', '--check', '--help'].includes(arg)) {
      throw new Error(`Unknown argument: ${arg}. Use --help for usage.`)
    }
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`)
    seen.add(arg)
    if (arg === '--dest') {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error('--dest requires a directory.')
      result.dest = value
    } else result[arg.slice(2)] = true
  }
  if (result.check && result['dry-run']) throw new Error('--check and --dry-run are mutually exclusive.')
  return result
}

function lstat(file) {
  try {
    return fs.lstatSync(file)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function contains(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

// Resolve existing ancestors too: a parent symlink must not bypass overlap checks.
function physicalDirectory(dir) {
  const stat = lstat(dir)
  if (!stat) return path.join(physicalDirectory(path.dirname(dir)), path.basename(dir))
  const real = fs.realpathSync(dir)
  if (!fs.statSync(real).isDirectory()) throw new Error(`Not a directory: ${dir}`)
  return real
}

function destination(value) {
  const requested = path.resolve(value)
  if (lstat(requested)?.isSymbolicLink()) throw new Error(`Destination is a symlink: ${requested}`)
  const dest = physicalDirectory(requested)
  if (contains(dest, TOOLS_ROOT)) throw new Error(`Destination overlaps the source repo or its ancestors: ${dest}`)
  for (const name of SKILLS) {
    const source = path.join(TOOLS_ROOT, '.agents', 'skills', name)
    if (contains(dest, source) || contains(source, dest)) {
      throw new Error(`Destination overlaps source skill directory: ${source}`)
    }
  }
  return dest
}

function tree(root) {
  const files = new Map()
  const directories = []
  function visit(relative) {
    const absolute = path.join(root, relative)
    const stat = lstat(absolute)
    if (!stat) throw new Error(`Missing file or directory: ${absolute}`)
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink: ${absolute}`)
    if (stat.isDirectory()) {
      if (relative) directories.push(relative)
      for (const name of fs.readdirSync(absolute).sort()) visit(relative ? `${relative}/${name}` : name)
    } else if (stat.isFile() && relative) {
      files.set(relative, fs.readFileSync(absolute))
    } else throw new Error(`Expected a regular file or directory: ${absolute}`)
  }
  visit('')
  return { files, directories: directories.sort() }
}

function hashes(files) {
  return Object.fromEntries([...files].map(([file, bytes]) => [file, createHash('sha256').update(bytes).digest('hex')]))
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function safeRelative(value) {
  return typeof value === 'string' && value !== '' && !value.includes('\\') && !value.includes('\0') &&
    !value.includes(':') && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

function validateMetadata(meta, name, file) {
  const invalid = () => { throw new Error(`Invalid or unmanaged install.json: ${file}`) }
  if (!isObject(meta) || meta.schemaVersion !== 1 || meta.installer !== INSTALLER ||
      meta.skillName !== name || meta.source !== `.agents/skills/${name}` ||
      typeof meta.toolsRoot !== 'string' || !path.isAbsolute(meta.toolsRoot) ||
      !isObject(meta.files) || !Array.isArray(meta.directories)) invalid()
  if (!Object.hasOwn(meta.files, 'SKILL.md')) invalid()
  for (const [relative, hash] of Object.entries(meta.files)) {
    if (!safeRelative(relative) || relative === METADATA || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) invalid()
  }
  if (meta.directories.some((dir) => !safeRelative(dir) || dir === METADATA) ||
      new Set(meta.directories).size !== meta.directories.length) invalid()
  const dirs = new Set(meta.directories)
  for (const relative of [...Object.keys(meta.files), ...dirs]) {
    if (dirs.has(relative) && Object.hasOwn(meta.files, relative)) invalid()
    const parent = path.posix.dirname(relative)
    if (parent !== '.' && !dirs.has(parent)) invalid()
  }
}

function sameEntries(left, right) {
  const keys = Object.keys(left).sort()
  return JSON.stringify(keys) === JSON.stringify(Object.keys(right).sort()) && keys.every((key) => left[key] === right[key])
}

function installed(target, name) {
  const stat = lstat(target)
  if (!stat) return null
  if (stat.isSymbolicLink()) throw new Error(`Refusing symlink installation: ${target}`)
  if (!stat.isDirectory()) throw new Error(`Unmanaged installation (not a directory): ${target}`)
  const metadataPath = path.join(target, METADATA)
  const metadataStat = lstat(metadataPath)
  if (!metadataStat) throw new Error(`Unmanaged installation (missing install.json): ${target}`)
  if (metadataStat.isSymbolicLink()) throw new Error(`Refusing symlink: ${metadataPath}`)
  if (!metadataStat.isFile()) throw new Error(`Invalid install.json (not a regular file): ${metadataPath}`)
  const text = fs.readFileSync(metadataPath, 'utf8')
  let meta
  try {
    meta = JSON.parse(text)
  } catch {
    throw new Error(`Invalid install.json (malformed JSON): ${metadataPath}`)
  }
  validateMetadata(meta, name, metadataPath)
  const actual = tree(target)
  actual.files.delete(METADATA)
  for (const [relative, bytes] of actual.files) {
    if (!Object.hasOwn(meta.files, relative)) throw new Error(`Extra file in installation: ${path.join(target, relative)}`)
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (hash !== meta.files[relative]) throw new Error(`Locally modified installed file: ${path.join(target, relative)}`)
  }
  for (const relative of Object.keys(meta.files)) {
    if (!actual.files.has(relative)) throw new Error(`Missing installed file (local change): ${path.join(target, relative)}`)
  }
  if (JSON.stringify(actual.directories) !== JSON.stringify([...meta.directories].sort())) {
    throw new Error(`Extra or missing directory in installation (local change): ${target}`)
  }
  return { meta, text }
}

function planSkill(dest, name) {
  const source = `.agents/skills/${name}`
  const sourceRoot = path.join(TOOLS_ROOT, source)
  if (!lstat(sourceRoot)) throw new Error(`Missing source skill directory: ${sourceRoot}`)
  if (fs.realpathSync(sourceRoot) !== sourceRoot) throw new Error(`Refusing symlink source directory: ${sourceRoot}`)
  const content = tree(sourceRoot)
  if (!content.files.has('SKILL.md')) throw new Error(`Source skill is missing SKILL.md: ${sourceRoot}`)
  if (content.files.has(METADATA) || content.directories.includes(METADATA)) {
    throw new Error(`Source skill uses reserved name ${METADATA}: ${sourceRoot}`)
  }
  const meta = {
    schemaVersion: 1,
    installer: INSTALLER,
    skillName: name,
    toolsRoot: TOOLS_ROOT,
    source,
    files: hashes(content.files),
    directories: content.directories,
  }
  const target = path.join(dest, name)
  const previous = installed(target, name)
  const current = previous !== null && previous.meta.toolsRoot === TOOLS_ROOT &&
    sameEntries(previous.meta.files, meta.files) &&
    JSON.stringify([...previous.meta.directories].sort()) === JSON.stringify(meta.directories)
  return { name, target, content, metadata: json(meta), previous, action: current ? 'unchanged' : previous ? 'update' : 'install' }
}

function apply(dest, plans) {
  const changes = plans.filter((plan) => plan.action !== 'unchanged')
  if (changes.length === 0) return
  fs.mkdirSync(dest, { recursive: true })
  const stage = fs.mkdtempSync(path.join(dest, '.coffee-skills-install-'))
  let preserveStage = false
  try {
    // Stage both snapshots before changing either installation.
    for (const plan of changes) {
      const next = path.join(stage, plan.name)
      fs.mkdirSync(next)
      for (const dir of plan.content.directories) fs.mkdirSync(path.join(next, dir), { recursive: true })
      for (const [file, bytes] of plan.content.files) fs.writeFileSync(path.join(next, file), bytes, { flag: 'wx' })
      fs.writeFileSync(path.join(next, METADATA), plan.metadata, { flag: 'wx' })
    }
    // Catch edits made while staging; no existing installation has been renamed yet.
    for (const plan of plans) {
      if (installed(plan.target, plan.name)?.text !== plan.previous?.text) {
        throw new Error(`Installation changed during preflight; retry: ${plan.target}`)
      }
    }
    for (const plan of changes) {
      const backup = path.join(stage, `previous-${plan.name}`)
      if (plan.previous) fs.renameSync(plan.target, backup)
      try {
        fs.renameSync(path.join(stage, plan.name), plan.target)
      } catch (error) {
        if (plan.previous) {
          try {
            fs.renameSync(backup, plan.target)
          } catch (restoreError) {
            // Never remove the only remaining copy if restoration itself fails.
            preserveStage = true
            throw new Error(`${error.message}; restore failed: ${restoreError.message}. Backup retained at ${backup}`)
          }
        }
        throw error
      }
      console.log(`${plan.action === 'install' ? 'Installed' : 'Updated'} ${plan.target}`)
    }
  } finally {
    if (!preserveStage) fs.rmSync(stage, { recursive: true, force: true })
  }
}

function main() {
  if (Number(process.versions.node.split('.')[0]) < 18) throw new Error('Node >=18 is required.')
  const opts = options(process.argv.slice(2))
  if (opts.help) {
    process.stdout.write(HELP)
    return
  }
  const dest = destination(opts.dest)
  // All source and installation validation happens before mkdir, staging, or updates.
  const plans = SKILLS.map((name) => planSkill(dest, name))
  if (opts.check) {
    const stale = plans.filter((plan) => plan.action !== 'unchanged')
    if (stale.length) throw new Error(`Missing or out-of-date installation (content or toolsRoot): ${stale.map((plan) => plan.target).join(', ')}`)
    console.log(`Skills are up to date with ${TOOLS_ROOT}`)
  } else if (opts['dry-run']) {
    for (const plan of plans) console.log(`Dry run: ${plan.action} ${plan.target}`)
  } else {
    apply(dest, plans)
    for (const plan of plans.filter((plan) => plan.action === 'unchanged')) console.log(`Unchanged ${plan.target}`)
  }
}

try {
  main()
} catch (error) {
  console.error(`install_skills: ${error.message}`)
  process.exitCode = 1
}

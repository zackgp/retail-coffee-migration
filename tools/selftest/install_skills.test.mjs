// Standalone CLI self-test, with every fixture kept below this repo's .work/.
//   node --test tools/selftest/install_skills.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const TOOLS_ROOT = fs.realpathSync(fileURLToPath(new URL('../../', import.meta.url)))
const WORK = path.join(TOOLS_ROOT, '.work')
const INSTALLER = path.join(TOOLS_ROOT, 'tools', 'install_skills.mjs')
const SKILLS = ['coffee-migration-ticket', 'coffee-migration']
const source = (repo, name) => path.join(repo, '.agents', 'skills', name)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function createRepo(repo) {
  fs.mkdirSync(path.join(repo, 'tools'), { recursive: true })
  fs.copyFileSync(INSTALLER, path.join(repo, 'tools', 'install_skills.mjs'))
  // Deliberately unusable configuration: installing must never import paths.mjs.
  write(path.join(repo, 'config.json'), 'not valid JSON\n')
  for (const name of SKILLS) {
    write(path.join(source(repo, name), 'SKILL.md'), `---\nname: ${name}\n---\n读 install.json 的 toolsRoot。\n`)
    write(path.join(source(repo, name), 'templates', 'guide.md'), `# ${name} guide\n`)
    write(path.join(source(repo, name), 'templates', 'nested', 'example.md'), 'Example\r\n')
    fs.mkdirSync(path.join(source(repo, name), 'templates', 'empty'))
  }
  return repo
}

function fixture(t) {
  fs.mkdirSync(WORK, { recursive: true })
  const base = fs.mkdtempSync(path.join(WORK, 'install-skills-test-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  return {
    base,
    repo: createRepo(path.join(base, 'checkout with spaces')),
    dest: path.join(base, 'custom skills'),
    home: path.join(base, 'fake home'),
  }
}

function run(f, args = [], { repo = f.repo, dest = f.dest, defaultDest = false, nodeArgs = [], cwd = f.base } = {}) {
  const result = spawnSync(process.execPath, [
    ...nodeArgs,
    path.join(repo, 'tools', 'install_skills.mjs'),
    ...(!defaultDest ? ['--dest', dest] : []),
    ...args,
  ], {
    cwd,
    env: { ...process.env, HOME: f.home, USERPROFILE: f.home, COFFEE_TARGET_REPO: 'intentionally-not-configured' },
    encoding: 'utf8',
    timeout: 10000,
  })
  if (result.error) throw result.error
  assert.equal(result.signal, null, result.stderr)
  return { ...result, output: result.stdout + result.stderr }
}

function ok(result) {
  assert.equal(result.status, 0, result.output)
  assert.equal(result.stderr, '', result.output)
  return result
}

// Include inode and mtime, not atime: reads are allowed, rewriting identical bytes is not.
function snapshot(root) {
  const entries = []
  function visit(file, relative) {
    const stat = fs.lstatSync(file, { bigint: true })
    const entry = { path: relative, inode: String(stat.ino), mtime: String(stat.mtimeNs), mode: String(stat.mode) }
    if (stat.isSymbolicLink()) entry.link = fs.readlinkSync(file)
    else if (stat.isFile()) entry.sha256 = sha256(fs.readFileSync(file))
    entries.push(entry)
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name), relative ? `${relative}/${name}` : name)
    }
  }
  visit(root, '')
  return entries
}

function readMetadata(dest, name) {
  return JSON.parse(fs.readFileSync(path.join(dest, name, 'install.json'), 'utf8'))
}

function assertInstalled(repo, dest) {
  assert.deepEqual(fs.readdirSync(dest).sort(), [...SKILLS].sort())
  for (const name of SKILLS) {
    const meta = readMetadata(dest, name)
    assert.equal(meta.schemaVersion, 1)
    assert.equal(meta.installer, 'retail-coffee-migration/tools/install_skills.mjs')
    assert.equal(meta.skillName, name)
    assert.equal(meta.toolsRoot, fs.realpathSync(repo))
    assert.ok(path.isAbsolute(meta.toolsRoot))
    assert.equal(meta.source, `.agents/skills/${name}`)
    assert.deepEqual(Object.keys(meta.files).sort(), ['SKILL.md', 'templates/guide.md', 'templates/nested/example.md'])
    assert.deepEqual(meta.directories, ['templates', 'templates/empty', 'templates/nested'])
    for (const [file, hash] of Object.entries(meta.files)) {
      const expected = fs.readFileSync(path.join(repo, meta.source, file))
      assert.deepEqual(fs.readFileSync(path.join(dest, name, file)), expected)
      assert.equal(hash, sha256(expected))
    }
  }
}

function refuseWithoutWrites(f, pattern, overrides = {}) {
  const before = snapshot(f.base)
  for (const args of [[], ['--dry-run'], ['--check']]) {
    const result = run(f, args, overrides)
    assert.equal(result.status, 1, result.output)
    assert.match(result.stderr, pattern)
    assert.deepEqual(snapshot(f.base), before, `Failed invocation wrote files: ${args.join(' ')}`)
  }
}

test('real skill packages have valid manual-only frontmatter and bundled templates', (t) => {
  const f = fixture(t)
  for (const name of SKILLS) {
    const body = fs.readFileSync(path.join(source(TOOLS_ROOT, name), 'SKILL.md'), 'utf8')
    const frontmatter = body.match(/^---\n([\s\S]*?)\n---\n/)
    assert.ok(frontmatter, `Missing frontmatter: ${name}`)
    assert.match(frontmatter[1], new RegExp(`^name: ${name}$`, 'm'))
    assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/)
    assert.ok(name.length <= 64)
    const description = frontmatter[1].match(/^description: (.+)$/m)?.[1]
    assert.ok(description && description.length <= 1024, `Invalid description: ${name}`)
    assert.match(frontmatter[1], /^disable-model-invocation: true$/m)
    for (const [file] of body.matchAll(/templates\/[a-z-]+\.md/g)) {
      assert.ok(fs.statSync(path.join(source(TOOLS_ROOT, name), file)).isFile(), `Missing template: ${file}`)
    }
  }
  ok(run(f, [], { repo: TOOLS_ROOT }))
  ok(run(f, ['--check'], { repo: TOOLS_ROOT }))
  for (const name of SKILLS) {
    const meta = readMetadata(f.dest, name)
    assert.equal(meta.toolsRoot, TOOLS_ROOT)
    for (const [file, hash] of Object.entries(meta.files)) {
      const expected = fs.readFileSync(path.join(source(TOOLS_ROOT, name), file))
      assert.deepEqual(fs.readFileSync(path.join(f.dest, name, file)), expected)
      assert.equal(hash, sha256(expected))
    }
  }
})

test('help works without source skills or configuration and writes nothing', (t) => {
  const f = fixture(t)
  fs.rmSync(path.join(f.repo, '.agents'), { recursive: true })
  const before = snapshot(f.base)
  const result = ok(run(f, ['--help'], { defaultDest: true }))
  for (const option of ['--dest', '--dry-run', '--check', '--help']) assert.ok(result.stdout.includes(option))
  assert.deepEqual(snapshot(f.base), before)
})

test('invalid CLI arguments are rejected without writes', (t) => {
  const f = fixture(t)
  const before = snapshot(f.base)
  for (const args of [
    ['--unknown'], ['--force'], ['positional'], ['--dest'], ['--dest', ''],
    ['--dest', '--check'], ['--check', '--dry-run'], ['--check', '--check'],
    ['--dest', f.dest, '--dest', f.dest],
  ]) {
    const result = run(f, args, { defaultDest: true })
    assert.equal(result.status, 1, result.output)
    assert.match(result.stderr, /Unknown argument|requires a directory|mutually exclusive|Duplicate option/)
    assert.deepEqual(snapshot(f.base), before)
  }
})

test('installs both skills, templates, empty directories, and deterministic hash metadata', (t) => {
  const f = fixture(t)
  const before = snapshot(f.repo)
  ok(run(f))
  assertInstalled(f.repo, f.dest)
  ok(run(f, ['--check']))
  assert.deepEqual(snapshot(f.repo), before, 'Installer changed the source checkout')
})

test('default destination uses os.homedir(), never the real user home in tests', (t) => {
  const f = fixture(t)
  ok(run(f, [], { defaultDest: true }))
  const dest = path.join(f.home, '.agents', 'skills')
  assertInstalled(f.repo, dest)
  ok(run(f, ['--check'], { defaultDest: true }))
  assert.equal(fs.existsSync(f.dest), false)
})

test('relative custom destination resolves from cwd, while source resolves from import.meta.url', (t) => {
  const f = fixture(t)
  ok(run(f, [], { dest: 'relative skills' }))
  assertInstalled(f.repo, path.join(f.base, 'relative skills'))
})

test('check reports missing installations without creating the destination', (t) => {
  const f = fixture(t)
  const before = snapshot(f.base)
  const result = run(f, ['--check'])
  assert.equal(result.status, 1, result.output)
  assert.match(result.stderr, /Missing or out-of-date/)
  for (const name of SKILLS) assert.ok(result.stderr.includes(name))
  assert.deepEqual(snapshot(f.base), before)
})

test('dry-run does not create even missing destination ancestors', (t) => {
  const f = fixture(t)
  const before = snapshot(f.base)
  const result = ok(run(f, ['--dry-run'], { dest: path.join(f.base, 'missing', 'parents', 'skills') }))
  assert.match(result.stdout, /Dry run: install/)
  assert.deepEqual(snapshot(f.base), before)
})

test('repeated install, check, and dry-run preserve content, inode, and mtime', (t) => {
  const f = fixture(t)
  ok(run(f))
  const before = snapshot(f.dest)
  for (const args of [[], ['--check'], ['--dry-run'], []]) {
    ok(run(f, args))
    assert.deepEqual(snapshot(f.dest), before)
  }
})

test('source edits, additions, and removals update clean managed installations only', (t) => {
  const f = fixture(t)
  ok(run(f))
  write(path.join(source(f.repo, SKILLS[0]), 'SKILL.md'), '# Updated source\n')
  fs.unlinkSync(path.join(source(f.repo, SKILLS[0]), 'templates', 'guide.md'))
  fs.rmdirSync(path.join(source(f.repo, SKILLS[0]), 'templates', 'empty'))
  write(path.join(source(f.repo, SKILLS[1]), 'templates', 'new.md'), 'New template\n')
  const before = snapshot(f.dest)
  const check = run(f, ['--check'])
  assert.equal(check.status, 1, check.output)
  assert.match(check.stderr, /out-of-date/)
  ok(run(f, ['--dry-run']))
  assert.deepEqual(snapshot(f.dest), before)
  ok(run(f))
  ok(run(f, ['--check']))
  assert.equal(fs.existsSync(path.join(f.dest, SKILLS[0], 'templates', 'guide.md')), false)
  assert.equal(fs.existsSync(path.join(f.dest, SKILLS[0], 'templates', 'empty')), false)
  assert.equal(fs.readFileSync(path.join(f.dest, SKILLS[1], 'templates', 'new.md'), 'utf8'), 'New template\n')
  const after = snapshot(f.dest)
  ok(run(f))
  assert.deepEqual(snapshot(f.dest), after)
})

const unsafeInstallations = [
  ['local SKILL.md edit', /Locally modified/, (target) => write(path.join(target, 'SKILL.md'), 'Local edit\n')],
  ['local template edit', /Locally modified/, (target) => write(path.join(target, 'templates', 'guide.md'), 'Local edit\n')],
  ['missing installed file', /Missing installed file/, (target) => fs.unlinkSync(path.join(target, 'SKILL.md'))],
  ['extra file', /Extra file/, (target) => write(path.join(target, 'notes.txt'), 'User data\n')],
  ['extra nested file', /Extra file/, (target) => write(path.join(target, 'templates', 'notes.md'), 'User data\n')],
  ['extra empty directory', /Extra or missing directory/, (target) => fs.mkdirSync(path.join(target, 'user-empty'))],
  ['missing empty directory', /Extra or missing directory/, (target) => fs.rmdirSync(path.join(target, 'templates', 'empty'))],
  ['unmanaged directory', /Unmanaged installation/, (target) => fs.unlinkSync(path.join(target, 'install.json'))],
  ['plain file instead of directory', /Unmanaged installation/, (target) => {
    fs.rmSync(target, { recursive: true })
    write(target, 'User file\n')
  }],
  ['symlink installation', /symlink/, (target, f) => {
    const external = path.join(f.base, 'external skill')
    fs.renameSync(target, external)
    fs.symlinkSync(external, target, 'dir')
  }],
  ['dangling symlink installation', /symlink/, (target, f) => {
    fs.rmSync(target, { recursive: true })
    fs.symlinkSync(path.join(f.base, 'nonexistent'), target, 'dir')
  }],
  ['symlink file', /symlink/, (target, f) => {
    const file = path.join(target, 'SKILL.md')
    const external = path.join(f.base, 'external.md')
    fs.renameSync(file, external)
    fs.symlinkSync(external, file)
  }],
  ['symlink nested directory', /symlink/, (target, f) => {
    const templates = path.join(target, 'templates')
    const external = path.join(f.base, 'external templates')
    fs.renameSync(templates, external)
    fs.symlinkSync(external, templates, 'dir')
  }],
  ['symlink install.json', /symlink/, (target, f) => {
    const file = path.join(target, 'install.json')
    const external = path.join(f.base, 'external.json')
    fs.renameSync(file, external)
    fs.symlinkSync(external, file)
  }],
  ['malformed install.json', /Invalid install.json/, (target) => write(path.join(target, 'install.json'), '{bad json')],
  ['install.json directory', /Invalid install.json/, (target) => {
    fs.unlinkSync(path.join(target, 'install.json'))
    fs.mkdirSync(path.join(target, 'install.json'))
  }],
]

for (const [description, pattern, mutate] of unsafeInstallations) {
  test(`refuses ${description} in every mode before updating the other skill`, (t) => {
    const f = fixture(t)
    ok(run(f))
    write(path.join(source(f.repo, SKILLS[0]), 'SKILL.md'), '# Pending source update\n')
    mutate(path.join(f.dest, SKILLS[1]), f)
    refuseWithoutWrites(f, pattern)
  })
}

for (const [description, mutate] of [
  ['wrong schema', (meta) => { meta.schemaVersion = 2 }],
  ['wrong installer', (meta) => { meta.installer = 'someone-else' }],
  ['wrong name', (meta) => { meta.skillName = SKILLS[0] }],
  ['wrong source', (meta) => { meta.source = '../escape' }],
  ['relative toolsRoot', (meta) => { meta.toolsRoot = '../checkout' }],
  ['invalid hash', (meta) => { meta.files['SKILL.md'] = 'not-a-hash' }],
  ['traversal file', (meta) => { meta.files['../escape'] = meta.files['SKILL.md'] }],
  ['absolute file', (meta) => { meta.files['/escape'] = meta.files['SKILL.md'] }],
  ['missing file map', (meta) => { delete meta.files }],
  ['missing directories', (meta) => { delete meta.directories }],
  ['traversal directory', (meta) => { meta.directories.push('../escape') }],
  ['file/directory conflict', (meta) => { meta.directories.push('SKILL.md') }],
]) {
  test(`refuses invalid metadata: ${description}`, (t) => {
    const f = fixture(t)
    ok(run(f))
    const file = path.join(f.dest, SKILLS[1], 'install.json')
    const meta = readMetadata(f.dest, SKILLS[1])
    mutate(meta)
    write(file, JSON.stringify(meta))
    refuseWithoutWrites(f, /Invalid or unmanaged install.json/)
  })
}

test('even a local edit identical to the new source is not overwritten', (t) => {
  const f = fixture(t)
  ok(run(f))
  write(path.join(source(f.repo, SKILLS[1]), 'SKILL.md'), '# Same new bytes\n')
  write(path.join(f.dest, SKILLS[1], 'SKILL.md'), '# Same new bytes\n')
  refuseWithoutWrites(f, /Locally modified/)
})

test('unmanaged empty directory is not adopted, and neither skill is created', (t) => {
  const f = fixture(t)
  fs.mkdirSync(path.join(f.dest, SKILLS[1]), { recursive: true })
  refuseWithoutWrites(f, /Unmanaged installation/)
  assert.equal(fs.existsSync(path.join(f.dest, SKILLS[0])), false)
})

test('another checkout can safely take over clean installations and update toolsRoot', (t) => {
  const f = fixture(t)
  ok(run(f))
  const second = createRepo(path.join(f.base, 'another checkout'))
  const before = snapshot(f.dest)
  const stale = run(f, ['--check'], { repo: second })
  assert.equal(stale.status, 1, stale.output)
  assert.match(stale.stderr, /toolsRoot/)
  ok(run(f, ['--dry-run'], { repo: second }))
  assert.deepEqual(snapshot(f.dest), before)
  ok(run(f, [], { repo: second }))
  assertInstalled(second, f.dest)
  ok(run(f, ['--check'], { repo: second }))
  assert.equal(fs.existsSync(f.repo), true)
})

test('copied installations relocate to a second machine path after the old checkout disappears', (t) => {
  const f = fixture(t)
  ok(run(f))
  const repo = createRepo(path.join(f.base, 'machine-b', 'relocated checkout'))
  const dest = path.join(f.base, 'machine-b', 'home', '.agents', 'skills')
  fs.cpSync(f.dest, dest, { recursive: true })
  fs.rmSync(f.repo, { recursive: true })
  const stale = run(f, ['--check'], { repo, dest })
  assert.equal(stale.status, 1, stale.output)
  ok(run(f, [], { repo, dest }))
  assertInstalled(repo, dest)
  ok(run(f, ['--check'], { repo, dest }))
})

test('a different checkout cannot take over a locally edited installation', (t) => {
  const f = fixture(t)
  ok(run(f))
  const repo = createRepo(path.join(f.base, 'another checkout'))
  write(path.join(f.dest, SKILLS[1], 'SKILL.md'), 'Local edit\n')
  refuseWithoutWrites(f, /Locally modified/, { repo })
})

for (const [description, select] of [
  ['repo root', (f) => f.repo],
  ['repo ancestor', (f) => f.base],
  ['skills parent', (f) => path.join(f.repo, '.agents', 'skills')],
  ['source ancestor', (f) => path.join(f.repo, '.agents')],
  ['source itself', (f) => source(f.repo, SKILLS[0])],
  ['source descendant', (f) => path.join(source(f.repo, SKILLS[1]), 'templates')],
  ['missing source descendant', (f) => path.join(source(f.repo, SKILLS[1]), 'new', 'child')],
]) {
  test(`rejects overlapping destination: ${description}`, (t) => {
    const f = fixture(t)
    refuseWithoutWrites(f, /overlaps/, { dest: select(f) })
  })
}

test('symlink destination and symlink ancestors cannot bypass overlap checks', (t) => {
  const f = fixture(t)
  const alias = path.join(f.base, 'repo alias')
  fs.symlinkSync(f.repo, alias, 'dir')
  refuseWithoutWrites(f, /symlink/, { dest: alias })
  refuseWithoutWrites(f, /overlaps/, { dest: path.join(alias, '.agents', 'skills', SKILLS[0], 'new') })
})

test('non-directory destination is rejected without writes', (t) => {
  const f = fixture(t)
  write(f.dest, 'User data\n')
  refuseWithoutWrites(f, /Not a directory/)
})

for (const [description, pattern, mutate] of [
  ['missing source skill', /Missing source skill directory/, (f) => fs.rmSync(source(f.repo, SKILLS[1]), { recursive: true })],
  ['missing SKILL.md', /missing SKILL.md/, (f) => fs.unlinkSync(path.join(source(f.repo, SKILLS[1]), 'SKILL.md'))],
  ['reserved metadata name', /reserved name/, (f) => write(path.join(source(f.repo, SKILLS[1]), 'install.json'), '{}')],
  ['source symlink file', /symlink/, (f) => {
    const file = path.join(source(f.repo, SKILLS[1]), 'SKILL.md')
    const external = path.join(f.base, 'external.md')
    fs.renameSync(file, external)
    fs.symlinkSync(external, file)
  }],
  ['source symlink directory', /symlink/, (f) => {
    const dir = source(f.repo, SKILLS[1])
    const external = path.join(f.base, 'external skill')
    fs.renameSync(dir, external)
    fs.symlinkSync(external, dir, 'dir')
  }],
]) {
  test(`preflights both sources before writes: ${description}`, (t) => {
    const f = fixture(t)
    mutate(f)
    refuseWithoutWrites(f, pattern)
    assert.equal(fs.existsSync(f.dest), false)
  })
}

test('failed replacement restores that managed installation and cleans its own staging only', (t) => {
  const f = fixture(t)
  ok(run(f))
  const original = snapshot(path.join(f.dest, SKILLS[1]))
  write(path.join(source(f.repo, SKILLS[1]), 'SKILL.md'), '# Updated source\n')
  const preload = path.join(f.base, 'fail-rename.cjs')
  write(preload, `const fs = require('node:fs')
const rename = fs.renameSync
let failed = false
fs.renameSync = (from, to) => {
  if (!failed && from.includes('.coffee-skills-install-') && !from.includes('previous-')) {
    failed = true
    throw new Error('injected rename failure')
  }
  return rename(from, to)
}
`)
  const unrelated = path.join(f.dest, '.coffee-skills-install-user-owned')
  write(path.join(unrelated, 'notes.txt'), 'User data\n')
  const unrelatedBefore = snapshot(unrelated)
  const result = run(f, [], { nodeArgs: ['--require', preload] })
  assert.equal(result.status, 1, result.output)
  assert.match(result.stderr, /injected rename failure/)
  assert.deepEqual(snapshot(path.join(f.dest, SKILLS[1])), original)
  assert.deepEqual(snapshot(unrelated), unrelatedBefore)
  assert.deepEqual(fs.readdirSync(f.dest).sort(), [...SKILLS, path.basename(unrelated)].sort())
  ok(run(f))
  ok(run(f, ['--check']))
})

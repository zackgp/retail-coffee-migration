// Self-test for tools/lib/interop.mjs (G3). Run from anywhere:
//   node tools/selftest/interop.mjs
// Builds the real graph, then replaces / adds files in memory (analyzeSource) and checks that
// each rule reports what it should. Nothing under src/ is touched.
import assert from 'node:assert/strict'
import { analyzeSource } from '../lib/analyze.mjs'
import { buildGraph } from '../lib/graph.mjs'
import { checkInterop, formatFinding, readAllowlist } from '../lib/interop.mjs'
import { createResolver } from '../lib/resolve.mjs'

const base = buildGraph()

/** Graph with `add` ({file: source}) analysed in memory and `remove` files dropped. */
function mutate({ add = {}, remove = [] } = {}) {
  const files = base.files.filter((f) => !remove.includes(f))
  for (const f of Object.keys(add)) if (!files.includes(f)) files.push(f)
  files.sort()
  const fileSet = new Set(files)
  const resolver = createResolver(fileSet)
  const analyses = new Map()
  for (const [f, a] of base.analyses) if (!remove.includes(f)) analyses.set(f, structuredClone(a))
  for (const [f, src] of Object.entries(add)) {
    const a = analyzeSource(f, src)
    assert.ok(!a.compileError, `${f}: ${a.compileError}`)
    analyses.set(f, a)
  }
  const edges = []
  const importersOf = new Map()
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
    for (const m of a.mocks) m.resolved = resolver.resolve(m.spec, from).resolved
  }
  return { graph: { files, fileSet, analyses, resolver, edges, importersOf, contextEdges: [] }, sources: new Map(Object.entries(add)) }
}

function run(name, mutation, opts, expect) {
  const { graph, sources } = mutate(mutation)
  const { findings, stale } = checkInterop(graph, { sources, ...opts })
  const lines = findings.map(formatFinding)
  try {
    expect(findings, lines, stale)
    console.log(`ok   ${name}`)
  } catch (e) {
    console.log(`FAIL ${name}\n  ${e.message}\n  findings:\n    ${lines.slice(0, 40).join('\n    ')}`)
    process.exitCode = 1
  }
}

const has = (fs, pred, msg) => assert.ok(fs.some(pred), msg)
const hasNot = (fs, pred, msg) => assert.ok(!fs.some(pred), msg)
const at = (rule, from, to) => (f) => f.rule === rule && f.from === from && (to === undefined || f.to === to)
const ST = 'src/sagamore/__selftest__'

// --- baseline: whole graph clean (allowlist applied)
run('baseline: 0 errors with allowlist', {}, { allowlist: readAllowlist() }, (fs, _l, stale) => {
  assert.equal(fs.filter((f) => f.severity === 'error' && !f.allowed).length, 0)
  assert.deepEqual(stale, [])
})

// --- rule 1 + 5: cjs-value coffee target becomes `export default` -> coffee `X = require()` reported;
//     the TS importer gets a shim-stale warning (shims.d.ts declares 'sr/apps/collection')
const COLL = 'src/sagamore/apps/collection'
run(
  'rule 1 require-esm-default / rule 5 shim-stale: apps/collection.coffee -> export default',
  { remove: [`${COLL}.coffee`], add: { [`${COLL}.js`]: 'const Collection = {}\nexport default Collection\n' } },
  { files: [`${COLL}.coffee`] },
  (fs) => {
    has(fs, at('require-esm-default', 'src/sagamore/apps/cash_drawers.coffee', `${COLL}.js`), 'cash_drawers.coffee: SRAppsCollection = require(...)')
    const f = fs.find(at('require-esm-default', 'src/sagamore/apps/cash_drawers.coffee'))
    assert.equal(f.line, 3)
    has(fs, at('shim-stale', 'src/sagamore/apps/custom_fields.ts', `${COLL}.js`), 'custom_fields.ts shim-stale')
    hasNot(fs, at('default-missing', 'src/sagamore/apps/custom_fields.ts'), 'default import of an export-default module is fine')
    assert.ok(fs.every((f) => f.from.includes('collection') || f.to?.includes('collection') || f.rule === 'shim-stale'), '--files limits edges')
  },
)

// rule 1: require of an ESM default module used directly (value / call / new) and `.member` of a non-export
run(
  'rule 1 require-esm-default: direct use / non-exported member',
  {
    add: {
      [`${ST}/r1.coffee`]: [
        "Store = require('sr/store')",
        'Store.dispatch()',
        "x = require('sr/store')()",
        "y = require('sr/lib/pos_pin_lock').nope",
        "z = require('sr/lib/pos_pin_lock').default",
        "QS = require('sr/lib/query_string')",
        'QS.parse()',
        '',
      ].join('\n'),
    },
  },
  { files: [`${ST}/r1.coffee`] },
  (fs) => {
    const r = fs.filter((f) => f.rule === 'require-esm-default').map((f) => f.line)
    assert.deepEqual(r.sort(), [1, 3, 4], `lines ${r}`) // Store (member not exported), call, .nope; QS.parse is a real named export
  },
)

// --- rule 2: namespace misuse
run(
  'rule 2 namespace-misuse',
  {
    add: {
      [`${ST}/ns.js`]: [
        "import * as Store from 'sr/store'",
        "import * as QS from 'sr/lib/query_string'",
        "import * as Notif from 'sr/actions/notifications'",
        'Store()',
        'QS.parse(QS.nope)',
        'Notif.notifyError()',
        '',
      ].join('\n'),
      [`${ST}/ns2.coffee`]: "N = require('sr/actions/notifications')\nnew N()\n",
    },
  },
  { files: [`${ST}/ns.js`, `${ST}/ns2.coffee`] },
  (fs) => {
    has(fs, (f) => at('namespace-misuse', `${ST}/ns.js`)(f) && /Store.*call/.test(f.message), 'Store() call')
    has(fs, (f) => at('namespace-misuse', `${ST}/ns.js`)(f) && /QS\.nope/.test(f.message) && !/QS\.parse/.test(f.message), 'QS.nope')
    hasNot(fs, (f) => /Notif/.test(f.message), 'Notif.notifyError is exported')
    has(fs, at('namespace-misuse', `${ST}/ns2.coffee`), 'new on require() of named-only ESM')
  },
)

// --- rule 3: named-missing (ESM incl. export * recursion, cjs-object, cjs frozen literal), cjs-value warning
run(
  'rule 3 named-missing / named-from-cjs-value',
  {
    add: {
      [`${ST}/star_base.js`]: 'export const a = 1\nexport default 0\n',
      [`${ST}/star_index.js`]: "export * from './star_base'\nexport const b = 2\n",
      [`${ST}/named.js`]: [
        "import { a, b, c } from './star_index'",
        "import { default as d } from './star_index'",
        "import { parse, nope } from 'sr/lib/query_string'",
        "import { alerts, zzz } from 'sr/initial_state'",
        "import { foo } from 'sr/apps/collection'",
        "export { notifyError, notifyBogus } from 'sr/actions/notifications'",
        'console.log(a, b, c, d, parse, nope, alerts, zzz, foo)',
        '',
      ].join('\n'),
      [`${ST}/named.coffee`]: [
        "{ get, nope2 } = require('sr/lib/default_per_page')",
        "q = require('sr/lib/default_per_page').nope3",
        "{ alerts, nope4 } = require('sr/initial_state')",
        "{ fooBar } = require('sr/apps/collection')",
        '',
      ].join('\n'),
    },
  },
  { files: [`${ST}/named.js`, `${ST}/named.coffee`] },
  (fs) => {
    const msg = (from, line) => fs.filter((f) => f.rule === 'named-missing' && f.from === from && f.line === line).map((f) => f.message).join(' | ')
    assert.match(msg(`${ST}/named.js`, 1), /'c'/)
    assert.doesNotMatch(msg(`${ST}/named.js`, 1), /'a'|'b'/)
    assert.match(msg(`${ST}/named.js`, 2), /'default'/, 'star does not re-export default')
    assert.match(msg(`${ST}/named.js`, 3), /'nope'/)
    assert.doesNotMatch(msg(`${ST}/named.js`, 3), /'parse'/)
    assert.match(msg(`${ST}/named.js`, 4), /'zzz'/, 'deepFreeze({...}) keys are static')
    assert.doesNotMatch(msg(`${ST}/named.js`, 4), /'alerts'/)
    assert.match(msg(`${ST}/named.js`, 6), /'notifyBogus'/)
    assert.match(msg(`${ST}/named.coffee`, 1), /nope2/)
    assert.doesNotMatch(msg(`${ST}/named.coffee`, 1), /\bget\b/)
    assert.match(msg(`${ST}/named.coffee`, 2), /nope3/)
    assert.match(msg(`${ST}/named.coffee`, 3), /nope4/)
    assert.doesNotMatch(msg(`${ST}/named.coffee`, 3), /alerts/)
    has(fs, (f) => f.rule === 'named-from-cjs-value' && f.from === `${ST}/named.coffee` && f.line === 4, 'coffee destructure from cjs-value warning')
    has(fs, (f) => f.rule === 'named-from-cjs-value' && f.line === 5 && /'foo'/.test(f.message), 'cjs-value warning')
  },
)

// TS: interfaces/types are not runtime exports but importing them is fine; value use is not
run(
  'rule 3 TS type imports',
  {
    add: {
      [`${ST}/types.tsx`]: [
        "import { GridTableProps } from 'sr/components/purchasing/orders/allocation/grids/grid_table'",
        "import { Missing } from 'sr/components/purchasing/orders/allocation/grids/grid_table'",
        'const p: GridTableProps | null = null',
        'console.log(p, Missing)',
        '',
      ].join('\n'),
    },
  },
  { files: [`${ST}/types.tsx`] },
  (fs) => {
    hasNot(fs, (f) => f.line === 1, 'exported interface')
    has(fs, (f) => f.rule === 'named-missing' && f.line === 2, 'missing value import')
  },
)

// --- rule 4: default-missing
run(
  'rule 4 default-missing',
  {
    add: {
      [`${ST}/def.js`]: [
        "import DefaultPerPage from 'sr/lib/default_per_page'",
        "import Unused from 'sr/lib/default_per_page'",
        "import Notifications from 'sr/actions/notifications'",
        "import Nothing from 'sr/__selftest__/empty'",
        'DefaultPerPage.get()',
        'Notifications.notifyError()',
        'Nothing()',
        '',
      ].join('\n'),
      [`${ST}/empty.coffee`]: 'Sagamore.SelfTest = 1\n',
      [`${ST}/def.coffee`]: "x = require('sr/actions/notifications').default\n",
    },
  },
  { files: [`${ST}/def.js`, `${ST}/def.coffee`] },
  (fs) => {
    const lines = fs.filter((f) => f.rule === 'default-missing').map((f) => `${f.from.replace(`${ST}/`, '')}:${f.line}`).sort()
    assert.deepEqual(lines, ['def.coffee:1', 'def.js:1', 'def.js:3', 'def.js:4'])
  },
)

// jest.mock factories replace the target's shape for the mocking file
run(
  'rules 1-4 use the jest.mock factory shape in the mocking file',
  {
    add: {
      [`${ST}/__tests__/m1.test.js`]: "import D from 'sr/lib/default_per_page'\njest.mock('sr/lib/default_per_page', () => ({ set: jest.fn() }))\nD.set()\n",
      [`${ST}/__tests__/m2.test.js`]: "import D from 'sr/lib/default_per_page'\njest.mock('sr/lib/default_per_page', () => ({ __esModule: true, set: jest.fn() }))\nD.set()\n",
      [`${ST}/__tests__/m3.test.js`]: "jest.mock('sr/store', () => { const actual = jest.requireActual('sr/store'); return actual })\n",
    },
  },
  { files: [`${ST}/__tests__/m1.test.js`, `${ST}/__tests__/m2.test.js`, `${ST}/__tests__/m3.test.js`] },
  (fs) => {
    hasNot(fs, (f) => f.from.endsWith('m1.test.js') && f.severity === 'error', 'no __esModule: default import = whole object')
    has(fs, at('default-missing', `${ST}/__tests__/m2.test.js`), '__esModule without default')
    hasNot(fs, (f) => f.from.endsWith('m3.test.js') && f.severity === 'error', 'requireActual pass-through')
  },
)

// --- rule 6: duplicate
run(
  'rule 6 coffee-js-duplicate (error; knownDuplicates -> warning)',
  { add: { [`${COLL}.js`]: 'export default {}\n' } },
  { files: [`${COLL}.js`, 'src/sagamore/lib/active_resource.js'] },
  (fs) => {
    const d = fs.find(at('coffee-js-duplicate', `${COLL}.coffee`, `${COLL}.js`))
    assert.equal(d?.severity, 'error')
    assert.equal(fs.find(at('coffee-js-duplicate', 'src/sagamore/lib/active_resource.coffee'))?.severity, 'warning')
  },
)

// --- rule 7: mock-shape
run(
  'rule 7 mock-shape',
  {
    add: {
      // footer.coffee does `ProgressImitator = require('sr/lib/progress_imitator')` (cjs-value)
      [`${ST}/__tests__/ms1.test.js`]: "import 'sr/components/pos/footer'\njest.mock('sr/lib/progress_imitator', () => ({ __esModule: true, default: jest.fn() }))\n",
      // app.coffee does `store = require('sr/store').default` (esm-default)
      [`${ST}/__tests__/ms2.test.js`]: "import 'sr/app'\njest.mock('sr/store', () => ({ dispatch: jest.fn() }))\n",
      // same mock, but nothing loaded reads it without interop
      [`${ST}/__tests__/ms3.test.js`]: "import store from 'sr/store'\njest.mock('sr/store', () => ({ dispatch: jest.fn() }))\nstore.dispatch()\n",
    },
  },
  { files: [`${ST}/__tests__/ms1.test.js`, `${ST}/__tests__/ms2.test.js`, `${ST}/__tests__/ms3.test.js`] },
  (fs) => {
    has(fs, (f) => at('mock-shape', `${ST}/__tests__/ms1.test.js`)(f) && /footer\.coffee/.test(f.message), 'cjs target + __esModule')
    has(fs, (f) => at('mock-shape', `${ST}/__tests__/ms2.test.js`)(f) && /app\.coffee/.test(f.message), 'esm-default target without default')
    hasNot(fs, at('mock-shape', `${ST}/__tests__/ms3.test.js`), 'no raw consumer')
  },
)

// --- rule 8 + karma tag + vendor ignored + loader prefix
run(
  'rule 8 unresolved, [karma] tag, vendor ignored, loader prefix skipped',
  {
    add: {
      [`${ST}/unres.js`]: "import x from 'sr/does/not/exist'\nimport y from './nope'\nconsole.log(x, y)\n",
      'src/DEPRECATED_spec/__selftest___spec.js': "import Notifications from 'sr/actions/notifications'\nNotifications.notifyError()\n",
      'src/vendor/__selftest__.js': "import Notifications from 'sr/actions/notifications'\nNotifications.notifyError()\n",
      [`${ST}/loader.js`]: "import inj from 'inject-loader?x!sr/actions/notifications'\ninj()\n",
    },
  },
  { files: [`${ST}/unres.js`, 'src/DEPRECATED_spec/__selftest___spec.js', 'src/vendor/__selftest__.js', `${ST}/loader.js`] },
  (fs, lines) => {
    assert.equal(fs.filter(at('unresolved', `${ST}/unres.js`)).length, 2)
    assert.ok(fs.every((f) => f.rule !== 'unresolved' || f.severity === 'warning'))
    assert.ok(lines.some((l) => l.startsWith('error [default-missing] [karma] src/DEPRECATED_spec/__selftest___spec.js:1 -> src/sagamore/actions/notifications.js: ')), 'karma tag + line format')
    hasNot(fs, (f) => f.from.startsWith('src/vendor/'), 'vendor ignored')
    hasNot(fs, (f) => f.from === `${ST}/loader.js`, 'loader prefix')
  },
)

// --- allowlist
run(
  'allowlist: allowed + stale',
  { add: { [`${ST}/al.js`]: "import N from 'sr/actions/notifications'\nN()\n" } },
  { allowlist: new Map([[`default-missing|${ST}/al.js|src/sagamore/actions/notifications.js`, 'test'], ['named-missing|src/x.js|src/y.js', 'stale']]) },
  (fs, _l, stale) => {
    assert.equal(fs.find(at('default-missing', `${ST}/al.js`))?.allowed, 'test')
    assert.deepEqual(stale, ['named-missing|src/x.js|src/y.js'])
  },
)

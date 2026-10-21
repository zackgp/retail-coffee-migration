/**
 * G4 (PLAN.md §3): export-shape snapshots of migrated CoffeeScript modules.
 *
 * One snapshot per module in <dataDir>/shapes/<module__key>.json of the retail-coffee-migration
 * repo (not in the target PR), recorded from the .coffee source BEFORE conversion. Each snapshot
 * stores recordedFrom and recordedSha (git blob sha of that .coffee); verify.sh step 0b checks
 * the sha against the target's merge base. Afterwards the converted JS must keep a compatible
 * shape (see ../helpers/compare_shapes.js).
 *
 * Record (host: tools/record_shapes.sh Bxx; it runs this in the sr_web container):
 *   UPDATE_COFFEE_SHAPES=1 COFFEE_SHAPES_MODULES="src/sagamore/lib/util.coffee,…" yarn jest coffee-tools/jest/tests/export_shapes
 *   UPDATE_COFFEE_SHAPES=1 yarn jest coffee-tools/jest/tests/export_shapes   # re-record existing snapshots
 *
 * The whole app (vendor + main) is loaded once with Sagamore.* writes traced, so modules load
 * with the same globals as in the browser and each module's own registrations are known.
 */
import fs from 'node:fs'
import path from 'node:path'

import { SRC } from '../helpers/webpack_runtime'
import { describeModule, moduleKey, typeOf } from '../helpers/describe_value'
import { compareShapes } from '../helpers/compare_shapes'
import { loadLegacyApp, quietly } from '../helpers/legacy_app'
import { SHAPES_DIR, gitBlobSha } from '../helpers/tool_paths'

const UPDATE = process.env.UPDATE_COFFEE_SHAPES === '1'
const requested = (process.env.COFFEE_SHAPES_MODULES || '')
  .split(/[\s,]+/)
  .filter(Boolean)
  .map((p) => moduleKey(p.replace(/^apps\/monolith\//, '')))

const fileFor = (key) => path.join(SHAPES_DIR, `${key.replace(/\//g, '__')}.json`)
const existing = fs.existsSync(SHAPES_DIR)
  ? fs
      .readdirSync(SHAPES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(SHAPES_DIR, f), 'utf8')).module)
      .sort()
  : []
const targets = UPDATE && requested.length ? requested : existing

const sortedRegistrations = (m, identify) =>
  Object.fromEntries(
    [...(m || new Map()).entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, v]) => [p, { type: typeOf(v), id: typeof v === 'function' || (v && typeof v === 'object') ? identify(v) : null }]),
  )

if (!targets.length) {
  test('no export-shape snapshots recorded yet', () => {
    expect(existing).toEqual([])
  })
} else {
  let app

  beforeAll(() => {
    app = loadLegacyApp({ track: true, strict: false })
  }, 600000)

  afterAll(() => {
    if (app && app.tracker) app.tracker.restore()
  })

  test('the legacy app (vendor + main) still loads', () => {
    expect(app.error && String(app.error.stack || app.error).split('\n').slice(0, 6).join('\n')).toBeNull()
  })

  describe('CoffeeScript migration export shapes', () => {
    test.each(targets)('%s', (key) => {
      const current = { module: key }
      try {
        const file = require.resolve(path.join(SRC, key))
        current.recordedFrom = path.relative(path.join(SRC, '..'), file)
        current.recordedSha = gitBlobSha(fs.readFileSync(file))
        // eslint-disable-next-line import/no-dynamic-require, global-require -- modules are chosen at runtime from the snapshot list
        const m = quietly(() => require(file))
        app.invalidate()
        current.shape = describeModule(m, app.identify)
      } catch (e) {
        ;[current.loadError] = String((e && e.message) || e).split('\n')
      }
      current.registrations = sortedRegistrations(app.tracker.registrations.get(key), app.identify)

      if (UPDATE) {
        fs.mkdirSync(SHAPES_DIR, { recursive: true })
        fs.writeFileSync(fileFor(key), `${JSON.stringify(current, null, 1)}\n`)
        return
      }
      const recorded = JSON.parse(fs.readFileSync(fileFor(key), 'utf8'))
      expect(compareShapes(recorded, current)).toEqual([])
    })
  })
}

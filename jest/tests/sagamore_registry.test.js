/* global window */
/**
 * G5 (PLAN.md §3): runtime Sagamore registry snapshot.
 *
 * Loads vendor + main exactly like karma-entry.js, walks window.Sagamore (depth <= 5) and
 * compares every key path and its type with <dataDir>/sagamore_registry.json (in the
 * retail-coffee-migration repo). Also records the route tables (Sagamore.Apps.*.prototype.routes
 * and the apps.coffee `Sagamore.appOptions` table) and checks the public globals of
 * <dataDir>/public_globals.json are still registered.
 *
 * Any change must be re-recorded (and committed in the tools repo) and explained in the target
 * PR description; verify.sh step 0b needs ALLOW_REGISTRY_CHANGE=1 while it is uncommitted:
 *   tools/sr_web.sh env UPDATE_COFFEE_REGISTRY=1 yarn jest coffee-tools/jest/tests/sagamore_registry
 */
import fs from 'node:fs'
import path from 'node:path'

import { registryPaths, typeOf } from '../helpers/describe_value'
import { loadLegacyApp, quietly } from '../helpers/legacy_app'
import { DATA_DIR } from '../helpers/tool_paths'

const SNAPSHOT = path.join(DATA_DIR, 'sagamore_registry.json')
const PUBLIC = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'public_globals.json'), 'utf8')).globals
const UPDATE = process.env.UPDATE_COFFEE_REGISTRY === '1'

const getPath = (p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), window)

function routesOf(appClass, identify) {
  const routes = appClass && appClass.prototype && appClass.prototype.routes
  if (!routes) return null
  const r = typeof routes === 'function' ? routes.call(appClass.prototype) : routes
  return Object.fromEntries(Object.keys(r).map((k) => [k, typeof r[k] === 'string' ? r[k] : identify(r[k])]))
}

function diff(recorded, current) {
  const problems = []
  Object.keys({ ...recorded, ...current })
    .sort()
    .forEach((k) => {
      const a = JSON.stringify(recorded[k])
      const b = JSON.stringify(current[k])
      if (a === b) return
      if (!(k in current)) problems.push(`removed ${k} (was ${a})`)
      else if (!(k in recorded)) problems.push(`added ${k}: ${b}`)
      else problems.push(`changed ${k}: ${a} -> ${b}`)
    })
  return problems
}

describe('Sagamore runtime registry (main + apps)', () => {
  const current = {}
  let identify

  beforeAll(() => {
    const app = loadLegacyApp()
    ;({ identify } = app)
    const root = window.Sagamore
    current.paths = registryPaths(root)
    current.appsRoutes = Object.fromEntries(
      Object.entries(current.paths)
        .filter(([p, t]) => p.startsWith('Sagamore.Apps.') && (t === 'function' || t === 'es-class'))
        .map(([p]) => [p, routesOf(getPath(p), identify)]),
    )
    current.layouts = Object.keys(root.Components.Layouts || {}).sort()
    const errors = (root.Components.Imports && root.Components.Imports.Errors) || {}
    current.importErrorDetails = Object.keys(errors.Details || {}).sort()
    current.importErrorResolvers = Object.fromEntries(
      Object.keys(errors.Resolvers || {})
        .sort()
        .map((k) => [k, typeOf(errors.Resolvers[k]) === 'object' ? Object.keys(errors.Resolvers[k]).sort() : typeOf(errors.Resolvers[k])]),
    )
    current.formats = Object.keys(root.Formats || {}).sort()

    // apps.coffee is a separate webpack entry on top of main: its route table
    quietly(() => app.runtime.require('./apps'))
    app.invalidate()
    current.appOptions = (root.appOptions || []).map((o) => ({
      module: o.module ?? null,
      prefix: o.prefix ?? null,
      appClass: o.appClass ? identify(o.appClass) : null,
      routes: routesOf(o.appClass, identify),
    }))

    if (UPDATE) fs.writeFileSync(SNAPSHOT, `${JSON.stringify(current, null, 1)}\n`)
  }, 600000)

  const recorded = () => JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'))

  test('registry key paths and types are unchanged', () => {
    expect(diff(recorded().paths, current.paths)).toEqual([])
  })

  test('Sagamore.Apps.* route tables are unchanged', () => {
    expect(diff(recorded().appsRoutes, current.appsRoutes)).toEqual([])
  })

  test('dynamic registries (Layouts, Imports.Errors.*, Formats) are unchanged', () => {
    const r = recorded()
    const pick = (o) => ({ layouts: o.layouts, importErrorDetails: o.importErrorDetails, importErrorResolvers: o.importErrorResolvers, formats: o.formats })
    expect(diff(pick(r), pick(current))).toEqual([])
  })

  test('apps.coffee route table (Sagamore.appOptions) is unchanged', () => {
    const asMap = (list) => Object.fromEntries(list.map((o, i) => [`${String(i).padStart(2, '0')} ${o.prefix ?? '(root)'}`, o]))
    expect(diff(asMap(recorded().appOptions), asMap(current.appOptions))).toEqual([])
  })

  test('public globals are still registered (never delete; see public_globals.json)', () => {
    const missing = PUBLIC.filter((g) => g.registeredIn && typeOf(getPath(g.path)) === 'undefined').map((g) => g.path)
    expect(missing).toEqual([])
  })
})

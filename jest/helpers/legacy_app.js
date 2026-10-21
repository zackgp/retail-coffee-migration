/* global window */
/* eslint-disable no-console, no-underscore-dangle -- silences the legacy app while loading; reads __esModule */
// Loads the whole legacy app once (vendor + main, like karma-entry.js) with Sagamore
// registrations being traced, and provides value -> stable identity lookups.
import { createWebpackRuntime, loadMain } from './webpack_runtime'
import { moduleKey, reverseRegistry, trackSagamore } from './describe_value'

const CONSOLE_METHODS = ['log', 'info', 'debug', 'warn', 'error']

/** Runs fn with console output suppressed (the legacy app is very chatty while loading). */
export function quietly(fn) {
  const saved = CONSOLE_METHODS.map((m) => [m, console[m]])
  CONSOLE_METHODS.forEach((m) => {
    console[m] = () => {}
  })
  try {
    return fn()
  } finally {
    saved.forEach(([m, f]) => {
      console[m] = f
    })
  }
}

/**
 * Loads vendor + main. A load failure is returned as `error` (not thrown) unless `strict`, so
 * snapshot tests can report "the app no longer loads" and still compare individual modules.
 */
export function loadLegacyApp({ track = false, strict = true } = {}) {
  const tracker = track ? trackSagamore() : null
  const runtime = createWebpackRuntime()
  let error = null
  try {
    quietly(() => loadMain({}, runtime))
  } catch (e) {
    if (strict) throw e
    error = e
  }
  const raw = tracker ? tracker.raw : window.Sagamore
  let byValue = null
  const identify = (value) => {
    const v = tracker ? tracker.unwrap(value) : value
    if (!byValue) {
      byValue = new Map()
      runtime.modules().forEach(([file, exp]) => {
        const val = exp && exp.__esModule ? exp.default : exp
        if ((typeof val === 'function' || (val && typeof val === 'object')) && !byValue.has(val)) byValue.set(val, `module:${moduleKey(file)}`)
      })
      reverseRegistry(raw).forEach((p, val) => {
        if (!byValue.has(val)) byValue.set(val, p)
      })
    }
    if (byValue.has(v)) return byValue.get(v)
    return `name:${(v && (v.displayName || v.name)) || 'anonymous'}`
  }
  return {
    runtime,
    tracker,
    identify,
    error,
    invalidate: () => {
      byValue = null
    },
  }
}

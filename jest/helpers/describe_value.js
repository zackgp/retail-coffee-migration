/* eslint-disable no-underscore-dangle, react/forbid-foreign-prop-types -- inspects Backbone/React internals (__super__, __reactAutoBindPairs, propTypes) of exported values */
/* global window */
// Shared helpers for the CoffeeScript migration snapshot tests (PLAN.md G4/G5):
// describing a module's export shape, walking the Sagamore registry, and attributing
// Sagamore.* registrations to the file that performed them.
import path from 'node:path'
import { SRC } from './webpack_runtime'

const isPlainObject = (v) => {
  if (!v || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

export function fnKind(f) {
  return /^class[\s{]/.test(Function.prototype.toString.call(f)) ? 'es-class' : 'function'
}

/** coarse type used in registry snapshots and object-export key maps */
export function typeOf(v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'function') return fnKind(v)
  if (typeof v === 'object') return isPlainObject(v) ? 'object' : 'instance'
  return typeof v
}

/** `src/sagamore/lib/util.coffee` | absolute path -> `sagamore/lib/util` */
export function moduleKey(file) {
  const rel = path.isAbsolute(file) ? path.relative(SRC, file) : file.replace(/^src\//, '')
  return rel.split(path.sep).join('/').replace(/\.(coffee|jsx?|tsx?|mjs|cjs)$/, '')
}

// ------------------------------------------------------------------ registry walk

// Registrations also hang off function values used as namespaces, e.g.
// `Sagamore.Apps.Integrations.Clover` where `Sagamore.Apps.Integrations` is an App class.
// Such static members are followed when their name starts with an upper-case letter.
const isNamespaceKey = (k) => /^[A-Z]/.test(k)
const descendable = (v) => isPlainObject(v) || typeof v === 'function'
const childKeys = (obj) => (typeof obj === 'function' ? Object.keys(obj).filter(isNamespaceKey) : Object.keys(obj))

/** { 'Sagamore.A.B': type } for namespaces (plain objects, upper-case statics of functions). */
export function registryPaths(root, rootName = 'Sagamore', maxDepth = 8) {
  const out = {}
  const seen = new Set()
  const walk = (obj, prefix, depth) => {
    if (seen.has(obj)) return
    seen.add(obj)
    childKeys(obj)
      .sort()
      .forEach((k) => {
        const v = obj[k]
        const p = `${prefix}.${k}`
        out[p] = typeOf(v)
        if (depth < maxDepth && descendable(v)) walk(v, p, depth + 1)
      })
  }
  walk(root, rootName, 1)
  return out
}

/** Map value -> first registry path holding it (functions and plain objects only). */
export function reverseRegistry(root, rootName = 'Sagamore', maxDepth = 8) {
  const map = new Map()
  const seen = new Set()
  const walk = (obj, prefix, depth) => {
    if (seen.has(obj)) return
    seen.add(obj)
    childKeys(obj)
      .sort()
      .forEach((k) => {
        const v = obj[k]
        const p = `${prefix}.${k}`
        if (descendable(v) && !map.has(v)) map.set(v, p)
        if (depth < maxDepth && descendable(v)) walk(v, p, depth + 1)
      })
  }
  walk(root, rootName, 1)
  return map
}

// ------------------------------------------------------------------ registration tracking

const TRACKER_FILES = [__filename, path.dirname(__dirname), path.join(SRC, 'sagamore_init_shim.js'), path.join(SRC, 'jest_helpers')]

function callerFile() {
  const prev = Error.stackTraceLimit
  Error.stackTraceLimit = 30
  const stack = new Error().stack || ''
  Error.stackTraceLimit = prev
  const files = [...stack.matchAll(/\(?((?:\/|[A-Za-z]:\\)[^():]+):\d+:\d+\)?$/gm)].map((m) => m[1])
  return files.find((f) => f.startsWith(SRC) && !TRACKER_FILES.some((t) => f.startsWith(t)) && !f.includes('/vendor/')) || null
}

/**
 * Replaces `global.Sagamore` with a recording proxy (plain-object namespaces are proxied
 * recursively). Every assignment is attributed to the first src/ stack frame.
 * Returns { registrations: Map<moduleKey, Map<path, value>>, ... }.
 */
export function trackSagamore(rootName = 'Sagamore') {
  const raw = window[rootName]
  const proxies = new WeakMap()
  const targets = new WeakMap()
  const registrations = new Map()
  const record = (p, value) => {
    const file = callerFile()
    const key = file ? moduleKey(file) : '(unknown)'
    if (!registrations.has(key)) registrations.set(key, new Map())
    registrations.get(key).set(p, value)
  }
  const wrap = (obj, prefix) => {
    // functions are only proxied when reached as namespaces (Sagamore.X.Y with Y upper-case) and
    // only their upper-case members are followed, so prototype/extend/__super__ stay untouched
    const isFn = typeof obj === 'function'
    if (!isPlainObject(obj) && !isFn) return obj
    if (proxies.has(obj)) return proxies.get(obj)
    const follows = (prop) => typeof prop === 'string' && (!isFn || isNamespaceKey(prop))
    const proxy = new Proxy(obj, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver)
        return follows(prop) && isNamespaceKey(prop) ? wrap(v, `${prefix}.${prop}`) : v
      },
      set(target, prop, value, receiver) {
        const v = targets.get(value) || value
        if (follows(prop)) record(`${prefix}.${prop}`, v)
        return Reflect.set(target, prop, v, isFn ? target : receiver)
      },
      defineProperty(target, prop, desc) {
        if (follows(prop)) record(`${prefix}.${prop}`, desc.value)
        return Reflect.defineProperty(target, prop, desc)
      },
    })
    proxies.set(obj, proxy)
    targets.set(proxy, obj)
    return proxy
  }
  window[rootName] = wrap(raw, rootName)
  return {
    registrations,
    unwrap: (v) => targets.get(v) || v,
    raw,
    restore() {
      window[rootName] = raw
    },
  }
}

// ------------------------------------------------------------------ export shape

const DATA_PROPS = ['model', 'collection', 'template']
const IGNORED_STATICS = new Set(['length', 'name', 'prototype', 'arguments', 'caller'])
// methods every createReactClass / React.Component instance inherits
const REACT_BASE_METHODS = new Set(['constructor', 'setState', 'forceUpdate', 'replaceState', 'isMounted', 'isReactComponent'])

function baseProtos() {
  const out = new Set([Object.prototype, Function.prototype])
  const { Backbone } = window
  if (Backbone) {
    ;['View', 'Model', 'Collection', 'Router', 'History'].forEach((k) => Backbone[k] && out.add(Backbone[k].prototype))
  }
  try {
    // eslint-disable-next-line global-require
    const React = require('react')
    out.add(React.Component.prototype)
    out.add(React.PureComponent.prototype)
  } catch (e) {
    // react not available
  }
  return out
}

function jsonSafe(v, depth = 0) {
  if (v === undefined) return { $undefined: true }
  if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) return v
  if (typeof v === 'function') return { $fn: typeOf(v) }
  if (depth > 3) return { $deep: typeOf(v) }
  if (Array.isArray(v)) return v.map((x) => jsonSafe(x, depth + 1))
  if (isPlainObject(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, jsonSafe(v[k], depth + 1)]))
  return { $instance: (v.constructor && v.constructor.name) || 'object' }
}

/**
 * Names assigned as `this.x = ...` in a class/constructor body (class fields after
 * transpilation). `this.m = this.m.bind(this)` is a binding of an existing method, not a field,
 * so it does not count (it must not mask a method that was lost).
 */
function instanceFieldNames(f) {
  const src = Function.prototype.toString.call(f)
  const names = new Set()
  for (const m of src.matchAll(/this\.([A-Za-z_$][\w$]*)\s*=(?!=)\s*([^\n;]{0,80})/g)) {
    const rhs = m[2]
    if (!new RegExp(`^(this\\.)?${m[1].replace(/\$/g, '\\$')}\\.bind\\b`).test(rhs)) names.add(m[1])
  }
  return [...names].sort()
}

function describeDataProp(v, name, identify) {
  if (v === undefined) return undefined
  if (name === 'model' || name === 'collection') return typeof v === 'function' ? identify(v) : typeOf(v)
  if (name === 'template') return typeof v === 'function' ? v.templatePath || typeOf(v) : jsonSafe(v)
  if (typeof v === 'function') return { $fn: typeOf(v) }
  return jsonSafe(v)
}

/**
 * Describes a function export: kind, React metadata, statics, prototype methods and the
 * Backbone data properties listed in PLAN.md G4.
 */
export function describeFunction(f, identify) {
  const stops = baseProtos()
  const d = {
    type: 'function',
    kind: fnKind(f),
    isReactComponent: !!(f.prototype && f.prototype.isReactComponent),
    createReactClass: !!(f.prototype && f.prototype.__reactAutoBindPairs),
    displayName: f.displayName ?? null,
    propTypes: f.propTypes ? Object.keys(f.propTypes).sort() : null,
    contextTypes: f.contextTypes ? Object.keys(f.contextTypes).sort() : null,
    defaultProps: f.defaultProps ? jsonSafe(f.defaultProps) : null,
    statics: Object.getOwnPropertyNames(f)
      .filter((k) => !IGNORED_STATICS.has(k))
      .sort(),
    hasExtend: typeof f.extend === 'function',
    hasSuper: Object.prototype.hasOwnProperty.call(f, '__super__'),
    methods: [],
    instanceFields: instanceFieldNames(f),
    data: {},
  }
  const methods = new Set()
  const dataNames = new Set(DATA_PROPS)
  for (let p = f.prototype; p && !stops.has(p); p = Object.getPrototypeOf(p)) {
    Object.getOwnPropertyNames(p).forEach((k) => {
      const desc = Object.getOwnPropertyDescriptor(p, k)
      if (!desc || k === 'constructor' || REACT_BASE_METHODS.has(k) || k === '__reactAutoBindPairs') return
      if (typeof desc.value === 'function' && !DATA_PROPS.includes(k)) methods.add(k)
      else if (desc.get || desc.set) methods.add(`get ${k}`)
      else dataNames.add(k)
    })
  }
  d.methods = [...methods].sort()
  if (f.prototype) {
    // every prototype data property (routes, events, tagName, className, defaults, idAttribute,
    // urlRoot, url, template, title, layout, ...), including inherited ones below the stop bases
    ;[...dataNames].sort().forEach((k) => {
      const v = describeDataProp(f.prototype[k], k, identify)
      if (v !== undefined) d.data[k] = v
    })
  }
  return d
}

/** Full shape record for a module object as returned by require(). */
export function describeModule(m, identify = (v) => v.displayName || v.name || 'anonymous') {
  const esModule = !!(m && m.__esModule)
  const value = esModule ? m.default ?? m : m
  const named = esModule ? Object.keys(m).filter((k) => k !== 'default' && k !== '__esModule').sort() : []
  const shape = { esModule, named }
  const describe = (v) => {
    if (typeof v === 'function') return describeFunction(v, identify)
    if (isPlainObject(v) || (esModule && v === m)) {
      return {
        type: 'object',
        keys: Object.fromEntries(
          Object.keys(v)
            .filter((k) => k !== '__esModule')
            .sort()
            .map((k) => [k, typeOf(v[k])]),
        ),
      }
    }
    return { type: typeOf(v), value: jsonSafe(v) }
  }
  shape.value = describe(value)
  return shape
}

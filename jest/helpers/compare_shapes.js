/* eslint-disable react/forbid-foreign-prop-types -- compares recorded propTypes/contextTypes key lists, not component propTypes */
// Comparison rules for the G4 export-shape snapshots (PLAN.md §3 G4).
// Returns a list of human-readable problems; [] means compatible.
//
// Allowed differences:
//   - createReactClass -> ES class: kind function -> es-class; createReactClass internals
//     (getDefaultProps, getInitialState, __reactAutoBindPairs, mixins…) may disappear;
//     defaultProps must stay equal; business methods may move to class fields.
//   - additions (new methods, statics, named exports, object keys) are allowed.
// Hard rules:
//   - anything recorded with a static `extend` or `__super__` (Backbone hierarchy) must stay a
//     plain `function` (never an ES class) and keep `extend`;
//   - a module that loaded when recorded must still load.
// createReactClass internals that legitimately disappear when converting to a class component.
// (childContextTypes / getChildContext must be kept: dropping them breaks context consumers.)
const CRC_INTERNAL_STATICS = new Set(['getDefaultProps'])
const CRC_INTERNAL_METHODS = new Set(['getInitialState', 'getDefaultProps'])
const OPTIONAL_STATICS = new Set(['displayName', 'propTypes', 'contextTypes', 'defaultProps'])

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function compareFunction(rec, cur, where, problems) {
  const p = (msg) => problems.push(`${where}: ${msg}`)
  if (cur.type !== 'function') {
    p(`was a function (${rec.kind}), now ${cur.type}`)
    return
  }
  const backbone = rec.hasExtend || rec.hasSuper
  if (backbone) {
    if (cur.kind !== 'function') p('Backbone-style class (has extend/__super__) became an ES class — use .extend (PLAN.md §6.2)')
    if (rec.hasExtend && !cur.hasExtend) p('lost static extend()')
    if (rec.hasSuper && !cur.hasSuper) p('lost __super__ (not created with .extend?)')
  } else if (rec.kind !== cur.kind) {
    const crcToClass = rec.kind === 'function' && cur.kind === 'es-class' && rec.isReactComponent
    if (!crcToClass) p(`kind ${rec.kind} -> ${cur.kind}`)
  }
  if (rec.isReactComponent !== cur.isReactComponent) p(`isReactComponent ${rec.isReactComponent} -> ${cur.isReactComponent}`)
  if (rec.displayName !== null && rec.displayName !== cur.displayName) p(`displayName ${JSON.stringify(rec.displayName)} -> ${JSON.stringify(cur.displayName)}`)
  if (!eq(rec.propTypes, cur.propTypes)) p(`propTypes keys ${JSON.stringify(rec.propTypes)} -> ${JSON.stringify(cur.propTypes)}`)
  if (!eq(rec.contextTypes, cur.contextTypes)) p(`contextTypes keys ${JSON.stringify(rec.contextTypes)} -> ${JSON.stringify(cur.contextTypes)}`)
  if (!eq(rec.defaultProps, cur.defaultProps)) p(`defaultProps ${JSON.stringify(rec.defaultProps)} -> ${JSON.stringify(cur.defaultProps)}`)

  const curStatics = new Set(cur.statics)
  const lostStatics = rec.statics.filter(
    (s) => !curStatics.has(s) && !OPTIONAL_STATICS.has(s) && !(rec.createReactClass && CRC_INTERNAL_STATICS.has(s)),
  )
  if (lostStatics.length) p(`lost statics: ${lostStatics.join(', ')}`)

  const curMethods = new Set([...cur.methods, ...cur.instanceFields])
  const lostMethods = rec.methods.filter((m) => !curMethods.has(m) && !(rec.createReactClass && CRC_INTERNAL_METHODS.has(m)))
  if (lostMethods.length) p(`lost methods: ${lostMethods.join(', ')}`)

  const keys = new Set([...Object.keys(rec.data), ...Object.keys(cur.data)])
  keys.forEach((k) => {
    if (eq(rec.data[k], cur.data[k])) return
    // createReactClass spec data may become a class field (instance property) of the class component
    if (rec.createReactClass && !(k in cur.data) && cur.instanceFields.includes(k)) return
    p(`prototype.${k} ${JSON.stringify(rec.data[k])} -> ${JSON.stringify(cur.data[k])}`)
  })
}

function compareKeyTypes(rec, cur, k, where, problems) {
  if (rec === cur) return
  const crcLike = rec === 'function' && cur === 'es-class'
  if (!crcLike) problems.push(`${where}: key ${k} ${rec} -> ${cur}`)
}

// eslint-disable-next-line import/prefer-default-export -- named export matches the other coffee_migration helpers
export function compareShapes(recorded, current) {
  const problems = []
  // a module that could not be loaded when recorded has no shape to compare against: fail so the
  // batch fixes the load (or records why) instead of silently skipping G4
  if (recorded.loadError) return [`recorded snapshot has loadError (${recorded.loadError}); G4 cannot protect this module`]
  if (current.loadError) return [`module no longer loads: ${current.loadError}`]
  const rv = recorded.shape.value
  const cv = current.shape.value
  if (rv.type === 'function') compareFunction(rv, cv, 'export', problems)
  else if (rv.type === 'object') {
    if (cv.type !== 'object') problems.push(`export: was an object (keys ${Object.keys(rv.keys).join(', ')}), now ${cv.type}`)
    else {
      Object.entries(rv.keys).forEach(([k, t]) => {
        if (!(k in cv.keys)) problems.push(`export: lost key ${k}`)
        else compareKeyTypes(t, cv.keys[k], k, 'export', problems)
      })
    }
  } else if (rv.type !== cv.type || !eq(rv.value, cv.value)) {
    problems.push(`export: ${rv.type} ${JSON.stringify(rv.value)} -> ${cv.type} ${JSON.stringify(cv.value)}`)
  }
  const curNamed = new Set(current.shape.named)
  const lostNamed = recorded.shape.named.filter((n) => !curNamed.has(n))
  if (lostNamed.length) problems.push(`lost named exports: ${lostNamed.join(', ')}`)

  const rr = recorded.registrations || {}
  const cr = current.registrations || {}
  const crcExport = rv.type === 'function' && rv.isReactComponent && !rv.hasExtend && !rv.hasSuper
  Object.keys({ ...rr, ...cr })
    .sort()
    .forEach((k) => {
      if (!(k in cr)) problems.push(`no longer registers ${k}`)
      else if (!(k in rr)) problems.push(`newly registers ${k} (${JSON.stringify(cr[k])})`)
      else {
        const a = rr[k]
        const b = cr[k]
        if (a.type !== b.type && !(a.type === 'function' && b.type === 'es-class' && crcExport)) problems.push(`registration ${k}: ${a.type} -> ${b.type}`)
        if (a.id !== b.id) problems.push(`registration ${k} now holds ${b.id} (was ${a.id})`)
      }
    })
  return problems
}

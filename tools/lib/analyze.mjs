// Static analysis of a single source file (coffee / js / jsx / ts / tsx).
//
// CoffeeScript files are compiled with the repo-pinned coffeescript 1.12.7 (`bare: true`)
// and the JS output is analysed exactly like a JS file; line numbers are mapped back to
// the .coffee source through the compiler's source map.
//
// Produces:
//   imports  – every import / require / re-export / dynamic import with how the binding is used
//   contexts – require.context(...) calls
//   mocks    – jest.mock(...) calls and the shape their factory returns
//   exports  – ESM / CJS export shape
//   globals  – Sagamore.* assignments and reads (including through local aliases)
import fs from 'node:fs'
import { loadCoffee, loadTs } from './deps.mjs'
import { abs, rel } from './paths.mjs'
import { langOf } from './files.mjs'

const SAGAMORE_ROOTS = new Set(['Sagamore'])
const GLOBAL_OBJECTS = new Set(['window', 'global', 'globalThis'])

export function compileCoffee(src, opts = {}) {
  return loadCoffee().compile(src, { bare: true, ...opts })
}

/** Reads and analyses one file. `relPath` is monolith-relative. */
export function analyzeFile(relPath) {
  const source = fs.readFileSync(abs(relPath), 'utf8')
  return analyzeSource(relPath, source)
}

export function analyzeSource(relPath, source) {
  const lang = langOf(relPath)
  const result = {
    file: relPath,
    lang,
    lines: source.split('\n').length - (source.endsWith('\n') ? 1 : 0),
    imports: [],
    contexts: [],
    mocks: [],
    exports: { module: 'none', default: false, named: [], star: [], cjs: null, cjsKeys: [], cjsOpenKeys: false },
    shape: 'none',
    globals: { assigns: [], uses: [], dynamic: [], aliases: {} },
    envUses: 0,
  }

  if (lang === 'template') {
    for (const [i, line] of source.split('\n').entries()) {
      for (const m of line.matchAll(/\bSagamore(?:\.[A-Za-z_$][\w$]*)+/g)) {
        result.globals.uses.push({ name: m[0], line: i + 1 })
      }
    }
    result.shape = 'cjs-value' // eco/ejs loaders export the template function
    result.exports.module = 'cjs'
    result.exports.cjs = 'value'
    return result
  }

  let code = source
  let mapLine = (genLine) => genLine
  if (lang === 'coffee') {
    try {
      const compiled = compileCoffee(source, { sourceMap: true })
      code = compiled.js
      const sm = compiled.sourceMap
      mapLine = (genLine, genCol) => {
        for (let l = genLine - 1; l >= 0; l -= 1) {
          const loc = sm.sourceLocation([l, l === genLine - 1 ? genCol : 0]) || sm.sourceLocation([l, 0])
          if (loc) return loc[0] + 1
        }
        return 1
      }
    } catch (e) {
      result.compileError = `${e.message}${e.location ? ` (line ${e.location.first_line + 1})` : ''}`
      return result
    }
  }

  const ts = loadTs()
  const kind = /\.tsx$/.test(relPath)
    ? ts.ScriptKind.TSX
    : /\.ts$/.test(relPath)
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JSX
  const sf = ts.createSourceFile(relPath, code, ts.ScriptTarget.Latest, true, kind)
  const lineOf = (node) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    return mapLine(line + 1, character)
  }

  new Analyzer(ts, sf, lineOf, result).run()
  result.shape = shapeOf(result.exports)
  return result
}

export function shapeOf(ex) {
  if (ex.module === 'esm') {
    if (ex.default) return 'esm-default'
    if (ex.named.length || ex.star.length) return 'esm-named'
    return 'none'
  }
  if (ex.cjs === 'value') return 'cjs-value'
  if (ex.cjs === 'object') return 'cjs-object'
  return 'none'
}

const SCOPE_KINDS = (ts) =>
  new Set([
    ts.SyntaxKind.SourceFile,
    ts.SyntaxKind.FunctionDeclaration,
    ts.SyntaxKind.FunctionExpression,
    ts.SyntaxKind.ArrowFunction,
    ts.SyntaxKind.MethodDeclaration,
    ts.SyntaxKind.Constructor,
    ts.SyntaxKind.GetAccessor,
    ts.SyntaxKind.SetAccessor,
  ])

class Analyzer {
  constructor(ts, sf, lineOf, result) {
    this.ts = ts
    this.sf = sf
    this.lineOf = lineOf
    this.r = result
    this.scopeKinds = SCOPE_KINDS(ts)
    this.scopeDecls = new Map() // scope node -> Set(names)
    this.bindings = [] // { name, scope, record }
    this.sagamoreAliases = new Map() // local name -> 'Sagamore.X.Y'
    this.assignTargets = new Set() // nodes that are the LHS of a Sagamore assignment
  }

  run() {
    const { ts, sf } = this
    this.collectScopes(sf, sf)
    this.visit(sf)
    if (this.bindings.length) this.collectUsages()
    this.collectExports()
    this.r.globals.aliases = Object.fromEntries(this.sagamoreAliases)
    void ts
  }

  // ---------------------------------------------------------------- scopes

  declare(scope, name) {
    let s = this.scopeDecls.get(scope)
    if (!s) this.scopeDecls.set(scope, (s = new Set()))
    s.add(name)
  }

  bindingNames(nameNode, out = []) {
    const { ts } = this
    if (!nameNode) return out
    if (ts.isIdentifier(nameNode)) out.push(nameNode.text)
    else if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
      for (const el of nameNode.elements) if (!ts.isOmittedExpression(el)) this.bindingNames(el.name, out)
    }
    return out
  }

  collectScopes(node, scope) {
    const { ts } = this
    if (node !== this.sf && this.scopeKinds.has(node.kind)) {
      if (ts.isFunctionDeclaration(node) && node.name) this.declare(scope, node.name.text)
      if (ts.isFunctionExpression(node) && node.name) this.declare(node, node.name.text)
      for (const p of node.parameters || []) for (const n of this.bindingNames(p.name)) this.declare(node, n)
      scope = node
      this.declare(scope, '\0') // ensure entry
    }
    if (ts.isVariableDeclaration(node)) for (const n of this.bindingNames(node.name)) this.declare(scope, n)
    if (ts.isClassDeclaration(node) && node.name) this.declare(scope, node.name.text)
    if (ts.isCatchClause(node) && node.variableDeclaration) {
      for (const n of this.bindingNames(node.variableDeclaration.name)) this.declare(scope, n)
    }
    if (ts.isImportClause(node)) {
      if (node.name) this.declare(this.sf, node.name.text)
      const nb = node.namedBindings
      if (nb && ts.isNamespaceImport(nb)) this.declare(this.sf, nb.name.text)
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) this.declare(this.sf, el.name.text)
    }
    ts.forEachChild(node, (c) => this.collectScopes(c, scope))
  }

  scopeOf(node) {
    let n = node.parent
    while (n && !this.scopeKinds.has(n.kind)) n = n.parent
    return n || this.sf
  }

  /** Scope that declares `name` as seen from `node`, or null (implicit global). */
  resolveScope(node, name) {
    let n = node
    while (n) {
      if (this.scopeKinds.has(n.kind)) {
        const s = this.scopeDecls.get(n)
        if (s && s.has(name)) return n
      }
      n = n.parent
    }
    return null
  }

  // ---------------------------------------------------------------- visiting

  stringArg(call, i = 0) {
    const a = call.arguments[i]
    if (a && (this.ts.isStringLiteral(a) || this.ts.isNoSubstitutionTemplateLiteral(a))) return a.text
    return null
  }

  visit(node) {
    const { ts } = this
    if (ts.isImportDeclaration(node)) this.onImport(node)
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier) this.onReExport(node)
    else if (ts.isCallExpression(node)) this.onCall(node)
    else if (ts.isBinaryExpression(node)) this.onBinary(node)
    else if (ts.isVariableDeclaration(node)) this.onVarDecl(node)
    else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) this.onAccess(node)
    ts.forEachChild(node, (c) => this.visit(c))
  }

  onImport(node) {
    const { ts } = this
    const spec = node.moduleSpecifier.text
    const line = this.lineOf(node)
    const clause = node.importClause
    if (!clause) {
      this.r.imports.push({ spec, line, kind: 'esm-side-effect' })
      return
    }
    if (clause.isTypeOnly) return
    if (clause.name) {
      const record = { spec, line, kind: 'esm-default', local: clause.name.text, usage: newUsage() }
      this.r.imports.push(record)
      this.bindings.push({ name: clause.name.text, scope: this.sf, record, pos: 0 })
    }
    const nb = clause.namedBindings
    if (nb && ts.isNamespaceImport(nb)) {
      const record = { spec, line, kind: 'esm-namespace', local: nb.name.text, usage: newUsage() }
      this.r.imports.push(record)
      this.bindings.push({ name: nb.name.text, scope: this.sf, record, pos: 0 })
    } else if (nb && ts.isNamedImports(nb)) {
      const names = nb.elements
        .filter((el) => !el.isTypeOnly)
        .map((el) => ({ imported: (el.propertyName || el.name).text, local: el.name.text, usage: newUsage() }))
      if (names.length) this.r.imports.push({ spec, line, kind: 'esm-named', names })
      for (const n of names) this.bindings.push({ name: n.local, scope: this.sf, record: n, pos: 0 })
    }
  }

  onReExport(node) {
    const { ts } = this
    if (node.isTypeOnly) return
    const spec = node.moduleSpecifier.text
    const line = this.lineOf(node)
    const ec = node.exportClause
    if (!ec) this.r.imports.push({ spec, line, kind: 're-export-star' })
    else if (ts.isNamespaceExport(ec)) this.r.imports.push({ spec, line, kind: 're-export-namespace' })
    else {
      const names = ec.elements
        .filter((el) => !el.isTypeOnly)
        .map((el) => ({ imported: (el.propertyName || el.name).text, local: el.name.text }))
      this.r.imports.push({ spec, line, kind: 'esm-named', names, reExport: true })
    }
  }

  isRequireCall(node) {
    const { ts } = this
    const e = node.expression
    if (ts.isIdentifier(e) && e.text === 'require') return true
    // jest.requireActual('x') / require.requireActual('x')
    if (ts.isPropertyAccessExpression(e) && e.name.text === 'requireActual') return true
    return false
  }

  onCall(node) {
    const { ts } = this
    const e = node.expression
    if (e.kind === ts.SyntaxKind.ImportKeyword) {
      const spec = this.stringArg(node)
      if (spec) this.r.imports.push({ spec, line: this.lineOf(node), kind: 'dynamic-import' })
      return
    }
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
      const obj = e.expression.text
      const prop = e.name.text
      if (obj === 'require' && prop === 'context') {
        const dir = this.stringArg(node)
        const rec = node.arguments[1]
        const re = node.arguments[2]
        if (dir) {
          this.r.contexts.push({
            dir,
            recursive: !rec || rec.kind !== ts.SyntaxKind.FalseKeyword,
            regex: re && ts.isRegularExpressionLiteral(re) ? re.text : null,
            line: this.lineOf(node),
          })
        }
        return
      }
      if (obj === 'jest' && (prop === 'mock' || prop === 'doMock' || prop === 'setMock')) {
        const spec = this.stringArg(node)
        if (spec) this.r.mocks.push({ spec, line: this.lineOf(node), factory: this.factoryShape(node.arguments[1]) })
        return
      }
    }
    if (this.isRequireCall(node)) {
      const spec = this.stringArg(node)
      if (spec) this.onRequire(node, spec)
    }
  }

  factoryShape(fn) {
    const { ts } = this
    if (!fn) return null
    let ret = null
    if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) ret = fn.body
    else if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isBlock(fn.body)) {
      const r = fn.body.statements.find((s) => ts.isReturnStatement(s))
      ret = r && r.expression
    } else if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) {
      ret = fn // jest.setMock(name, value)
    }
    while (ret && ts.isParenthesizedExpression(ret)) ret = ret.expression
    if (!ret) return { kind: 'unknown' }
    if (ts.isObjectLiteralExpression(ret)) {
      const keys = []
      let spread = false
      for (const p of ret.properties) {
        if (ts.isSpreadAssignment(p)) spread = true
        else if (p.name) keys.push(propName(ts, p.name))
      }
      return { kind: 'object', keys, spread, esModule: keys.includes('__esModule') }
    }
    return { kind: 'value' }
  }

  onRequire(node, spec) {
    const { ts } = this
    let n = node
    while (n.parent && (ts.isParenthesizedExpression(n.parent) || ts.isAsExpression(n.parent))) n = n.parent
    const p = n.parent
    const base = { spec, line: this.lineOf(node), kind: 'require' }
    if (ts.isPropertyAccessExpression(p) && p.expression === n) {
      const name = p.name.text
      this.r.imports.push({ ...base, access: name === 'default' ? 'default' : 'member', name })
      return
    }
    if (ts.isElementAccessExpression(p) && p.expression === n) {
      const a = p.argumentExpression
      if (ts.isStringLiteral(a)) {
        this.r.imports.push({ ...base, access: a.text === 'default' ? 'default' : 'member', name: a.text })
      } else this.r.imports.push({ ...base, access: 'computed' })
      return
    }
    if (ts.isVariableDeclaration(p) && p.initializer === n) {
      if (ts.isIdentifier(p.name)) return this.addRequireBinding(base, p.name.text, this.scopeOf(p), node)
      if (ts.isObjectBindingPattern(p.name)) {
        const names = p.name.elements.map((el) => (el.propertyName ? propName(ts, el.propertyName) : el.name.text))
        this.r.imports.push({ ...base, access: 'destructure', names })
        return
      }
    }
    if (ts.isBinaryExpression(p) && p.right === n && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (ts.isIdentifier(p.left)) {
        const scope = this.resolveScope(p.left, p.left.text) || this.sf
        return this.addRequireBinding(base, p.left.text, scope, node)
      }
      if (isModuleExports(ts, p.left)) {
        this.r.imports.push({ ...base, access: 'value', reExport: true })
        return
      }
      if (ts.isObjectLiteralExpression(p.left)) {
        const names = p.left.properties.map((pr) => propName(ts, pr.name))
        this.r.imports.push({ ...base, access: 'destructure', names })
        return
      }
    }
    if (ts.isExpressionStatement(p)) {
      this.r.imports.push({ ...base, access: 'side-effect' })
      return
    }
    if (ts.isCallExpression(p) && p.expression === n) {
      this.r.imports.push({ ...base, access: 'call' })
      return
    }
    if (ts.isNewExpression(p) && p.expression === n) {
      this.r.imports.push({ ...base, access: 'new' })
      return
    }
    this.r.imports.push({ ...base, access: 'value' })
  }

  addRequireBinding(base, name, scope, node) {
    const record = { ...base, access: 'binding', local: name, usage: newUsage() }
    this.r.imports.push(record)
    this.bindings.push({ name, scope, record, pos: node.getStart(this.sf) })
  }

  // ---------------------------------------------------------------- binding usages

  collectUsages() {
    const { ts } = this
    const byName = new Map()
    for (const b of this.bindings) {
      if (!byName.has(b.name)) byName.set(b.name, [])
      byName.get(b.name).push(b)
    }
    const walk = (node) => {
      if (ts.isIdentifier(node) && byName.has(node.text) && isReference(ts, node)) {
        const scope = this.resolveScope(node, node.text) || this.sf
        // the last binding (in source order) at or before this position in the same scope wins
        const cands = byName.get(node.text).filter((b) => b.scope === scope)
        if (cands.length) {
          const pos = node.getStart(this.sf)
          let b = cands[0]
          for (const c of cands) if (c.pos <= pos) b = c
          this.classify(node, b.record.usage)
        }
      }
      ts.forEachChild(node, walk)
    }
    walk(this.sf)
  }

  classify(id, usage) {
    const { ts } = this
    const p = id.parent
    const line = this.lineOf(id)
    const push = (k) => usage[k].push(line)
    if (ts.isPropertyAccessExpression(p) && p.expression === id) {
      const name = p.name.text
      ;(usage.members[name] ||= []).push(line)
    } else if (ts.isElementAccessExpression(p) && p.expression === id) {
      const a = p.argumentExpression
      if (ts.isStringLiteral(a)) (usage.members[a.text] ||= []).push(line)
      else push('computed')
    } else if (ts.isCallExpression(p) && p.expression === id) push('call')
    else if (ts.isNewExpression(p) && p.expression === id) push('new')
    else if ((ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p)) && p.tagName === id) push('jsx')
    else if (ts.isJsxClosingElement(p)) {
      // counted on the opening tag
    } else if (ts.isExpressionWithTypeArguments(p) && p.parent && ts.isHeritageClause(p.parent)) push('extends')
    else if (ts.isBinaryExpression(p) && p.left === id && isAssignOp(ts, p.operatorToken.kind)) {
      // reassignment, not a read
    } else if (ts.isTypeOfExpression(p)) {
      // typeof X – harmless
    } else push('value')
  }

  // ---------------------------------------------------------------- Sagamore globals

  sagamoreChain(node) {
    // returns 'Sagamore.A.B' for Sagamore.A.B / window.Sagamore.A.B / Alias.B, else null
    const { ts } = this
    const parts = []
    let n = node
    while (ts.isPropertyAccessExpression(n)) {
      parts.unshift(n.name.text)
      n = n.expression
    }
    if (!ts.isIdentifier(n)) return null
    let root = n.text
    if (GLOBAL_OBJECTS.has(root) && parts[0] && SAGAMORE_ROOTS.has(parts[0])) {
      root = parts.shift()
    }
    if (SAGAMORE_ROOTS.has(root)) {
      if (this.resolveScope(n, root)) return null // a local named Sagamore
      return ['Sagamore', ...parts].join('.')
    }
    const alias = this.sagamoreAliases.get(root)
    if (alias) return [alias, ...parts].join('.')
    return null
  }

  onBinary(node) {
    const { ts } = this
    if (!isAssignOp(ts, node.operatorToken.kind)) return
    const left = node.left
    if (ts.isPropertyAccessExpression(left)) {
      const name = this.sagamoreChain(left)
      if (name && name !== 'Sagamore') {
        this.r.globals.assigns.push({ name, line: this.lineOf(left) })
        this.assignTargets.add(left)
      }
    } else if (ts.isIdentifier(left) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      this.maybeAlias(left.text, node.right)
    }
  }

  onVarDecl(node) {
    if (this.ts.isIdentifier(node.name) && node.initializer) this.maybeAlias(node.name.text, node.initializer)
  }

  maybeAlias(name, expr) {
    const { ts } = this
    if (!ts.isPropertyAccessExpression(expr) && !ts.isIdentifier(expr)) return
    const chain = ts.isIdentifier(expr)
      ? SAGAMORE_ROOTS.has(expr.text)
        ? 'Sagamore'
        : this.sagamoreAliases.get(expr.text) || null
      : this.sagamoreChain(expr)
    if (chain) this.sagamoreAliases.set(name, chain)
  }

  onAccess(node) {
    const { ts } = this
    // only consider maximal chains
    const p = node.parent
    if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === node) return
    if (ts.isElementAccessExpression(node)) {
      const name = ts.isPropertyAccessExpression(node.expression) || ts.isIdentifier(node.expression)
        ? ts.isIdentifier(node.expression)
          ? SAGAMORE_ROOTS.has(node.expression.text)
            ? 'Sagamore'
            : this.sagamoreAliases.get(node.expression.text)
          : this.sagamoreChain(node.expression)
        : null
      if (name) this.r.globals.dynamic.push({ name, line: this.lineOf(node) })
      return
    }
    if (this.assignTargets.has(node)) return
    const name = this.sagamoreChain(node)
    if (name && name !== 'Sagamore') this.r.globals.uses.push({ name, line: this.lineOf(node) })
    else if (!name && ts.isIdentifier(node.expression) && node.expression.text === 'sagamore') this.r.envUses += 1
  }

  // ---------------------------------------------------------------- exports

  collectExports() {
    const { ts, sf } = this
    const ex = this.r.exports
    const named = new Set()
    const cjsKeys = new Set()
    const hasMod = (n, k) => ts.canHaveModifiers(n) && (ts.getModifiers(n) || []).some((m) => m.kind === k)
    let esm = false
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && !(st.importClause && st.importClause.isTypeOnly)) esm = true
      if (ts.isExportAssignment(st)) {
        if (st.isExportEquals) {
          ex.cjs = 'value'
        } else {
          esm = true
          ex.default = true
        }
      } else if (ts.isExportDeclaration(st)) {
        if (st.isTypeOnly) continue
        esm = true
        const ec = st.exportClause
        if (!ec) ex.star.push(st.moduleSpecifier.text)
        else if (ts.isNamespaceExport(ec)) named.add(ec.name.text)
        else {
          for (const el of ec.elements) {
            if (el.isTypeOnly) continue
            if (el.name.text === 'default') ex.default = true
            else named.add(el.name.text)
          }
        }
      } else if (hasMod(st, ts.SyntaxKind.ExportKeyword)) {
        if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) continue
        if (hasMod(st, ts.SyntaxKind.DeclareKeyword)) continue
        esm = true
        if (hasMod(st, ts.SyntaxKind.DefaultKeyword)) ex.default = true
        else if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) for (const n of this.bindingNames(d.name)) named.add(n)
        } else if (st.name) named.add(st.name.text)
      } else if (ts.isExpressionStatement(st)) {
        this.cjsExport(st.expression, ex, cjsKeys)
      }
    }
    ex.module = esm ? 'esm' : ex.cjs || cjsKeys.size ? 'cjs' : 'none'
    if (esm && (ex.cjs || cjsKeys.size)) ex.mixed = true
    if (!ex.cjs && cjsKeys.size) ex.cjs = 'object'
    ex.named = [...named].sort()
    ex.cjsKeys = [...cjsKeys].sort()
  }

  cjsExport(expr, ex, keys) {
    const { ts } = this
    if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      this.cjsExport(expr.left, ex, keys)
      this.cjsExport(expr.right, ex, keys)
      return
    }
    if (!ts.isBinaryExpression(expr) || expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return
    const left = expr.left
    if (isModuleExports(ts, left)) {
      let right = expr.right
      while (ts.isBinaryExpression(right) && right.operatorToken.kind === ts.SyntaxKind.EqualsToken) right = right.right
      while (ts.isParenthesizedExpression(right)) right = right.expression
      if (ts.isObjectLiteralExpression(right)) {
        ex.cjs = 'object'
        for (const p of right.properties) {
          if (ts.isSpreadAssignment(p)) ex.cjsOpenKeys = true
          else if (p.name) keys.add(propName(ts, p.name))
        }
      } else {
        ex.cjs = 'value'
      }
      return
    }
    if (ts.isPropertyAccessExpression(left)) {
      const obj = left.expression
      if (isModuleExports(ts, obj) || (ts.isIdentifier(obj) && obj.text === 'exports')) keys.add(left.name.text)
    }
    // chained: module.exports.a = exports.b = ...
    if (ts.isBinaryExpression(expr.right)) this.cjsExport(expr.right, ex, keys)
  }
}

function newUsage() {
  return { call: [], new: [], jsx: [], extends: [], value: [], computed: [], members: {} }
}

function isAssignOp(ts, k) {
  return (
    k === ts.SyntaxKind.EqualsToken ||
    k === ts.SyntaxKind.BarBarEqualsToken ||
    k === ts.SyntaxKind.QuestionQuestionEqualsToken ||
    k === ts.SyntaxKind.AmpersandAmpersandEqualsToken
  )
}

function isModuleExports(ts, n) {
  return (
    ts.isPropertyAccessExpression(n) &&
    ts.isIdentifier(n.expression) &&
    n.expression.text === 'module' &&
    n.name.text === 'exports'
  )
}

function propName(ts, n) {
  if (!n) return '?'
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isPrivateIdentifier(n)) return n.text
  return '[computed]'
}

/** true if this identifier is a value reference (not a declaration / property name / type) */
function isReference(ts, id) {
  const p = id.parent
  if (!p) return false
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false
  if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p)) && p.name === id) return false
  if ((ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isPropertySignature(p) || ts.isMethodSignature(p)) && p.name === id) return false
  if (ts.isVariableDeclaration(p) && p.name === id) return false
  if (ts.isParameter(p) && p.name === id) return false
  if (ts.isBindingElement(p) && (p.name === id || p.propertyName === id)) return false
  if ((ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p)) && p.name === id) return false
  if (ts.isImportClause(p) || ts.isImportSpecifier(p) || ts.isNamespaceImport(p) || ts.isExportSpecifier(p)) return false
  if (ts.isJsxAttribute(p)) return false
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false
  if (ts.isQualifiedName(p) || ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p)) return false
  if (ts.isEnumMember(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)) return false
  return true
}

export { rel }

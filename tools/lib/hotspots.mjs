// G7b (PLAN.md §3): CoffeeScript semantic hotspots, found on the coffeescript 1.12.7 AST
// (`require('coffeescript').nodes(src)`), plus the markdown checklist format used by
// coffee_hotspots.mjs (render / parse / --check). See coffee_hotspots.mjs for the format.
//
// AST facts this relies on (verified for PLAN.md §9 Q3):
// - Every parser-created node has `locationData` {first_line, first_column, last_line,
//   last_column} (0-based lines, inclusive columns). Synthetic nodes (e.g. the Splat a bare
//   `super` creates, Switch case tuples) have none; we fall back to the nearest parent.
// - Nodes are identified by `constructor.name` (Block, Code, Value, Call, If, For, ...).
//   `node.children` lists the child attributes; For also has `name`/`index` outside children.
// - Code.bound = `=>`; Param.value = default, Param.splat; Expansion = bare `...`.
// - SuperCall.isBare is INVERTED: true when explicit args were given; a bare `super` has
//   isBare=false and a synthetic `arguments` splat.
// - Class.body.expressions: each run of `key: value` lines is one Value(Obj) whose
//   properties are Assign(context='object'); `@key:` has a `this` Value as variable (static);
//   anything else is an executable statement.
// - Existence (`a?`), Op operator '?' (`a ? b`), Assign context '?=', Access.soak (`?.`),
//   Index.soak (`?[`), Call.soak (`?(`).
// - For.own / For.object (`of`); Range.exclusive; Slice wraps a Range.
// - heregex / block strings are NOT marked in the AST (the lexer already folded them);
//   they are recognised from the source text at the node's location.
// - Line comments are dropped; block comments (`###`) are Comment nodes (skipped).
import crypto from 'node:crypto'
import { loadCoffee } from './deps.mjs'

export const CATEGORIES = [
  {
    id: 'ret',
    title: '隐式返回值可能有语义的函数',
    hint: 'PLAN §6.1 隐式 return。jQuery 事件处理函数返回 false = preventDefault + stopPropagation；$.each 返回 false 中断循环；validate 返回非空 = 校验失败；render 返回 this；find/filter/some/every 回调；parse/toJSON/url；then 回调。⚠ = 末尾是 false、赋值、循环、if/switch（或 try 分支末尾是这些），转换时必须确认返回值。React 组件的 render 只在 ⚠ 时列出。',
  },
  {
    id: 'loop-tail',
    title: '最后一句是循环的函数（隐式返回数组）',
    hint: 'CoffeeScript 会收集循环每次迭代的值并返回数组。⚠ = 循环体末尾是纯值表达式，疑似有意的推导式，调用方可能在用返回的数组。',
  },
  {
    id: 'default-param',
    title: '默认参数',
    hint: 'CoffeeScript 1 在实参为 null 或 undefined 时都取默认值，JS 只对 undefined 生效。调用方可能传 null 时写成 x = x ?? default。',
  },
  {
    id: 'existence',
    title: '存在运算符',
    hint: 'a? → a != null；a ? b → a ?? b；a ?= b → a ??= b；a?.b → a?.b。⚠ a.b?() 原语义是“a.b 是函数才调用”，a?.b?.() 在 a.b 非函数且非空时会抛错，必要时写 typeof a.b === \'function\' && a.b()。⚠ a?[x]。',
  },
  {
    id: 'class-bound',
    title: '胖箭头方法',
    hint: 'class 中的 m: => 在构造函数开头、调用父类构造函数之前绑定（PLAN §6.2）。⚠ createReactClass / .extend 对象字面量中的 m: => 绑定的是外层 this（模块级），不是实例。',
  },
  {
    id: 'super',
    title: 'super 调用',
    hint: '⚠ 裸 super 透传全部参数：Parent.prototype.m.apply(this, arguments)；构造函数中 Parent.apply(this, args)。super(a) → Parent.prototype.m.call(this, a)。',
  },
  {
    id: 'class-exec',
    title: '类体中的可执行语句',
    hint: '放在 .extend(...) 之后执行；类体中的 @ 指类本身，局部变量是闭包私有变量。',
  },
  {
    id: 'class-data',
    title: '类体中的数据属性（原型属性）',
    hint: '放进 extend 的第一个参数对象，不要写成类字段（PLAN §6.2）。React class 组件中，原型上的数据属性（如 displayName）也不是静态属性。',
  },
  {
    id: 'class-static',
    title: '静态成员（@key:）',
    hint: '放进 extend 的第二个参数对象；React class 用 static。',
  },
  {
    id: 'for-own',
    title: 'for own … of',
    hint: '→ Object.keys(obj).forEach 或 for…of Object.entries。',
  },
  {
    id: 'for-of',
    title: '不带 own 的 for k of obj',
    hint: '会遍历继承来的可枚举属性：保持 for…in 语义，不要改成 Object.keys。',
  },
  {
    id: 'loop-closure',
    title: '闭包捕获了循环变量的循环',
    hint: 'CoffeeScript 是 var 语义，闭包拿到的是最终值（除非用了 do）；改成 let/const 后按每次迭代捕获。闭包如果被延迟调用，行为会改变。⚠ = 闭包不是同步迭代回调（each/map/filter…）。',
  },
  {
    id: 'arguments',
    title: 'arguments',
    hint: '改成 ...rest。⚠ 在 => 函数里：CoffeeScript 指内层函数自己的 arguments，JS 箭头函数里会变成外层函数的。',
  },
  {
    id: 'splat',
    title: 'splat / expansion',
    hint: 'fn(args...) / (a, rest...) / [a, rest...] = x → ...；中间位置的 splat 和 ... expansion 需要手工改写。',
  },
  {
    id: 'heregex',
    title: '/// 块正则',
    hint: '去掉空白和 # 注释后人工拼成正则，并核对转义；带 #{} 插值的编译为 RegExp(...)。',
  },
  {
    id: 'block-string',
    title: '块字符串与多行字符串',
    hint: "''' / \"\"\" 会去掉公共缩进以及首尾空行；普通 '…' / \"…\" 跨行时换行（及其两侧缩进）折叠为一个空格。",
  },
  {
    id: 'range',
    title: '范围（切片 / 范围数组）',
    hint: 'arr[a..b] → slice(a, b + 1)；arr[a...b] → slice(a, b)；[a..b] 数组包含 b。⚠ 范围赋值 arr[a..b] = x 是 splice。',
  },
  {
    id: 'module-this',
    title: '模块级 @ / this',
    hint: 'PLAN §6.1：经 imports-loader 包裹的文件（webpack 规则 /src\\/sagamore.*\\.coffee$/ 等，实际覆盖 src/sagamore/** 全部 coffee）中 this === window，其他为 module.exports；转成 ESM 后为 undefined，必须显式改写。注意：模块级 => 函数（包括 createReactClass 中的 m: =>）里的 @ 也是模块级 this。',
  },
  {
    id: 'react-if',
    title: 'React：没有 else 的 if / switch 作为值',
    hint: 'PLAN §6.3：没有 else 的 if 值为 undefined。只有条件确定是布尔值时才能写 cond && <X/>，否则写 cond ? <X/> : null。',
  },
  {
    id: 'react-method-ref',
    title: 'React：作为回调传出的 @method',
    hint: 'createReactClass 会自动绑定，class 不会：转成 class 后这些方法必须绑定（PLAN §6.3）。⚠ = 方法没有用 => 定义。',
  },
  { id: 'parse-error', title: '解析失败', hint: 'nodes() 抛错，文件未分析。' },
]
const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id))

const type = (n) => (n && n.constructor ? n.constructor.name : typeof n)
const isNode = (v) => v != null && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.children)

function* flat(v) {
  if (!v) return
  if (Array.isArray(v)) for (const x of v) yield* flat(x)
  else if (isNode(v)) yield v
}

function* childNodes(n) {
  for (const a of n.children) yield* flat(n[a])
}

function eachNode(root, fn) {
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    fn(n)
    for (const c of childNodes(n)) stack.push(c)
  }
}

function lastStmt(block) {
  if (!block) return undefined
  if (!block.expressions) return type(block) === 'Comment' ? undefined : block // Parens.body may be a bare node
  const xs = block.expressions.filter((e) => type(e) !== 'Comment')
  return xs[xs.length - 1]
}

function stmts(block) {
  if (!block) return []
  return (block.expressions || [block]).filter((e) => type(e) !== 'Comment')
}

function unwrapCode(n) {
  for (let i = 0; n && i < 5; i += 1) {
    const t = type(n)
    if (t === 'Code') return n
    if (t === 'Value' && n.properties.length === 0) n = n.base
    else if (t === 'Parens') {
      const xs = stmts(n.body)
      n = xs.length === 1 ? xs[0] : null
    } else return null
  }
  return null
}

const isObjValue = (n) => type(n) === 'Value' && n.properties.length === 0 && type(n.base) === 'Obj'

/** `@name` (not soaked) -> 'name' */
function thisMemberName(n) {
  if (type(n) !== 'Value' || type(n.base) !== 'ThisLiteral' || n.properties.length !== 1) return null
  const p = n.properties[0]
  if (type(p) !== 'Access' || p.soak || type(p.name) !== 'PropertyName') return null
  return p.name.value
}

const unquote = (s) => s.replace(/^(['"])([\s\S]*)\1$/, '$2')

/** key of an object/class-body property Assign: { name, isStatic } */
function propKey(variable) {
  if (type(variable) !== 'Value') return null
  if (type(variable.base) === 'ThisLiteral') {
    const p = variable.properties[0]
    return p && type(p) === 'Access' ? { name: p.name.value, isStatic: true } : null
  }
  if (variable.properties.length) return null
  const b = variable.base
  const bt = type(b)
  if (bt === 'PropertyName' || bt === 'IdentifierLiteral' || bt === 'NumberLiteral') return { name: b.value, isStatic: false }
  if (bt === 'StringLiteral') return { name: unquote(b.value), isStatic: false }
  return null
}

/** last property name of a callee (`a.b.on` -> 'on'), or the identifier (`each` -> 'each') */
function calleeName(call) {
  const v = call.variable
  if (type(v) !== 'Value') return { name: null, member: false }
  if (v.properties.length) {
    const p = v.properties[v.properties.length - 1]
    return type(p) === 'Access' && type(p.name) === 'PropertyName' ? { name: p.name.value, member: true } : { name: null, member: true }
  }
  return type(v.base) === 'IdentifierLiteral' ? { name: v.base.value, member: false } : { name: null, member: false }
}

function collectIdents(n, out) {
  if (!n) return out
  const t = type(n)
  if (t === 'IdentifierLiteral') out.add(n.value)
  else if (t === 'Value') {
    if (n.properties.length === 0) collectIdents(n.base, out)
  } else if (t === 'Obj') {
    for (const p of n.properties) {
      if (type(p) === 'Assign') collectIdents(p.value, out)
      else collectIdents(p, out)
    }
  } else if (t === 'Arr') for (const o of n.objects) collectIdents(o, out)
  else if (t === 'Splat') collectIdents(n.name, out)
  else if (t === 'Assign') collectIdents(n.variable, out) // destructuring default `{a = 1}`
  return out
}

function paramNames(code) {
  const out = new Set()
  for (const p of code.params) if (type(p) === 'Param') collectIdents(p.name, out)
  return out
}

// jQuery/underscore/promise methods whose callback return value can matter (PLAN §6.1 / G7b).
const CALLBACK_MEMBERS = new Set([
  'on', 'one', 'bind', 'delegate', 'live', 'click', 'dblclick', 'submit', 'change', 'keydown', 'keyup',
  'keypress', 'mousedown', 'mouseup', 'focus', 'blur', 'each', 'find', 'detect', 'filter', 'select',
  'reject', 'some', 'any', 'every', 'all', 'findIndex', 'then', 'catch',
])
// same, when called as a bare identifier (`{each, find} = require('underscore')`)
const CALLBACK_IDENTS = new Set(['each', 'find', 'detect', 'filter', 'select', 'reject', 'some', 'any', 'every', 'all', 'findIndex'])
const NAMED_METHODS = new Set(['validate', 'parse', 'toJSON', 'url', 'render', 'initialize'])
// synchronous iterator callbacks: a closure passed here runs before the loop iteration ends
const SYNC_ITERATORS = new Set([
  'each', 'forEach', 'map', 'filter', 'find', 'detect', 'some', 'every', 'any', 'all', 'reduce', 'reduceRight',
  'select', 'reject', 'sortBy', 'groupBy', 'countBy', 'indexBy', 'partition', 'findIndex', 'findWhere',
  'max', 'min', 'flatMap', 'times', 'sort', 'uniq',
])
const IMPORTS_LOADER_WINDOW = [/src\/sagamore.*\.coffee$/, /src\/main\.coffee$/, /src\/sync\.coffee$/, /src\/templates\.coffee$/, /src\/test\.coffee$/]

function describeTail(n, depth = 0) {
  if (!n) return { text: '空（undefined）', warn: false }
  if (depth > 2) return { text: '…', warn: false }
  const t = type(n)
  const branches = (parts) => parts.map((p) => describeTail(p, depth + 1))
  switch (t) {
    case 'Value': {
      if (n.properties.length) return { text: `Value(${type(n.base) === 'ThisLiteral' ? '@属性' : '属性访问'})`, warn: false }
      const bt = type(n.base)
      if (bt === 'BooleanLiteral') return { text: `BooleanLiteral(${n.base.value})`, warn: n.base.value === 'false' }
      if (bt === 'Parens') return describeTail(lastStmt(n.base.body), depth)
      return { text: bt, warn: false }
    }
    case 'Parens':
      return describeTail(lastStmt(n.body), depth)
    case 'Assign':
      return { text: n.context ? `Assign(${n.context})` : 'Assign', warn: true }
    case 'For':
      return { text: n.object ? 'For(of)' : 'For', warn: true }
    case 'While':
      return { text: 'While', warn: true }
    case 'If': {
      const parts = branches([lastStmt(n.body)])
      const texts = parts.map((p) => p.text)
      if (n.elseBody) {
        const e = describeTail(lastStmt(n.elseBody), depth + 1)
        texts.push(e.text)
      } else texts.push('无 else→undefined')
      return { text: `If → [${texts.join(' | ')}]`, warn: true }
    }
    case 'Switch': {
      const texts = n.cases.map((c) => describeTail(lastStmt(c[1]), depth + 1).text)
      texts.push(n.otherwise ? describeTail(lastStmt(n.otherwise), depth + 1).text : '无 else→undefined')
      return { text: `Switch → [${texts.join(' | ')}]`, warn: true }
    }
    case 'Try': {
      const parts = branches([lastStmt(n.attempt), n.recovery ? lastStmt(n.recovery) : null])
      if (!n.recovery) parts[1] = { text: '无 catch→undefined', warn: false }
      return { text: `Try → [${parts.map((p) => p.text).join(' | ')}]`, warn: parts.some((p) => p.warn) }
    }
    case 'Return':
      return { text: n.expression ? `Return(${describeTail(n.expression, depth + 1).text})` : 'Return(无值)', warn: false }
    case 'Call':
      return { text: n.isNew ? 'Call(new)' : 'Call', warn: false }
    case 'Op':
      return { text: `Op(${n.operator})`, warn: false }
    case 'Code':
      return { text: n.bound ? 'Code(=>)' : 'Code', warn: false }
    case 'StatementLiteral':
      return { text: `StatementLiteral(${n.value})`, warn: false }
    default:
      return { text: t, warn: false }
  }
}

/** loops that end up as the implicit return value of a block's tail */
function loopTails(n) {
  if (!n) return []
  switch (type(n)) {
    case 'For':
    case 'While':
      return [n]
    case 'If':
      return [...loopTails(lastStmt(n.body)), ...loopTails(lastStmt(n.elseBody))]
    case 'Switch':
      return [...n.cases.flatMap((c) => loopTails(lastStmt(c[1]))), ...loopTails(lastStmt(n.otherwise))]
    case 'Try':
      return [...loopTails(lastStmt(n.attempt)), ...loopTails(lastStmt(n.recovery))]
    default:
      return []
  }
}

function isPureValue(n) {
  const t = type(n)
  if (t === 'Value') return !(type(n.base) === 'Parens')
  if (t === 'Op') return !['++', '--', 'delete', 'new', 'yield', 'await'].includes(n.operator)
  return t === 'Existence' || t === 'In'
}

const clip = (s, max = 70) => {
  const one = s.replace(/\s+/g, ' ').trim().replace(/`/g, "'").replace(/—/g, '-')
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}
const code = (s) => (s ? `\`${s}\`` : '')

class FileAnalyzer {
  constructor(file, src) {
    this.file = file
    this.lines = src.replace(/\r/g, '').split('\n')
    this.items = []
    this.existence = new Map()
    this.moduleThisLines = new Set()
    this.retFns = new Map() // Code -> { anchor, reasons: [], componentRenderOnly }
    this.methodInfo = new Map() // Code -> { container, name, isStatic, assign }
    this.fnNames = new Map() // Code -> display name
    this.objRole = new Map() // Obj -> 'component' | 'extend'
    this.doCodes = new Set() // Code nodes invoked by `do` (immediately)
    this.windowThis = IMPORTS_LOADER_WINDOW.some((r) => r.test(file))
    this.isReactFile = /require\(\s*['"](react|react-dom-factories|create-react-class)['"]\s*\)/.test(src)
  }

  // ------------------------------------------------------------ locations / output

  line(node, fallback) {
    const ld = (node && node.locationData) || (fallback && fallback.locationData)
    return ld ? ld.first_line + 1 : 0
  }

  col(node) {
    return node && node.locationData ? node.locationData.first_column : 0
  }

  rawText(node) {
    const ld = node && node.locationData
    if (!ld) return ''
    const l = this.lines[ld.first_line] || ''
    return ld.last_line === ld.first_line ? l.slice(ld.first_column, ld.last_column + 1) : l.slice(ld.first_column)
  }

  text(node, max) {
    const ld = node && node.locationData
    if (!ld) return ''
    return clip(this.rawText(node) + (ld.last_line > ld.first_line ? ' …' : ''), max)
  }

  /** source from the start of `a` to the end of `b` (a Value's own loc excludes its properties) */
  spanText(a, b, max) {
    const s = a && a.locationData
    const e = b && b.locationData
    if (!s || !e) return this.text(a, max)
    if (s.first_line !== e.last_line) return this.text(a, max)
    const l = this.lines[s.first_line] || ''
    const end = type(b) === 'Slice' && l[e.last_column + 1] === ']' ? e.last_column + 2 : e.last_column + 1
    return clip(l.slice(s.first_column, end), max)
  }

  /** text of an expression; for a Value, including its whole property chain (`a.b.c`) */
  vtext(node, max) {
    if (type(node) === 'Value' && node.properties.length) return this.spanText(node, node.properties[node.properties.length - 1], max)
    return this.text(node, max)
  }

  lineText(node, max) {
    const ld = node && node.locationData
    return ld ? clip(this.lines[ld.first_line] || '', max) : ''
  }

  add(cat, node, desc, warn = false, fallback) {
    this.items.push({ cat, file: this.file, line: this.line(node, fallback), col: this.col(node || fallback), warn, desc })
  }

  fnLabel(fn) {
    if (!fn) return '模块顶层'
    const info = this.methodInfo.get(fn)
    if (info) return `${info.isStatic ? '@' : ''}${info.name}`
    return this.fnNames.get(fn) || '匿名函数'
  }

  // ------------------------------------------------------------ this / containers

  /** what `@` means at this point: a container, 'module', 'class' (class body) or null (unknown) */
  thisTarget(ctx) {
    for (let i = ctx.fns.length - 1; i >= 0; i -= 1) {
      const f = ctx.fns[i]
      const info = this.methodInfo.get(f)
      // `m: =>` in a class body binds to the instance; any other `=>` is transparent
      if (f.bound && !(info && info.container.kind === 'class')) continue
      if (!info) return null
      return info.isStatic ? 'static' : info.container
    }
    return ctx.classBody ? 'class' : 'module'
  }

  buildContainer(kind, node, props, role) {
    const c = { kind, node, role, methods: new Map(), props, isComponent: false, componentKind: null }
    for (const p of props) {
      const fn = unwrapCode(p.assign.value)
      if (!fn) continue
      const info = { container: c, name: p.name, isStatic: p.isStatic, assign: p.assign, code: fn }
      this.methodInfo.set(fn, info)
      if (!p.isStatic) c.methods.set(p.name, info)
    }
    return c
  }

  /** 1-based line of the first `@name = …` / `this.name = …` inside a container's source range */
  instanceAssignLine(node, name) {
    const ld = node && node.locationData
    if (!ld) return 0
    const re = new RegExp(`(?:@|\\bthis\\.)${name.replace(/[$]/g, '\\$')}\\s*=(?!=)`)
    for (let i = ld.first_line; i <= ld.last_line && i < this.lines.length; i += 1) {
      if (re.test(this.lines[i].replace(/#.*$/, ''))) return i + 1
    }
    return 0
  }

  addRet(fn, anchor, reason, { componentRender = false } = {}) {
    let e = this.retFns.get(fn)
    if (!e) {
      e = { anchor, reasons: [], componentRenderOnly: componentRender }
      this.retFns.set(fn, e)
    } else if (!componentRender) e.componentRenderOnly = false
    if (!e.reasons.includes(reason)) e.reasons.push(reason)
  }

  /** Backbone `events` hash + validate/parse/... methods of a class body / object literal */
  containerRetChecks(c) {
    for (const p of c.props) {
      if (p.isStatic) continue
      const fn = unwrapCode(p.assign.value)
      if (fn && NAMED_METHODS.has(p.name)) {
        this.addRet(fn, p.assign, `${p.name} 方法`, { componentRender: c.isComponent && p.name === 'render' })
      }
      if (p.name !== 'events') continue
      const hashes = []
      const collect = (v, depth) => {
        if (!v || depth > 2) return
        if (isObjValue(v)) hashes.push(v.base)
        else if (type(v) === 'Code') collect(lastStmt(v.body), depth + 1)
        else if (type(v) === 'Call') for (const a of v.args) collect(a, depth + 1)
      }
      collect(fn || p.assign.value, 0)
      for (const h of hashes) {
        for (const ev of h.properties) {
          if (type(ev) !== 'Assign') continue
          const sel = this.vtext(ev.variable, 40)
          const inline = unwrapCode(ev.value)
          if (inline) {
            this.addRet(inline, ev, `events ${code(sel)} 的内联处理函数`)
            continue
          }
          const v = ev.value
          const name =
            type(v) === 'Value' && type(v.base) === 'StringLiteral' && !v.properties.length ? unquote(v.base.value) : thisMemberName(v)
          if (!name) continue
          const m = c.methods.get(name)
          if (m) this.addRet(m.code, m.assign, `events ${code(sel)} → ${name}`)
          else if (c.kind === 'class' || c.role === 'extend') {
            const at = this.instanceAssignLine(c.node, name)
            this.add(
              'ret',
              ev,
              at
                ? `events ${code(sel)} → ${name}：未作为方法定义，在 L${at} 以实例属性 \`@${name} = …\` 赋值（返回值看被赋的函数）`
                : `events ${code(sel)} → ${name}：本类中未定义（继承？需到父类确认返回值）`,
            )
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ main walk

  run(root) {
    eachNode(root, (n) => {
      if (type(n) === 'Call' && type(n.variable) === 'Code') this.doCodes.add(n.variable)
    })
    this.walk(root, { fns: [], classBody: null, component: null, inString: false }, false, null)
    this.finish()
    return this.items
  }

  walkChildren(node, ctx, isValue = 'expr') {
    for (const c of childNodes(node)) this.walk(c, ctx, isValue, node)
  }

  walk(node, ctx, isValue, parent) {
    if (!node) return
    switch (type(node)) {
      case 'Comment':
        return
      case 'Block': {
        const xs = node.expressions
        let last = -1
        xs.forEach((e, i) => {
          if (type(e) !== 'Comment') last = i
        })
        xs.forEach((e, i) => this.walk(e, ctx, i === last ? isValue : false, node))
        return
      }
      case 'Code':
        return this.visitCode(node, ctx, parent)
      case 'Class':
        return this.visitClass(node, ctx)
      case 'Obj':
        return this.visitObj(node, ctx)
      case 'Value':
        return this.visitValue(node, ctx, parent)
      case 'Call':
        return this.visitCall(node, ctx)
      case 'SuperCall': {
        const fn = ctx.fns[ctx.fns.length - 1]
        if (!node.isBare) {
          this.add('super', node, `⚠ 裸 super（透传全部 arguments），所在方法 ${this.fnLabel(fn)}`, true)
          return // its args are a synthetic `arguments` splat
        }
        this.add('super', node, `${code(this.text(node))}，所在方法 ${this.fnLabel(fn)}`)
        return this.walkChildren(node, ctx)
      }
      case 'Assign':
        return this.visitAssign(node, ctx)
      case 'If':
        this.checkReactIf(node, ctx, isValue, parent, !node.elseBody, 'if')
        this.walk(node.condition, ctx, 'expr', node)
        this.walk(node.body, ctx, isValue, node)
        this.walk(node.elseBody, ctx, isValue, node)
        return
      case 'Switch':
        this.checkReactIf(node, ctx, isValue, parent, !node.otherwise, 'switch')
        this.walk(node.subject, ctx, 'expr', node)
        for (const [conds, block] of node.cases) {
          for (const c of flat(conds)) this.walk(c, ctx, 'expr', node)
          this.walk(block, ctx, isValue, node)
        }
        this.walk(node.otherwise, ctx, isValue, node)
        return
      case 'Try':
        this.walk(node.attempt, ctx, isValue, node)
        this.walk(node.recovery, ctx, isValue, node)
        this.walk(node.ensure, ctx, false, node)
        return
      case 'For':
        return this.visitFor(node, ctx, isValue)
      case 'While':
        this.checkLoopClosure(node, assignedVars(node.body, new Set()))
        this.walk(node.condition, ctx, 'expr', node)
        this.walk(node.guard, ctx, 'expr', node)
        this.walk(node.body, ctx, isValue, node)
        return
      case 'Op':
        if (node.operator === '?') this.addExistence(node, 'a ? b', '`a ? b`（→ a ?? b）', false)
        return this.walkChildren(node, ctx)
      case 'Existence':
        this.addExistence(node, 'a?', '`a?`（→ a != null）', false)
        return this.walkChildren(node, ctx)
      case 'Splat':
        this.add('splat', node, `${parent && type(parent) === 'Call' ? '调用展开' : '数组展开 / 解构'} ${code(this.text(node))}`)
        return this.walkChildren(node, ctx)
      case 'Expansion':
        this.add('splat', node, `expansion ${code('...')}（${code(this.lineText(node))}）`, false, parent)
        return
      case 'IdentifierLiteral':
        if (node.value === 'arguments') this.visitArguments(node, ctx)
        return
      case 'StringLiteral':
      case 'StringWithInterpolations':
        if (!ctx.inString) this.checkString(node)
        return this.walkChildren(node, { ...ctx, inString: true })
      case 'RegexLiteral':
      case 'RegexWithInterpolations': {
        const raw = this.rawText(node)
        if (!ctx.inString && (type(node) === 'RegexWithInterpolations' || raw.startsWith('///'))) {
          this.add('heregex', node, `⚠ ${code(this.text(node))}`, true)
        }
        return this.walkChildren(node, { ...ctx, inString: true })
      }
      case 'Parens': {
        // `(expr)`: keep the outer parent so `f (if a then b)` still sees the Call
        const xs = stmts(node.body)
        if (xs.length === 1) return this.walk(xs[0], ctx, 'expr', parent)
        return this.walk(node.body, ctx, 'expr', node)
      }
      default:
        return this.walkChildren(node, ctx)
    }
  }

  visitCode(node, ctx, parent) {
    const info = this.methodInfo.get(node)
    const isDo = this.doCodes.has(node)
    const fctx = { ...ctx, fns: [...ctx.fns, node], classBody: null }
    const label = this.fnLabel(node)
    for (const p of node.params) {
      if (type(p) === 'Expansion') {
        this.add('splat', p, `参数 expansion ${code('...')}，函数 ${label}`, false, node)
        continue
      }
      if (type(p) !== 'Param') continue
      if (p.value && !isDo) this.add('default-param', p, `${code(this.text(p))}，函数 ${label}`)
      if (p.splat) this.add('splat', p, `参数 splat ${code(this.text(p))}，函数 ${label}`)
      this.walk(p.name, fctx, 'expr', p)
      this.walk(p.value, fctx, 'expr', p)
    }
    const isCtor = info && info.name === 'constructor' && info.container.kind === 'class'
    this.walk(node.body, fctx, isCtor ? false : 'tail', node)
    if (isCtor) return
    for (const loop of loopTails(lastStmt(node.body))) {
      const bodyTail = lastStmt(loop.body)
      const pure = bodyTail && isPureValue(bodyTail)
      const anchor = info ? info.assign : parent && type(parent) === 'Assign' ? parent : node
      this.add(
        'loop-tail',
        anchor,
        `${pure ? '⚠ 疑似有意的推导式；' : ''}函数 ${label} 末尾是 ${type(loop)}（L${this.line(loop)} ${code(this.text(loop, 50))}），循环体末尾 ${describeTail(bodyTail).text}`,
        !!pure,
        node,
      )
    }
  }

  classProps(body) {
    const props = []
    const exec = []
    for (const e of body.expressions) {
      if (type(e) === 'Comment') continue
      if (!isObjValue(e)) {
        exec.push(e)
        continue
      }
      for (const a of e.base.properties) {
        if (type(a) !== 'Assign' || a.context !== 'object') continue
        const k = propKey(a.variable)
        if (k) props.push({ ...k, assign: a })
      }
    }
    return { props, exec }
  }

  visitClass(node, ctx) {
    const { props, exec } = this.classProps(node.body)
    const c = this.buildContainer('class', node, props)
    const parentText = node.parent ? this.vtext(node.parent) : ''
    if (/^(React\.)?(Pure)?Component$/.test(parentText)) {
      c.isComponent = true
      c.componentKind = 'React class'
    }
    const className = node.variable ? this.vtext(node.variable, 40) : '(匿名 class)'
    for (const p of props) {
      const fn = unwrapCode(p.assign.value)
      if (p.isStatic && fn && fn.bound) {
        this.add('class-static', p.assign, `⚠ ${className} 静态胖箭头 @${p.name}: =>（this 固定为 ${className} 本身，子类调用时也不是子类）`, true)
      } else if (p.isStatic) {
        this.add('class-static', p.assign, `${className} ${fn ? '静态方法' : '静态属性'} ${code(this.text(p.assign, 50))}`)
      } else if (fn) {
        if (fn.bound) this.add('class-bound', p.assign, `⚠ ${className}#${p.name}: =>`, true)
        if (p.name === 'constructor') this.add('class-data', p.assign, `${className} 定义了 constructor（胖箭头绑定会插在最前面，裸 super 见 super 类别）`)
      } else {
        this.add('class-data', p.assign, `${className} ${code(this.text(p.assign, 50))}`)
      }
    }
    for (const e of exec) this.add('class-exec', e, `⚠ ${className} 类体语句 ${code(this.text(e))}`, true)
    this.containerRetChecks(c)

    this.walk(node.variable, ctx, 'expr', node)
    this.walk(node.parent, ctx, 'expr', node)
    const bctx = { ...ctx, classBody: node, component: c.isComponent ? c : ctx.component }
    for (const p of props) {
      const fn = unwrapCode(p.assign.value)
      if (fn) this.fnNames.set(fn, p.name)
      this.walk(p.assign.value, bctx, 'expr', p.assign)
    }
    for (const e of exec) this.walk(e, bctx, false, node.body)
  }

  visitObj(node, ctx) {
    const role = this.objRole.get(node)
    const props = []
    for (const a of node.properties) {
      if (type(a) !== 'Assign' || a.context !== 'object') continue
      const k = propKey(a.variable)
      if (k) props.push({ ...k, assign: a })
    }
    const c = this.buildContainer('obj', node, props, role)
    if (role === 'component') {
      c.isComponent = true
      c.componentKind = 'createReactClass'
    }
    if (role) {
      for (const p of props) {
        const fn = unwrapCode(p.assign.value)
        if (fn && fn.bound) {
          this.add('class-bound', p.assign, `⚠ ${role === 'component' ? 'createReactClass' : '.extend'} 对象中的 ${p.name}: =>（this 绑定到外层，不是实例）`, true)
        }
      }
    }
    this.containerRetChecks(c)
    const octx = c.isComponent ? { ...ctx, component: c } : ctx
    for (const a of node.properties) {
      if (type(a) === 'Assign' && a.context === 'object') {
        const k = propKey(a.variable)
        const fn = unwrapCode(a.value)
        if (fn && k && !this.fnNames.has(fn)) this.fnNames.set(fn, k.name)
        this.walk(a.value, octx, 'expr', a)
      } else this.walk(a, octx, 'expr', node)
    }
  }

  visitValue(node, ctx, parent) {
    const bt = type(node.base)
    if (bt === 'ThisLiteral') {
      const target = this.thisTarget(ctx)
      const line = this.line(node)
      if (target === 'module' && !this.moduleThisLines.has(line)) {
        this.moduleThisLines.add(line)
        const fn = ctx.fns[ctx.fns.length - 1]
        this.add(
          'module-this',
          node,
          `⚠ ${code(this.lineText(node))}${fn ? '（在模块级 => 函数中）' : ''}；本文件中 this ${this.windowThis ? '=== window（imports-loader）' : '=== module.exports'}`,
          true,
        )
      }
      this.checkMethodRef(node, ctx, parent, target)
    }
    if (bt === 'Range' && !(parent && type(parent) === 'For' && parent.source === node)) {
      this.add('range', node, `范围数组 ${code(this.text(node))}（${node.base.exclusive ? '不含' : '包含'}终点）`)
    }
    for (const p of node.properties) {
      const pt = type(p)
      if (pt === 'Access' && p.soak) {
        const proto = p.name && p.name.value === 'prototype'
        this.addExistence(p, proto ? '?::' : '?.', proto ? '`a?::b`' : '`a?.b`', false, node)
      } else if (pt === 'Index' && p.soak) {
        this.addExistence(p, '?[', '⚠ `a?[x]`', true, node)
      } else if (pt === 'Slice') {
        const splice = parent && type(parent) === 'Assign' && parent.variable === node
        this.add(
          'range',
          p,
          `${splice ? '⚠ 范围赋值（splice）' : '切片'} ${code(this.spanText(node, p))} → slice(a, ${p.range.exclusive ? 'b' : 'b + 1'})`,
          splice,
          node,
        )
      }
    }
    this.walk(node.base, ctx, 'expr', node.properties.length ? node : parent)
    for (const p of node.properties) this.walk(p, ctx, 'expr', node)
  }

  visitCall(node, ctx) {
    if (node.soak) this.addExistence(node, '?(', '⚠ `a.b?()` / `a?()`（仅当是函数才调用）', true)
    if (this.doCodes.has(node.variable)) {
      // `do (x) -> …`: args mirror the params; walk only the function
      return this.walk(node.variable, ctx, 'expr', node)
    }
    const { name, member } = calleeName(node)
    let calleeText = type(node.variable) === 'Value' ? this.vtext(node.variable, 40) : ''
    if (member && name && /…/.test(calleeText)) calleeText = `….${name}`
    if (name === 'createReactClass' || calleeText === 'React.createClass') {
      for (const a of node.args) if (isObjValue(a)) this.objRole.set(a.base, 'component')
    } else if (name === 'extend' && member && !/^(_|\$|jQuery|Object|angular)\.extend$/.test(calleeText)) {
      // Backbone-style `Parent.extend {…}`; `_.extend(a, {…})` / `$.extend` only merge objects
      for (const a of node.args) if (isObjValue(a)) this.objRole.set(a.base, 'extend')
    }
    if (name && (member ? CALLBACK_MEMBERS.has(name) : CALLBACK_IDENTS.has(name))) {
      for (const a of node.args) {
        const fn = unwrapCode(a)
        if (fn) {
          this.addRet(fn, fn, `${code(calleeText)} 的回调`)
          if (!this.fnNames.has(fn)) this.fnNames.set(fn, `${calleeText} 回调`)
          continue
        }
        const ref = thisMemberName(a)
        const target = ref && this.thisTarget(ctx)
        const m = target && typeof target === 'object' ? target.methods.get(ref) : null
        if (m) this.addRet(m.code, m.assign, `作为 ${code(calleeText)} 的回调传入（L${this.line(a)}）`)
      }
    }
    for (const a of node.args) {
      const fn = unwrapCode(a)
      if (fn && !this.fnNames.has(fn)) this.fnNames.set(fn, `${calleeText || '调用'} 的参数`)
    }
    this.walk(node.variable, ctx, 'expr', node)
    for (const a of node.args) this.walk(a, ctx, 'expr', node)
  }

  visitAssign(node, ctx) {
    if (node.context === '?=') this.addExistence(node, '?=', '`a ?= b`（→ a ??= b）', false)
    const v = node.variable
    const fn = unwrapCode(node.value)
    if (fn && !this.fnNames.has(fn)) this.fnNames.set(fn, this.vtext(v, 40))
    // Foo::render = -> / Foo.prototype.render = ->
    if (fn && type(v) === 'Value' && v.properties.length >= 2) {
      const [protoAcc, nameAcc] = v.properties.slice(-2)
      if (
        type(protoAcc) === 'Access' &&
        protoAcc.name.value === 'prototype' &&
        type(nameAcc) === 'Access' &&
        NAMED_METHODS.has(nameAcc.name.value)
      ) {
        this.addRet(fn, node, `${nameAcc.name.value} 方法（原型赋值）`)
      }
    }
    this.walk(v, ctx, 'expr', node)
    this.walk(node.value, ctx, 'expr', node)
  }

  visitFor(node, ctx, isValue) {
    if (node.object) {
      const head = code(this.lineText(node))
      if (node.own) this.add('for-own', node, head)
      else this.add('for-of', node, `${head}（含继承属性）`)
    }
    const vars = new Set()
    collectIdents(node.name, vars)
    collectIdents(node.index, vars)
    assignedVars(node.body, vars)
    this.checkLoopClosure(node, vars)
    this.walk(node.source, ctx, 'expr', node)
    this.walk(node.guard, ctx, 'expr', node)
    this.walk(node.step, ctx, 'expr', node)
    this.walk(node.body, ctx, isValue, node)
  }

  checkLoopClosure(loop, vars) {
    if (!vars.size) return
    const hits = [] // { closure, names:Set, sync }
    const visit = (n, shadow, closure, parent) => {
      if (!n) return
      const t = type(n)
      if (t === 'Code') {
        const inner = new Set([...shadow, ...paramNames(n)])
        let cl = closure
        if (!this.doCodes.has(n) && !closure) {
          const { name } = parent && type(parent) === 'Call' ? calleeName(parent) : { name: null }
          cl = { node: n, names: new Set(), sync: !!name && SYNC_ITERATORS.has(name) && parent.variable !== n }
          hits.push(cl)
        }
        for (const p of n.params) if (type(p) === 'Param') visit(p.value, inner, cl, n)
        visit(n.body, inner, cl, n)
        return
      }
      if (t === 'IdentifierLiteral' && closure && vars.has(n.value) && !shadow.has(n.value)) closure.names.add(n.value)
      for (const c of childNodes(n)) visit(c, shadow, closure, n)
    }
    visit(loop.body, new Set(), null, loop)
    const used = hits.filter((h) => h.names.size)
    if (!used.length) return
    const names = [...new Set(used.flatMap((h) => [...h.names]))]
    const warn = used.some((h) => !h.sync)
    const where = used
      .slice(0, 3)
      .map((h) => `L${this.line(h.node)}${h.sync ? '（同步迭代回调）' : ''}`)
      .join('、')
    this.add(
      'loop-closure',
      loop,
      `${warn ? '⚠ ' : ''}${code(this.lineText(loop, 50))}：闭包捕获 ${names.join(', ')}，闭包位于 ${where}${used.length > 3 ? ' …' : ''}`,
      warn,
    )
  }

  visitArguments(node, ctx) {
    const fn = ctx.fns[ctx.fns.length - 1]
    if (!fn) this.add('arguments', node, `⚠ 模块顶层的 arguments（CommonJS 包装函数的参数）${code(this.lineText(node))}`, true)
    else if (fn.bound) this.add('arguments', node, `⚠ 在 => 函数 ${this.fnLabel(fn)} 中：${code(this.lineText(node))}`, true)
    else this.add('arguments', node, `函数 ${this.fnLabel(fn)}：${code(this.lineText(node))}`)
  }

  checkString(node) {
    const ld = node.locationData
    if (!ld) return
    const raw = this.rawText(node)
    if (raw.startsWith("'''") || raw.startsWith('"""')) {
      this.add('block-string', node, `块字符串 ${raw.slice(0, 3)}（L${ld.first_line + 1}–${ld.last_line + 1}）${code(this.text(node, 50))}`)
    } else if (ld.last_line > ld.first_line && /^['"]/.test(raw)) {
      this.add('block-string', node, `跨行普通字符串（L${ld.first_line + 1}–${ld.last_line + 1}，换行折叠为空格）${code(this.text(node, 50))}`)
    }
  }

  checkMethodRef(node, ctx, parent, target) {
    const comp = ctx.component
    if (!comp || target !== comp) return
    const name = thisMemberName(node)
    const m = name && comp.methods.get(name)
    if (!m) return
    const pt = parent && type(parent)
    if (pt === 'Call' && parent.variable === node) return // @m()
    if (pt === 'Assign' && parent.context !== 'object' && parent.variable === node) return // @m = …
    if (pt === 'Value') return // part of a longer chain
    let how
    if (pt === 'Assign') how = `${code(this.vtext(parent.variable, 30))}: @${name}`
    else if (pt === 'Call') how = `作为 ${code(this.vtext(parent.variable, 30))} 的参数`
    else how = code(this.lineText(node))
    const bound = m.code.bound && comp.componentKind === 'React class'
    this.add(
      'react-method-ref',
      node,
      `${bound ? '' : '⚠ '}${how}（${comp.componentKind}${bound ? '，方法已用 => 定义' : ''}）`,
      !bound,
    )
  }

  checkReactIf(node, ctx, isValue, parent, noElse, kind) {
    if (!noElse || !isValue || !this.isReactFile) return
    const fn = ctx.fns[ctx.fns.length - 1]
    const info = fn && this.methodInfo.get(fn)
    let report
    if (ctx.component) {
      // a function tail is rendering only inside render*: handlers, lifecycle methods and the
      // callbacks nested in them (success:/done:/.then/局部函数) discard their return value
      if (isValue === 'expr') report = true
      else if (/render/i.test(this.fnLabel(fn))) report = true
      else {
        report = false
        for (let i = ctx.fns.length - 1; i >= 0; i -= 1) {
          const mi = this.methodInfo.get(ctx.fns[i])
          if (mi && mi.container === ctx.component) {
            report = /render/i.test(mi.name) && i !== ctx.fns.length - 1
            break
          }
        }
        if (!info && !ctx.fns.some((f) => this.methodInfo.get(f)?.container === ctx.component)) report = true
      }
    } else {
      const pt = parent && type(parent)
      report = (isValue === 'expr' && (pt === 'Call' || pt === 'Arr')) || (isValue === 'tail' && /render/i.test(this.fnLabel(fn)))
    }
    if (!report) return
    const where = isValue === 'tail' ? `${this.fnLabel(fn)} 的返回值` : '表达式中'
    this.add('react-if', node, `⚠ ${kind} 无 else（${where}）${code(this.text(node, 50))}`, true)
  }

  addExistence(node, kind, label, warn, fallback) {
    const line = this.line(node, fallback)
    const key = `${line}|${kind}`
    const e = this.existence.get(key)
    if (e) e.count += 1
    else this.existence.set(key, { node, fallback, label, warn, count: 1 })
  }

  finish() {
    for (const e of this.existence.values()) {
      const n = e.fallback && !e.node.locationData ? e.fallback : e.node
      this.add('existence', n, `${e.label}${e.count > 1 ? ` ×${e.count}` : ''}：${code(this.lineText(n))}`, e.warn, e.fallback)
    }
    for (const [fn, e] of this.retFns) {
      const tailNode = lastStmt(fn.body)
      const tail = describeTail(tailNode)
      if (e.componentRenderOnly && !tail.warn) continue
      const tl = this.line(tailNode)
      const where = tailNode && tl !== this.line(e.anchor) ? `（L${tl} ${code(this.text(tailNode, 50))}）` : ''
      this.add('ret', e.anchor, `${tail.warn ? '⚠ ' : ''}${this.fnLabel(fn)}：${e.reasons.join('；')}；末尾 ${tail.text}${where}`, tail.warn, fn)
    }
  }
}

/** identifiers assigned directly in a block (not inside nested functions), incl. nested loop vars */
function assignedVars(block, out) {
  const visit = (n) => {
    if (!n) return
    const t = type(n)
    if (t === 'Code') return
    if (t === 'Assign' && n.context !== 'object') {
      if (type(n.variable) === 'Value' && n.variable.properties.length === 0) collectIdents(n.variable, out)
    }
    if (t === 'For') {
      collectIdents(n.name, out)
      collectIdents(n.index, out)
    }
    for (const c of childNodes(n)) visit(c)
  }
  visit(block)
  return out
}

/** Analyze one .coffee file. `file` is the monolith-relative path used in the output. */
export function analyzeCoffee(file, src) {
  let root
  try {
    root = loadCoffee().nodes(src)
  } catch (e) {
    const line = e.location ? e.location.first_line + 1 : 0
    return [{ cat: 'parse-error', file, line, col: 0, warn: true, desc: `⚠ ${clip(String(e.message), 120)}` }]
  }
  const a = new FileAnalyzer(file, src)
  try {
    return a.run(root)
  } catch (e) {
    const where = e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)
    return [{ cat: 'parse-error', file, line: 0, col: 0, warn: true, desc: `⚠ 分析器内部错误：${clip(where, 200)}` }]
  }
}

const CAT_ORDER = new Map(CATEGORIES.map((c, i) => [c.id, i]))
export function sortItems(items) {
  return items.sort(
    (a, b) =>
      CAT_ORDER.get(a.cat) - CAT_ORDER.get(b.cat) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.line - b.line ||
      a.col - b.col,
  )
}

export function countByCategory(items) {
  const counts = new Map(CATEGORIES.map((c) => [c.id, { total: 0, warn: 0 }]))
  for (const it of items) {
    const c = counts.get(it.cat)
    c.total += 1
    if (it.warn) c.warn += 1
  }
  return counts
}

// ------------------------------------------------------------------ markdown format

export const CONCLUSION_SEP = ' — 结论：'
const ITEM_RE = /^- \[([a-z-]+)\] (\S+):(\d+) — (.*)$/
const BULK_RE = /^批量结论[：:](.*)$/
const SECTION_RE = /^## \[([a-z-]+)\]/
const HASH_RE = /<!-- coffee_hotspots:items=(\d+) sha1=([0-9a-f]{40}) -->/
const PLACEHOLDER_RE = /^(todo|tbd|待定|待填|待确认|[?？\-—…_.]*)$/i

export const itemKey = (it) => `- [${it.cat}] ${it.file}:${it.line} — ${it.desc}`
const hashKeys = (keys) => crypto.createHash('sha1').update([...keys].sort().join('\n')).digest('hex')
const filled = (s) => s != null && !PLACEHOLDER_RE.test(s.trim())

export function renderMarkdown({ title, command, files, items, prev }) {
  const counts = countByCategory(items)
  const out = []
  out.push(`# coffee 语义热点：${title}`, '')
  out.push(`<!-- 生成：${command} -->`, '')
  out.push(
    '填写说明（PLAN.md G7b；校验规则见 tools/coffee_hotspots.mjs 文件头）：',
    '',
    '- 每个热点一行：`- [类别] 文件:行 — 说明 — 结论：<填写>`。**只改“结论：”后面的文字**；前面的部分和文末的校验注释不要动（`--check` 用哈希校验条目是否被增删改）。',
    '- 带 ⚠ 的条目必须逐条填写结论。',
    '- 不带 ⚠ 且结论留空的条目可以由所在类别下的 `批量结论：` 一行统一覆盖；逐条填写的结论优先。',
    '- 结论为空，或只写 TODO / TBD / 待定 / ? / - 视为未填；显式写了 TODO 等占位符的条目不会被批量结论覆盖。',
    '- 重新生成同一输出文件时，按条目原文保留已填的结论（行号变化的条目需要重填）。',
    `- 校验：\`node tools/coffee_hotspots.mjs --check <本文件>\``,
    '',
  )
  out.push(`## 文件（${files.length}）`, '', ...files.map((f) => `- ${f}`), '')
  out.push('## 统计', '', '| 类别 | 说明 | 数量 | ⚠ |', '| --- | --- | ---: | ---: |')
  for (const c of CATEGORIES) {
    const n = counts.get(c.id)
    if (c.id === 'parse-error' && !n.total) continue
    out.push(`| ${c.id} | ${c.title} | ${n.total} | ${n.warn} |`)
  }
  out.push(`| **合计** | | ${items.length} | ${items.filter((i) => i.warn).length} |`, '')
  for (const c of CATEGORIES) {
    const its = items.filter((i) => i.cat === c.id)
    if (!its.length) continue
    const n = counts.get(c.id)
    out.push(`## [${c.id}] ${c.title}（${n.total}，⚠ ${n.warn}）`, '', `> ${c.hint}`, '')
    out.push(`批量结论：${prev?.bulk.get(c.id) ?? ''}`, '')
    for (const it of its) {
      const key = itemKey(it)
      out.push(`${key}${CONCLUSION_SEP}${prev?.conclusions.get(key) ?? ''}`)
    }
    out.push('')
  }
  out.push(`<!-- coffee_hotspots:items=${items.length} sha1=${hashKeys(items.map(itemKey))} -->`, '')
  return out.join('\n')
}

export function parseMarkdown(text) {
  const items = []
  const bulk = new Map()
  const conclusions = new Map()
  const problems = []
  let section = null
  let hash = null
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '')
    const h = HASH_RE.exec(line)
    if (h) hash = { count: Number(h[1]), sha1: h[2] }
    const s = SECTION_RE.exec(line)
    if (s) section = s[1]
    else if (line.startsWith('## ')) section = null
    const b = BULK_RE.exec(line)
    if (b && section) {
      bulk.set(section, b[1].trim())
      return
    }
    if (!line.startsWith('- [')) return
    const at = line.indexOf(CONCLUSION_SEP)
    const key = at >= 0 ? line.slice(0, at) : line
    const m = ITEM_RE.exec(key)
    if (!m) {
      problems.push(`第 ${i + 1} 行：无法解析的条目：${clip(line, 100)}`)
      return
    }
    if (at < 0) problems.push(`第 ${i + 1} 行：缺少“${CONCLUSION_SEP.trim()}”：${clip(line, 100)}`)
    if (!CATEGORY_IDS.has(m[1])) problems.push(`第 ${i + 1} 行：未知类别 ${m[1]}`)
    if (section && m[1] !== section) problems.push(`第 ${i + 1} 行：条目类别 ${m[1]} 与所在小节 ${section} 不一致`)
    const conclusion = at >= 0 ? line.slice(at + CONCLUSION_SEP.length).trim() : ''
    const it = { key, cat: m[1], file: m[2], line: Number(m[3]), warn: m[4].includes('⚠'), conclusion, mdLine: i + 1 }
    items.push(it)
    conclusions.set(key, conclusion)
  })
  return { items, bulk, conclusions, hash, problems }
}

/** --check: returns { ok, problems[], missing[], total, covered } */
export function checkMarkdown(text) {
  const { items, bulk, hash, problems } = parseMarkdown(text)
  const errs = [...problems]
  if (!hash) errs.push('缺少文末校验注释 <!-- coffee_hotspots:items=… sha1=… -->')
  else {
    const sha1 = hashKeys(items.map((i) => i.key))
    if (hash.count !== items.length || hash.sha1 !== sha1) {
      errs.push(`条目被增删或改动：校验注释记录 ${hash.count} 条，现有 ${items.length} 条，哈希${hash.sha1 === sha1 ? '一致' : '不一致'}（只能修改“结论：”之后的文字）`)
    }
  }
  const missing = []
  let viaBulk = 0
  for (const it of items) {
    if (filled(it.conclusion)) continue
    // 显式写了 TODO / ? 等占位符的条目视为“待处理”，不被批量结论覆盖
    const blank = !it.conclusion || !it.conclusion.trim()
    if (!it.warn && blank && filled(bulk.get(it.cat))) {
      viaBulk += 1
      continue
    }
    missing.push(it)
  }
  return { ok: !errs.length && !missing.length, problems: errs, missing, total: items.length, viaBulk }
}

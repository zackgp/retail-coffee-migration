# CoffeeScript → JS 目标写法范例（PLAN.md G1）

执行 Agent 翻译前必读；Reviewer 对照用。翻译规则本身以 `PLAN.md` §6 为准，本文只说明“仓库里已有的哪段 JS 可以照着写，哪段不能照着写”。

- 路径相对 `apps/monolith/src/sagamore`，行号基于 `origin/staging` @ `6103b96a7f`。
- 每个范例都标了“可参考”和“不要模仿”。**类写法一律以 §6.2 为准**，见第 0 节。
- 语义有疑问时用 `coffee_compile.mjs` 看 CoffeeScript 1.12.7 的真实编译结果（第 7 节）。

## 0. 先读：G1 范例与 §6.2 的冲突

G1 列出的范例里，**只有 5 个**用的是 §6.2 要求的 `Parent.extend({...})`。其余全部是 ES `class X extends SRModel/SRView`，而 §6.2 明确规定翻译 coffee 时**不允许使用 ES class**。按 §6.2 的要求，G4 中 coffee 产物的 `kind` 必须保持 `function`，并且要有 `__super__`；G7 也会把 `class` 标出来。所以下表中“类写法”一列为“ES class”的范例，**只参考模块层面的写法**（import/export、underscore 具名导入、测试组织），不参考类写法。

| 范例 | 提交 | 类写法 | 符合 §6.2 | 可参考 |
| --- | --- | --- | --- | --- |
| `view.js` | `7f1e17949d` | `Backbone.View.extend` | 是 | 全部 |
| `model.js` | `3bdb74eed1` | `Backbone.Model.extend(proto, statics)` | 是 | 全部（个别 decaffeinate 残留除外，见 1.1） |
| `collection.js` | — | `Backbone.Collection.extend(proto, statics)` | 是 | 结构可参考；IIFE 残留**不要模仿** |
| `views/dialog.js` | `de6041dc03` | `SRView.extend` | 是 | 全部 |
| `apps/roles.js` | — | `SRAppsCollection.extend` | 是 | 全部 |
| `models/sales/order.js` | `974499e62f` | ES class | **否** | 模块结构、类外的静态调用 |
| `models/import/*.js` | `63c46ac942` | ES class | **否** | 模块结构、`X.baseUrl(...)` |
| `views/export_button.js` | `c348c2712d` | ES class | **否** | 只参考 import 写法；该提交还改了行为 |
| `views/sales/*.js` | `93386079e0` | ES class + 类字段 | **否** | 只参考 import 和测试；含潜伏 bug |
| `views/action_line.js`、`views/actions.js` | `b3f8f61f6c` | ES class 多级继承 | **否** | 只参考 import、文件头 eslint 注释 |
| `components/backbone_lookup.js` | `445fd3a990` | `createReactClass` + 一个 ES class View | React 部分是 | React 部分可参考 |

> 需要主会话决定：要么修订 PLAN G1 的范例列表，要么在 G1 中注明这些 ES class 范例只参考模块层面。本文暂时按后者处理。

## 1. Backbone

### 1.1 符合 §6.2：类写法照这些写

**`view.js`**（`7f1e17949d`，HRTL-10407）
- 体现了 `.extend` 的标准形态：`const View = Backbone.View.extend({...})`（:20）。构造函数写成 `constructor: function (options)`，上一行加 `// eslint-disable-next-line object-shorthand`（:41-42）；注释里说明了原因：用简写方法时 Backbone 会崩溃。父类构造用 `Backbone.View.call(this, opts)`（:50），父类方法用 `Backbone.View.prototype.remove.apply(this, args)`（:145）。
- 其他约定：underscore 按需具名导入 `import { result, isArray, extend } from 'underscore'`（:18）；mixin 写在 `extend` 之后，`extend(View.prototype, Events)`（:167）；`export default View`（:169）。`Backbone` 直接用全局，不 import。
- 不要模仿：:62 的 `Array.from(extension)` 是 decaffeinate 残留。

**`model.js`**（`3bdb74eed1`，HRTL-10406）
- 静态成员放在 `extend` 的第二个参数（:26 起的 `Backbone.Model.extend(proto, statics)`）。`baseUrl` 等静态方法在 :350 起；`baseUrl(x)` 的实现就是 `this.prototype._baseUrl = x`。
- 胖箭头对应的写法：`constructor` 第一行先 `this._cleanup = this._cleanup.bind(this)`（:32），最后 `Backbone.Model.apply(this, [attributes, options, ...args])`（:71）。
- 父类方法的调用：`Backbone.Model.prototype.save.apply(this, [key, val, options])`（:255）。
- 为了打破 import 循环，用 `Sagamore.CIRCULAR_DEPENDENCIES.Model = Model`（:361）。
- 不要模仿：:182 的 `const results = (() => { ... })()` IIFE 是 decaffeinate 残留。

**`collection.js`**
- `.extend(proto, { baseUrl })`（:12、:247）。`model: Sagamore.CIRCULAR_DEPENDENCIES.Model`（:17）配合构造函数里的惰性兜底（:38），用来处理循环依赖。这也是 §6.1“加载时机”中“保留惰性读取”的一个实例。
- 父类构造用 `Backbone.Collection.apply(this, [_models, _options, ...args])`（:41）。
- **不要模仿**：:84、:166、:180、:207 的 `(() => { const result = []; ... })()` IIFE，以及 :210 的 `Array.from(sort.split(','))`，都是 decaffeinate 风格残留，`lint_converted.sh` 会判失败。

**`views/dialog.js`**（`de6041dc03`，HRTL-16786）
- 一个 coffee 类有多个胖箭头方法时，在 `constructor: function (...args)` 里依次 bind 6 个方法（:12-17），然后 `return SRView.apply(this, args)`（:18）。父类方法用 `SRView.prototype.remove.call(this)`（:137）。
- 可以用 `??=`，见 `opts.animation ??= 'fadeAndPop'`（:113）。
- 保留全局注册：`export default Dialog`（:230）之后写 `Sagamore.Views.Dialog = Dialog`（:231）。`views/` 不在 `no-restricted-globals` 的范围内，所以这里不需要 eslint-disable。
- `import { isBoolean } from 'underscore'`（:3）。

**`apps/roles.js`**
- 先 bind，再 `SRAppsCollection.apply(this, args)`，**最后**才能执行依赖父类初始化结果的语句，例如 `this.debouncedSave = debounce(...)`（:13-17）。
- 数据属性 `baseRouteName`、`layout` 放在 `extend` 第一个参数里（:104-106）；方法中可以直接写 JSX。
- 保留全局注册 `Sagamore.Apps.Roles = Roles`（:109）。
- 导出全部是具名导出 `export { ListView }`、`export { EditView }`、`export { Roles }`（:111-113），**没有 default**，对应 coffee 的对象型 `module.exports = { ListView, EditView, Roles }`（§6.4 对象型模块）。
- `import * as DefaultPerPage from 'sr/lib/default_per_page'`（:3）。

### 1.2 ES class 写法：只参考模块层面

**`models/sales/order.js`**（`974499e62f`；同一提交还转换了 `customer.js`、`customer_event.js`、`invoice.js`、`order_line.js`，同样是 ES class）
- 可参考：
  - coffee 类体中的可执行语句放在类定义之后、按原顺序执行：`Order.subcollection(...)`（:272-277）、`Order.memoized(...)`（:279）、`Order.customFields(...)`（:284）。
  - 保留 `Sagamore.Models.Sales.Order = Order`（:286）和 `export default`（:288）。
  - underscore 具名导入（:2）。
  - 可以用 `?.`（:100）。
- 不要模仿：
  - `class Order extends SRModel`（:14）；
  - 原型数据属性 `Order.prototype.attributeOptions = ...`（:259）在类外赋值。按 §6.2 应放进 `extend` 第一个参数。
  - coffee 的 `@baseUrl '/api/sales/orders'` 被改写成了直接赋值私有字段 `Order.prototype._baseUrl = ...`（:270）。语义虽然等价（见 `model.js:350`），但应保持调用 `X.baseUrl(...)`，与 `models/import/*` 一致。

**`models/import/{schema,set,set_error,set_row}.js`**（`63c46ac942`）
- 可参考：
  - `X.baseUrl('/api/...')`、`X.subcollection(...)` 写在类后（`schema.js:60`、`set.js:62-65`）；
  - `import { find, isEmpty } from 'underscore'`（`schema.js:1`）；
  - `?.` 和 `??` 的用法（`schema.js:26,38`）；
  - 每个文件都有 `__tests__/<name>.test.js`。
- 不要模仿：ES class，以及 `X.prototype.attributeOptions = ...` 在类外赋值（`set.js:58`）。

## 2. 普通模块和视图

这一节的范例**全部是 ES class**（第 0 节）。翻译 coffee 的类时，按 1.1 节的 `.extend` 写法来写；这里只参考模块层面。

**`views/export_button.js`**（`c348c2712d`）
- 可参考：
  - `import { uniqueId } from 'underscore'`（:1）；
  - 把只在本模块用、不访问 `this` 的原型方法提升为模块级函数（`createFormatLi`）；
  - 遍历真数组时用 `for...of`（:22）；
  - `export default`（:32）；
  - 配套测试 `views/__tests__/export_button.test.js`。
- **不要模仿：这个提交改变了行为**：
  - 删除了 `onButtonClick`，以及 toastr 的 `showUnableToRunReportToastr` 逻辑；
  - ul 的 class 从 `"export-ul f-dropdown"` 改成了 `"f-dropdown"`，违反 §6.3“保留 className”；
  - 删除了 `Sagamore.Views.ExportButton` 全局，违反 PLAN §2 第 3 条“默认不去全局”。

**`views/sales/*.js`**（`93386079e0`：`create_item_on_the_fly.js`、`discounts_table.js`、`set_missing_fields_dialog.js`、`invoices/add_lines.js`）
- 可参考：
  - 模块级纯函数取代原型方法：`discountAmount`，见 `discounts_table.js:3`；
  - 测试放在 `views/sales/__tests__/*.test.jsx`。
- **不要模仿**：
  - 用类字段写原型数据属性：`size = 'medium'`（`create_item_on_the_fly.js:8`）、`fields = [...]`（`discounts_table.js:6`）。这正是 §6.2 所说的时序问题：
    - `discounts_table.js`：`CollectionTable.initialize`（`views/collection_table.js:86`）在父类构造函数里通过 `result(this, 'fields')` 读取 `fields`，这时类字段还没赋值，读到的是空值。随后类字段才把数组写上去，所以只是**碰巧**能显示。它的测试把 `CollectionTable` mock 成了 ES class，测不出这个问题。
    - `create_item_on_the_fly.js` 和 `set_missing_fields_dialog.js`：`Dialog.initialize` 先执行 `if (options.size != null) this.size = options.size`（`views/dialog.js:25`），之后类字段 `size = ...` 会把调用方传入的 `size` **覆盖掉**。目前没有调用方传 `size`（`views/extensions/item_lines_creation.js:603,614`、`apps/pos.coffee:2037`），所以问题处于潜伏状态。
  - `className` 在类外赋值 `X.prototype.className = ...`（`create_item_on_the_fly.js:47`）；`discounts_table.js` 则**丢掉了**原 coffee 的 `className: "discounts"`。
  - `create_item_on_the_fly.js` 丢掉了原 coffee `initialize: -> super` 中对父类的调用。
  - `add_lines.js:25` 使用全局 `_.isEmpty`，没有 import underscore；bind 写在 `initialize` 里（:13），而不是像 §6.2 要求的那样写在构造函数最前面。
  - 删除了 `Sagamore.Views.Sales.*` 全局。
  - `discounts_table.js:5` 直接继承全局 `Sagamore.Views.CollectionTable`。

**`views/action_line.js`、`views/actions.js`**（`b3f8f61f6c`；同一提交的 `views/conditions.js` 写法相同）
- 可参考：
  - 文件头声明全局与豁免规则：`/* globals $, JST */` 和 `/* eslint-disable no-restricted-globals, max-classes-per-file, class-methods-use-this */`（`action_line.js:1-2`）；
  - `import { each, without } from 'underscore'`（`actions.js:2`）；
  - coffee 中挂在基类上的子类注册保持为静态属性赋值 `ActionLine.percent_off_items = ...`（`action_line.js:477-490`），写在类定义之后；
  - 测试 `views/__tests__/action_line.test.js`、`actions.test.js`。
- 不要模仿：
  - ES class 多级继承；
  - 原 coffee 的类体属性 `events:` 改成在 `initialize` 里赋值 `this.events = {...}`。这是为了绕开类字段的时序问题。注意顺序也不统一：`actions.js:10-15` 在 `super.initialize` **之前**赋值，`action_line.js:113-118` 在**之后**。
  - 箭头类字段 `initSelection = (...) => {}`（`action_line.js:418`）。按 §6.2，应在构造函数里 bind。

## 3. 带 mixins、保留 `createReactClass` 的组件

**`components/backbone_lookup.js`**（`445fd3a990`）
- 可参考（§6.3“带 mixins 的组件保留 createReactClass”）：
  - 写成 `// eslint-disable-next-line react/prefer-es6-class` 加 `const BackboneLookup = createReactClass({ displayName, mixins: [PureRenderMixin], getDefaultProps, ... })`（:32-39）；
  - `propTypes` 移到 spec 外：`BackboneLookup.propTypes = {...}`（:55）；
  - `prop-types` 具名导入 `import { bool, func, string, any } from 'prop-types'`（:1）；
  - `export default`（:64）。
- 不要模仿 / 需注意：
  - :51 的 render 仍然是工厂调用 `Sagamore.Components.BackboneView({ view })`，**没有改成 JSX**，也没有遵守 §6.3“DOM 工厂 → JSX”。而且它在 `components/` 下读取 `Sagamore`，却没有加 `// eslint-disable-next-line no-restricted-globals`，而 `.eslintrc.js:178-192` 对 components/containers 设置了 `no-restricted-globals: [2, 'sagamore', 'Sagamore']`。同样的情况还有 `components/imports/importers/spreadsheet.js:144` 和 `components/setup_error_message.js:41`。按 §6.3，应逐行加 `// eslint-disable-next-line no-restricted-globals -- TODO(coffee-deglob)`。
  - 同一个文件里的 `class LookupWrapperView extends SRView`（:10）把 events 放在 initialize 里赋值。§6.2 已明确说明不要以它作为 Backbone 范例。
  - 相对 coffee 的改动：`@_view` 改名为 `this.wrapperView`（:44）；`LookupWrapperView` 移到了文件开头；删除了 `Sagamore.Components.BackboneLookup` 全局。翻译时不要做这类改名、重排或去全局（§4 的“与源码顺序一致”，§2 第 3 条）。
  - 没有配套的 jest 测试。

## 4. React class 组件

**B04 合并后补充。** 届时从 B04 的产出中挑 2–3 个，覆盖以下三种情况：
- 需要 bind 回调的组件；
- 带 `defaultProps` / `propTypes` 静态属性的组件；
- 由 `UNSAFE_` 生命周期改写的组件。

补充后，为每个范例写明其 bind 方式（§6.3 要求全仓统一）。

## 5. 从这些范例归纳的约定

以下只列出**有代码佐证**的条目。与 §6 重复的部分只给出引用。

1. **模块格式**：统一用 ESM。值型模块使用 `export default X`，对象型模块使用具名导出（`apps/roles.js:111-113`），依据见 §6.4。`sr/...` 模块用 `import X from 'sr/...'`。
2. **underscore 按需具名导入**：`import { a, b } from 'underscore'`（`view.js:18`、`collection.js:3`、`views/dialog.js:3`、`apps/roles.js:9`、`models/sales/order.js:2`、`models/import/schema.js:1`、`views/export_button.js:1`、`views/actions.js:2`）。反例是 `views/sales/invoices/add_lines.js:25` 的全局 `_`。
   - 注意：npm 的 underscore 是 1.13.8，而 webpack 下页面全局 `_` 是 `src/vendor/underscore.js` 1.8.3，两者是不同的实例。如果代码依赖 `_.mixin` 注入的方法或 `_.templateSettings`，改成 import 前要先确认（见 Q5 汇报）。
3. **`Backbone`、`$`、`JST` 直接使用全局**，不 import（`view.js:20`，`views/action_line.js:1` 的 `/* globals $, JST */`）。它们来自 `src/vendor`，由 script-loader 以全局方式加载。
4. **`.extend` 的构造函数**：
   - 写成 `// eslint-disable-next-line object-shorthand` 加 `constructor: function (...args) {`（`view.js:41-42`、`views/dialog.js:10-11`、`apps/roles.js:12-13`）；
   - 函数体内先 bind，再 `Parent.apply(this, args)`。其余规则见 §6.2。
   - 写法上有一处差异：`views/dialog.js:18` 写了 `return SRView.apply(...)`，`apps/roles.js:15` 没有写 `return`。Backbone 1.0 的构造函数没有返回值，所以两种写法效果相同。
5. **静态成员**：放进 `extend` 的第二个参数（`model.js:26` 起、`collection.js:247`）。coffee 类体中的可执行语句（`@baseUrl ...`、`@subcollection ...`）放在 `extend` 之后，用 `X.baseUrl(...)` / `X.subcollection(...)`（`models/import/set.js:62-65`），见 §6.2。
6. **调用父类方法**：`Parent.prototype.m.call/apply(this, ...)`（`view.js:145`、`model.js:255`、`collection.js:149`、`views/dialog.js:137`），见 §6.2。
7. **全局注册**：
   - 保留，写在 `export default` 之后（`views/dialog.js:231`、`apps/roles.js:109`、`models/sales/order.js:286`），依据见 PLAN §2 第 3 条；
   - 只有在 `components/`、`containers/` 下才需要加 `// eslint-disable-next-line no-restricted-globals -- TODO(coffee-deglob)`（`.eslintrc.js:178-192`）；
   - 公开全局见 `public_globals.json`。
8. **新语法**：可以直接使用 `?.`、`??`、`??=`、展开语法（`views/dialog.js:113`、`models/sales/order.js:100`、`models/import/schema.js:38`）。babel（preset-env，chrome 97 / firefox 102 / safari 14）和 ts-jest（target es2015）都能处理。
9. **测试**：放在模块旁的 `__tests__/<name>.test.js(x)`（如 `models/import/__tests__/*.test.js`、`views/sales/__tests__/*.test.jsx`、`views/__tests__/dialog.test.jsx`）。
   - 没有测试的范例：`view.js`、`collection.js`、`apps/roles.js`、`views/sales/create_item_on_the_fly.js`、`components/backbone_lookup.js`。
   - mock 父类时，要按父类的真实形态 mock：父类是 `.extend` 写的，就不要 mock 成 ES class（反例 `views/sales/__tests__/discounts_table.test.jsx`）。
10. **不要模仿的 decaffeinate 残留**：
    - `(() => { const result = []; ... })()` IIFE（`collection.js:84` 等、`model.js:182`）；
    - `Array.from(x)` 用于解构（`view.js:62`、`collection.js:210`）。

## 6. 范例之间的不一致（汇总）

| 主题 | 写法 A | 写法 B | 以谁为准 |
| --- | --- | --- | --- |
| 类写法 | `.extend`（view/model/collection/dialog/roles） | ES class（order、import/*、export_button、views/sales、action_line/actions、backbone_lookup 内的 View） | §6.2：`.extend` |
| 原型数据属性 | 写在 `extend` 第一个参数里（roles 的 `baseRouteName`/`layout`） | 类外 `X.prototype.y = ...`（order、import/set、views/sales）；类字段（views/sales）；在 `initialize` 里赋值（action_line/actions/backbone_lookup 的 `events`） | §6.2 |
| `baseUrl` | `X.baseUrl('/api/...')`（import/*） | `X.prototype._baseUrl = ...`（order.js:270） | 用 `X.baseUrl(...)` 保持与 coffee 一致 |
| 胖箭头方法 bind 的位置 | 构造函数最前面（model/dialog/roles） | `initialize` 里（add_lines.js:13）；箭头类字段（action_line.js:418） | §6.2：构造函数最前面 |
| `events` 与 `super.initialize` 的先后 | 先赋值（actions.js:10-15） | 后赋值（action_line.js:113-118） | 不适用：`.extend` 写法下 `events` 直接放进原型 |
| 全局注册 | 保留（model/dialog/roles/order） | 删除（export_button、views/sales、backbone_lookup） | PLAN §2 第 3 条：保留 |
| 导出 | `export default` | 只有具名导出（roles） | §6.4：按值型 / 对象型区分 |
| underscore | 具名 import | 全局 `_`（add_lines） | 具名 import |
| DOM 工厂 | JSX（roles） | 保留工厂调用 `Sagamore.Components.BackboneView(...)`（backbone_lookup:51） | §6.3：改 JSX |
| 行为与结构 | 保持原样 | 删除方法/逻辑、改 className、丢掉 `super` 调用、改名、重排（export_button、views/sales、backbone_lookup） | §4 / §6.3：保持原样 |

## 7. 语义核对工具：`coffee_compile.mjs`

```sh
# 在 retail-coffee-migration 根目录（宿主机，依赖由 tools/setup_host.sh 装在 .host-deps/；src/... 相对目标 app 目录）
node tools/coffee_compile.mjs src/sagamore/components/breadcrumbs.coffee
node tools/coffee_compile.mjs src/sagamore/components/breadcrumbs.coffee --range 25:35
# 在 sr_web 容器内：tools/sr_web.sh yarn node coffee-tools/tools/coffee_compile.mjs ...
```

- 输出 `compile(src, { bare: true })` 的结果到 stdout，**不落盘，不提交，不作为翻译起点**（PLAN §2）。
- 使用 `--range a:b` 时，只输出映射到 coffee 第 a..b 行（1-based，含）的生成行。每段前加 `// coffee L<x>-L<y>`，段与段之间用 `// ...` 分隔。
- 文件头部的 `var ...` 声明和 `extend`、`slice` 等 helper 会映射到 coffee 第一条语句所在的行。
- 退出码：
  - 0：成功；
  - 1：读取失败、编译错误（输出带 `file:line:col` 的错误），或者范围内没有任何生成代码；
  - 2：参数错误。

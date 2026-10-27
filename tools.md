## User

[@retail-coffee-migration](file:///Users/zack/workspaces/retail/retail-coffee-migration/)
 这里面已经把 migration 时需要的静态检查工具写好了但是我不是很理解每个工具是做什么的，什么时候用，需要我手动调用还是让agent自己掌握调用的时机即可

## Assistant

<thinking>
I need to explain the tools in retail-coffee-migration, so I should look at README.md, PLAN.md, and the tools directory to understand what's there.


</thinking>

我先看一下工具 repo 的结构和文档，再逐个说明。

**Tool Call: List the `retail-coffee-migration` directory's contents**
Status: Completed

# Folders:
retail-coffee-migration/.work
retail-coffee-migration/data
retail-coffee-migration/jest
retail-coffee-migration/progress
retail-coffee-migration/tools

# Files:
retail-coffee-migration/.gitignore
retail-coffee-migration/AGENTS.md
retail-coffee-migration/EXAMPLES.md
retail-coffee-migration/PLAN.md
retail-coffee-migration/README.md
retail-coffee-migration/config.json


**Tool Call: List the `retail-coffee-migration/tools` directory's contents**
Status: Completed

# Folders:
retail-coffee-migration/tools/lib
retail-coffee-migration/tools/selftest

# Files:
retail-coffee-migration/tools/baseline.sh
retail-coffee-migration/tools/changes.mjs
retail-coffee-migration/tools/check_interop.mjs
retail-coffee-migration/tools/coffee_compile.mjs
retail-coffee-migration/tools/coffee_hotspots.mjs
retail-coffee-migration/tools/collect.mjs
retail-coffee-migration/tools/compare.mjs
retail-coffee-migration/tools/ensure_packages.sh
retail-coffee-migration/tools/inventory.mjs
retail-coffee-migration/tools/lint_converted.sh
retail-coffee-migration/tools/lint_scan.mjs
retail-coffee-migration/tools/record_shapes.sh
retail-coffee-migration/tools/setup_host.sh
retail-coffee-migration/tools/sr_web.sh
retail-coffee-migration/tools/verify.sh
retail-coffee-migration/tools/verify_container.sh
retail-coffee-migration/tools/webpack_stats.cjs


**Tool Call: Read file `retail-coffee-migration/README.md`**
Status: Completed

````retail-coffee-migration/README.md
     1	# retail-coffee-migration
     2	
     3	把 Heartland Retail（springboard-retail）`apps/monolith` 里剩余的 CoffeeScript 迁移到 JavaScript 用的**护栏工具和工作资料**，独立于 springboard-retail 仓库：
     4	
     5	- 不提交到 springboard-retail，也不参与它的 CI；
     6	- 通过配置文件指向任意一个 springboard-retail checkout（主仓库或 worktree）；
     7	- 计划、范例、批次进度也放在这里：`PLAN.md`、`EXAMPLES.md`、`progress/`。
     8	
     9	迁移的方法、批次划分和每批协议以 `PLAN.md` 为准，先读文首的“★ 工具独立 repo 化”一节。
    10	
    11	## 目录
    12	
    13	```
    14	config.json              目标 checkout 与容器设置（提交）
    15	config.local.json        本机覆盖（gitignore，可选）
    16	PLAN.md  EXAMPLES.md     迁移计划 / 目标写法范例
    17	progress/                每批一个进度文件 progress.<bxx>.md
    18	tools/                   全部脚本（宿主机 + 容器）
    19	  lib/                   共享库：paths.mjs（唯一的路径来源）、config_env.mjs、deps.mjs …
    20	  selftest/              工具自测
    21	jest/
    22	  tests/                 G4 export_shapes / G5 sagamore_registry / G9 legacy_helpers（在目标的 jest 里跑）
    23	  helpers/               webpack_runtime、describe_value、compare_shapes、legacy、legacy_app、tool_paths
    24	data/springboard-retail/ 针对该目标的数据（提交）
    25	  batches.json  coffee_manifest.txt  interop_allowlist.json  public_globals.json
    26	  sagamore_registry.json  baseline/  shapes/
    27	.work/                   临时目录：缓存、verify/baseline 运行结果、hotspots/<Bxx>.md、inventory.json（gitignore）
    28	.host-deps/              宿主机用的 coffeescript 1.12.7 + typescript（gitignore，setup_host.sh 安装）
    29	```
    30	
    31	## 配置
    32	
    33	`config.json`（被 `config.local.json` 深合并覆盖）：
    34	
    35	| 字段 | 含义 |
    36	| --- | --- |
    37	| `name` | 目标名，只用于输出 |
    38	| `targetRepo` | 目标仓库根目录（绝对路径，支持 `~`） |
    39	| `appDir` | 目标仓库内的 app 目录，`apps/monolith` |
    40	| `baseRef` | 计算“本分支改了什么”的基准，`origin/staging` |
    41	| `dataDir` | 数据目录，必须在本 repo 内 |
    42	| `workDir` | 临时目录，必须在本 repo 内（容器只能通过挂载看到本 repo） |
    43	| `container.composeFiles` | 相对目标仓库根的 compose 文件 |
    44	| `container.service` | `sr_web` |
    45	| `container.projectName` | compose 项目名，不能和目标目录 basename 相同（会和主仓库共享容器/volume） |
    46	| `container.repoMount` | 容器里目标仓库的挂载点，`/sr` |
    47	| `container.toolsMount` | 本 repo 在容器里挂到 `<repoMount>/<appDir>/<toolsMount>`，`coffee-tools` |
    48	
    49	环境变量优先级更高：`COFFEE_TARGET_REPO`、`COFFEE_WORK_DIR`、`COFFEE_BASE_REF`、`COMPOSE_PROJECT_NAME`。
    50	
    51	同时迁移多个 worktree 时，每个 worktree 用不同的 `workDir` 和 `container.projectName`（例如在 shell 里 `export COFFEE_TARGET_REPO=… COFFEE_WORK_DIR=.work/wt2 COMPOSE_PROJECT_NAME=sr-coffee2`），否则会共用缓存和容器。
    52	
    53	## 首次准备
    54	
    55	```sh
    56	# 1. 指向目标 checkout（不改 config.json 时用本地覆盖）
    57	echo '{ "targetRepo": "/path/to/springboard-retail" }' > config.local.json
    58	# 2. 装宿主机依赖；把容器挂载点加进目标仓库的 info/exclude
    59	tools/setup_host.sh
    60	```
    61	
    62	前提：宿主机有 node、git、docker；目标仓库能用 `sr-dev` 构建 `sr_web` 镜像（见目标仓库 `AGENTS.md`）。docker 命令在 Agent 沙箱里需要 `unsandboxed`。
    63	
    64	## 命令
    65	
    66	都在本 repo 里运行（脚本会自己切到目标 app 目录）；`src/…` 形式的文件参数相对目标 app 目录。
    67	
    68	| 命令 | 运行位置 | 作用 |
    69	| --- | --- | --- |
    70	| `tools/verify.sh [--quick] [--batch Bxx] [--base <ref>]` | 宿主机 | G8 每批总校验（0/0b/0c/1/2/4b 在宿主机，2/3/4/5–8 在容器） |
    71	| `tools/baseline.sh [--only jest,karma,…]` | 宿主机 | G6 在干净的目标分支上录制基线到 `data/…/baseline/` |
    72	| `tools/record_shapes.sh <Bxx \| src/…coffee …>` | 宿主机 | G4 转换前录制形态快照到 `data/…/shapes/` |
    73	| `node tools/inventory.mjs [--summary\|--check\|--batch Bxx …]` | 宿主机 | G2 盘点与批次 |
    74	| `node tools/check_interop.mjs [--files …]` | 宿主机 | G3 互操作检查 |
    75	| `node tools/coffee_hotspots.mjs --batch Bxx` / `--check <md>` | 宿主机 | G7b 热点清单（输出 `.work/hotspots/<Bxx>.md`） |
    76	| `node tools/coffee_compile.mjs <file.coffee> [--range a:b]` | 宿主机 | 查看 CoffeeScript 1.12.7 编译结果（只看，不落盘） |
    77	| `tools/lint_converted.sh <files…>` | 宿主机或容器 | G7 残留扫描 + 严格 eslint |
    78	| `node tools/changes.mjs [--list <name>]` | 宿主机 | 本分支相对 merge-base 的文件集合（verify 用） |
    79	| `tools/sr_web.sh <cmd…>` | 宿主机 | 在目标的一次性 `sr_web` 容器里执行命令（工作目录 `/sr/apps/monolith`） |
    80	| `tools/ensure_packages.sh` | 宿主机 | 缺少 `apps/packages/*/dist` 时在容器里 `yarn build:packages` |
    81	| `tools/selftest/hotspots_check.sh`、`node tools/selftest/interop.mjs` | 宿主机 | 工具自测 |
    82	
    83	容器里直接跑 jest 的例子：
    84	
    85	```sh
    86	tools/sr_web.sh sh -c 'yarn jest --cacheDirectory "$JEST_CACHE_DIR" src/sagamore/views'     # 目标自己的测试
    87	tools/sr_web.sh sh -c 'yarn jest --ci --cacheDirectory "$JEST_CACHE_DIR" coffee-tools/jest/tests'   # 护栏测试
    88	tools/sr_web.sh env UPDATE_COFFEE_REGISTRY=1 yarn jest coffee-tools/jest/tests/sagamore_registry   # 重录 G5（要说明原因）
    89	```
    90	
    91	## 工作原理
    92	
    93	### 宿主机
    94	
    95	`tools/lib/paths.mjs` 读取配置，导出 `REPO_ROOT`、`MONOLITH`、`DATA_DIR`、`WORK_DIR` 等；shell 脚本通过 `eval "$(node tools/lib/config_env.mjs)"` 得到同样的 `COFFEE_*` 变量。宿主机上目标没有安装依赖（Yarn PnP 装在镜像里），所以静态工具从 `.host-deps/` 加载 coffeescript/typescript。
    96	
    97	### 容器
    98	
    99	`tools/sr_web.sh` 等价于在目标仓库根执行：
   100	
   101	```sh
   102	docker compose run --rm -T \
   103	  -v <本 repo>:/sr/apps/monolith/coffee-tools -w /sr/apps/monolith \
   104	  -e COFFEE_IN_CONTAINER=1 -e COFFEE_REPO_ROOT=/sr -e COFFEE_MONOLITH=/sr/apps/monolith \
   105	  -e COFFEE_TOOLS_ROOT=/sr/apps/monolith/coffee-tools -e COFFEE_WORK_DIR=… -e COFFEE_DATA_DIR=… \
   106	  -e COREPACK_HOME=…/.work/corepack -e JEST_CACHE_DIR=…/.work/jest-cache \
   107	  sr_web <cmd…>
   108	```
   109	
   110	为什么挂在 `apps/monolith/coffee-tools`：
   111	
   112	- 位于 `sr-apps` workspace 目录内，Yarn PnP 把这里的文件当作该 workspace 的文件，工具和 jest helpers 可以直接 `import 'coffeescript'`、`'react'` 等；`webpack_stats.cjs` 用 `createRequire(<app>/package.json)`。
   113	- 在目标 jest 的 `rootDir` 内，`yarn jest coffee-tools/jest/tests` 能找到测试，用目标自己的 `jest.config.js`（ts-jest、moduleNameMapper、`global.setup.js`）。
   114	- 目标的 `yarn test`（`jest ./src`）、`eslint src`、`tsc`（include 只有 `src/**`、`migrators/**`、`shims.d.ts`）都看不到它，所以不会影响目标的 lint/test/CI 结果。
   115	- 本 repo 故意**没有 package.json**：嵌套的 package.json（尤其 `"type": "module"`）会改变挂载目录里文件的模块类型和 jest haste 行为。
   116	
   117	docker 会在宿主机上留下一个空目录 `<appDir>/coffee-tools/`。`setup_host.sh` 把它写进目标仓库的 `info/exclude`；`sr_web.sh` 发现它非空时拒绝运行（防止有人真的往里放了文件）。容器里没有 git（worktree 的 `.git` 指向挂载外），需要变更列表的步骤都在宿主机算好，再通过 `.work/` 传进去。
   118	
   119	### 与目标仓库的边界（重要）
   120	
   121	- 目标分支**不能**包含 `apps/monolith/coffee-tools/`、`apps/monolith/migration/coffee/` 下的文件，也不能引用 `coffee-tools/`、`jest_helpers/coffee_migration`、`__tests__/coffee_migration`、`retail-coffee-migration`。`verify.sh` 第 0c 步（`changes.mjs --list tool-leaks`）检查这一点。
   122	- 提交到目标仓库的测试必须**自包含**：不能 import `jest/helpers/*`，也不能用 `loadLegacyApp` 加载整个 app。某个批次的提交测试确实需要 helper 时，把函数复制到目标的 `src/jest_helpers/`，作为普通代码随该批 PR 提交。
   123	- G4（形态）/G5（注册表）只在本地 verify 里跑，不进 CI。它们的快照提交在本 repo：
   124	  - `shapes/<key>.json` 带 `recordedFrom`（必须是 `.coffee`）和 `recordedSha`（录制时 `.coffee` 的 git blob sha）；verify 0b 要求它等于目标 merge-base 上那个 `.coffee` 的 blob，所以快照一定录自转换前的源码。
   125	  - `sagamore_registry.json` 有未提交修改时，0b 需要 `ALLOW_REGISTRY_CHANGE=1`，并在目标 PR 描述和进度文件里说明。
   126	- 基线 `data/…/baseline/` 对应某个目标 merge-base；目标 rebase 到新的 `baseRef` 后用 `tools/baseline.sh` 重录并提交到本 repo。
   127	
   128	## 待验证（2026-10-21 搬迁后尚未运行）
   129	
   130	搬迁只改了代码和文档，下面这些还没实际跑过：
   131	
   132	1. `tools/setup_host.sh`：`.host-deps` 安装、`info/exclude` 写入（worktree 的 `--git-path` 指向主仓库的 `.git/info/exclude`）。
   133	2. 宿主机静态工具：`node tools/inventory.mjs --check`、`--summary`；`node tools/check_interop.mjs --quiet`（0 error、7 条白名单）；`tools/selftest/hotspots_check.sh`；`node tools/selftest/interop.mjs`。
   134	3. 挂载：`tools/sr_web.sh ls coffee-tools`；嵌套 bind mount（`./apps` 已挂到 `/sr/apps`，再挂 `coffee-tools`）在 Docker Desktop 上是否正常；宿主机空挂载点是否只出现在 `info/exclude` 覆盖的位置。
   135	4. PnP 与 ts-jest：`tools/sr_web.sh sh -c 'yarn jest --ci --cacheDirectory "$JEST_CACHE_DIR" coffee-tools/jest/tests'`，即挂载目录下的测试和 helpers 能被 ts-jest 转换、能解析 `coffeescript`/`typescript`/`react`/`sr/*`。
   136	5. 容器内 `yarn node coffee-tools/tools/collect.mjs --only karma-static`、`webpack_stats.cjs`（`createRequire` 找 webpack）。
   137	6. **重录基线** `tools/baseline.sh`：旧基线的 `jest-passing.txt` 含已移走的 3 个 `src/__tests__/coffee_migration/*` 套件，不重录会被判为“测试减少”。
   138	7. `tools/verify.sh --quick` 与完整模式在无改动时全绿（含 0c）。
   139	8. 重做 B00 四项自测（`PLAN.md` “B00 验收”）；其中形态快照改用 `tools/record_shapes.sh` 录制，确认 0b 的 `recordedSha` 校验能拦住“转换后再录制”。

````


**Tool Call: Search files for regex `^#{1,3} `**
Status: Completed

file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L1:2

```
# PLAN.md — 剩余 CoffeeScript 全量迁移到 JavaScript

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L9:10

```
## ★ 工具独立 repo 化（2026-10-21，优先于下文）

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L41:42

```
## 0. 结论速览

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L51:52

```
### 模型与思考档位

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L66:67

```
## 1. 现状要点（决定计划形状的事实）

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L148:149

```
## 2. 总体策略

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L173:174

```
## 3. B00：护栏基础设施（Opus 5.5，高；不转换任何 coffee）

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L179:180

```
### B00 实现要点（以此为准；下文 G1–G9 是原始设计）

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L193:194

```
### G1. 目标写法范例与语义参考工具（不使用转换工具）

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L211:212

```
### G2. 盘点与进度：`tools/inventory.mjs`

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L225:226

```
### G3. 互操作检查器：`tools/check_interop.mjs`（静态，宿主机运行）

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L249:250

```
### G4. 导出形态快照（jest）：`jest/tests/export_shapes.test.js`

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L279:280

```
### G5. 运行时注册表快照（jest；不新增 karma 用例）：`jest/tests/sagamore_registry.test.js`

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L291:292

```
### G6. 基线录制：`tools/baseline.sh`

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L304:305

```
### G7. 严格 lint 与残留扫描：`tools/lint_converted.sh <files…>`

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L322:323

```
### G7b. coffee 语义热点清单：`tools/coffee_hotspots.mjs <files.coffee…>`

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L343:344

```
### G8. 每批总校验：`tools/verify.sh`

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L362:363

```
### G9. 测试脚手架

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L373:374

```
### B00 验收

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L385:386

```
## 4. 每批执行协议（所有转换批次通用）

```


**Tool Call: Read file `retail-coffee-migration/PLAN.md` (lines 1-60)**
Status: Completed

```retail-coffee-migration/PLAN.md
     1	# PLAN.md — 剩余 CoffeeScript 全量迁移到 JavaScript
     2	
     3	> 读者：执行迁移的大模型 Agent（以及审阅它们的人）。
     4	> 前置阅读：`AGENTS.md`（sr-dev 用法、构建接线、团队约定）。本文不重复其中内容，只引用。
     5	> 基线：`origin/staging` @ `6103b96a7f`（2026-10）。每批开始前都要重新跑盘点脚本，数据以脚本输出为准。
     6	
     7	---
     8	
     9	## ★ 工具独立 repo 化（2026-10-21，优先于下文）
    10	
    11	B00 产出的护栏工具、快照测试、数据，以及 `PLAN.md`、`EXAMPLES.md`、`progress/`，已从 springboard-retail 移到独立 repo **`/Users/zack/workspaces/retail/retail-coffee-migration`**（下称“工具 repo”）。springboard-retail 里**不提交任何工具代码**，工具也不参与 springboard-retail 的 CI。用法、配置和容器挂载机制见工具 repo 的 `README.md`。
    12	
    13	**路径约定**：下文以 `tools/`、`jest/`、`data/`、`.work/` 开头的路径都相对工具 repo 根目录；`src/…`、`webpack.config.js`、`shims.d.ts` 等相对目标 app 目录（`<targetRepo>/apps/monolith`）。目标 checkout 由 `config.json` / `config.local.json` / `COFFEE_TARGET_REPO` 指定。
    14	
    15	| 原位置（springboard-retail） | 现位置（工具 repo） |
    16	| --- | --- |
    17	| `apps/monolith/migration/coffee/` 下的 `.mjs`/`.sh`/`.cjs`、`lib/`、`selftest/` | `tools/` |
    18	| `migration/coffee/{batches.json,coffee_manifest.txt,interop_allowlist.json,public_globals.json,sagamore_registry.json}` | `data/springboard-retail/` |
    19	| `migration/coffee/baseline/`、`migration/coffee/shapes/` | `data/springboard-retail/baseline/`、`data/springboard-retail/shapes/` |
    20	| `migration/coffee/.work/`（含 `hotspots/<Bxx>.md`、`verify/`、`inventory.json`） | `.work/`（gitignore） |
    21	| `migration/coffee/.work/coffee-tools`（宿主机依赖） | `.host-deps/`（gitignore） |
    22	| `migration/coffee/EXAMPLES.md` | `EXAMPLES.md` |
    23	| `src/__tests__/coffee_migration/*.test.js` | `jest/tests/` |
    24	| `src/jest_helpers/coffee_migration/*.js` | `jest/helpers/`（新增 `tool_paths.js`） |
    25	| 仓库根 `PLAN.md`、`progress/` | 工具 repo 根 `PLAN.md`、`progress/`（目标 worktree 的 `AGENTS.md` 保留并指向这里） |
    26	
    27	**变更的规则（与下文冲突时以本节为准）**：
    28	
    29	1. **命令**：在工具 repo 里运行，如 `tools/verify.sh [--quick] [--batch Bxx]`、`node tools/inventory.mjs --batch Bxx`、`tools/record_shapes.sh Bxx`、`tools/sr_web.sh <cmd…>`。脚本自己切到目标 app 目录；`src/…` 形式的参数从任何目录都能用。
    30	2. **容器**：`tools/sr_web.sh` 把工具 repo 挂到容器内 `/sr/apps/monolith/coffee-tools`（在 Yarn workspace 目录内，PnP 能解析目标的依赖；`jest ./src`、`eslint src`、tsc 都扫不到它），工作目录 `/sr/apps/monolith`。docker 会在宿主机创建空目录 `apps/monolith/coffee-tools/`，`tools/setup_host.sh` 把它写进目标仓库的 `info/exclude`。
    31	3. **G4/G5 只在本地跑**（`verify.sh` 第 4 步的 guardrail jest），不再进 CI。形态快照 `data/…/shapes/*.json` 和注册表快照 `data/…/sagamore_registry.json` **提交在工具 repo**，不进目标 PR。下文“快照和转换放在同一个 PR”“注册表变化必须出现在 PR diff”改为：快照在工具 repo 提交；注册表变化在目标 PR 描述和进度文件里说明。
    32	4. **0b 快照完整性**改为按内容校验：本分支每个转换掉的 `.coffee` 模块都要有 `shapes/<key>.json`，其 `recordedFrom` 以 `.coffee` 结尾，`recordedSha`（录制时写入的 git blob sha）等于该 `.coffee` 在 merge-base 上的 blob；`sagamore_registry.json` 在工具 repo 里有未提交修改时需 `ALLOW_REGISTRY_CHANGE=1`。
    33	5. **新增 0c tool-leaks**：目标分支不得包含 `apps/monolith/coffee-tools/` 或 `apps/monolith/migration/coffee/` 下的文件，改动的文件不得引用 `coffee-tools/`、`jest_helpers/coffee_migration`、`__tests__/coffee_migration`、`retail-coffee-migration`。
    34	6. **G9 helpers 仅本地可用**：提交到 springboard-retail 的测试必须自包含——不能 import `jest/helpers/*`，也不能加载整个 app（`loadLegacyApp`）。批次的提交测试确实需要某个 helper 时，在该批 PR 里把函数复制到 `src/jest_helpers/` 作为普通代码。
    35	7. **基线**：`data/…/baseline/` 提交在工具 repo。搬迁后必须重录一次（旧基线的 `jest-passing.txt` 含 3 个已移走的 `src/__tests__/coffee_migration/*` 套件）。
    36	8. **B00 不再单独给 springboard-retail 提 PR**（原“Add CoffeeScript migration guardrails”）；护栏随工具 repo 提交。
    37	9. **多个 worktree**：每个目标 worktree 用自己的 `config.local.json`（或 `COFFEE_TARGET_REPO` + `COFFEE_WORK_DIR`）和不同的 `container.projectName`，避免共用 `.work/` 与 compose 项目。
    38	
    39	---
    40	
    41	## 0. 结论速览
    42	
    43	| 问题 | 结论 |
    44	| --- | --- |
    45	| 一次性转完还是分批？ | **分批**。先做 1 个护栏批次（B00），再做约 32 个转换批次（B01–B32）。每批约 1,000–1,800 行 coffee，或约 15 个文件，按功能目录划分，每批一个 PR。 |
    46	| 为什么不一次性转完？ | 322 个文件、31k 行，对应 JS 产出约 35k 行。任何模型都无法在单一上下文里逐行对照原文审阅，人也审不了这么大的 diff。团队约定是小 PR（参见 `c348c2712d` 等提交）。长期 worktree 期间 staging 会持续变动，大 PR 的冲突成本过高。按批次拆分后，出问题可以单独 revert。 |
    47	| 能否并行？ | 可以，但有条件。同一批内可以按**不相交的文件集**派生多个子 Agent 并行转换，由编排 Agent 统一跑校验、统一修改共享文件。不同批次**串行合并**，因为它们共享快照 JSON、`shims.d.ts`、`webpack.config.js`。具体规则见 §10.4。 |
    48	| 怎么开始执行？ | 按 §10 开会话：每批一个主会话，用 `progress/progress.<bxx>.md` 记录工作进度，可以按规则派 subagent，Reviewer 由人另开独立会话。提示词见 §10.5。 |
    49	| 主力模型 | 见下表。 |
    50	
    51	### 模型与思考档位
    52	
    53	| 角色 / 工作类型 | 推荐模型 | 思考档位 | 理由 |
    54	| --- | --- | --- | --- |
    55	| B00 护栏基础设施（脚本、快照测试、verify） | **Claude Opus 5.5** | **高** | 需要理解 webpack/jest/karma/TS 互操作，写出的工具决定后面所有批次的可信度。 |
    56	| Backbone App、设备/打印/支付、`pos.coffee` 拆分、核心基类、入口文件（B15、B16–B31） | **Claude Opus 5.5** | **高** | CS1 class / `super` / 胖箭头 / 原型数据属性 / `this===window` 等语义陷阱密集，且大多数文件**没有测试**。 |
    57	| 每批完成后的独立审阅（Reviewer） | **Claude Opus 5.5** | **高** | 用全新上下文逐文件对照 `.coffee` 原文与最终 JS，专门找语义漂移。审阅者不能和执行者是同一个会话。 |
    58	| `createReactClass` 组件批次（B02–B14 中标注的批次） | **Claude Sonnet 5.5** | **中**；标注“高”的批次用**高** | 模式高度重复：DOM 工厂改写成 JSX，`createReactClass` 改写成 class。第一个组件批次 B04 产出范例后，其余批次按范例直接翻译，Sonnet 的性价比最好。 |
    59	| 编排 Agent（拆分子任务、跑 verify、汇总） | Opus 5.5 | 中 | 需要判断失败原因并分派修复。 |
    60	| 机械性工作：跑 verify 并汇总日志、更新进度表、残留扫描 | Claude Haiku 5.5 | 低 | 不做语义判断。**禁止**用 Haiku 写转换代码。 |

```


**Tool Call: Read file `retail-coffee-migration/PLAN.md` (lines 173-480)**
Status: Completed

````retail-coffee-migration/PLAN.md
   173	## 3. B00：护栏基础设施（Opus 5.5，高；不转换任何 coffee）
   174	
   175	所有迁移工具放在独立的工具 repo（见文首“★ 工具独立 repo 化”）。容器里通过 `tools/sr_web.sh` 挂在 `apps/monolith/coffee-tools`，`eslint src` 和 `jest ./src` 都扫不到。快照测试放在工具 repo 的 `jest/tests/`，只在本地由 `verify.sh` 跑，不进 CI。
   176	
   177	> 运行环境：除盘点和静态检查脚本可以在宿主机用 Node 跑之外，其他命令都在 `sr_web` 容器里执行（需要 `unsandboxed`）。容器里**没有可用的 git**，因为 `.git` 指针指向的主仓库没有挂载进去。需要变更文件列表的步骤，先在宿主机算好，再作为参数传进去。
   178	
   179	### B00 实现要点（以此为准；下文 G1–G9 是原始设计）
   180	
   181	- **容器入口用 `tools/sr_web.sh <cmd…>`**，不要用 `sr-dev run`：后者透传参数不加引号，`sh -c '…'` 会被拆散。`sr_web.sh` 默认 `COMPOSE_PROJECT_NAME=sr-coffee`，并把 corepack 与 jest 缓存放在挂载目录里（`--rm` 容器否则每次冷启动：jest 加载 main 100 秒 vs 3 秒）。宿主机工具依赖用 `tools/setup_host.sh` 装一次。
   182	- **工作目录是 `.work/`（gitignore），不是 `apps/monolith/tmp/`**：production webpack 先输出到 `tmp/`，`CleanBuildPlugin` 再把整个 `tmp/` 移成 `public/`，放在 `tmp/` 里的东西会被一次 `yarn build:production` 带走。热点清单因此在 `.work/hotspots/<Bxx>.md`（下文所有 `tmp/coffee_hotspots/` 都指这里）。
   183	- **G2**：`batches.json` 的 glob 相对 `src/`、**不带扩展名**，与 `coffee_manifest.txt`（迁移开始时的 322 个 coffee 模块）取交集，转换后仍能定位。`inventory.json` 是生成文件，不提交。`--batch Bxx [--json|--list files|coffee|js|callers|karma|related]`、`--summary`、`--check`、`--freeze`。
   184	- **G4**：没有用 `jest.isolateModules`。模块依赖完整的全局注册表，隔离加载会大量失败且把依赖的注册算进来。实际做法：用带追踪的 `global.Sagamore`（Proxy，写入时取调用栈里第一个 `src/` 文件）加载一次 vendor+main，再逐模块 require 取形态；每个模块的“全局注册副作用”= 由该文件执行的写入（路径 + 类型 + 值的身份）。原型上**所有**数据属性都记录；`model`/`collection`/`appClass` 记为导出它的模块 `module:<key>`。录制时加载失败的模块不再跳过，而是判失败。录制用 `record_shapes.sh <Bxx|files…>`。快照在 `data/springboard-retail/shapes/`。B00 不录任何模块（各批自录）。
   185	- **G5**：jest 方案（见 §9 Q1）。遍历规则：普通对象全部向下，函数只沿大写开头的静态属性向下（`Sagamore.Apps.Integrations.Clover` 这类挂在 App 类上的注册），深度 ≤ 8，共 481 条路径。另记 `Apps.*` 路由、Layouts、Imports.Errors、Formats、`appOptions`。`public_globals.json` 里的名字必须存在。
   186	- **G6**：采集器 `collect.mjs`（容器内）、比较器 `compare.mjs`（宿主机）、`baseline.sh`。除 PLAN 列的文件外还记录：`jest-passing.txt`（每文件通过数，防止删/skip 测试）、`karma-specs.txt`（`DEPRECATED_spec` 下每个文件的 it 数与 sha）、`test-config.txt`（karma-entry/karma.conf/jest.config 等指纹）。webpack 通过 `webpack_stats.cjs` 用 Node API 取 stats（配置里 production 的 SILENT stats 会丢模块列表）。
   187	- **G7**：扫描在 `lint_scan.mjs`（TS AST）。任何 `class … extends X`（X 不是 React.Component/PureComponent/Error）都判失败，含别名/括号/匿名类；另加 coffee 1.12.7 编译产物指纹（`__super__`、`hasProp.call`、`superClass`、`refN`、`_this`…）；整文件 `eslint-disable` 与 `/* eslint rule: 0 */` 一律失败，行级 disable 要求 `-- <≥10 字符理由>` 或 `TODO(coffee-deglob)`。
   188	- **G8**：`verify.sh [--quick] [--batch Bxx] [--base origin/staging]`，宿主机用 `changes.mjs` 算文件集（merge-base + 未跟踪文件），容器部分一次性跑 `verify_container.sh`。新增步骤 0（`inventory --check`）和 0b（快照完整性：`shapes/*.json` 必须录自 merge-base 上仍是 `.coffee` 的模块、`recordedFrom` 必须是 `.coffee`、本分支转换的每个模块都要有快照、`sagamore_registry.json` 的修改须 `ALLOW_REGISTRY_CHANGE=1`）。G7 也覆盖本分支新增的非测试代码文件（拆分/移动后的文件）。webpack 模块集合只放行“本分支新增文件”的新增和“删除且无替代”的删除；karma spec 缩小必须是纯删除（当前文件是 staging 版本的行子序列）；karma 通过数的下降不得超过删除的 it 数。完整模式约 3.5–4 分钟，`--quick` 约 25 秒。
   189	- **G9**：`jest/helpers/legacy.js`（`mockAjax`、`renderBackboneApp`、`mountLegacy`），需要完整全局环境时在 `beforeAll` 里调 `legacy_app.js` 的 `loadLegacyApp()`。
   190	- 自测脚本：`tools/selftest/interop.mjs`（G3）、`selftest/hotspots_check.sh`（G7b `--check`）。
   191	- 已知局限：`jest.mock` factory 形状不匹配只报 warning（靠相关 jest 测试兽底）；G4 只看导出值，未导出的内部类靠 G7 与人工 Reviewer；React class 的方法绑定仍需 Reviewer 逐个核对；`sagamore`/`JST`/`Highcharts` 等非 `Sagamore` 的 window 全局尚未快照（B30/B31 前补）。
   192	
   193	### G1. 目标写法范例与语义参考工具（不使用转换工具）
   194	
   195	- **`EXAMPLES.md`**：列出每类代码要对齐的团队现有写法，作为执行 Agent 的必读材料。
   196	  - **Backbone**：
   197	    - `view.js`、`model.js`、`collection.js`
   198	    - `views/dialog.js`、`apps/roles.js`
   199	    - `models/sales/order.js`（`974499e62f`）
   200	    - `models/import/*.js`（`63c46ac942`）
   201	  - **普通模块和视图**：
   202	    - `views/export_button.js`（`c348c2712d`）
   203	    - `views/sales/*.js`（`93386079e0`）
   204	    - `views/action_line.js`、`views/actions.js`（`b3f8f61f6c`）
   205	  - **带 mixins、保留 `createReactClass` 的组件**：`components/backbone_lookup.js`。
   206	  - **React class 组件**：B04 合并后，从它的产出里挑 2–3 个补进来，作为后续组件批次的范例。
   207	  - 每个范例写一两句说明它体现了哪条约定，例如具名导出、`.extend` 加 bind、`import { x } from 'underscore'`。
   208	- **`tools/coffee_compile.mjs <file.coffee> [--range a:b]`**：用仓库已有的 `coffeescript` 1.12.7 执行 `compile(src, { bare: true })`，把结果输出到 stdout，可以只输出指定行范围对应的片段。只用来在语义有疑问时核对，**不落盘，也不提交**。
   209	- **互操作修复由 Agent 按 G3 的报错手工完成**，不使用 `deglob` 或 `addDefaultToRequires`。前者会改写整个代码库，后者是批量改写，都不适合按批次精确控制。
   210	
   211	### G2. 盘点与进度：`tools/inventory.mjs`
   212	
   213	- 把 `tmp/coffee_inventory.mjs` 和 `tmp/coffee_exports.mjs` 正式化，合并到这个脚本。
   214	- 默认模式（宿主机 Node 可运行），输出 `.work/inventory.json`，每个文件包含：
   215	  - 行数
   216	  - importer（区分 coffee、JS、TS、测试）
   217	  - 全局赋值，以及这些全局的静态使用者
   218	  - 已知的动态注册表命中
   219	  - 导出形态
   220	  - 语法模式
   221	  - 关联测试
   222	- `--batch Bxx`：读取 `data/springboard-retail/batches.json`（批次 → glob 列表），打印该批的文件、外部调用方、需要处理互操作的位置，以及按 §4.1 (a)(b) 判定需要迁移的 karma spec（列出文件路径、行数，以及命中的 `describe` 名称）。
   223	- `--summary`：输出剩余文件数和行数、每个批次的状态，以及剩余 karma spec 的数量，用于更新 §8 的进度表。
   224	
   225	### G3. 互操作检查器：`tools/check_interop.mjs`（静态，宿主机运行）
   226	
   227	解析 `src/**/*.{js,jsx,ts,tsx,coffee}` 的 import 和 require。用和 webpack 相同的规则（`sr/` alias、扩展名顺序）解析目标模块，再判断目标的导出形态：
   228	
   229	- `esm-default`
   230	- `esm-named`
   231	- `cjs-value`
   232	- `cjs-object`
   233	- `coffee`
   234	
   235	以下情况**报错**：
   236	
   237	| 调用方写法 | 目标形态 | 问题 |
   238	| --- | --- | --- |
   239	| `require('x')` 后直接使用，没有 `.default` 也没有解构 | `esm-default` | 拿到的是命名空间对象 |
   240	| `import * as X from 'x'`，并且把 `X` 当函数/类调用，或者访问了 `X.<非导出名>` | ESM | 命名空间对象不可调用 |
   241	| `import { a } from 'x'` | 没有导出 `a` | eslint `import/named` 看不到 coffee 目标 |
   242	| `import X from 'x'` | 只有具名导出 | 拿到 `undefined` |
   243	| TS 文件 import 了已转成 JS 的模块 | `shims.d.ts` 里仍有对应的 `declare module` | 只**警告**，提示清理 shim |
   244	
   245	其他规则：
   246	- 同一路径下 `.coffee` 和 `.js` 并存时报错，因为 `.js` 会静默覆盖 `.coffee`。
   247	- 支持 `--files` 参数：只检查与给定文件相关的边（调用方和被调用方），也支持全量检查。
   248	
   249	### G4. 导出形态快照（jest）：`jest/tests/export_shapes.test.js`
   250	
   251	- 读取 `data/springboard-retail/shapes/*.json`，每个模块对应一个快照。
   252	- `UPDATE_COFFEE_SHAPES=1` 时录制，否则比对。
   253	- **录制必须在转换前、基于 `.coffee` 进行**（`tools/record_shapes.sh Bxx`）。快照提交在工具 repo，不进目标 PR；`recordedSha` 把它和 merge-base 上的 `.coffee` 绑定（verify 0b）。
   254	- 每个模块在 `jest.isolateModules` 中加载。加载前后各对 `global.Sagamore` 做一次深层键路径快照，两者的差集就是本模块的**全局注册副作用**。
   255	- 先对模块值做归一化：`v = m && m.__esModule ? m.default ?? m : m`，同时记录具名导出键。
   256	
   257	需要记录的内容：
   258	
   259	- `typeof`
   260	- 函数类型：`es-class` 还是 `function`（判断依据是 `Function.prototype.toString` 的结果是否以 `class` 开头）
   261	- `isReactComponent`、`displayName`
   262	- `propTypes`、`contextTypes` 的键
   263	- `defaultProps`（JSON 安全的值）
   264	- 静态自有键（排除 `length`、`name`、`prototype`），以及 `__super__` 是否存在
   265	- 原型链（直到 `Backbone.*`、`React.Component` 或 `Object` 为止）上的方法名集合
   266	- **原型上的数据属性值**，包括 `routes`、`events`、`tagName`、`className`、`defaults`、`idAttribute`、`urlRoot`、`template` 是否存在，以及 `model` 和 `collection` 的标识
   267	- 对象型导出：每个键的类型
   268	
   269	比较规则需要预置以下“允许的差异”：
   270	
   271	- `createReactClass` → `class`：
   272	  - 允许 `kind` 从 `function` 变为 `es-class`。
   273	  - 允许 `__reactAutoBindPairs`、`getDefaultProps`、`getInitialState` 等 createReactClass 内部键消失，但 `defaultProps` 必须相等。
   274	  - 业务方法集合不能减少。
   275	- **硬规则**：只要录制时存在 `extend` 静态方法或 `__super__`，转换后 `kind` 必须仍是 `function`，不能是 `es-class`。
   276	
   277	在 jsdom 里加载失败的模块，记录 `{ loadError: <message> }` 并跳过形态比对，改由 G5 的运行时注册表兜底。比对时如果模块从“能加载”变成“不能加载”，判定失败。
   278	
   279	### G5. 运行时注册表快照（jest；不新增 karma 用例）：`jest/tests/sagamore_registry.test.js`
   280	
   281	- 优先方案是 jest。在 jsdom 里仿照 `karma-entry.js` 的加载顺序：先 `require('vendor')`，再 `require('main')`；在此之前，`jest_helpers/global.setup.js` 已经准备好了 jQuery、Backbone 和 shim。只 mock 那些在 jsdom 里确实跑不起来的第三方脚本，比如 Highcharts 和插件探测。
   282	- 如果 B00 发现 `main` 无法在 jsdom 里完整加载，就改成一个 CI 不跑的脚本 `tools/registry_snapshot.mjs`：先 `yarn build`（dev），再用 `sr_web` 镜像里 karma 用的那个 Chromium 加载构建产物，读出注册表。这个脚本由 `verify.sh` 调用。**不允许为此在 `DEPRECATED_spec` 里加 spec。**
   283	- 在完整加载 `src/main` 之后，遍历 `window.Sagamore`（深度 ≤ 5），对每个键路径记录类型（`es-class`、`function`、`object`、原始值），然后与 `data/springboard-retail/sagamore_registry.json` 比对。
   284	- 额外记录：每个 `Sagamore.Apps.*` 的 `prototype.routes`、`Sagamore.Components.Layouts` 的键、`Imports.Errors.Details` 和 `Imports.Errors.Resolvers.*` 的键、`Sagamore.Formats` 的键。
   285	- `UPDATE_COFFEE_REGISTRY=1` 时录制。
   286	- 注册表的任何变化都必须重录、提交到工具 repo，并在目标 PR 描述和进度文件中说明原因（未提交时 verify 0b 需 `ALLOW_REGISTRY_CHANGE=1`）。只有 P9（去全局）阶段才会预期它缩小。
   287	- `apps.coffee` 是一个独立的 webpack entry，`main` 不会加载它：
   288	  - 如果 B00 能用 jest 加 mock 加载它，就在 G4 里录下它的路由表：每条路由对应的 `appClass` 路径和 `routes`。
   289	  - 如果做不到，就把录制路由表这一步留到 B31 开始前。
   290	
   291	### G6. 基线录制：`tools/baseline.sh`
   292	
   293	在 B00 结束时录制一次，之后每次 rebase 到新的 staging 都要重录。小文件提交到 `data/springboard-retail/baseline/`：
   294	
   295	- `jest-failures.txt`：`yarn jest ./src --json` 的失败用例集合。预期为空；如果 staging 本身就有失败用例，记下来。
   296	- `karma.txt`：`yarn test:karma` 的结果摘要，包括用例总数和失败用例列表。这份基线只用来对比回归。karma spec 的数量只会随着迁移减少。
   297	- `eslint.json`：`yarn lint:js --format json` 按 规则 × 文件 统计的数量。
   298	- `tsc-errors.txt`：`yarn tsc --noEmit -p tsconfig.json` 的错误集合，归一化为 `文件 (TSxxxx): 消息`，**不含行号**。
   299	- `webpack-modules-{dev,prod}.txt`：两种模式下 `webpack --json` 的 stats，取每个 chunk 的模块路径集合，并把扩展名统一归一化为 `.<ext>`。这个基线用来发现两类问题：
   300	  - `require.context` 漏掉了模块，或者 alias 指错了
   301	  - 意外引入的新依赖
   302	- `yarn build`（production）能成功。
   303	
   304	### G7. 严格 lint 与残留扫描：`tools/lint_converted.sh <files…>`
   305	
   306	对**本批新增的 JS 文件**执行：
   307	
   308	```
   309	eslint --max-warnings 0 --rule 'no-undef: error' --rule 'import/no-unresolved: error' --rule 'no-unused-vars: error'
   310	```
   311	
   312	同时用 `rg` 扫描以下内容，命中即失败：
   313	
   314	- 机械转换工具的痕迹：`__guard__`、`__guardMethod__`、`__range__`、`__extends`、`__bind`、`__indexOf`、`__slice`、`__hasProp`、`decaffeinate`、`bulk-decaffeinate`，以及文件头的整文件 `/* eslint-disable`。本计划不使用这些工具，一旦命中，说明执行者违规用了工具或照抄了编译输出。
   315	- `React.DOM`、`createFactory`
   316	- `class \w+ extends (Backbone\.|View|App|SRApp|Sagamore\.|.*Collection\b|.*Model\b)`，也就是 Backbone 体系被改成了 ES class
   317	- 新增的 `eslint-disable`，只有带 `-- TODO(coffee-deglob)` 或写明理由的才放行
   318	- `==` 和 `!=`：只允许 `!= null` 和 `== null`
   319	
   320	另外**列出**本批新 JS 中所有默认参数和 `&&` 形式的 JSX 条件渲染。这些不判失败，而是作为清单交给 Reviewer 人工确认，原因见 §6。
   321	
   322	### G7b. coffee 语义热点清单：`tools/coffee_hotspots.mjs <files.coffee…>`
   323	
   324	用 `coffeescript` 1.12.7 的 `nodes()` 解析**转换前的 `.coffee`**，输出一份带 `文件:行` 的热点清单。执行者必须逐项给出结论，Reviewer 逐项复核。这是替代机械转换工具“语义忠实”的主要自动化手段。清单包含以下几类：
   325	
   326	- **隐式返回值可能有语义的函数**，包括以下场景：
   327	  - Backbone `events` 哈希里引用的方法；
   328	  - `.on`、`.click`、`.bind`、`$.each`、`.each`、`_.each`、`_.find`、`filter`、`some`、`every` 的回调；
   329	  - `validate`、`parse`、`toJSON`、`url`、`render`、`initialize` 方法；
   330	  - `.then` 的回调。
   331	
   332	  对每一个，都给出它最后一个表达式的节点类型。如果最后一个表达式是字面量 `false`、赋值、循环或 `if`，要重点标出。
   333	- **最后一句是循环的函数**：它们会隐式返回数组。
   334	- **默认参数**：对 `null` 和 `undefined` 都会生效。
   335	- **存在运算符**：尤其是 `a.b?()` 和 `a?[x]`。
   336	- **class 相关**：胖箭头方法、裸 `super`、类体中的可执行语句、类体中的数据属性、静态成员。
   337	- **循环相关**：`for own`、不带 `own` 的 `for k of obj`、闭包里捕获了循环变量的循环。
   338	- **其他**：`arguments`、splat、`///` 正则、块字符串、范围切片、模块级的 `@`。
   339	- **React 组件内**：没有 `else` 的 `if` 表达式（用于条件渲染时），以及作为回调传出去的 `@method` 引用（用来核对 class 写法下是否绑定）。
   340	
   341	输出位置：`.work/hotspots/<批次>.md`，不提交。执行者在每一项后面填写结论，并把结论贴进 PR 描述。如果项目过多，只贴需要特别处理的那些。
   342	
   343	### G8. 每批总校验：`tools/verify.sh`
   344	
   345	由编排 Agent 在宿主机调用：先算出本批文件和受影响的调用方，再把它们作为参数传入容器。
   346	
   347	| 步骤 | 命令 | 失败条件 |
   348	| --- | --- | --- |
   349	| 1 | `check_interop.mjs --files …`（宿主机） | 任何错误 |
   350	| 2 | `lint_converted.sh <新 js>` | 任何错误 |
   351	| 3 | `yarn eslint <本批所有改动文件>` 与基线对比 | 出现新的错误 |
   352	| 4 | `yarn jest --findRelatedTests <新 js 与改动文件>`，以及工具 repo 的 `jest/tests`（容器内 `coffee-tools/jest/tests`） | 任何失败 |
   353	| 4b | `coffee_hotspots.mjs`（G7b）生成的热点清单里，每一项都在 Agent 自查结果中有结论 | 有遗漏 |
   354	| 5 | `yarn tsc --noEmit` 的错误集合与基线 diff | 出现新的错误 |
   355	| 6 | `yarn build`（dev 和 production），生成 stats 后与基线 diff | 构建失败、出现循环依赖，或者模块集合出现非预期变化（只允许本批文件的扩展名变化，以及新增的测试或辅助模块） |
   356	| 7 | 跑 G5 注册表快照（jest；如果走的是备用方案，就跑 `registry_snapshot.mjs`），以及 `yarn test:karma` | 注册表 diff 不为空；karma 相对基线出现新的失败（修复方式是按 §4.1 迁移到 jest，**不能修补 karma**）；`DEPRECATED_spec` 中出现新增文件或新增用例 |
   357	| 8 | 批次合并前跑 `yarn jest ./src` 全量 | 相对基线出现新的失败 |
   358	| 9 | 可选，相关功能涉及 e2e 时：`JOB_ID=coffee ./misc/dev-tools/bin/sr-dev test e2e <suite>` | 依赖完整栈和端口，见 AGENTS.md 中的坑；也可以交给 CI |
   359	
   360	`verify.sh --quick` 只跑 1–4，供 Agent 在迭代中使用。完整模式是批次完成的必要条件。
   361	
   362	### G9. 测试脚手架
   363	
   364	- 实现在工具 repo 的 `jest/helpers/`（**仅本地**）：
   365	  - `renderBackboneApp`：实例化 App，触发指定路由，并 mock `fetch` 和 `$.ajax`。
   366	  - `mountLegacy`：挂载 createReactClass 或 class 组件，并提供最小 context。
   367	- 提交到目标 repo 的测试不能 import 它们（verify 0c）。需要时把用到的函数复制到目标的 `src/jest_helpers/`，随该批 PR 提交；提交的测试也不能加载整个 app。
   368	- 这些辅助函数用于给**没有测试的大文件**补冒烟测试，也用于§4.1 的 karma → jest 迁移。
   369	- 按需从 `DEPRECATED_spec/helpers` 搬入工厂函数。不要让 jest 用例 import `DEPRECATED_spec` 下的任何文件。
   370	- 决定冒烟测试的覆盖范围时，只看是否有 jest 覆盖。karma 覆盖不算数。有 49 个 coffee 文件只有 karma 覆盖，它们的 karma 用例会按 §4.1 (a) 迁移到 jest。
   371	- 冒烟测试必须**在转换前基于 coffee 写好并通过**，然后原样用于验证 JS 版本。
   372	
   373	### B00 验收
   374	
   375	- 护栏自身的测试：
   376	  - 故意把一个模块改成错误的导出形态，确认 G3/G4 能报出来。
   377	  - 把一个 Backbone 子类改成 ES `class`，确认 G4/G7 能报出来。
   378	  - 删除一个全局注册，确认 G5 能报出来。
   379	  - 在 `DEPRECATED_spec` 里新增一个用例，确认 G8 第 7 步能报出来。
   380	- 基线全部录制完毕，`verify.sh` 在不做任何改动时全绿。
   381	- ~~以单独的 PR 提交：`HRTL-xxxxx: Add CoffeeScript migration guardrails`。~~ 工具独立后护栏提交在工具 repo，不给 springboard-retail 提 PR。
   382	
   383	---
   384	
   385	## 4. 每批执行协议（所有转换批次通用）
   386	
   387	**执行 Agent** 的步骤：
   388	
   389	1. **同步与盘点**：确认分支基于最新的 `origin/staging`（创建分支和 rebase 需要用户授权），然后运行 `inventory.mjs --batch Bxx`。如果本批文件已被其他人修改或删除，先更新 `batches.json`。盘点输出里要列出本批需要迁移的 karma spec，判定标准见 §4.1。
   390	2. **迁移 karma 用例**（在 coffee 状态下完成）：按 §4.1 把需要迁移的 karma 用例改写成 jest，确认它们在 coffee 版本上通过，然后删除对应的 karma 用例。
   391	3. **录制**：在 coffee 状态下完成以下操作：
   392	   - `UPDATE_COFFEE_SHAPES=1` 录制本批模块的形态快照；
   393	   - 按 G9 给没有测试、且超过 150 行的文件补冒烟测试，并确认它们在 coffee 版本上通过；
   394	   - 运行 `coffee_hotspots.mjs <本批 .coffee>`（G7b），生成语义热点清单。
   395	4. **翻译**：逐文件直接从 `.coffee` 写出同名的目标 JS。按 §6 的规则执行，写法对齐 G1 的 `EXAMPLES.md`。
   396	   - 顶层结构和方法顺序保持与源码一致。
   397	   - 每遇到一个热点，就写下结论：是否保留了返回值、默认参数是否需要 `??`、条件渲染用的是三元表达式还是 `&&`。
   398	   - 有疑问时用 `coffee_compile.mjs` 查看编译结果。
   399	   - 超过约 400 行的文件，按顶层单元（class、对象、方法组）分段翻译，每段写完就对照源码自查一次。
   400	   - **禁止**使用 `yarn convert:coffee`、decaffeinate 或 codemod，也禁止把编译输出整体拷贝后再改。
   401	5. **自查**：对照 `.coffee` 原文把每个文件从头到尾再读一遍，重点核对 §6 和热点清单。
   402	6. **调用方**：根据 G3 的报错修复互操作。如果调用方是 karma spec，**不要修补它**，而是按 §4.1 迁移到 jest。
   403	   - 优先改调用方：coffee 调用方加 `.default`，JS 调用方改为默认或具名 import；
   404	   - 其次才是调整被调用方的导出形态。
   405	   - 对象型模块一律改成具名导出（`export const a…` / `export function a…`），**不要**用 `export default { … }`，否则 164 处具名 import 会失效。
   406	7. **类型**：从 `shims.d.ts` 删除已转换模块的 `declare module`。如果暴露出新的 tsc 错误：
   407	   - 能用 JSDoc 或小改动修好的就修；
   408	   - 修不好的就保留 shim，并标注 `// TODO(coffee-js-types)`。
   409	8. **删除 `.coffee`**，跑 `verify.sh --quick` 迭代到全绿，最后跑完整的 `verify.sh`。
   410	   - 如果 karma 出现新的失败，就把失败的用例按 §4.1 迁移到 jest。新写的 jest 用例要先在 coffee 版本上验证一遍：用 `git show origin/staging:<path>.coffee` 临时恢复原文件，跑一次，再删掉。
   411	9. **自查清单**：输出 G7b 热点清单和 G7 列出的人工确认项，并逐条给出结论；同时列出本批迁移了哪些 karma 用例，以及删除了哪些 karma 用例。
   412	
   413	**Reviewer Agent**（Opus 5.5，高，全新会话）：
   414	
   415	- 输入：本批 diff、`.coffee` 原文（`git show origin/staging:<path>`）、G7b 热点清单和执行者给出的结论、G7 清单、被删除的 karma 用例原文。必要时用 `coffee_compile.mjs` 查看编译结果。
   416	- 职责：只找语义差异，不改风格，并输出“问题 / 已确认无问题”两张表。
   417	- 对 karma → jest 的迁移，还要逐个 `it` 核对：断言是否被弱化、用例是否丢失。
   418	- 执行 Agent 修复后，必须重新跑 `verify.sh`。
   419	
   420	**批次完成的定义（DoD）**：
   421	
   422	- 本批 `.coffee` 已全部删除；`verify.sh` 完整模式全绿；Reviewer 无未关闭的问题。
   423	- 本批需要迁移的 karma 用例都已迁移到 jest 并从 karma 中删除；`DEPRECATED_spec` 中没有新增或修补的内容。
   424	- §7 中对应的人工验收项已列在 PR 描述里，并标注“需人工”。
   425	- 提交信息为 `HRTL-xxxxx: Migrate <thing> CoffeeScript to JS`，正文写 `Connect to HRTL-xxxxx`。如有行为变化，在提交说明中写明。
   426	- §8 的进度表已更新。
   427	
   428	**禁止事项**：
   429	
   430	- 不经用户授权就 commit、push 或建分支。
   431	- 在本 worktree 跑 `pristine`、`update`、`down -v`。
   432	- 为了让测试变绿去修改测试的断言语义。只有 mock 的形状（`__esModule`/`default`）可以调整。
   433	- 新增 karma 用例，或者修补 karma 用例（包括改 import、改 mock、改 `.default`）。需要改动的 karma 用例一律按 §4.1 迁移。
   434	- 顺手重构业务逻辑。
   435	- 一个批次修改另一个批次的文件。互操作修复除外，并且必须在 PR 里列出。
   436	
   437	### 提示词
   438	
   439	执行 Agent、Reviewer、B00 和中断续接的提示词统一放在 §10.5。会话怎么开、进度文件 `progress/progress.<bxx>.md` 怎么写、subagent 怎么用，见 §10。
   440	
   441	### 4.1 karma 用例处理规则（团队策略：只迁移，不新增，不修补）
   442	
   443	**哪些 karma 用例必须迁移**（`inventory.mjs --batch` 会自动列出前三类）：
   444	
   445	- (a) 直接 import 或 require 了本批 coffee 模块的 spec。
   446	- (b) 读取、mock 或 spy 了本批模块注册的 `Sagamore.*` 全局的 spec。
   447	- (c) 测试了本批模块的 spec，即使它没有直接 import，比如通过父组件渲染子组件并断言子组件的 DOM。这类靠盘点脚本加人工判断。
   448	- (d) 本批转换后运行失败的 spec，包括因为导入导出形态变化而失败的。
   449	
   450	其他 karma 用例不要动。
   451	
   452	**迁移粒度**：
   453	
   454	- 只迁移和本批模块相关的 `describe` 或 `it`。如果一个 spec 文件里只有一部分相关，就只移走那一部分，并从原 spec 中删掉，参见 `edc495731c`。
   455	- spec 文件被清空后就删除这个文件。如果有 helper 因此不再被任何 spec 引用，也一并删除。
   456	
   457	**放在哪里、用什么风格**：
   458	
   459	- 放在被测模块旁边的 `__tests__/<name>.test.js(x)`。如果已经有这个文件，就合并进去。
   460	- 使用 `@testing-library/react`、`@testing-library/user-event`、`@testing-library/jest-dom` 和 `jest.fn`，写法和现有的 `__tests__` 保持一致。
   461	- 不要引入 jasmine 兼容层，也不要用 `test:jasmine` 的配置去跑旧用例。
   462	
   463	**等价性要求**：
   464	
   465	- 每个被删除的 `it`，都要在 jest 里有一个对应的 `test`，断言强度不能低于原用例。
   466	- 确实不再需要的用例（比如测的是已经删除的代码、或者和已有 jest 用例重复）可以不迁移，但要在 PR 描述里逐条列出并说明理由。
   467	- jest 用例必须**先在 coffee 版本上通过**，再用来验证 JS 版本。
   468	- 按照团队习惯，可以顺手补充断言。
   469	
   470	**常见改写对照**：
   471	
   472	| karma / jasmine | jest |
   473	| --- | --- |
   474	| `jasmine.createSpy()`、`spyOn(o, 'm')` | `jest.fn()`、`jest.spyOn(o, 'm')` |
   475	| `.and.returnValue(x)`、`.and.callFake(f)`、`.and.callThrough()` | `.mockReturnValue(x)`、`.mockImplementation(f)`、`jest.spyOn` 的默认行为 |
   476	| `spy.calls.mostRecent().args`、`calls.argsFor(i)`、`calls.count()` | `spy.mock.lastCall`、`spy.mock.calls[i]`、`toHaveBeenCalledTimes` |
   477	| `jasmine.any(X)`、`jasmine.objectContaining` | `expect.any(X)`、`expect.objectContaining` |
   478	| `jasmine.clock()` | `jest.useFakeTimers()` |
   479	| `jasmine.Ajax`（`mock-ajax.js`） | mock `$.ajax`，或使用 `src/jest_helpers/fetch.mock.js` |
   480	| jasmine-jquery 的匹配器（`toHaveClass`、`toBeVisible`、`toContainText`） | `@testing-library/jest-dom` 的对应匹配器 |

````


## Assistant

<thinking>
I should check §10 for session details on who invokes what, review the progress folder state, and verify the exact sequence of verify.sh steps to make sure I'm accurate about the ordering.


</thinking>

**Tool Call: Search files for regex `^## 10|^### 10\.`**
Status: Completed

file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L726:727

```
## 10. 会话编排：怎么开会话、进度文件、subagent

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L728:729

```
### 10.1 角色

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L737:738

```
### 10.2 开会话前（人来做）

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L750:751

```
### 10.3 进度文件 `progress/progress.<bxx>.md`：批次工作日志

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L796:797

```
### 10.4 subagent 使用规则

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L836:837

```
### 10.5 提示词

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L881:882

```
### 10.6 一个批次的完整流程

```


file:///Users/zack/workspaces/retail/retail-coffee-migration/PLAN.md#L894:895

```
### 10.7 人工检查点

```


**Tool Call: List the `retail-coffee-migration/progress` directory's contents**
Status: Completed


# Files:
retail-coffee-migration/progress/progress.b00.md


**Tool Call: Search files for regex `step|STEP|^# `**
Status: Completed

file:///Users/zack/workspaces/retail/retail-coffee-migration/tools/verify.sh#L1:11

```
#!/usr/bin/env bash
# G8 (PLAN.md §3): per-batch verification. Run on the HOST from anywhere; the target checkout
# comes from config.json / config.local.json / COFFEE_TARGET_REPO (README.md).
#
#   tools/verify.sh [--quick] [--batch Bxx] [--base <ref, default config baseRef>]
#
# --quick  steps 0–4 (+4b): interop, G7 lint, eslint vs baseline, related jest + guardrail tests,
#          hotspot conclusions. For iterating.
# (full)   additionally 5–8: tsc, webpack dev+prod module sets, karma run + DEPRECATED_spec
#          guard, full jest — each compared with <dataDir>/baseline/. Required for DoD.
# Step 9 (e2e) is not automated here; see PLAN.md G8.
```


file:///Users/zack/workspaces/retail/retail-coffee-migration/tools/verify.sh#L12:15

```
#
# Changed files come from git (merge-base with --base, plus untracked files); --batch adds the
# batch's modules and their callers (inventory.mjs) and enables the hotspot check (4b).
set -uo pipefail
```


file:///Users/zack/workspaces/retail/retail-coffee-migration/tools/verify.sh#L38:40

```
record() { # record <step> <exit> <label>
  if [[ "$2" == "0" ]]; then SUMMARY+=("ok    $1 $3"); else SUMMARY+=("FAIL  $1 $3"); FAILED=1; fi
}
```


file:///Users/zack/workspaces/retail/retail-coffee-migration/tools/verify.sh#L93:95

```

echo; echo "=== container steps"
"$HERE/ensure_packages.sh"
```


file:///Users/zack/workspaces/retail/retail-coffee-migration/tools/verify.sh#L112:114

```
done < "$W/added.txt"
# deleting tests is only expected together with dead code (B01) — otherwise fewer passing tests fail
if grep -qE '(__tests__/|\.test\.)' "$W/deleted.txt" && [[ -s "$W/removed_only.txt" ]]; then ALLOW+=(--allow-test-removal); fi
```


file:///Users/zack/workspaces/retail/retail-coffee-migration/tools/verify.sh#L133:135

```
printf '%s\n' "${SUMMARY[@]}"
if [[ "$MODE" == "full" ]]; then echo "(step 9 e2e: not automated — see PLAN.md G8)"; fi
if [[ $FAILED -eq 0 ]]; then echo "VERIFY: ALL GREEN"; else echo "VERIFY: FAILED"; fi
```


**Tool Call: Read file `retail-coffee-migration/PLAN.md` (lines 726-920)**
Status: Completed

````retail-coffee-migration/PLAN.md
   726	## 10. 会话编排：怎么开会话、进度文件、subagent
   727	
   728	### 10.1 角色
   729	
   730	| 角色 | 是谁 | 职责 |
   731	| --- | --- | --- |
   732	| 人 | 你 | 提供 Jira 号；建分支；commit 和发 PR；把关 §10.7 的人工检查点；开 Reviewer 会话。 |
   733	| 主会话 | 每个批次一个 Zed 会话，模型和档位按 §0、§5 选 | 执行或编排本批；**唯一可以写本批进度文件的角色**；可以派 subagent；负责跑完整的 `verify.sh`。 |
   734	| subagent | 由主会话派生 | 只做 §10.4 允许的子任务，只写指定的文件，结果报回主会话。 |
   735	| Reviewer | 由人新开的独立会话（Opus 5.5，高） | 按 §4 的要求审阅语义。**不能由主会话派生的 subagent 代替**，否则输入会经过执行者筛选，失去独立性。 |
   736	
   737	### 10.2 开会话前（人来做）
   738	
   739	1. 准备 Jira 号。
   740	2. 在自己的终端里建分支：
   741	   - B00：`git switch -c <分支名> origin/staging`。
   742	   - B01 起：等 B00 合进 staging 后，从最新的 `origin/staging` 建分支；也可以叠在上一个还没合并的批次分支上，但合并顺序必须保持一致。
   743	3. `PLAN.md`、`progress/`、`EXAMPLES.md` 在工具 repo（独立 git，可以正常提交），切目标分支不影响它们。目标 worktree 里只留 `AGENTS.md`（不纳入 git，建议加进 `info/exclude`）。新 worktree 先跑一次 `tools/setup_host.sh`（并把 `config.local.json` 的 `targetRepo` 指向它）。
   744	4. 确认 Docker Desktop 正在运行。第一次运行会构建 `sr_web` 镜像。
   745	5. 在同时包含目标 worktree 和工具 repo 的 Zed 项目里新建会话，选好模型和思考档位，粘贴 §10.5 中对应的提示词。
   746	   - `AGENTS.md` 会自动加载；`PLAN.md` 和进度文件不会，但提示词里写了路径，Agent 会自己去读，**不需要 @ 引用**。
   747	   - @ 引用会把整个 `PLAN.md`（约 700 行）一次性塞进上下文，没有必要。
   748	6. 运行过程中会弹出 `unsandboxed` 授权提示（docker 需要），可以选择“本会话内允许”。
   749	
   750	### 10.3 进度文件 `progress/progress.<bxx>.md`：批次工作日志
   751	
   752	- **位置**：工具 repo 根目录下的 `progress/`（随工具 repo 提交）。**每个批次一个文件**，批次号用小写，例如 `progress/progress.b00.md`、`progress/progress.b04.md`、`progress/progress.b29-t.md`。同一批次拆成多个会话时（如 B00a/B00b）共用一个文件。下文“进度文件”都指本批的这个文件。
   753	- **和 `PLAN.md` 的分工**：`PLAN.md` 写“应该怎么做”，§8 记录批次之间的总进度；进度文件只记录本批“做到哪了、发现了什么、决定了什么”，不复制计划内容。
   754	- **只有主会话可以写**。subagent 的结果由主会话核实后写入。
   755	- **更新时机**：每完成一个清单项更新一次，会话结束或预计上下文快满时也要更新。不要每跑一条命令就写一次。
   756	- **收尾**：结论写回 `PLAN.md`（B00 写回 §9 和 G4/G5 的方案选择，每批更新 §8），PR 描述需要的内容从这里整理。进度文件提交在工具 repo，绝不进目标 PR。
   757	
   758	模板：
   759	
   760	```markdown
   761	# Bxx — <范围简述>
   762	
   763	- 分支：<name>，基于 origin/staging @ <sha>
   764	- 模型/档位：<主会话模型>；Jira：HRTL-xxxxx
   765	- 状态：in-progress | review | done
   766	
   767	## 清单
   768	| 项 | 状态 | 验证记录 |
   769	| --- | --- | --- |
   770	| <B00: G1…G9、§9 Q1…Q6、验收 4 项；转换批次: 每个文件一行> | todo/doing/done/blocked | <命令 + 结果摘要；没有验证记录不能标 done> |
   771	
   772	转换批次的“项”按文件列出，验证记录里依次写：karma 迁移 → 形态录制 → 冒烟测试（coffee 上通过）→ 热点清单 → 翻译 → 自查 → quick verify。
   773	
   774	## 决策记录
   775	- <决定>：<原因>；已写回 PLAN.md <§x>：是/否
   776	
   777	## 偏离 PLAN.md
   778	- <偏离内容>：<原因>
   779	
   780	## karma 用例
   781	- 迁移：<karma spec → jest 测试>
   782	- 删除：<spec 路径 / describe 名>
   783	
   784	## subagent 记录
   785	| 任务 | 写入范围 | 结果 | 主会话复核 |
   786	| --- | --- | --- | --- |
   787	
   788	## verify / Reviewer
   789	- verify.sh（完整）：<日期，结果摘要>
   790	- Reviewer 问题：<编号，状态>
   791	
   792	## 下一步
   793	- <下一个会话从这里开始做什么>
   794	```
   795	
   796	### 10.4 subagent 使用规则
   797	
   798	**通用规则**：
   799	
   800	- 只派**边界清楚、写入文件互不重叠**的子任务。同时运行的 subagent 不超过 3 个。
   801	- 共享文件只由主会话修改，包括：`batches.json`、`inventory.json` 的格式、快照 JSON、`shims.d.ts`、`webpack.config.js`、`main` 中的 `require.context`、跨批次的调用方互操作修复、进度文件、`PLAN.md`。
   802	- subagent 看不到对话历史，派任务时必须用下面的模板写全上下文。
   803	- subagent 声称“通过”的结果，主会话必须自己重跑一遍才能在进度文件里标为 done。
   804	- subagent 可以跑和自己文件相关的 `yarn jest <路径>` 和 `lint_converted.sh`。**完整的 `verify.sh` 只由主会话跑**，避免多个容器同时跑全量构建。
   805	- 模型：写代码或做调研的 subagent 用和本批主会话相同的模型和档位。Haiku 只能用来跑命令、汇总长日志，不能写代码。
   806	
   807	**B00 的分工**：
   808	
   809	| 部分 | 由谁做 | 原因 |
   810	| --- | --- | --- |
   811	| §9 Q3（`nodes()` AST 能力）、Q5（React/Backbone 版本）、Q6（公开全局清单） | 并行 subagent | 只读，互相独立，在宿主机就能做 |
   812	| §9 Q1、Q2、Q4（需要容器） | 主会话 | 结论直接决定 G4/G5 的方案；第一次构建镜像时不宜并发跑 docker |
   813	| G2 `inventory.mjs`、`batches.json` | 主会话，**先做** | 定义后续脚本共用的数据格式 |
   814	| G1（`EXAMPLES.md`、`coffee_compile.mjs`）、G3 `check_interop.mjs`、G7b `coffee_hotspots.mjs` | 并行 subagent，在 G2 定好格式之后 | 写入的文件互不重叠，在宿主机运行 |
   815	| G4、G5、G6、G7、G8、G9 | 主会话 | 需要集成、依赖容器，而且依赖 §9 的结论 |
   816	| 收尾时的对抗性审查：想办法让护栏失效 | 一个全新的 subagent | 换个视角找漏洞；发现的问题由主会话复核和修复 |
   817	
   818	**转换批次的分工**：
   819	
   820	- §4 步骤 1（同步与盘点）由主会话完成；步骤 2–3（karma 迁移、录制、冒烟测试、热点清单）也由主会话完成，因为它们写的是共享的快照和测试脚手架。
   821	- 步骤 4–5（翻译和自查）可以按**互不重叠的文件集**分给 subagent，例如 §5 中 B07 的拆法。每个 subagent 拿到自己负责的文件、对应的热点清单段落和 `EXAMPLES.md`。
   822	- 步骤 6–9（调用方互操作、类型、删除 `.coffee`、完整 verify、汇总自查清单）由主会话完成。
   823	- 文件少于约 8 个或少于约 800 行的批次，不要拆分，主会话直接做。
   824	
   825	**派 subagent 的消息模板**：
   826	
   827	```
   828	背景：你在目标 worktree /Users/zack/workspaces/retail/zed.worktrees/springboard-retail/coffee/springboard-retail 执行 PLAN.md 批次 <Bxx> 的一个子任务；迁移工具、PLAN.md、EXAMPLES.md 在工具 repo /Users/zack/workspaces/retail/retail-coffee-migration。先读目标 worktree 的 AGENTS.md、工具 repo 的 README.md，以及 PLAN.md 的文首“★”节和 <§x、§y>。
   829	任务：<具体内容；转换任务要附上文件列表和热点清单路径（工具 repo）.work/hotspots/<Bxx>.md 中对应的段落>
   830	只允许写入：<路径列表>。其他文件一律不改；如果发现需要改别处，写进汇报，由主会话处理。
   831	禁止：commit 或建分支；运行 pristine、update、down -v；使用 convert:coffee、decaffeinate 或 codemod；新增或修补 karma 用例；修改工具 repo 的 progress/、PLAN.md、data/；在目标仓库里引用工具 repo 的任何文件；运行完整的 verify.sh。
   832	docker 命令一律用（工具 repo）tools/sr_web.sh <cmd…>（需要 unsandboxed；跑 jest 时加 --cacheDirectory "$JEST_CACHE_DIR"）。
   833	汇报内容：改动的文件；跑过的命令及结果（失败时原样贴出关键行）；每个热点的结论；没解决的问题；需要主会话处理的跨文件改动。
   834	```
   835	
   836	### 10.5 提示词
   837	
   838	**B00 主会话**（Opus 5.5，高）：
   839	
   840	```
   841	你在 /Users/zack/workspaces/retail/zed.worktrees/springboard-retail/coffee/springboard-retail 执行 PLAN.md 的批次 B00（护栏基础设施，不转换任何 coffee）。Jira：HRTL-xxxxx。
   842	先通读 PLAN.md 全文，重点是 §3、§4、§4.1、§9、§10。然后读进度文件 progress/progress.b00.md；没有就按 §10.3 的模板创建。
   843	1. 按 §10.4 的 B00 分工核实 §9 的每个未决问题，把结论以及由此确定的方案（例如 G5 用 jest 方案还是备用脚本）写回 PLAN.md 的对应位置。
   844	2. 按 G1–G9 实现护栏：工具放在 tools/，快照测试放在 jest/tests/；按 §5 的批次表生成 batches.json。
   845	3. 运行 baseline.sh 录制基线。按“B00 验收”逐项做护栏自测：故意制造错误，确认护栏能报出来，然后还原。
   846	4. 确认在不做任何改动时，verify.sh 完整模式全绿。
   847	可以按 §10.4 使用 subagent。不要 commit。
   848	完成后输出：新增和修改的文件列表；§9 每个问题的结论；基线摘要（jest、karma、tsc、eslint 的现状）；4 项自测的结果；偏离 PLAN.md 的地方以及原因；需要人工确认的事项。
   849	```
   850	
   851	**转换批次主会话**（模型和档位按 §5 中该批次的标注）：
   852	
   853	```
   854	你在目标 worktree /Users/zack/workspaces/retail/zed.worktrees/springboard-retail/coffee/springboard-retail 执行 PLAN.md 的批次 <Bxx>。Jira：HRTL-xxxxx。迁移工具、PLAN.md、EXAMPLES.md、progress/ 都在工具 repo /Users/zack/workspaces/retail/retail-coffee-migration（先读其 README.md）。
   855	先读 PLAN.md 文首“★”节、§2、§4、§4.1、§6、§7、§10，以及 EXAMPLES.md。然后读进度文件 progress/progress.<bxx>.md；没有就按 §10.3 的模板创建。
   856	批次文件：在工具 repo 里 node tools/inventory.mjs --batch <Bxx>。
   857	严格按 §4 的步骤 1–9 执行：先在 coffee 上把测试跑通再翻译；由 LLM 直接翻译，禁止使用转换工具；karma 用例按 §4.1 只迁移，不修补；提交到目标仓库的测试必须自包含（不引用工具 repo）。
   858	可以按 §10.4 使用 subagent。不要 commit。
   859	完成后输出：改动文件列表；迁移和删除的 karma 用例；verify.sh 结果摘要；热点清单和 G7 清单的逐条结论；需要人工验收的项（对照 §7）。
   860	```
   861	
   862	**Reviewer**（Opus 5.5，高，由人新开会话）：
   863	
   864	```
   865	审阅 PLAN.md 批次 <Bxx> 的 CoffeeScript→JS 转换。只关心语义等价，不评论风格。目标 worktree 见 AGENTS.md；PLAN.md、进度文件和工具在工具 repo /Users/zack/workspaces/retail/retail-coffee-migration。先读 PLAN.md §4、§4.1、§6，以及进度文件 progress/progress.<bxx>.md（只用来定位，不要采信其中“没问题”的结论）。
   866	逐文件把 git show origin/staging:<path>.coffee 与当前 JS 并排逐段对照（两者顶层顺序应一致）；对语义有疑问时，用 tools/coffee_compile.mjs 查看 CoffeeScript 1.12.7 的真实编译结果。
   867	重点核对 §6 的每一条；逐项复核 G7b 热点清单（.work/hotspots/<Bxx>.md）中执行者给出的结论，以及 G7 列出的默认参数和 && 条件渲染（.work/verify/lint_converted.md）。
   868	对 karma→jest 迁移，逐个 it 对照被删除的 karma 用例（git show origin/staging:<spec 路径>），检查有没有丢用例、有没有弱化断言。
   869	不要修改任何文件。输出两张表：「问题（文件:行，原语义，现语义，修复建议）」「已确认无问题的风险点」。
   870	```
   871	
   872	把 Reviewer 的问题表贴回主会话修复；修完后主会话重跑完整的 `verify.sh`，并在进度文件里更新问题状态。
   873	
   874	**中断后续接**（上下文压缩、会话中断，或者把一个批次拆成多个会话时；用该批次原来的模型和档位）：
   875	
   876	```
   877	继续执行 PLAN.md 的批次 <Bxx>（PLAN.md 与进度文件在工具 repo /Users/zack/workspaces/retail/retail-coffee-migration）。先读 PLAN.md 文首“★”节和 §10，再读进度文件 progress/progress.<bxx>.md，然后按批次类型重读 PLAN.md 的相关章节（B00 读 §3，转换批次读 §4 和 §6）。
   878	从“下一步”继续。标为 done 但没有验证记录的项，先复核再往下做。其余要求与 PLAN.md §10.5 中该批次的提示词相同。
   879	```
   880	
   881	### 10.6 一个批次的完整流程
   882	
   883	```mermaid
   884	flowchart TD
   885	    A[人：建分支，开主会话] --> B[主会话：盘点、karma 迁移、录制、热点清单]
   886	    B --> C[主会话或 subagent：翻译与自查]
   887	    C --> D[主会话：互操作、类型、删除 coffee、完整 verify]
   888	    D --> E[人：新开 Reviewer 会话]
   889	    E -->|有问题| F[主会话：修复并重跑 verify]
   890	    F --> E
   891	    E -->|无未关闭问题| G[人：人工验收、commit、PR、更新 §8]
   892	```
   893	
   894	### 10.7 人工检查点
   895	
   896	- **B00 完成后**（不要跳过）：
   897	  - 4 项护栏自测是否真的报出了错误；
   898	  - §9 的结论，尤其是 G5 采用了哪个方案；
   899	  - 基线中本来就存在的失败。
   900	
   901	  如果结论和计划假设不一致，先修改 `PLAN.md`，再开始 B01。
   902	- **B04 完成后**：审一遍 React class 组件的写法，确认没问题后再补进 `EXAMPLES.md`。后续的组件批次都会照着它写。
   903	- **每个批次**：Reviewer 没有未关闭的问题；PR 描述里标了“需人工”的项已经验收；`git --no-pager diff --stat` 里没有超出本批范围的改动。

````


**Tool Call: Read file `retail-coffee-migration/progress/progress.b00.md`**
Status: Completed

```retail-coffee-migration/progress/progress.b00.md
     1	# B00 — 护栏基础设施（不转换任何 coffee）
     2	
     3	- 分支：coffee-b00，基于 origin/staging @ 6103b96a7f
     4	- 模型/档位：Claude Opus 5.5（高）；Jira：未提供（HRTL-xxxxx 待人工填写）
     5	- 状态：review（待 §10.7 人工检查点）；2026-10-21 工具已搬到独立 repo `retail-coffee-migration`，**待重新验证**（下表的验证记录都是搬迁前的）
     6	
     7	## 清单
     8	| 项 | 状态 | 验证记录 |
     9	| --- | --- | --- |
    10	| 环境：sr_web 镜像 | done | 镜像 sr-coffee-sr_web；`tools/sr_web.sh`（原 `migration/coffee/sr_web.sh`）；容器内先 `ensure_packages.sh`（build:packages） |
    11	| 共享库 tools/lib/*（原 migration/coffee/lib） | done | 全量分析 ~2.6s，4421 文件，0 编译错误；宿主机与容器都能跑 |
    12	| G2 inventory.mjs + batches.json + coffee_manifest.txt | done | `--check`：322 个 coffee 各属一批；`--summary` 322 / 30,905 行 / 743 spec；`--batch B09/B29` 抽查正确 |
    13	| G1 EXAMPLES.md + coffee_compile.mjs | done | subagent C；主会话复核 `--range` 输出 |
    14	| G3 check_interop.mjs + lib/interop.mjs | done | 全量 0 error（7 条白名单）；selftest/interop.mjs 12 组 ok；对抗审查后加强 CJS `.default` 规则，probe 中 3 个漏报变为捕获 |
    15	| G4 export_shapes.test.js | done | 录制/比较可用；自测 1、2 通过；对抗审查后加强（全部原型数据、注册值身份、bind 不算字段、loadError 判失败、CRC 允许消失项收紧） |
    16	| G5 sagamore_registry.test.js | done | jest 方案；481 路径（含挂在函数上的命名空间、深度 8）、35 个 Apps 路由、82 条 appOptions；自测 3 通过 |
    17	| G6 baseline.sh + collect.mjs + compare.mjs + webpack_stats.cjs | done | 基线 3 分钟；见下 |
    18	| G7 lint_converted.sh + lint_scan.mjs | done | 自测 2 通过；对抗审查的 g7_bypass.js 全部 17 处捕获 |
    19	| G7b coffee_hotspots.mjs | done | subagent B；selftest/hotspots_check.sh 9 场景 ok |
    20	| G8 verify.sh + verify_container.sh + changes.mjs | done | 完整模式全绿 3m36s；--quick 25s |
    21	| G9 jest/helpers/legacy.js（原 src/jest_helpers/coffee_migration） | done | legacy_helpers.test.js 6/6 |
    22	| §9 Q1 | done | jsdom 能加载 main（webpack_runtime.js）；ChromeHeadless 用 /usr/bin/chromium |
    23	| §9 Q2 | done | apps.coffee 能加载，82 条路由录入 G5 |
    24	| §9 Q3 | done | nodes() 足够（subagent B） |
    25	| §9 Q4 | done | 见基线摘要 |
    26	| §9 Q5 | done | React 17.0.2；Backbone 1.0.0 / jQuery 1.8.3 不可迭代 |
    27	| §9 Q6 | done | public_globals.json；Sagamore.View 已缺失 |
    28	| 验收 1：错误导出形态 → G3/G4 | done | collection.coffee→具名导出 JS：G3 14 error（13 default-missing + 1 named-missing），G4 “was a function, now object” + “no longer registers”，另报 app 无法加载；已还原（cmp 一致） |
    29	| 验收 2：Backbone 子类 → ES class → G4/G7 | done | support.coffee→`class Support extends SRApp`：G7 [backbone-es-class]，G4 硬规则 + lost __super__/extend + registration es-class；再把快照从 JS 重录：0b 快照完整性报错、G4/G5 仍失败；已还原 |
    30	| 验收 3：删除全局注册 → G5 | done | 删 `Sagamore.Apps.Support =`：G5 报 removed path、removed route table、appOptions appClass→null；G4 “no longer registers”；已还原 |
    31	| 验收 4：DEPRECATED_spec 新增用例 → G8 第 7 步 | done | 加 it + 新 spec 文件：verify.sh 完整模式 FAIL（more it()、new file），karma 运行本身仍绿（3742）；改 import 不改 it 数：报 patching；已还原 |
    32	| verify.sh 完整模式无改动全绿 | done | 2026-10-18 最终运行 ALL GREEN（3m36s） |
    33	
    34	## 基线摘要（原 migration/coffee/baseline/，现 data/springboard-retail/baseline/；搬迁后需重录）
    35	- jest 723 套件 / 3,936 用例，0 失败（容器内需 --maxWorkers=4，否则 OOM）
    36	- karma 3,740（3,645 执行、95 skipped），0 失败
    37	- eslint 0 error / 2,158 warning
    38	- tsc 12 个历史错误（TS9005/9006 声明生成）
    39	- webpack dev 5,498 / prod 5,461 模块，0 错误，0 循环
    40	
    41	## 决策记录
    42	- 静态工具宿主机运行，依赖 setup_host.sh 装到 `.work/coffee-tools`；容器内 `yarn node`。已写回 PLAN §3 实现要点：是
    43	- G3/G2 统一 TS AST，coffee 先编译再解析：是
    44	- 容器入口 sr_web.sh（不用 sr-dev run）：是
    45	- 工作目录 `migration/coffee/.work/` 而非 `apps/monolith/tmp/`（CleanBuildPlugin 会移走 tmp）：是
    46	- batches.json glob 不带扩展名 + coffee_manifest.txt：是
    47	- knownDuplicates：两对既有 coffee+js 只警告，归 B01：是（§9）
    48	- G4 不用 isolateModules，改为加载一次 main + Proxy 追踪写入归属：是
    49	- G5 走 jest 方案：是
    50	- B00 不录任何 G4 快照（各批录自己的）：是
    51	- §6.2 严格解释：无父类的 coffee class 也不得改 ES class（待人工确认）：是
    52	- jest.mock 形状问题保持 warning（靠相关 jest 测试兜底）：是（已知局限）
    53	- 2026-10-21 工具独立 repo 化（用户要求）：工具/数据/文档搬到 `/Users/zack/workspaces/retail/retail-coffee-migration`，通过 `config.json`（+ `config.local.json`、`COFFEE_*` 环境变量）指向目标 checkout；springboard-retail 不提交任何工具，不进 CI。已写回 PLAN 文首“★”节：是
    54	- 容器内把工具 repo 挂到 `/sr/apps/monolith/coffee-tools`（workspace 目录内 → PnP 可解析依赖；`jest ./src`/`eslint src`/tsc 不扫）；宿主机空挂载点由 `setup_host.sh` 写进目标 `info/exclude`，`sr_web.sh` 发现挂载点非空则拒绝运行：是
    55	- G4/G5 只在本地 verify 跑；shapes/registry 快照提交在工具 repo；0b 改为 `recordedSha`（git blob sha）对 merge-base 校验；新增 0c tool-leaks：PLAN ★ 节：是
    56	- G9 helpers 只本地用；提交到目标的测试必须自包含（需要时把 helper 复制到 `src/jest_helpers/`）：PLAN ★ 节与 G9：是
    57	
    58	## 偏离 PLAN.md
    59	- `inventory.json` 不提交（生成文件 ~500KB）。
    60	- 工具路径：`.work/` 替代 `tmp/`；容器命令 `sr_web.sh` 替代 `sr-dev run`。
    61	- G4 实现方式（见决策）。
    62	- G6/G8 额外记录 jest-passing、test-config，并新增 0/0b 步骤、karma 纯删除检查（对抗审查后加固）。
    63	- G7 `backbone-es-class` 改为 AST：任何非 React/Error 父类的 ES class 都失败（比 PLAN 的正则更严）。
    64	- 新增工具：collect.mjs、compare.mjs、webpack_stats.cjs、changes.mjs、verify_container.sh、ensure_packages.sh、record_shapes.sh、lint_scan.mjs、selftest/*。
    65	- 2026-10-21：工具不在 `apps/monolith/migration/coffee/`，而在独立工具 repo（路径映射见 PLAN ★ 节）；B00 不再给 springboard-retail 提 PR。新增 `tools/lib/config_env.mjs`、`jest/helpers/tool_paths.js`、`config.json`。
    66	
    67	## karma 用例
    68	- B00 不迁移、不删除 karma 用例。自测期间的临时改动已全部还原（git status 无已跟踪文件改动）。
    69	
    70	## subagent 记录
    71	| 任务 | 写入范围 | 结果 | 主会话复核 |
    72	| --- | --- | --- | --- |
    73	| A: G3 | check_interop.mjs、lib/interop.mjs、interop_allowlist.json | 0 error；7 条白名单 | 重跑全量 + selftest 一致 |
    74	| B: G7b + Q3 | coffee_hotspots.mjs、lib/hotspots.mjs | 322 文件 0.5s；--check 格式 | 重跑生成/校验 + selftest 一致 |
    75	| C: G1 + Q5 + Q6 | EXAMPLES.md、coffee_compile.mjs、public_globals.json | 见 §9 | 重跑 coffee_compile 一致 |
    76	| D: 对抗审查 | .work/adversarial/ | 14 条；已修 #1–#7、#8 大部分、#10、#11、#13 由 #10/G3 覆盖部分 | 用其探针复跑：G7 全捕获、G3 .default 全捕获、G5 漏掉的注册现已进快照（剩 2 处为运行时真实被覆盖） |
    77	
    78	## 对抗审查未修/部分修项
    79	- #9 jest.mock factory 形状：保持 warning。
    80	- #12 无父类 coffee class → ES class：G4 判失败（严格），待人工确认。
    81	- #14 非 Sagamore 的 window 全局（sagamore、JST、Highcharts）未快照：B30/B31 前补。
    82	- G4 只看导出值；未导出的内部类靠 G7 + Reviewer；React class 绑定靠 Reviewer。
    83	
    84	## verify / Reviewer
    85	- verify.sh（完整）：2026-10-18 ALL GREEN，3m36s；--quick ALL GREEN 25s。（搬迁前；搬迁后尚未运行）
    86	- Reviewer：B00 不需要语义 Reviewer；§10.7 人工检查点待做。
    87	
    88	## 2026-10-21 工具独立 repo 化（未验证）
    89	- 搬迁：tools/、jest/{tests,helpers}/、data/springboard-retail/、EXAMPLES.md、PLAN.md、progress/ 已在工具 repo；springboard-retail worktree 中已删除 `apps/monolith/migration/`、`apps/monolith/src/__tests__/coffee_migration`、`apps/monolith/src/jest_helpers/coffee_migration`、`PLAN.md`、`progress/`；目标的 `AGENTS.md` 已改为指向工具 repo。
    90	- 代码改动：所有脚本经 `lib/paths.mjs` / `lib/config_env.mjs` 取路径；`sr_web.sh` 挂载工具 repo 并传 `COFFEE_*`；`changes.mjs` 重写 snapshot-problems、新增 tool-leaks；`export_shapes.test.js` 写入 `recordedSha`；jest helpers 经 `tool_paths.js` 取 app 目录和数据目录。
    91	- 已知必须做：**重录基线**。旧 `jest-passing.txt` 含 `src/__tests__/coffee_migration/{export_shapes 1, legacy_helpers 6, sagamore_registry 5}`，搬走后会被当成“测试减少”；jest 套件/用例数也会变为 720 / 3,924。
    92	- 待验证（见工具 repo README“待验证”）：setup_host.sh、挂载后 PnP 解析与 ts-jest 转换、guardrail jest、record_shapes、完整 verify、B00 四项自测重做一遍。
    93	
    94	## 下一步
    95	- 验证搬迁（用户安排在 2026-10-22）：按工具 repo README“待验证”清单逐项跑；先 `tools/setup_host.sh`，再 `tools/sr_web.sh yarn jest coffee-tools/jest/tests`，再 `tools/baseline.sh` 重录基线，最后 `tools/verify.sh` 完整模式全绿、`--quick` 全绿，并重做 B00 四项自测（快照录制改用 `tools/record_shapes.sh`）。
    96	- 人：§10.7 B00 检查点（4 项自测、§9 结论尤其 G5 方案、基线既有问题、#12 规则、Sagamore.View 是否恢复）。
    97	- 工具 repo 做初始提交（用户确认后）；不再给 springboard-retail 提 “Add CoffeeScript migration guardrails” PR。
    98	- 之后开 B01。

```


## Assistant

<thinking>
I think I have enough to answer clearly in Chinese: most tools are meant for the agent to call automatically, while the human mainly handles a few manual steps like initial setup, baseline checks after rebasing, starting sessions, and reviewing checkpoints. I'm planning to organize this as a table grouping tools by phase, showing what each does and who typically invokes it.

I'm grouping the tools by workflow stage: one-time environment setup (setup_host, sr_web, ensure_packages), baseline comparison after rebases, batch-start inventory and shape recording, mid-translation tools for checking compiled output and lint residue, and finally the closing verification step. I'm also noting that since these are post-migration tools, the README marks them as unverified, so the next step should be re-verifying them against B00.

I'm distinguishing verify.sh's quick mode from its full mode (which runs tsc, webpack, karma, and jest for the full definition of done), listing the internal scripts it relies on, and clarifying which jest guardrail tests run during verification versus requiring human approval to re-record. I'm also explaining what the inventory, snapshot-integrity, and tool-leak checks do, and noting that since the agent-facing prompts already point to the tool list, a human mainly intervenes at branch creation and session start.

I'm also running through the points where human judgment is still required: approving unsandboxed runs, deciding whether to re-record baselines after a rebase, approving registry changes, running an independent verify.sh before committing, and reviewing any additions to the interop allowlist or batches.json rather than letting the agent edit those freely.

Currently tools 10-21 have been moved but not re-verified, so the next concrete step is resuming B00 to verify them — I'll note that briefly while keeping the explanation concise but table-friendly since this is a clarifying question.


</thinking>

## 结论

这套工具是给 agent 用的。`PLAN.md` §4 的每批执行协议把调用顺序定死了，§10.5 的提示词也让 agent 照着做。所以你基本不用记哪个工具什么时候跑。agent 不能替你做的是几个决策点：要不要重录基线、要不要接受注册表变化、什么时候开 Reviewer、最后 commit。

下面按一个批次的时间顺序说明每个工具。

## 一次性准备 / 基础设施

| 工具 | 作用 | 什么时候 | 谁来跑 |
| --- | --- | --- | --- |
| `tools/setup_host.sh` | 在宿主机装 coffeescript 1.12.7 和 typescript（装到 `.host-deps/`），并把容器挂载点 `apps/monolith/coffee-tools/` 写进目标仓库的 `info/exclude` | 每个新的 worktree 跑一次 | 你或 agent 都可以 |
| `tools/sr_web.sh <cmd>` | 起一个一次性的 `sr_web` 容器，并把工具 repo 挂进去。容器里的命令都从这里走 | 其他脚本会在内部调用它 | agent（需要 `unsandboxed`） |
| `tools/ensure_packages.sh` | 缺少 `apps/packages/*/dist` 时自动在容器里 build | `verify.sh` 会自动调用 | 不用管 |
| `tools/baseline.sh` | 在干净的分支上录制 jest、karma、eslint、tsc、webpack 模块集合的基线。之后 verify 拿它来判断有没有"变差" | B00 结束时录一次；**每次 rebase 到新的 staging 后重录** | 时机由你决定，执行可以交给 agent |

内部用的组件不需要直接调：`collect.mjs`（容器里采集数据）、`compare.mjs`（和基线比较）、`webpack_stats.cjs`（取模块列表）、`changes.mjs`（算本分支改了哪些文件）、`verify_container.sh`、`lint_scan.mjs`、`tools/lib/*`。

## 批次开始，还在 coffee 状态时（协议第 1–3 步）

| 工具 | 作用 | 能拦住什么 |
| --- | --- | --- |
| `node tools/inventory.mjs --batch Bxx` | 列出本批的 coffee 文件、外部调用方、需要处理的互操作位置，以及**必须迁移成 jest 的 karma spec** | 漏掉调用方、漏迁 karma 用例 |
| `tools/record_shapes.sh Bxx` | G4：**转换前**基于 `.coffee` 录制每个模块的导出形态，包括 typeof、原型方法、`routes`/`events`、静态键、`__super__`、向 `Sagamore.*` 注册了什么。快照写入时带 `recordedSha` | 转换后导出形态变了，比如 Backbone 子类被写成 ES class、方法丢了、全局注册没了 |
| `node tools/coffee_hotspots.mjs --batch Bxx` | G7b：解析 coffee AST，列出语义热点并写进 `.work/hotspots/Bxx.md`。热点包括有语义的隐式 return、`?.`、胖箭头、裸 `super`、`for own`、默认参数、JSX 里没有 `else` 的 `if` 等 | 翻译时的语义漂移。agent 必须逐项写结论，verify 4b 会检查有没有漏项 |

## 翻译过程中（第 4–6 步）

| 工具 | 作用 |
| --- | --- |
| `node tools/coffee_compile.mjs file.coffee [--range a:b]` | 吃不准语义时查看 CS1 真实的编译结果。只看，不落盘，也不能照抄 |
| `tools/lint_converted.sh <新 js>` | G7：严格 eslint，外加残留扫描。命中以下情况就失败：decaffeinate 的 helper、`_this`/`__super__` 等编译产物指纹、Backbone 被改成 ES class、整文件 `eslint-disable`、`==`。默认参数和 `&&` 条件渲染会单独列成清单交给 Reviewer |
| `node tools/check_interop.mjs [--files …]` | G3：检查 import/require 和目标导出形态是否匹配。例如 `require` 一个 ESM default 却没加 `.default`、`import X` 但目标只有具名导出、同一路径下 `.coffee` 和 `.js` 并存 |

这几个 agent 会在写完一个文件后自己跑。它们也都包含在 `verify.sh --quick` 里。

## 收尾校验（第 8 步）：`tools/verify.sh`

它把上面的检查汇总到一起：

- `--quick`（约 25 秒，迭代时用）：
  - 0：`inventory --check`，确认批次划分一致
  - 0b：快照完整性。快照必须录自 merge-base 上的 `.coffee`，防止有人转换完再录
  - 0c：工具泄漏检查。目标仓库不能引用工具 repo
  - 1：G3 互操作检查
  - 2：G7 lint 与残留扫描
  - 3：eslint 和基线对比
  - 4：相关 jest，加上护栏 jest：G4 形态、G5 `Sagamore.*` 注册表、G9 helpers
  - 4b：热点清单的结论是否齐全
- 完整模式（约 4 分钟，批次完成的必要条件）：在上面基础上增加
  - 5：tsc 和基线对比
  - 6：dev 和 prod 的 webpack 模块集合
  - 7：karma 回归，以及 `DEPRECATED_spec` 只允许删除的检查
  - 8：全量 jest

`tools/selftest/*` 是工具自己的测试，只有改了工具本身才需要跑。

## 需要你亲自介入的地方

1. **建分支，开会话**：粘贴 `PLAN.md` §10.5 的提示词即可，不需要提哪个工具。
2. **批准 `unsandboxed`**：docker 需要这个权限，可以选"本会话内允许"。
3. **重录基线**：rebase 到新的 staging 之后要重录，这个时机只有你知道。
4. **审核需要豁免的改动**：
   - `ALLOW_REGISTRY_CHANGE=1` 或 `UPDATE_COFFEE_REGISTRY=1`：表示全局注册表变了，必须有理由。
   - 往 `interop_allowlist.json` 加白名单，或修改 `batches.json`。

   这些是绕过护栏的开关，agent 想用的时候你应该看一眼原因。
5. **开 Reviewer**：开一个全新的会话做 Reviewer，不能用主会话派生的 subagent 代替。
6. **人工检查点和提交**：做完 §10.7 的检查点后再 commit 和发 PR。commit 前可以自己跑一次 `tools/verify.sh`，复核 agent 说的"全绿"。

## 当前状态

工具在 10-21 搬到独立 repo 后**还没有重新验证过**，见 `README.md` 的"待验证"和 `progress/progress.b00.md` 的"下一步"。所以第一步不是开 B01，而是用 §10.5 的"中断后续接"提示词继续 B00：

1. 跑 `setup_host.sh`。
2. 跑护栏 jest。
3. 用 `baseline.sh` 重录基线。
4. 确认 `verify.sh` 的 quick 和完整模式都是全绿。
5. 重做 B00 的 4 项自测。

然后你做 B00 的人工检查点。需要的话，我可以现在按这个清单开始验证。

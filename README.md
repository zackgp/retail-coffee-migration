# retail-coffee-migration

把 Heartland Retail（springboard-retail）`apps/monolith` 里剩余的 CoffeeScript 迁移到 JavaScript 用的**护栏工具和工作资料**，独立于 springboard-retail 仓库：

- 不提交到 springboard-retail，也不参与它的 CI；
- 通过配置文件指向任意一个 springboard-retail checkout（主仓库或 worktree）；
- 计划、范例、批次进度也放在这里：`PLAN.md`、`EXAMPLES.md`、`progress/`。

迁移的方法、批次划分和每批协议以 `PLAN.md` 为准，先读文首的“★ 工具独立 repo 化”一节。

## 目录

```
config.json              目标 checkout 与容器设置（提交）
config.local.json        本机覆盖（gitignore，可选）
PLAN.md  EXAMPLES.md     迁移计划 / 目标写法范例
progress/                每批一个进度文件 progress.<bxx>.md
tools/                   全部脚本（宿主机 + 容器）
  lib/                   共享库：paths.mjs（唯一的路径来源）、config_env.mjs、deps.mjs …
  selftest/              工具自测
jest/
  tests/                 G4 export_shapes / G5 sagamore_registry / G9 legacy_helpers（在目标的 jest 里跑）
  helpers/               webpack_runtime、describe_value、compare_shapes、legacy、legacy_app、tool_paths
data/springboard-retail/ 针对该目标的数据（提交）
  batches.json  coffee_manifest.txt  interop_allowlist.json  public_globals.json
  sagamore_registry.json  baseline/  shapes/
.work/                   临时目录：缓存、verify/baseline 运行结果、hotspots/<Bxx>.md、inventory.json（gitignore）
.host-deps/              宿主机用的 coffeescript 1.12.7 + typescript（gitignore，setup_host.sh 安装）
```

## 配置

`config.json`（被 `config.local.json` 深合并覆盖）：

| 字段 | 含义 |
| --- | --- |
| `name` | 目标名，只用于输出 |
| `targetRepo` | 目标仓库根目录（绝对路径，支持 `~`） |
| `appDir` | 目标仓库内的 app 目录，`apps/monolith` |
| `baseRef` | 计算“本分支改了什么”的基准，`origin/staging` |
| `dataDir` | 数据目录，必须在本 repo 内 |
| `workDir` | 临时目录，必须在本 repo 内（容器只能通过挂载看到本 repo） |
| `container.composeFiles` | 相对目标仓库根的 compose 文件 |
| `container.service` | `sr_web` |
| `container.projectName` | compose 项目名，不能和目标目录 basename 相同（会和主仓库共享容器/volume） |
| `container.repoMount` | 容器里目标仓库的挂载点，`/sr` |
| `container.toolsMount` | 本 repo 在容器里挂到 `<repoMount>/<appDir>/<toolsMount>`，`coffee-tools` |

环境变量优先级更高：`COFFEE_TARGET_REPO`、`COFFEE_WORK_DIR`、`COFFEE_BASE_REF`、`COMPOSE_PROJECT_NAME`。

同时迁移多个 worktree 时，每个 worktree 用不同的 `workDir` 和 `container.projectName`（例如在 shell 里 `export COFFEE_TARGET_REPO=… COFFEE_WORK_DIR=.work/wt2 COMPOSE_PROJECT_NAME=sr-coffee2`），否则会共用缓存和容器。

## 首次准备

```sh
# 1. 指向目标 checkout（不改 config.json 时用本地覆盖）
echo '{ "targetRepo": "/path/to/springboard-retail" }' > config.local.json
# 2. 装宿主机依赖；把容器挂载点加进目标仓库的 info/exclude
tools/setup_host.sh
```

前提：宿主机有 node、git、docker；目标仓库能用 `sr-dev` 构建 `sr_web` 镜像（见目标仓库 `AGENTS.md`）。docker 命令在 Agent 沙箱里需要 `unsandboxed`。

## 命令

都在本 repo 里运行（脚本会自己切到目标 app 目录）；`src/…` 形式的文件参数相对目标 app 目录。

| 命令 | 运行位置 | 作用 |
| --- | --- | --- |
| `tools/verify.sh [--quick] [--batch Bxx] [--base <ref>]` | 宿主机 | G8 每批总校验（0/0b/0c/1/2/4b 在宿主机，2/3/4/5–8 在容器） |
| `tools/baseline.sh [--only jest,karma,…]` | 宿主机 | G6 在干净的目标分支上录制基线到 `data/…/baseline/` |
| `tools/record_shapes.sh <Bxx \| src/…coffee …>` | 宿主机 | G4 转换前录制形态快照到 `data/…/shapes/` |
| `node tools/inventory.mjs [--summary\|--check\|--batch Bxx …]` | 宿主机 | G2 盘点与批次 |
| `node tools/check_interop.mjs [--files …]` | 宿主机 | G3 互操作检查 |
| `node tools/coffee_hotspots.mjs --batch Bxx` / `--check <md>` | 宿主机 | G7b 热点清单（输出 `.work/hotspots/<Bxx>.md`） |
| `node tools/coffee_compile.mjs <file.coffee> [--range a:b]` | 宿主机 | 查看 CoffeeScript 1.12.7 编译结果（只看，不落盘） |
| `tools/lint_converted.sh <files…>` | 宿主机或容器 | G7 残留扫描 + 严格 eslint |
| `node tools/changes.mjs [--list <name>]` | 宿主机 | 本分支相对 merge-base 的文件集合（verify 用） |
| `tools/sr_web.sh <cmd…>` | 宿主机 | 在目标的一次性 `sr_web` 容器里执行命令（工作目录 `/sr/apps/monolith`） |
| `tools/ensure_packages.sh` | 宿主机 | 缺少 `apps/packages/*/dist` 时在容器里 `yarn build:packages` |
| `tools/selftest/hotspots_check.sh`、`node tools/selftest/interop.mjs` | 宿主机 | 工具自测 |

容器里直接跑 jest 的例子：

```sh
tools/sr_web.sh sh -c 'yarn jest --cacheDirectory "$JEST_CACHE_DIR" src/sagamore/views'     # 目标自己的测试
tools/sr_web.sh sh -c 'yarn jest --ci --cacheDirectory "$JEST_CACHE_DIR" coffee-tools/jest/tests'   # 护栏测试
tools/sr_web.sh env UPDATE_COFFEE_REGISTRY=1 yarn jest coffee-tools/jest/tests/sagamore_registry   # 重录 G5（要说明原因）
```

## 工作原理

### 宿主机

`tools/lib/paths.mjs` 读取配置，导出 `REPO_ROOT`、`MONOLITH`、`DATA_DIR`、`WORK_DIR` 等；shell 脚本通过 `eval "$(node tools/lib/config_env.mjs)"` 得到同样的 `COFFEE_*` 变量。宿主机上目标没有安装依赖（Yarn PnP 装在镜像里），所以静态工具从 `.host-deps/` 加载 coffeescript/typescript。

### 容器

`tools/sr_web.sh` 等价于在目标仓库根执行：

```sh
docker compose run --rm -T \
  -v <本 repo>:/sr/apps/monolith/coffee-tools -w /sr/apps/monolith \
  -e COFFEE_IN_CONTAINER=1 -e COFFEE_REPO_ROOT=/sr -e COFFEE_MONOLITH=/sr/apps/monolith \
  -e COFFEE_TOOLS_ROOT=/sr/apps/monolith/coffee-tools -e COFFEE_WORK_DIR=… -e COFFEE_DATA_DIR=… \
  -e COREPACK_HOME=…/.work/corepack -e JEST_CACHE_DIR=…/.work/jest-cache \
  sr_web <cmd…>
```

为什么挂在 `apps/monolith/coffee-tools`：

- 位于 `sr-apps` workspace 目录内，Yarn PnP 把这里的文件当作该 workspace 的文件，工具和 jest helpers 可以直接 `import 'coffeescript'`、`'react'` 等；`webpack_stats.cjs` 用 `createRequire(<app>/package.json)`。
- 在目标 jest 的 `rootDir` 内，`yarn jest coffee-tools/jest/tests` 能找到测试，用目标自己的 `jest.config.js`（ts-jest、moduleNameMapper、`global.setup.js`）。
- 目标的 `yarn test`（`jest ./src`）、`eslint src`、`tsc`（include 只有 `src/**`、`migrators/**`、`shims.d.ts`）都看不到它，所以不会影响目标的 lint/test/CI 结果。
- 本 repo 故意**没有 package.json**：嵌套的 package.json（尤其 `"type": "module"`）会改变挂载目录里文件的模块类型和 jest haste 行为。

docker 会在宿主机上留下一个空目录 `<appDir>/coffee-tools/`。`setup_host.sh` 把它写进目标仓库的 `info/exclude`；`sr_web.sh` 发现它非空时拒绝运行（防止有人真的往里放了文件）。容器里没有 git（worktree 的 `.git` 指向挂载外），需要变更列表的步骤都在宿主机算好，再通过 `.work/` 传进去。

### 与目标仓库的边界（重要）

- 目标分支**不能**包含 `apps/monolith/coffee-tools/`、`apps/monolith/migration/coffee/` 下的文件，也不能引用 `coffee-tools/`、`jest_helpers/coffee_migration`、`__tests__/coffee_migration`、`retail-coffee-migration`。`verify.sh` 第 0c 步（`changes.mjs --list tool-leaks`）检查这一点。
- 提交到目标仓库的测试必须**自包含**：不能 import `jest/helpers/*`，也不能用 `loadLegacyApp` 加载整个 app。某个批次的提交测试确实需要 helper 时，把函数复制到目标的 `src/jest_helpers/`，作为普通代码随该批 PR 提交。
- G4（形态）/G5（注册表）只在本地 verify 里跑，不进 CI。它们的快照提交在本 repo：
  - `shapes/<key>.json` 带 `recordedFrom`（必须是 `.coffee`）和 `recordedSha`（录制时 `.coffee` 的 git blob sha）；verify 0b 要求它等于目标 merge-base 上那个 `.coffee` 的 blob，所以快照一定录自转换前的源码。
  - `sagamore_registry.json` 有未提交修改时，0b 需要 `ALLOW_REGISTRY_CHANGE=1`，并在目标 PR 描述和进度文件里说明。
- 基线 `data/…/baseline/` 对应某个目标 merge-base；目标 rebase 到新的 `baseRef` 后用 `tools/baseline.sh` 重录并提交到本 repo。

## 待验证（2026-10-21 搬迁后尚未运行）

搬迁只改了代码和文档，下面这些还没实际跑过：

1. `tools/setup_host.sh`：`.host-deps` 安装、`info/exclude` 写入（worktree 的 `--git-path` 指向主仓库的 `.git/info/exclude`）。
2. 宿主机静态工具：`node tools/inventory.mjs --check`、`--summary`；`node tools/check_interop.mjs --quiet`（0 error、7 条白名单）；`tools/selftest/hotspots_check.sh`；`node tools/selftest/interop.mjs`。
3. 挂载：`tools/sr_web.sh ls coffee-tools`；嵌套 bind mount（`./apps` 已挂到 `/sr/apps`，再挂 `coffee-tools`）在 Docker Desktop 上是否正常；宿主机空挂载点是否只出现在 `info/exclude` 覆盖的位置。
4. PnP 与 ts-jest：`tools/sr_web.sh sh -c 'yarn jest --ci --cacheDirectory "$JEST_CACHE_DIR" coffee-tools/jest/tests'`，即挂载目录下的测试和 helpers 能被 ts-jest 转换、能解析 `coffeescript`/`typescript`/`react`/`sr/*`。
5. 容器内 `yarn node coffee-tools/tools/collect.mjs --only karma-static`、`webpack_stats.cjs`（`createRequire` 找 webpack）。
6. **重录基线** `tools/baseline.sh`：旧基线的 `jest-passing.txt` 含已移走的 3 个 `src/__tests__/coffee_migration/*` 套件，不重录会被判为“测试减少”。
7. `tools/verify.sh --quick` 与完整模式在无改动时全绿（含 0c）。
8. 重做 B00 四项自测（`PLAN.md` “B00 验收”）；其中形态快照改用 `tools/record_shapes.sh` 录制，确认 0b 的 `recordedSha` 校验能拦住“转换后再录制”。

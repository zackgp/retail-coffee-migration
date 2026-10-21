# B00 — 护栏基础设施（不转换任何 coffee）

- 分支：coffee-b00，基于 origin/staging @ 6103b96a7f
- 模型/档位：Claude Opus 5.5（高）；Jira：未提供（HRTL-xxxxx 待人工填写）
- 状态：review（待 §10.7 人工检查点）；2026-10-21 工具已搬到独立 repo `retail-coffee-migration`，**待重新验证**（下表的验证记录都是搬迁前的）

## 清单
| 项 | 状态 | 验证记录 |
| --- | --- | --- |
| 环境：sr_web 镜像 | done | 镜像 sr-coffee-sr_web；`tools/sr_web.sh`（原 `migration/coffee/sr_web.sh`）；容器内先 `ensure_packages.sh`（build:packages） |
| 共享库 tools/lib/*（原 migration/coffee/lib） | done | 全量分析 ~2.6s，4421 文件，0 编译错误；宿主机与容器都能跑 |
| G2 inventory.mjs + batches.json + coffee_manifest.txt | done | `--check`：322 个 coffee 各属一批；`--summary` 322 / 30,905 行 / 743 spec；`--batch B09/B29` 抽查正确 |
| G1 EXAMPLES.md + coffee_compile.mjs | done | subagent C；主会话复核 `--range` 输出 |
| G3 check_interop.mjs + lib/interop.mjs | done | 全量 0 error（7 条白名单）；selftest/interop.mjs 12 组 ok；对抗审查后加强 CJS `.default` 规则，probe 中 3 个漏报变为捕获 |
| G4 export_shapes.test.js | done | 录制/比较可用；自测 1、2 通过；对抗审查后加强（全部原型数据、注册值身份、bind 不算字段、loadError 判失败、CRC 允许消失项收紧） |
| G5 sagamore_registry.test.js | done | jest 方案；481 路径（含挂在函数上的命名空间、深度 8）、35 个 Apps 路由、82 条 appOptions；自测 3 通过 |
| G6 baseline.sh + collect.mjs + compare.mjs + webpack_stats.cjs | done | 基线 3 分钟；见下 |
| G7 lint_converted.sh + lint_scan.mjs | done | 自测 2 通过；对抗审查的 g7_bypass.js 全部 17 处捕获 |
| G7b coffee_hotspots.mjs | done | subagent B；selftest/hotspots_check.sh 9 场景 ok |
| G8 verify.sh + verify_container.sh + changes.mjs | done | 完整模式全绿 3m36s；--quick 25s |
| G9 jest/helpers/legacy.js（原 src/jest_helpers/coffee_migration） | done | legacy_helpers.test.js 6/6 |
| §9 Q1 | done | jsdom 能加载 main（webpack_runtime.js）；ChromeHeadless 用 /usr/bin/chromium |
| §9 Q2 | done | apps.coffee 能加载，82 条路由录入 G5 |
| §9 Q3 | done | nodes() 足够（subagent B） |
| §9 Q4 | done | 见基线摘要 |
| §9 Q5 | done | React 17.0.2；Backbone 1.0.0 / jQuery 1.8.3 不可迭代 |
| §9 Q6 | done | public_globals.json；Sagamore.View 已缺失 |
| 验收 1：错误导出形态 → G3/G4 | done | collection.coffee→具名导出 JS：G3 14 error（13 default-missing + 1 named-missing），G4 “was a function, now object” + “no longer registers”，另报 app 无法加载；已还原（cmp 一致） |
| 验收 2：Backbone 子类 → ES class → G4/G7 | done | support.coffee→`class Support extends SRApp`：G7 [backbone-es-class]，G4 硬规则 + lost __super__/extend + registration es-class；再把快照从 JS 重录：0b 快照完整性报错、G4/G5 仍失败；已还原 |
| 验收 3：删除全局注册 → G5 | done | 删 `Sagamore.Apps.Support =`：G5 报 removed path、removed route table、appOptions appClass→null；G4 “no longer registers”；已还原 |
| 验收 4：DEPRECATED_spec 新增用例 → G8 第 7 步 | done | 加 it + 新 spec 文件：verify.sh 完整模式 FAIL（more it()、new file），karma 运行本身仍绿（3742）；改 import 不改 it 数：报 patching；已还原 |
| verify.sh 完整模式无改动全绿 | done | 2026-10-18 最终运行 ALL GREEN（3m36s） |

## 基线摘要（原 migration/coffee/baseline/，现 data/springboard-retail/baseline/；搬迁后需重录）
- jest 723 套件 / 3,936 用例，0 失败（容器内需 --maxWorkers=4，否则 OOM）
- karma 3,740（3,645 执行、95 skipped），0 失败
- eslint 0 error / 2,158 warning
- tsc 12 个历史错误（TS9005/9006 声明生成）
- webpack dev 5,498 / prod 5,461 模块，0 错误，0 循环

## 决策记录
- 静态工具宿主机运行，依赖 setup_host.sh 装到 `.work/coffee-tools`；容器内 `yarn node`。已写回 PLAN §3 实现要点：是
- G3/G2 统一 TS AST，coffee 先编译再解析：是
- 容器入口 sr_web.sh（不用 sr-dev run）：是
- 工作目录 `migration/coffee/.work/` 而非 `apps/monolith/tmp/`（CleanBuildPlugin 会移走 tmp）：是
- batches.json glob 不带扩展名 + coffee_manifest.txt：是
- knownDuplicates：两对既有 coffee+js 只警告，归 B01：是（§9）
- G4 不用 isolateModules，改为加载一次 main + Proxy 追踪写入归属：是
- G5 走 jest 方案：是
- B00 不录任何 G4 快照（各批录自己的）：是
- §6.2 严格解释：无父类的 coffee class 也不得改 ES class（待人工确认）：是
- jest.mock 形状问题保持 warning（靠相关 jest 测试兜底）：是（已知局限）
- 2026-10-21 工具独立 repo 化（用户要求）：工具/数据/文档搬到 `/Users/zack/workspaces/retail/retail-coffee-migration`，通过 `config.json`（+ `config.local.json`、`COFFEE_*` 环境变量）指向目标 checkout；springboard-retail 不提交任何工具，不进 CI。已写回 PLAN 文首“★”节：是
- 容器内把工具 repo 挂到 `/sr/apps/monolith/coffee-tools`（workspace 目录内 → PnP 可解析依赖；`jest ./src`/`eslint src`/tsc 不扫）；宿主机空挂载点由 `setup_host.sh` 写进目标 `info/exclude`，`sr_web.sh` 发现挂载点非空则拒绝运行：是
- G4/G5 只在本地 verify 跑；shapes/registry 快照提交在工具 repo；0b 改为 `recordedSha`（git blob sha）对 merge-base 校验；新增 0c tool-leaks：PLAN ★ 节：是
- G9 helpers 只本地用；提交到目标的测试必须自包含（需要时把 helper 复制到 `src/jest_helpers/`）：PLAN ★ 节与 G9：是

## 偏离 PLAN.md
- `inventory.json` 不提交（生成文件 ~500KB）。
- 工具路径：`.work/` 替代 `tmp/`；容器命令 `sr_web.sh` 替代 `sr-dev run`。
- G4 实现方式（见决策）。
- G6/G8 额外记录 jest-passing、test-config，并新增 0/0b 步骤、karma 纯删除检查（对抗审查后加固）。
- G7 `backbone-es-class` 改为 AST：任何非 React/Error 父类的 ES class 都失败（比 PLAN 的正则更严）。
- 新增工具：collect.mjs、compare.mjs、webpack_stats.cjs、changes.mjs、verify_container.sh、ensure_packages.sh、record_shapes.sh、lint_scan.mjs、selftest/*。
- 2026-10-21：工具不在 `apps/monolith/migration/coffee/`，而在独立工具 repo（路径映射见 PLAN ★ 节）；B00 不再给 springboard-retail 提 PR。新增 `tools/lib/config_env.mjs`、`jest/helpers/tool_paths.js`、`config.json`。

## karma 用例
- B00 不迁移、不删除 karma 用例。自测期间的临时改动已全部还原（git status 无已跟踪文件改动）。

## subagent 记录
| 任务 | 写入范围 | 结果 | 主会话复核 |
| --- | --- | --- | --- |
| A: G3 | check_interop.mjs、lib/interop.mjs、interop_allowlist.json | 0 error；7 条白名单 | 重跑全量 + selftest 一致 |
| B: G7b + Q3 | coffee_hotspots.mjs、lib/hotspots.mjs | 322 文件 0.5s；--check 格式 | 重跑生成/校验 + selftest 一致 |
| C: G1 + Q5 + Q6 | EXAMPLES.md、coffee_compile.mjs、public_globals.json | 见 §9 | 重跑 coffee_compile 一致 |
| D: 对抗审查 | .work/adversarial/ | 14 条；已修 #1–#7、#8 大部分、#10、#11、#13 由 #10/G3 覆盖部分 | 用其探针复跑：G7 全捕获、G3 .default 全捕获、G5 漏掉的注册现已进快照（剩 2 处为运行时真实被覆盖） |

## 对抗审查未修/部分修项
- #9 jest.mock factory 形状：保持 warning。
- #12 无父类 coffee class → ES class：G4 判失败（严格），待人工确认。
- #14 非 Sagamore 的 window 全局（sagamore、JST、Highcharts）未快照：B30/B31 前补。
- G4 只看导出值；未导出的内部类靠 G7 + Reviewer；React class 绑定靠 Reviewer。

## verify / Reviewer
- verify.sh（完整）：2026-10-18 ALL GREEN，3m36s；--quick ALL GREEN 25s。（搬迁前；搬迁后尚未运行）
- Reviewer：B00 不需要语义 Reviewer；§10.7 人工检查点待做。

## 2026-10-21 工具独立 repo 化（未验证）
- 搬迁：tools/、jest/{tests,helpers}/、data/springboard-retail/、EXAMPLES.md、PLAN.md、progress/ 已在工具 repo；springboard-retail worktree 中已删除 `apps/monolith/migration/`、`apps/monolith/src/__tests__/coffee_migration`、`apps/monolith/src/jest_helpers/coffee_migration`、`PLAN.md`、`progress/`；目标的 `AGENTS.md` 已改为指向工具 repo。
- 代码改动：所有脚本经 `lib/paths.mjs` / `lib/config_env.mjs` 取路径；`sr_web.sh` 挂载工具 repo 并传 `COFFEE_*`；`changes.mjs` 重写 snapshot-problems、新增 tool-leaks；`export_shapes.test.js` 写入 `recordedSha`；jest helpers 经 `tool_paths.js` 取 app 目录和数据目录。
- 已知必须做：**重录基线**。旧 `jest-passing.txt` 含 `src/__tests__/coffee_migration/{export_shapes 1, legacy_helpers 6, sagamore_registry 5}`，搬走后会被当成“测试减少”；jest 套件/用例数也会变为 720 / 3,924。
- 待验证（见工具 repo README“待验证”）：setup_host.sh、挂载后 PnP 解析与 ts-jest 转换、guardrail jest、record_shapes、完整 verify、B00 四项自测重做一遍。

## 下一步
- 验证搬迁（用户安排在 2026-10-22）：按工具 repo README“待验证”清单逐项跑；先 `tools/setup_host.sh`，再 `tools/sr_web.sh yarn jest coffee-tools/jest/tests`，再 `tools/baseline.sh` 重录基线，最后 `tools/verify.sh` 完整模式全绿、`--quick` 全绿，并重做 B00 四项自测（快照录制改用 `tools/record_shapes.sh`）。
- 人：§10.7 B00 检查点（4 项自测、§9 结论尤其 G5 方案、基线既有问题、#12 规则、Sagamore.View 是否恢复）。
- 工具 repo 做初始提交（用户确认后）；不再给 springboard-retail 提 “Add CoffeeScript migration guardrails” PR。
- 之后开 B01。

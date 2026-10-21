# AGENTS.md — retail-coffee-migration

这是 springboard-retail（Heartland Retail）CoffeeScript → JS 迁移的**独立工具 repo**。先读：

1. `README.md`：目录、配置、命令、容器挂载机制、与目标仓库的边界、待验证清单。
2. `PLAN.md`：迁移计划。文首“★ 工具独立 repo 化”一节优先于下文。执行批次前读 §10，再读 `progress/progress.<bxx>.md`。
3. 目标 worktree 的 `AGENTS.md`（默认 `/Users/zack/workspaces/retail/zed.worktrees/springboard-retail/coffee/springboard-retail/AGENTS.md`）：`sr-dev`、构建接线、团队迁移约定。

## 规则

- **目标仓库里不留任何工具痕迹**：不把本 repo 的文件复制或提交到 springboard-retail；目标代码和测试不得引用 `coffee-tools/`、`jest/helpers`、`retail-coffee-migration`（`verify.sh` 0c 会查）。目标提交的测试必须自包含。
- 路径一律通过 `tools/lib/paths.mjs`（JS）、`tools/lib/config_env.mjs`（shell）或 `jest/helpers/tool_paths.js`（jest）获取，不要写死 `apps/monolith`、`/sr`、`migration/coffee` 等路径。
- `dataDir`、`workDir` 必须在本 repo 内（容器只能通过挂载看到本 repo）。临时文件放 `.work/`，不要放目标的 `apps/monolith/tmp/`（production 构建会把它整个移走）。
- 不要给本 repo 加 `package.json`（会影响挂载目录在目标 jest/PnP 里的模块解析）。宿主机依赖由 `tools/setup_host.sh` 装到 `.host-deps/`。
- 需要容器的命令一律用 `tools/sr_web.sh <cmd…>`，不要用 `sr-dev run`；docker 命令需要申请 `unsandboxed`。不要在目标 worktree 跑 `pristine` / `update` / `down -v`。
- 不使用 `yarn convert:coffee`、decaffeinate、codemod 等自动转换工具；由 LLM 直接翻译（见 `PLAN.md` §2、§4）。
- 未经用户明确要求，不要 commit、push 或新建分支（本 repo 和目标仓库都一样）。
- 进度文件只由主会话写；subagent 规则见 `PLAN.md` §10.4。

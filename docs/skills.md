# Coffee migration Skills：安装与试用

本 repo 保存两个手动调用的 Zed Skill，供不同开发人员/电脑安装同一套流程。

| Skill | 入口 | 默认行为 |
| --- | --- | --- |
| [coffee-migration-ticket](../.agents/skills/coffee-migration-ticket/SKILL.md) | `/coffee-migration-ticket` | 分析当前代码，生成 Jira ticket 草稿；明确授权后才发布 |
| [coffee-migration](../.agents/skills/coffee-migration/SKILL.md) | `/coffee-migration` | 读取 ticket、按范围迁移、验证、输出人工验收包；不自动提交/关单 |

两个 Skill 都设置了 `disable-model-invocation: true`，避免普通问答意外触发迁移。下列示例是向 Agent 输入的自然语言，不是 shell 命令参数。

## 1. 两台电脑各自安装

前提：本机有 Node.js 18+，并已有本 repo 的 checkout。安装器只有 Node 内置依赖，**不要求先配置目标 repo、安装 Yarn 包或启动 Docker**。迁移环境准备是另一件事。

在每台电脑各自的工具 repo 根目录运行：

```sh
node tools/install_skills.mjs --dry-run
node tools/install_skills.mjs
node tools/install_skills.mjs --check
```

默认安装到：

```text
~/.agents/skills/coffee-migration-ticket/
~/.agents/skills/coffee-migration/
```

安装的是副本，包括 Skill 自带模板和本机生成的 `install.json`。元数据让 Skill 找到当前电脑的工具 repo；没有写死开发人员的绝对路径。**不要把电脑 A 的全局安装目录复制到电脑 B**，而是在 B 的 checkout 中重新运行同一命令。

源码还没提交/push 时，另一台电脑当然还拿不到这次新增文件；先由开发人员审核并自行同步 repo。本次创建 Skill 不自动 commit/push。

全局 Skill 通常在下一次新会话中发现；首次创建 `~/.agents/skills` 后若 slash 菜单未出现，可重启 Zed。支持项目内 Skill 的 Zed 也可直接发现本 repo 的 `.agents/skills/`，但团队跨项目使用推荐全局安装。出现同名来源时检查加载路径，保证使用的版本与当前 checkout 一致。

## 2. 各电脑分别配置迁移目标

- 将工具 repo 和要迁移的目标 checkout 一起加入 Zed 项目，让 Agent 的文件工具都能访问。
- 按 [README](../README.md) 在本机 `config.local.json` 设置目标路径，不把共享 `config.json` 改成个人机器配置。
- 多个 worktree 使用独立 WORK_DIR 和 compose project。路径解析仍走 `tools/lib/paths.mjs`；Skill 安装元数据只定位工具 repo，不替代目标配置。
- 需要真正迁移时，再准备宿主依赖、Docker、目标容器与有效基线，核实 README 中搬迁后的待验证项目。
- 读取/创建 Jira 需在每台电脑各自连接 Atlassian 工具并有权限；没有 Jira 连接仍可起草，执行时只能使用用户明确提供的完整离线正文并标明未核实状态。

## 3. 调用示例

### 起草 ticket

```text
/coffee-migration-ticket
分析我指定的组件目录，建议一组适合单独 review 的 Coffee 文件。
先给 Jira 草稿，不创建 issue；列出必要配套修改、风险及人工验收候选。
```

实际输入时提供真实目录、文件或既有 Bxx。创建到 Jira 时再明确提供站点/project 和发布授权；范围含糊时 Skill 应先澄清，而不是批量建单。必要的只拆分/测试先行任务会使用 prerequisite 模板单独起草，不自动交给转换 Skill。

### 执行 ticket

```text
/coffee-migration
按我提供的 Jira ticket URL 执行迁移。
先核对 scope 和当前 checkout；不要 commit、push、修改 Jira 或关单。
```

实际输入时附上真实 Jira URL。执行模式仅接受 conversion 任务；prerequisite 需走独立前置流程。Skill 产出代码、验证证据、`progress/progress.<小写key>.md` 和 WORK_DIR 下的人工验收包。不会把“手测计划已生成”当作“人已测过”。

### 独立 review（新会话）

```text
/coffee-migration
仅对我提供的 Jira ticket 和本分支实际 diff 做独立语义 review，不修改代码。
```

同一实现会话不能冒充独立 review；人工环境验收仍需开发人员完成。

## 4. 更新、检查与安全行为

修改 Skill 源码或在本机同步最新 repo 后，重新运行：

```sh
node tools/install_skills.mjs
node tools/install_skills.mjs --check
```

移动 checkout 或切换到另一个本机 checkout 后，也从新路径重新安装，更新 `toolsRoot`。建议团队使用同一工具 repo 版本；`--check` 只验证与当前 checkout 一致，不查询远端是否最新。

- 安装前检查两个目标目录；不覆盖非本安装器管理的同名 Skill。
- 已装文件被本地编辑、出现额外文件/目录、损坏元数据或 symlink 时拒绝更新；先人工保留/处理修改，不提供 `--force`。
- 幂等安装不重写未变文件；更新使用临时目录替换。两个 Skill 逐个替换，不是跨目录整体事务；意外中断后检查并重新运行。
- `--check` 只读，一致退出 0；缺失、过期、本地修改等退出非 0。`--dry-run` 做安全预检，不写入。
- 可用 `--dest <技能父目录>` 做隔离安装；非默认目录不会因此自动成为 Zed 搜索目录。
- 手动卸载前先备份本地修改，仅移走这两个已安装目录；不要清空整个 `~/.agents/skills`。

安装器自测（只在工具 repo `.work/` 下创建临时 fixture，不碰真实全局目录）：

```sh
node --test tools/selftest/install_skills.test.mjs
```

## 5. 初版边界与审阅重点

共同协议见 [skills-workflow.md](skills-workflow.md)。当前没有实现 risk-only verify、Jira 自动锁单、自动 PR 或关单。仍要求转换前形态快照、热点结论及完整 verify，风险用于追加检查。

建议先审阅：ticket 范围是否足够明确、默认草稿是否符合团队习惯、配套修改的边界、验收用例格式，以及完整验证要求。然后选一个低风险真实 ticket 试跑，再决定是否改验证工具实现分层减免。

安装器自测不代表 Jira 连接、迁移流程或 Docker 护栏已经通过端到端验证。

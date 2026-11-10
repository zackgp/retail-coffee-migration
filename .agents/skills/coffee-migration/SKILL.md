---
name: coffee-migration
description: 手动按 Jira ticket 明确的 CoffeeScript 文件清单执行 Heartland Retail JS 迁移，先在 Coffee 上建立行为证据，再翻译、检查互操作、运行护栏并生成针对性人工验收清单；也可在全新会话中仅做独立语义 review。不自动提交、关单或把未执行验收标为通过。
disable-model-invocation: true
---

# 执行 CoffeeScript 迁移

输入一个 Jira key/URL。默认执行该 ticket 的迁移；用户明确要求“仅 review”时进入最后的独立审阅流程。加载本 Skill 不授权创建分支、commit、push、写 Jira 或操作破坏性环境命令。

## 1. 定位、加载规则、检查环境

- 若本 Skill 目录有 `install.json`，读取其中 `toolsRoot`；否则从项目内 `.agents/skills/coffee-migration` 向上定位工具 repo。不存在时询问当前电脑的工具 repo，不能沿用另一台电脑绝对路径。
- 读工具 repo `AGENTS.md`、`README.md`、`docs/skills-workflow.md`、`PLAN.md` 的文首优先级说明与 §4、§6、§7、§10、`EXAMPLES.md`。不要凭聊天记忆替代当前规则。
- 用 `tools/lib/paths.mjs` 的导出获取目标 checkout、app、data、work、baseRef；读目标 `AGENTS.md` 和更局部规则。确认配置指向开发人员想修改的 checkout。
- 查看两个 repo 的分支、HEAD、工作区和目标 merge-base。保护用户改动；若目标工作区已有重叠改动，或本分支还包含其他迁移，先确认归属/隔离方案。verify 检查整个分支 diff，不是 ticket 子集。
- 确认已配置宿主依赖、Docker、独立 compose project/workDir、有效基线；遵循 README 的搬迁后待验证说明。缺环境时输出明确 blocker，不自动重录基线以消除错误。
- 容器命令只用 `tools/sr_web.sh`，按工具实际支持的方式申请权限。不运行 pristine/update/down -v，不偷偷启动完整栈。

## 2. 读取并冻结 ticket 范围

- 读取真实 Jira issue 的正文与验收标准；必要时读关联需求和相关评论。URL 已给站点时不再枚举站点；只有 key 且站点未知时先解析站点。
- Jira 读取失败时可接受用户明确提供的完整正文作为离线输入，记录来源和未核实状态；不能根据一个 key 猜范围。
- 先识别任务类型：本 Skill 的执行模式只接受 `Work type: conversion`。若 ticket 是 prerequisite（只拆分、补测试等），停止转换并交接独立前置流程，不删除 Coffee、不强套转换验收。旧 ticket 没有类型时从明确需求核实；无法判断则询问。
- 按 `docs/skills-workflow.md` 识别 `Migration scope`，逐项核对文件存在性、路径边界、目标 `.js` 冲突、当前源码与 ticket 分析 SHA。旧 ticket 没有明确列表、仅有 glob、风险/范围显著变化或文件已被他人转换时，先报告差异并澄清。
- 缺文件/全部已转换不是“本次成功”。可以检查已有结果，但不能虚构一次迁移。
- 查调用方、全局、模板、动态注册、现有测试和旧批次归属，列出迁移目标、必要配套修改、回归影响面；按证据确认风险。读取 PLAN §5 对应条目的非范围性强制门槛并重新核实，例如 B28 基类转换前所有子类的迁移状态/Coffee importer 为 0，B27 的 POS 全流程与 pos e2e。不能以 ticket 漏写或完整 verify 通过为由跳过；前置未满足则停止转换。明显越界的配套修改需暂停并请求调整范围。
- 在配置 WORK_DIR 下保存 ticket 范围快照（`tickets/<小写key>/scope.json`，字段见共享协议）；它是执行记录，不是 verify 支持的新输入格式。
- 主会话读/建 `progress/progress.<小写key>.md`，使用 PLAN §10.3 模板，额外记录 ticket URL/版本、范围、base/HEAD、风险、验收路径。记录相关 Bxx 映射，但绝不因映射而转换 ticket 之外的文件。

## 3. 转换前先建立行为证据

- 从源码和现有测试识别核心正常路径、边界/空值、失败/取消、回调 this、初始化时序、导出/注册契约。按风险补足有效测试，不以覆盖率数字代替行为判断。
- 将受影响 Karma 用例迁成自包含 Jest，在原 Coffee 上跑通再删除对应旧用例；不修补或新增 Karma。核对原断言未被弱化。
- 所有新行为测试先在 Coffee 实现上实际通过，记录命令、结果及源码身份。target 测试不能引用工具 repo，也不能加载整个 app。
- 当前兼容协议仍要求转换前形态快照：`tools/record_shapes.sh` 后显式传本 ticket 每个 app-relative Coffee 路径；不要使用范围更大的 Bxx 代替 ticket 清单。
- 用 `node tools/coffee_hotspots.mjs` 显式传 Coffee 文件和 `--out` 指向本 ticket WORK_DIR 下清单。源文件改变后原清单不再可信。只编辑结论，不删除热点来让检查通过。
- 不要在 Coffee 已删除后伪造/重录快照。遇到缺失基线或既有失败，记录并隔离原因；无法建立前置证据时停止转换，保留已完成的测试工作。

## 4. 翻译和必要配套修复

- 由 LLM 从 Coffee 源码直接翻译，保持顶层结构、方法顺序与行为。禁止 decaffeinate/codemod/整体复制编译产物。
- 依 PLAN §6 与 EXAMPLES：ESM、对象型模块具名导出、Backbone `.extend`、原型数据时序、React mixin/autobinding、隐式 return、null/undefined、循环表达式、条件渲染、顶层 this、加载顺序逐项核对。
- 歧义用 `tools/coffee_compile.mjs` 查看 CoffeeScript 1.12.7 输出，只作语义参考。
- 默认保留全局注册；删除前必须证明源码、模板、动态查找和外部公开 API 不再依赖，并满足现有协议，不因 grep 无结果直接判死代码。
- 修复真实调用方互操作与必要 shim/入口配置，避免顺手重构。配套文件不等于新增迁移目标；新增转换需先批准范围变化。
- 完成后删除同名 Coffee，测试放模块旁。自查每个热点和最终 diff；不要覆盖用户文件或以 git reset/checkout 掩盖失败。
- 若使用 subagent，遵守 PLAN §10.4 的不相交写入范围；共享文件、进度及完整 verify 仅由主会话处理。subagent 不能替代独立 reviewer。

## 5. 验证并形成验收包

当前保留完整 verify 底线，不把风险分级误写成“已有按 ticket 自动减免护栏”的能力。

1. 跑本次行为/交互测试及受影响调用方测试。单个范围用 `yarn jest <实际路径>`，不是 `yarn test <路径>`。
2. 填写热点结论，显式运行 `node tools/coffee_hotspots.mjs --check <本 ticket 清单路径>`。不带 `--batch` 的 verify 不自动执行此项。
3. 在工具 repo 运行 `node tools/check_interop.mjs --quiet`、针对实际产物的 `tools/lint_converted.sh`；再用 `tools/verify.sh --quick` 迭代，最终运行 `tools/verify.sh` 完整模式。任意 ticket 用不带 `--batch` 的模式，范围由真实分支 diff 决定。
4. 仅当 ticket 清单与一个既有 Bxx 完全相同且使用对应热点文件时，可用已有 `--batch Bxx`；不能把 Jira key 传给 `--batch`，也不存在 `--ticket`/`--scope`/`--risk` 参数。
5. 依风险和 ticket 追加 e2e、视觉/生产构建运行、集成或设备验收；完整 verify 并不包含所有这些项目。
6. 记录命令、退出状态、源码 SHA/工作区状态及结果。更改代码、修复 review 问题后，相关旧证据失效，重跑相关测试和完整 verify。超时/缺权限是 blocked，不是通过；不得降低断言、更新基线或放宽白名单来“跑绿”。

读取 `templates/acceptance.md`，把验收包写到本 ticket WORK_DIR 下 `acceptance.md`，在进度文件中保存可恢复的结果摘要和未完成 case。按照共享协议从原行为、调用链和热点推导具体手测用例，标注 confirmed/needs-confirmation；不能只生成通用 CRUD 清单。

最终分别报告：迁移完成度、自动校验、独立 review、人工验收。默认 reviewer/pending，人工项为 pending 或有理由的 not-applicable；只有实际执行且有证据才能 pass。输出最终 diff 范围、Karma 迁移映射、行为变化、blocker、验收包位置和下一步。不要自动创建 PR、写 Jira 评论/状态或宣布 ticket 已完成。

## 仅 review：必须全新独立会话

- 用户要独立 review 时，不先执行迁移，也不修改文件；若当前会话参与过实现，说明不满足独立性并要求新会话。
- 从真实 diff、共同祖先/记录的 Coffee 源码和 ticket 清单自行确定审阅范围。执行者摘要仅作线索，不代替检查原文；包括所有配套修改和删除的旧测试。
- 对照每个语义热点、导出/注册、this、继承时序及 Karma→Jest 断言，必要时看 Coffee 编译结果。疑似问题给出路径、证据、影响与修复建议，不做无关风格建议。
- 输出“发现的问题 / 已确认项 / 未能确认项”。独立 review 不等于人工功能验收；修复后的 diff 必须再审查和验证。

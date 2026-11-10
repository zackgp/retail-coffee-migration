# Migrate <功能> CoffeeScript to JavaScript

> 起草时填完占位符；正式创建前移除本提示。未执行验收不得勾选。

## Work type

conversion

## Goal

仅迁移语言/模块写法，保持现有可观察行为。说明本单功能边界及业务背景。

## Migration scope

- 路径基准：目标仓库根目录；appDir 从工具 repo 本机配置获取。
- 分析时目标 HEAD：<SHA>
- 关联旧批次：<Bxx / 多批次 / 无；仅供索引，不扩大范围>

```text
<一个真实的 repo-relative .coffee 路径一行，无 glob、无绝对路径>
```

| Coffee 文件 | 行数 | 分析时 blob SHA | 现有测试/关键行为 |
| --- | --- | --- | --- |
| <实际路径> | <行数> | <SHA 或未取得的原因> | <证据> |

## Supporting changes

| 预期配套文件/区域 | 必要原因 | 是否修改业务行为 |
| --- | --- | --- |
| <调用方、测试、shim、入口配置；无则写无> | <代码引用证据> | <否；例外需明确批准> |

配套修改不授权整份转换其他 Coffee 文件。新增迁移目标或显著扩大影响面需重新确认 scope。

## Impact and risk

- 风险：<low / medium / high>；依据：<源码路径、方法、调用关系>。
- 入口/页面/公开 API：<已确认的实际入口；未知写待确认>。
- 共享组件/调用方/模板/动态注册影响：<证据>。
- 不在本单范围：<重构、去全局、业务修复等>。

## Dependencies and blockers

- <前置 ticket、共享文件协调、角色/数据/硬件/沙箱要求；无则明确写无>
- 重复 ticket 检查：<已核实的结果与链接 / 未完成原因>。

## Automated acceptance

初版执行协议保留完整 verify；风险只决定追加项目，不自动减免现有护栏。

- [ ] 明确范围及实际 diff 一致，无未经批准的额外 Coffee 转换。
- [ ] 新增/迁移的行为测试先在原 Coffee 上通过，再在 JS 上通过，保留运行证据。
- [ ] 转换前录制形态快照，完成语义热点结论，核对调用方与全局依赖。
- [ ] 受影响 Karma 用例迁至自包含 Jest；不新增或修补 Karma。
- [ ] 相关 Jest、interop、lint/残留扫描通过；完整 `tools/verify.sh` 通过。
- [ ] 测试与业务代码不引用迁移工具 repo；原 Coffee 删除，无不应存在的同名冲突。
- [ ] 全新会话独立语义 review 无未关闭问题，修复后重新验证。
- [ ] <本功能需补的具体正常/边界/失败/异步测试；写实际测试范围，非通用口号>

## Manual acceptance

用例为候选计划，不是执行结果。未知业务预期标注 needs-confirmation；允许有理由地标 not-applicable。

### MAN-01 — <可执行场景名>

- 依据：<原 Coffee 方法/调用链/热点；为何自动测试仍不足>。
- 前置条件：<角色、数据状态、配置、环境、设备；不放凭据>。
- 入口：<已核实路由/页面；未确认则明确标注>。
- 操作：<编号步骤>。
- 预期：<从原行为/需求得到的可观察结果，包括不应发生的副作用>。
- 自动化覆盖/缺口：<已覆盖什么，人工补什么>。
- 优先级：<P0 / P1 / P2>；确定性：<confirmed / needs-confirmation>。
- 结果：pending；执行人/版本/环境/证据：待填。

## Definition of done

- [ ] 迁移及自动验收完成，输出证据与变更摘要。
- [ ] 独立 review 完成。
- [ ] 所有必需人工用例实际通过；未执行项不得以生成测试计划代替。
- [ ] 行为变化（如有）已显式批准并说明；合并/关单由开发人员决定。

## How to execute

在同时可访问目标 checkout 和 `retail-coffee-migration` 的 Zed 项目中，配置好当前电脑的目标路径，调用 `/coffee-migration <本 ticket key 或 URL>`。安装与环境说明见工具 repo `docs/skills.md`；共享执行协议见 `docs/skills-workflow.md`。

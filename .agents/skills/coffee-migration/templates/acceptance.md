# <Jira key> — Migration acceptance

## Identity and scope

- Ticket：<key / URL>；读取版本/updated：<实际值或未取得原因>。
- 输入来源：<Jira 实时读取 / 用户明确提供的离线正文>。
- 目标分支：<name>；baseRef / merge-base：<ref / SHA>。
- 测试前 Coffee HEAD/blob：<记录位置>。
- 验证时 HEAD / 未提交 diff 身份：<SHA + git diff/文件内容摘要标识；不能只写 HEAD>。
- 风险：<low/medium/high>，依据：<代码证据>。
- 迁移目标：<准确清单或本 ticket scope.json 路径>。
- 实际配套修改：<路径和原因>。
- 行为变化：<无 / 已批准变化和依据>。

## Status — 四项分开，不合并为一个“完成”

| 项目 | 状态 | 证据/剩余工作 |
| --- | --- | --- |
| 转换 | pending / partial / complete | <目标文件与 diff 核对> |
| 自动校验 | pending / pass / fail / blocked | <实际记录> |
| 独立 review | pending / pass / changes-requested | <独立会话/审阅版本> |
| 必需人工验收 | pending / pass / fail / blocked / not-applicable | <执行证据或不适用理由> |

## Automated evidence

| 检查 | 命令与工作目录 | 源码版本/运行时间 | 退出状态与结果摘要 | 日志 |
| --- | --- | --- | --- | --- |
| Coffee 行为测试 | <实际命令> | <Coffee 身份> | <实际结果> | <位置> |
| 转换前形态录制 | <实际命令> | <Coffee 身份> | <实际结果> | <位置> |
| 热点结论检查 | <实际命令> | <清单身份> | <实际结果> | <位置> |
| JS 行为/调用方测试 | <实际命令> | <最终代码身份> | <实际结果> | <位置> |
| interop / lint | <实际命令> | <最终代码身份> | <实际结果> | <位置> |
| 完整 verify | <实际命令> | <最终代码身份> | <实际结果> | <位置> |
| 按风险追加验证 | <实际命令或不适用理由> | <版本> | <实际结果> | <位置> |

- Karma → Jest 映射及断言核对：<原用例 → 新用例；无则写无>。
- 既有失败与新增失败的区分依据：<转换前记录，不凭推测>。
- 未运行/超时项：<原因和影响；不写通过>。

## Traceable manual cases

从原 Coffee 行为 + 调用链/入口 + 实际 diff + 语义热点推导；沿用 ticket 候选并根据实际改动修订。未知入口/业务预期写 needs-confirmation，不编造。

### MAN-01 — <场景>

- 来源：<文件/方法/热点、关联需求或已有测试>。
- 要防止的回归：<可观察风险>。
- 前置条件：<数据、角色、配置、沙箱/设备；不放凭据>。
- 入口：<已核实的页面/路径；未核实写明>。
- 步骤：
  1. <具体操作>
  2. <触发正常/边界/取消/失败路径>
- 预期：<明确且源自原行为的结果及副作用约束>。
- 自动化覆盖/缺口：<为什么还需要人测>。
- 优先级：<P0/P1/P2>；确定性：<confirmed/needs-confirmation>。
- 状态：pending / pass / fail / blocked / not-applicable。
- 执行人/日期：<待填>；版本/环境：<待填>；证据/失败单：<待填>。

若所有人工项确实不适用，用代码与测试证据解释原因，不为了凑数生成通用“打开页面正常”。AI 未实际执行的项目必须保持 pending；人工口头报告应标注“用户报告”，不冒充亲测。

## Open items and handoff

- 独立 review 问题：<编号、状态、修复后的验证>。
- 阻塞项/不确定性：<具体内容和所需信息>。
- 下一个会话入口：<进度文件、scope、热点、日志位置>。
- 需人工完成：<环境验收、review、PR/合并等>。
- Jira：未自动评论/流转/关单；如果另获授权写入，记录实际操作和返回值。

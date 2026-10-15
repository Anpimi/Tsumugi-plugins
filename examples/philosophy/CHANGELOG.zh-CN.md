# 更新日志

英文 `CHANGELOG.md` 为权威来源，本文件为简体中文镜像。

## [Unreleased]

### Changed

- 通过公共 `contributions` 与 `register(id, handler)` API 登记准确能力集合；
  setup／退出使用 Process-3 组件身份，默认 Project 作用域及领域行为保持不变。

- 从选定的 Process-3 SDK 快照准备公共 validator 与包来源，供匹配的 Host 使用。
  query／text-review 契约与同一未分发 alpha.1 包版本保持不变。

- 将自有 check 输入／输出替换为公共 SDK 的文本检查输入及报告契约；原检查能力推进至 2/2，query 契约保持 1/1，尚未分发的包继续为 `0.1.0-alpha.1`。
  从原术语资源生成四条 advisory 概念规则及其标题／说明。每次调用须明确选择规则子集，并核对准确 Host provider 和 Resource pins，返回完整状态及 UTF-16 诊断；缺译文保留捕获的 NA 依据或不可用状态，完整报告超限则拒绝而不截断。发现仍为未采纳建议，Core current QA 联合／采纳仍待接入；不为旧自有 check 格式提供兼容回退。

- 从原术语资源生成有界公共文本查询声明，保留准确输入依据、明确目标／词义选项及参考结果列。单项和批量消费者使用 SDK helper 与原组件；产品渲染与 Agent 集成仍待完成。

- 将包自有的 Agent 描述替换为公共 SDK 的严格只读工具选择器，明确 profile 及同包术语／Skill 引用。准备阶段使用固定 SDK 产物校验结构；能力契约、限额与权限仍由原查询能力拥有。

- 增加原创、固定版本的哲学术语资源及共享公共查询／确定性检查能力，显式限定词义与语言范围，保留完整查询依据及 UTF-16 诊断。
- 提供指向同一查询能力的 Skill 和 Agent 工具描述。产品编辑器、批量及 Agent 集成仍待完成。

# 更新日志

英文 [`CHANGELOG.md`](CHANGELOG.md) 为权威来源，本文件为简体中文镜像。

## [Unreleased]

### 新增

- 在 `knowledge` 组件上声明由宿主渲染的 `reference-query` UI 贡献，绑定唯一的 `agent-query-tool` Resource，支持桌面端渲染术语查询控件且不增加额外执行权限。
- 新增独立 `Attempt` 作用域的 `generation` 组件（`generation-delegate`），声明对 Core WorkPlan 生成服务与本包 `query` 能力的单项必需依赖，使用锁定的 SDK 校验器转发子任务与源单元子集并原样返回 Core 的回执或错误负载。
- 新增固定版本的哲学术语资源（`en` → `zh-CN`、`ja`）及共享的公共 `query` 与确定性 `check` 能力，支持显式词义与语言范围限定及 UTF-16 区间诊断，并提供配套的 Skill（`skills/concept-review.md`）与 Agent 工具描述。

### 变更

- `generation-delegate` 升级至 schema/behavior `2/2`，消费 SDK 的 `tsumugi.generation-component-input`（`1/1`）包装契约，在提交 Core 子生成请求（`1/1`）前先执行一次已准备的术语查询。
- 组件入口切换至 Process 3 的公共 `contributions` 与 `register(id, handler)` API，并从锁定的 Process 3 SDK 快照准备校验器与包来源元数据。
- 检查能力（`org.tsumugi.examples.philosophy-check`）升级至 schema/behavior `2/2`，改用公共 SDK 的 `tsumugi.text-review-input`（`1/1`）与 `tsumugi.text-review-report`（`1/1`）契约，并从原术语资源生成四条建议性（advisory）概念规则（`validity`、`soundness`、`premise`、`inference`）。
- 从术语资源生成公共文本查询展示配置（固定输入依据、词义与目标语言选项及参考结果列），供单项与批量调用方通过 `createToolQuery` 使用。
- 将原有的自定义 Agent 工具描述替换为公共 SDK 的只读工具选择器（`tsumugi.capability-tool-declaration` `1/1`），指向同包内的术语 Resource 与 Skill。

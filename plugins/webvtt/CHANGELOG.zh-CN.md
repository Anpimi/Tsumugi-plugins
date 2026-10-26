# 更新记录

本文件是英文 [`CHANGELOG.md`](CHANGELOG.md) 的简体中文镜像。
本插件采用语义化版本（`0.1.0-alpha.1` 为首个实验预发布版本）。

## [Unreleased]

## [0.1.0-alpha.1] - 2026-10-23

首个[未签名实验归档](https://github.com/Anpimi/Tsumugi-plugins/releases/tag/webvtt/v0.1.0-alpha.1)（发布时间采用 UTC），基于源码 commit `d0e8c826ef099cceeab059c7aed5370034296c54` 构建，面向 macOS aarch64 上的实验 Host `e0d223f9bcbbca9decad63d62a90aed8510f9cf0`（`minimum = current`）。

### 新增

- 支持从已确认目标语言的 `translations/<canonical-locale>.vtt` 导入现有译文字幕（`import-translations`），保留原始字节与 cue 身份，并提供独立的整文件译文语义检查（`translation-semantic-check`）。
- 为每条 cue 提取带原始 UTF-8 字节范围的 `time` 源上下文事实，并由独立源检查器核验；语义修订依据仍采用 `webvtt.cue-basis/1`，仅修改 `NOTE`、换行符或字节偏移不会使未变 cue 的修订失效。
- 源导入 Resource 升级为 schema/behavior `2/2`，并绑定同包不可变的 `review-profile` Resource。
- 新增 `review-profile` Resource 与所选文本 QA 检查能力（`review-check`，含 `webvtt.source-structure` 与 `webvtt.payload` 规则），基于 SDK `ReviewCheckInput` 与 `CheckResults` 执行校验。
- 新增包内 `source-profile` 源导入资源，在提取前声明输入材料、字幕 profile、提取与检查贡献以及修订策略。
- 新增不可豁免的固定源语义检查（`source-semantic-check`）及独立 JSON 预期样本，校验完整覆盖范围、字节区间、cue 身份、显示证据与依据块。
- 提供 WebVTT 源提取（`extract-source`）、按字节范围替换的本地化构建（`build`）及独立产物字节检查（`validate-artifact`）JavaScript 组件。
- 实现 `webvtt-captions/1` profile：支持显式 ASCII cue ID、时间轴与设置解析，并在构建时完整保留 BOM、换行符、`NOTE`、`STYLE`、`REGION` 等全部非 payload 字节。
- 提供带版本的 `cue-basis` schema、可恢复领域错误、源码来源说明（`PROVENANCE.md`）以及固定字节预期与拒绝测试样本。

### 变更

- 组件入口切换至 Process 3 的公共 `contributions` 与 `register(id, handler)` API，初始化与退出使用 Process 3 组件身份，保持默认 `Project` 作用域。
- 基于锁定的 Process 3 SDK 快照准备 SDK 辅助文件与包来源元数据。
- 构建与产物检查改为使用通用 SDK 的 `BuildInput`、`ArtifactSet`、`BuildDeclaration` 与 `CheckResults` 契约，移除早期专用构建/检查 schema。
- 源提取结果升级为 `tsumugi.content-exchange` schema 2 / behavior 1，包含原始 cue ID 显示值及 UTF-8 字节范围。

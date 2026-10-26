# 更新日志

本文件是[英文更新日志](CHANGELOG.md)的简体中文镜像，英文版为权威来源。

## [Unreleased]

## [0.1.0-alpha.1] - 2026-10-23

首个[未签名实验归档](https://github.com/Anpimi/Tsumugi-plugins/releases/tag/stardew-smapi/v0.1.0-alpha.1)（发布时间采用 UTC），基于源码 commit `d0e8c826ef099cceeab059c7aed5370034296c54` 构建，面向 macOS aarch64 上的实验 Host `e0d223f9bcbbca9decad63d62a90aed8510f9cf0`（`minimum = current`）。

### 新增

- 源提取在 `manifest.json` 的 `Name` 符合 SDK 事实长度上限（4,096 字节）时，附带带原始引号字节范围的快照级 `note` 上下文事实，并提供不含坐标的 `smapi.manifest-context-basis/1` 修订依据块（使仅修改 manifest 空白位置不会触发修订变更，而修改 `Name` 会更新修订）。
- 源导入 Resource 升级为 schema/behavior `2/2`，并绑定同包不可变的 `review-profile` Resource。
- 新增 `review-profile` Resource 与所选文本 QA 检查能力（`review-check`，含 `smapi.placeholders` 与 `smapi.format` 规则），基于 SDK `ReviewCheckInput` 与 `CheckResults` 执行校验。
- 实现独立 JavaScript `smapi-i18n-flat/1` 源提取（`extract-source`）与独立源语义检查（`source-semantic-check`），支持 JSONC 与 BOM 解析、原生 key 身份及原始 UTF-8 字节范围。
- 支持基于通用 SDK 的语言包构建（`build`）与独立严格产物检查（`validate-artifact`），随包携带锁定的 `jsonc-parser` 运行时依赖、SDK 校验器及相关许可证。
- 支持 `i18n/<locale>.json` 现有译文提取（`import-translations`）与整文件译文语义检查（`translation-semantic-check`），严格区分空对象（`{}`）与空字符串值（`""`）。

### 变更

- 组件入口切换至 Process 3 的公共 `contributions` 与 `register(id, handler)` API，初始化与退出使用 Process 3 组件身份，保持默认 `Project` 作用域。
- 基于锁定的 Process 3 SDK 快照准备 SDK 辅助文件与包来源元数据。

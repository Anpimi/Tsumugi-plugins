# 更新记录

本文件是本插件英文 `CHANGELOG.md` 的中文镜像。
本独立插件采用语义化版本，首个包为实验版本。

## [Unreleased]

### 新增

- JavaScript SDK 组件：捕获 WebVTT 源提取、按字节范围构建本地化字幕、独立检查实际产物字节。
- 字幕 profile 1：显式 ASCII cue 身份、时间与设置，以及 BOM、换行、NOTE、STYLE、REGION 和全部非 payload 字节保留。
- 带版本的构建、检查与身份依据 schema；有界输入和结果；可恢复领域错误；公开源码来源与固定字节预期、拒绝样本。

候选包版本为 `0.1.0-alpha.1`；尚未声明发布日期或完整应用迁移完成。

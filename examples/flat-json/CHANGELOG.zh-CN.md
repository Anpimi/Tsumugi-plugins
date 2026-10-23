# 更新日志

本文件是英文 CHANGELOG.md 的中文镜像。

## [Unreleased]

### Changed

- 公共 Native facade 在执行作者代码前拒绝多成员激活，本包继续使用原单项 profile。

### 变更

- 从选定的公共 Process-3 SDK 重新构建预编译 Native Worker。旧 Process-1/2 binary
  会被拒绝；flat catalog profile 与同一未分发 alpha.1 版本保持不变，无运行时回退。

### 新增

- 已捕获译文的提取与独立整文件语义检查，保留准确 native 键、语言证据及空文件；
  当前源匹配与逐条采纳仍由 Core 负责。
- 仅依赖公共 SDK 的 Rust 消息目录提取、独立源／QA／产物检查与语言构建，采用当前
  `flat-json-messages` 1/1 profile。
- 从 typed 定义生成 manifest／资源，以及保留固定 SDK 来源的显式预构建打包。
  这些变更不代表插件或应用已发布。

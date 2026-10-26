# 更新日志

本文件是英文 [`CHANGELOG.md`](CHANGELOG.md) 的简体中文镜像。

## [Unreleased]

### 新增

- 支持现有译文提取与独立整文件译文语义检查（`flat-json.translation-semantics`），保留精确原生键、语言校验及空对象（`{}`）处理。
- 基于公共 Tsumugi SDK 实现 `flat-json-messages`（`1/1`）Rust 消息目录源提取、独立源/QA/产物检查与本地化构建。
- 支持从单一强类型 Rust 定义生成插件 manifest 与声明式 Resource，并通过 `tooling/package-flat-json.py` 打包及记录锁定的 SDK 来源。

### 变更

- 公共 Native facade 在进入插件代码前拒绝多成员激活，本样例保持原有的单项组件配置。
- 基于锁定的 Process 3 SDK 快照重新编译预构建 Native Worker（Process-3 Host 会拒绝早期 Process-1/2 二进制）。

# Tsumugi 插件候选构建

本页介绍如何在本地运行 Tsumugi 插件仓库的独立候选构建，以及构建报告与兼容性测试的职责边界。完整的仓库结构、各领域插件说明及 SDK 用法请参阅 [英文 README](README.md) 和各包文档；串联 SDK 准备、插件打包、Host 检查器、手动加载与诊断的端到端流程请参阅 [插件开发指南（英文）](https://github.com/Anpimi/Tsumugi/blob/e0d223f9bcbbca9decad63d62a90aed8510f9cf0/docs/plugin-authoring.md)。

目前 [WebVTT 0.1.0-alpha.1](https://github.com/Anpimi/Tsumugi-plugins/releases/tag/webvtt/v0.1.0-alpha.1) 与 [SMAPI 0.1.0-alpha.1](https://github.com/Anpimi/Tsumugi-plugins/releases/tag/stardew-smapi/v0.1.0-alpha.1) 已发布未签名的实验归档，面向 [兼容策略](compatibility/macos-aarch64.json) 中指定的 macOS aarch64 Host（`minimum = current`）。

## 本地构建与检查

在 Unix 环境下安装 Rust 1.98+、Python 3.11+、Node `>=26.10.0 <27` 与 pnpm 12.8.1，在仓库根目录运行：

```sh
mkdir -p artifacts/candidates
python3 tooling/candidate-build.py --output artifacts/candidates/local
```

`--output` 指定的目录必须尚不存在；如果构建失败，脚本会保留现场供排查，重试时请换用新的输出路径。当本地 Cargo 与 pnpm 依赖缓存已就绪时，可附加 `--offline` 进行离线源码构建。

`candidate-build.py` 会依次完成以下步骤：

1. **准备固定 SDK**：校验并解压 `sdk.lock.json` 锁定的仓内 SDK 归档（无需拉取上游生产 commit 或依赖外部 Core 仓库）。
2. **执行测试套件**：运行 Python 打包测试、Rust workspace 与 SDK 消费端检查，以及三个 Node 领域测试套件。测试命令必须有实际非跳过的用例通过；空测试文件或全部 skip/TODO 的 Node 套件会直接中止打包（Rust workspace 中允许存在单个零用例目标，前提是整个 workspace 实际执行了其他非忽略测试）。
3. **打包四个独立候选产物**：分别构建 `webvtt`、`stardew-smapi`、`philosophy` 和 `flat-json`（均保持各自独立的版本号）。pnpm 安装禁用 lifecycle scripts 并复制实际依赖文件，避免打包工具读取指向全局缓存的硬链接；Rust 样例二进制会先安装到本次输出目录内再打包，打包后的 `.tar` 保留可执行权限且不含编译缓存。
4. **生成构建报告**：在 `candidate-build.json` 中记录当前 commit、工作树 dirty 状态、SDK 信息、平台、各测试命令的真实用例计数与日志 SHA-256，以及每个候选包的身份、版本、manifest SHA-256、文件与字节数、确定性 `.tar` 归档 SHA-256。

## 可选的 Host 包检查（Inspection）

构建报告中的 `.tar` SHA-256 是归档传输摘要，不同于 Host 计算的 `packageDigest`。默认情况下，`packageDigest` 为 `null`，`inspection` 状态为 `not-run`。

若本地已有匹配的公开 Host 检查器，可同时传入 `--inspector`、`--inspector-sha256` 与 `--declared-host-commit`。脚本会校验并复制该二进制到仅当前用户可访问的临时副本，调用 `tsumugi-plugin-package inspect <directory>`，并核对返回的包身份、manifest、文件数与字节数是否与归档完全一致，随后记录 `packageDigest`。报告中的 `declaredHostCommit` 为调用方声明值（标记为 `sourceProvenanceNotVerified: true`）。

## CI 工作流、兼容性矩阵与发布流程

- **候选构建工作流**：[候选 workflow](.github/workflows/candidate-build.yml) 在 Ubuntu 24.04 与 macOS 14 上使用固定版本的构建工具与固定 commit SHA 的 GitHub Actions。其中一个 Ubuntu 作业使用最低支持的 Rust 1.98.0 编译全部 Rust target 与 feature；Rust 1.99.0 作业则完整执行四包测试与打包（安装 pnpm 时先禁用自动生命周期脚本，再在临时工具目录显式初始化其原生二进制，项目依赖脚本始终禁用）。PR 运行仅使用 `contents: read` 权限，生成的构建产物仅作为开发候选归档。
- **兼容性矩阵**：即使完成了 Host 包检查，`candidate-build.json` 中的 `runtimeCompatibility` 依然保持 `not-run`。候选 Host 与已发布插件、候选插件与目标 Host、以及固定应用/SDK/插件组合的端到端验证由独立的 [兼容性矩阵指南](tooling/COMPATIBILITY.md) 负责。
- **实验版发布**：[实验版逐插件发布指南](tooling/RELEASE.md) 说明如何审核单个插件的固定归档并生成预发布计划（默认执行本地 dry-run，正式发布需操作者另行授权）。
- **Process 3 协议要求**：当前锁定的 SDK 使用 Process 3 协议。JavaScript 插件入口通过冻结的 `contributions` 集合逐项调用 `register(id, handler)`（三个默认组件保持 `Project` 作用域，Native helper 支持单项组件）。配合 Process-3 Host 使用前，请基于当前 SDK 重新准备 JavaScript 包并重新编译 Native Worker（旧 Process-1/2 组件会被拒绝）。

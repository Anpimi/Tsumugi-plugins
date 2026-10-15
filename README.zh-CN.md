# Tsumugi 插件候选构建

本页说明独立候选构建及其证据边界。完整仓库、领域包与 SDK 用法以
[英文 README](README.md) 和各包公开文档为准。

在 Unix 环境准备 Rust 1.98 或更新版本、Python 3.11 或更新版本、
Node `>=26.10.0 <27` 与 pnpm 12.8.1，从本仓运行：

```sh
mkdir -p artifacts/candidates
python3 tooling/candidate-build.py --output artifacts/candidates/local
```

输出目录必须尚不存在。失败尝试及已有目录会被保留；核对失败记录后，
使用新的输出目录，不覆盖原结果。仅在 Cargo 与 pnpm 缓存已准备时添加
`--offline`；离线源码构建与应用离线运行是不同验收范围。

入口复用现有 SDK 准备、冻结依赖、领域测试与显式打包工具，检查 Rust
workspace/公开消费端、Python 打包工具和三组 Node 领域测试，并构建
WebVTT、SMAPI、哲学知识样例及独立 Rust JSON 样例。四包保留各自的版本。
pnpm 安装禁用 lifecycle scripts，parser 由已有工具显式准备。
SDK 直接取自 `sdk.lock.json` 固定的仓内 tracked archive，不要求获取其
生产源 commit，也不需要私有文档、兄弟 Core checkout 或桌面应用。

`candidate-build.json` 记录源 commit、初始 dirty 状态、SDK、平台、命令结果
及日志，以及各实际包的身份/版本、manifest SHA-256、文件/字节计数和
确定性 tar SHA-256。dirty 工作树的结果不能单独证明未变化的 commit 通过。
tar 保留 executable bits，仅包含显式预构建包，不携带依赖缓存或 Cargo 目录。
测试命令保留真实 runner 计数及日志 SHA-256，失败时也保留。汇总不完整、
零有效执行、Node 全 skip/TODO 都会阻止打包。Node 空文件的文件级成功
不算有效用例；Rust 单个零用例 suite 仅在整个 workspace 测试命令实际
执行了其他非忽略用例时允许。

tar SHA-256 是传输摘要，不冒充 Host 的 `packageDigest`。默认
`packageDigest` 为 null，inspection 为 `not-run`。已有准确公开 inspector 时，
可同时传入 `--inspector`、`--inspector-sha256` 与 `--declared-host-commit`。
入口核验并捕获 binary bytes，创建仅当前用户可访问的新副本，通过该副本调用真实既有的
`tsumugi-plugin-package inspect <directory>`，核对身份、manifest 和完整计数，
并确认实际包与 tar 字节一致，才记录 Host 的包摘要。
原 binary 路径后续变化不会替换已捕获的执行对象；副本不包含在上传的候选产物中。

`declaredHostCommit` 仅是来源声明；`sourceProvenanceNotVerified: true`
明确表示脚本未独立证明该 binary 由该 commit 编译。inspection 不运行
Worker，不授予安装或执行权限。

[候选 workflow](.github/workflows/candidate-build.yml) 配置 Ubuntu 24.04/macOS 14、
准确工具版本及完整 SHA 固定的 Actions。每次变更检查四包及共享工具。
PR 只有 `contents: read`，checkout 不保留凭据，无发布密钥、特权后续作业
或发布操作。上传结果是未发布、未信任的开发候选，不能直接提升为发行物。
本配置说明不宣称实际 hosted run 已通过。

即使 inspection 成功，`runtimeCompatibility` 仍为 `not-run`。候选 Host 与
已发布插件、候选插件与支持的 Host、固定应用/SDK/插件组合、真实
Worker→Core 采纳及清洁离线应用验收，需要各自的独立证据；候选构建绿灯
不能替代这些门禁，也不证明已具备发布条件。

当前选定的 SDK 使用 Process3：JavaScript 入口按冻结集合逐项 `register(id, handler)`，
三个默认组件仍为 Project scope，Native helper 仅支持单项集合。应从此 SDK 重新准备
JavaScript 包并重建 Native Worker，旧 Process1/2 明确拒绝；领域契约和同一未分发
alpha.1 包版本保持不变。本选择不发布或安装插件。

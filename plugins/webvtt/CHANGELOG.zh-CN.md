# 更新记录

本文件是本插件英文 `CHANGELOG.md` 的中文镜像。
本独立插件采用语义化版本，首个包为实验版本。

## [Unreleased]

### 新增

- 源配方改用 schema/behavior 2/2，并必须引用准确且不可变的 `review-profile` Resource。消费者须使用新固定的 SDK；旧实验配方拒绝，不做转换。源与 Review 数据契约及未发布插件版本保持不变。

- 新增必需审阅 Resource 与所选文本 QA 能力，通过 SDK CheckResults 检查固定源证据和准确规则版本。缺译文只允许明确捕获的不适用依据，源检查继续执行；Core 人工批准、术语、回退、豁免和发布资格仍由应用负责。

- 包内 SDK 源导入资源，在提取前固定必需材料、字幕 profile、独立提取/检查贡献及必需修订和检查策略。

- 通过 SDK 检查要求与结果执行不可豁免的固定源语义检查；使用独立源 JSON 预期，拒绝伪造覆盖、范围、身份、显示依据、领域块与检查策略。
- JavaScript SDK 组件：捕获 WebVTT 源提取、按字节范围构建本地化字幕、独立检查实际产物字节。
- 字幕 profile 1：显式 ASCII cue 身份、时间与设置，以及 BOM、换行、NOTE、STYLE、REGION 和全部非 payload 字节保留。
- SDK 构建/检查契约与带版本的身份依据 schema；有界输入和结果；可恢复领域错误；公开源码来源与固定字节预期、拒绝样本。

### 变更

- 构建改为消费 SDK BuildInput 并返回 ArtifactSet；捕获的 BuildDeclaration 使独立构建器和检查器可被发现，产物检查返回必需 CheckResults，语义错误继续阻止采纳。拒绝过去实验专用构建/检查 JSON，不做转换；字幕限制和字节保真承诺不变。

- 提取结果采用 content-exchange schema 2 / behavior 1，提供原 cue ID 显示值与 UTF-8 字节范围。拒绝过去开发结果形状；调用方必须使用同一独立选择的 SDK 产物。

候选包版本为 `0.1.0-alpha.1`，仍属同一个未发布实验批次；尚未声明发布日期或完整应用迁移完成。

# Changelog

The English changelog is authoritative; [`CHANGELOG.zh-CN.md`](CHANGELOG.zh-CN.md) mirrors it.

## [Unreleased]

### Added

- Declared a host-rendered `reference-query` UI contribution on the `knowledge` component, binding its `agent-query-tool` Resource so Tsumugi Desktop can render terminology lookup controls without additional execution permissions.
- Added an independent `Attempt`-scoped `generation` component (`generation-delegate`) with required single-provider dependencies on the Core WorkPlan generation service and the package's `query` capability, forwarding a child task/unit subset and returning Core's receipt or error payload using pinned SDK validators.
- Added a pinned philosophy terminology resource (`en` → `zh-CN`, `ja`) with shared `query` and deterministic `check` capabilities, explicit concept and locale scoping, and UTF-16 range diagnostics, accompanied by a Skill (`skills/concept-review.md`) and Agent tool descriptor.

### Changed

- Updated `generation-delegate` to schema/behavior `2/2`, consuming the SDK's `tsumugi.generation-component-input` (`1/1`) wrapper to execute one prepared terminology query before submitting the Core child generation request (`1/1`).
- Updated component entrypoints to the Process 3 `contributions` and `register(id, handler)` API and staged validators from the pinned Process 3 SDK snapshot.
- Migrated `check` (`org.tsumugi.examples.philosophy-check`) to schema/behavior `2/2` using the SDK's `tsumugi.text-review-input` (`1/1`) and `tsumugi.text-review-report` (`1/1`) contracts, generating four advisory concept rules (`validity`, `soundness`, `premise`, `inference`) from the terminology resource.
- Generated the structured `query` presentation (input pins, concept/locale options, and reference columns) from the terminology resource for single and batch lookup consumers via `createToolQuery`.
- Replaced the custom Agent tool descriptor with the SDK's `tsumugi.capability-tool-declaration` (`1/1`) selector referencing the same-package terminology Resource and Skill.

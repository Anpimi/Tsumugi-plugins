# Source provenance

This independent MIT-licensed package derives its bounded caption parser,
identity policy and preservation-oriented builder from the public
[Tsumugi repository](https://github.com/Anpimi/Tsumugi), revision
`b5bb6812818a11b971497a751244d9898cda5dd2`:

- `crates/core/src/content/webvtt.rs`: caption profile, timing/settings, layout
  evidence, payload validation, output filename and range-based reconstruction.
- `crates/core/src/content/smapi.rs`: existing printable ASCII identifier rule.
- `crates/core/src/content/mod.rs`: source, cue and text budgets.
- `crates/core/tests/fixtures/webvtt/s1.vtt`, `s2.vtt`,
  `expected-zh-CN.vtt`: fixed preservation and source-change reference fixtures.
- `crates/core/src/content/webvtt_tests.rs`: rejection and fidelity scenarios.

Copyright (c) 2026 Tsumugi contributors. The complete MIT license accompanies
this package in `LICENSE`.

The JavaScript implementation owns only the supported format operations. It
imports no Core or desktop code. The artifact checker reparses actual output and
compares non-payload byte segments independently of the builder. Existing project
IDs, revisions, user decisions, grants and release policies remain application
responsibilities. This package does not claim a completed application migration
or full WebVTT conformance.

Shared component, invocation and content types come from the exact SDK artifact
selected by the repository's `sdk.lock.json`. Generated SDK files and cached
artifacts are not edited or vendored as another protocol source in this package.

# Source provenance

This independent MIT-licensed package derives its bounded caption parser,
identity policy and preservation-oriented builder from the public
[Tsumugi repository](https://github.com/Anpimi/Tsumugi), revision
`b5bb6812818a11b971497a751244d9898cda5dd2`:

The Rust implementation was ported to JavaScript, not moved byte-for-byte. The
original paths map to these package paths, first imported by plugin repository
commit `c1762285c246f25b7f29320007bce5f7d5f0319b`:

- `crates/core/src/content/webvtt.rs` → `plugins/webvtt/components/webvtt.mjs`:
  caption profile, timing/settings, layout evidence, payload validation, output
  filename and range-based reconstruction.
- `crates/core/src/content/smapi.rs` → `plugins/webvtt/components/webvtt.mjs`:
  existing printable ASCII identifier rule.
- `crates/core/src/content/mod.rs` → `plugins/webvtt/components/webvtt.mjs`:
  source, cue and text budgets.
- `crates/core/tests/fixtures/webvtt/s1.vtt` →
  `plugins/webvtt/tests/fixtures/s1.vtt`; `s2.vtt` →
  `plugins/webvtt/tests/fixtures/s2.vtt`; `expected-zh-CN.vtt` →
  `plugins/webvtt/tests/fixtures/expected-zh-CN.vtt`: fixed preservation and
  source-change reference fixtures.
- `crates/core/src/content/webvtt_tests.rs` →
  `plugins/webvtt/tests/webvtt.test.mjs`: rejection and fidelity scenarios.

Copyright (c) 2026 Tsumugi contributors. The complete MIT license accompanies
this package in `LICENSE`.

The JavaScript implementation owns only the supported format operations. It
imports no Core or desktop code. The artifact checker reparses actual output and
compares non-payload byte segments independently of the builder. Existing project
IDs, revisions, user decisions, grants and release policies remain application
responsibilities. This package does not claim a completed application migration
or full WebVTT conformance.

The later independent source-semantic checker, review rules/checker and
source-context facts are package-owned additions; they are not code from the
original Rust files listed above. The fixed-source semantic verifier
independently reparses captured material and checks complete proposal
references, original ID display/ranges and exact required basis blocks through
the SDK's standard check results. Its literal source-check fixture is an
independently authored oracle; it does not use extractor output to define the
expected source semantics. The caption source-context interpretation is also
package-owned: accepted timing tokens and original byte ranges yield extracted
time facts. The SDK owns the fact shape and bounded encoder; no voice, role or
scene is inferred from text.

Shared component, invocation and content types come from the exact SDK artifact
selected by the repository's `sdk.lock.json`. Generated SDK files and cached
artifacts are not edited or vendored as another protocol source in this package.

Build and artifact-check wire data now use the same SDK-owned generic build
contracts. Domain projection and byte-range rendering remain here; the independent
verifier reparses actual output and returns fixed CheckResults. The obsolete
experimental dedicated build/check schemas were removed, without conversion.

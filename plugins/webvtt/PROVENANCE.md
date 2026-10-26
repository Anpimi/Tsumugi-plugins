# Source provenance

This MIT-licensed package derives its WebVTT caption parser, cue identity rules, and byte-preserving builder from the public [Tsumugi repository](https://github.com/Anpimi/Tsumugi) at commit `b5bb6812818a11b971497a751244d9898cda5dd2`.

The original Rust implementation was ported to JavaScript and first imported into this repository in commit `c1762285c246f25b7f29320007bce5f7d5f0319b`:

- `crates/core/src/content/webvtt.rs` → `plugins/webvtt/components/webvtt.mjs`: Caption profile parsing, timing and cue settings, layout digest calculation, payload validation, output filename validation, and byte-range reconstruction.
- `crates/core/src/content/smapi.rs` → `plugins/webvtt/components/webvtt.mjs`: Printable ASCII identifier validation rule.
- `crates/core/src/content/mod.rs` → `plugins/webvtt/components/webvtt.mjs`: File, cue-count, and payload byte limits.
- `crates/core/tests/fixtures/webvtt/s1.vtt` → `plugins/webvtt/tests/fixtures/s1.vtt`; `s2.vtt` → `plugins/webvtt/tests/fixtures/s2.vtt`; `expected-zh-CN.vtt` → `plugins/webvtt/tests/fixtures/expected-zh-CN.vtt`: Byte-preservation and source-update reference fixtures.
- `crates/core/src/content/webvtt_tests.rs` → `plugins/webvtt/tests/webvtt.test.mjs`: Rejection and byte-fidelity test cases.

Copyright (c) 2026 Tsumugi contributors. See [`LICENSE`](LICENSE) for the full MIT license text.

## Package-owned additions and SDK boundaries

The following capabilities were authored directly in this package rather than ported from the original Rust files:

- **Independent semantic and review checkers**: `source-semantic-check`, `translation-semantic-check`, `validate-artifact`, and `review-check` reparse raw input and output bytes independently of the extractor and builder. The source-check test fixture is an independently authored JSON oracle rather than captured extractor output.
- **Source-context time facts**: Each extracted cue includes a `tsumugi.source-context-facts/1` `time` fact pointing to the original timing substring's UTF-8 byte range, encoded via the pinned SDK helper. Because `webvtt-captions/1` is a plain-text profile that rejects voice tags and markup, no speaker, role, or scene facts are inferred.
- **SDK contracts**: All shared wire types, Resource schemas, and standalone validators (`BuildInput`, `ArtifactSet`, `ArtifactCheckInput`, `CheckResults`, content-exchange, translation-exchange, and review contracts) come from the immutable SDK archive pinned in `sdk.lock.json`.

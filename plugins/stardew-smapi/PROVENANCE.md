# Source provenance

This package's SMAPI flat translation profile is derived from the public [Tsumugi repository](https://github.com/Anpimi/Tsumugi) at commit `1873fb6666365a7ca898689449f0b7a599e5855e` under the MIT license.

The original Rust implementation was ported to JavaScript and first imported into this repository in commit `f2f3bca95e3e892a13fd884b190ab1463ac0b96e`:

- `crates/core/src/content/smapi.rs` → `plugins/stardew-smapi/components/smapi.mjs`: JSONC parsing rules, manifest validation, native key identity, and source UTF-8 byte ranges.
- `crates/core/src/content/build.rs` → `plugins/stardew-smapi/components/smapi.mjs`: Canonical flat locale JSON generation and validation.
- `crates/core/src/content/translation.rs` → `plugins/stardew-smapi/components/smapi.mjs`: Existing flat translation decoding rules.
- `crates/core/src/review.rs` → `plugins/stardew-smapi/components/smapi.mjs`: Named placeholder syntax, token counts, and control-character validation rules.

## Dependencies, fixtures, and package-owned additions

- **JSONC parser**: Uses Microsoft's MIT-licensed [`jsonc-parser@3.3.1`](https://github.com/microsoft/node-jsonc-parser/blob/v3.3.1/README.md), pinned via `pnpm-lock.yaml`. Scanner and AST offsets are mapped to exact UTF-8 byte coordinates, and any scanner or parser error fails extraction (fault-tolerant recovery is never accepted).
- **Test fixtures**: The `Lookup Anything` mod files and independent .NET expected oracles in `tests/fixtures/stardew-lookup` preserve their upstream bytes, revision, and MIT license. The files in `tests/fixtures/upstream-maintenance` are synthetic test cases for source-update comparison.
- **Package-owned additions**: The independent semantic checkers (`source-semantic-check`, `translation-semantic-check`, and `validate-artifact`), the `review-check` contribution and declarative Resources, and the manifest `Name` snapshot context fact (`tsumugi.source-context-facts/1`) and coordinate-free revision basis (`smapi.manifest-context-basis/1`) were written directly for this package against the pinned SDK in `sdk.lock.json`.

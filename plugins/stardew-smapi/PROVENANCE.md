# Source provenance

The SMAPI profile is derived from Tsumugi commit
`1873fb6666365a7ca898689449f0b7a599e5855e`, under its MIT license:

The Rust implementation was ported to JavaScript, not moved byte-for-byte. The
path mappings below were first imported by plugin repository commit
`f2f3bca95e3e892a13fd884b190ab1463ac0b96e`:

- `crates/core/src/content/smapi.rs` →
  `plugins/stardew-smapi/components/smapi.mjs`: JSONC, manifest, native identity
  and source ranges.
- `crates/core/src/content/build.rs` →
  `plugins/stardew-smapi/components/smapi.mjs`: canonical flat locale
  construction and validation.
- `crates/core/src/content/translation.rs` →
  `plugins/stardew-smapi/components/smapi.mjs`: flat existing-translation
  decoding baseline.
- `crates/core/src/review.rs` →
  `plugins/stardew-smapi/components/smapi.mjs`: named marker syntax, counts and
  control characters.

The later independent source-semantic checker, review-check contribution and
resources, and source-context facts are package-owned additions. Their code and
contracts are not from the original Rust files listed above; the `review.rs`
mapping describes the marker-rule lineage only.

The independent JavaScript implementation consumes only the immutable public SDK
selected by `sdk.lock.json`. It does not import Core or the application. The
JavaScript parser is Microsoft's MIT-licensed `jsonc-parser@3.3.1`, selected by
this package's pnpm lockfile with registry integrity. Its scanner and AST offsets
are converted to original UTF-8 coordinates. Its fault-tolerant recovery is never
accepted as successful input: all scanner/parser errors block extraction.
See the [fixed upstream API](https://github.com/microsoft/node-jsonc-parser/blob/v3.3.1/README.md).

The licensed Lookup Anything files and independent .NET oracle in
`tests/fixtures/stardew-lookup` retain their original bytes and upstream revision.
Their README and MIT license describe that source. Maintenance fixtures are
isolated synthetic examples. They do not prove game or installed Mod compatibility.

The candidate implements source extraction/checking, complete existing-translation
extraction with independent whole-file checking, and locale building/artifact
checking. Translation data and Resource contracts come from the exact public SDK
producer selected in `sdk.lock.json`; no Core implementation is imported at runtime.
Project language confirmation, current-source matching, per-entry candidate/selection
adoption and final desktop cutover remain incomplete. Domain output and package
receipts cannot establish those application workflows.
The snapshot context note uses only the parsed manifest `Name` and its original
quoted byte range. SDK-generated encoding and limits are selected through the
same lock; this package does not infer characters or roles from native keys.
The separate domain revision basis records decoded Name only; source offsets
remain in the context fact and do not change project revisions by themselves.

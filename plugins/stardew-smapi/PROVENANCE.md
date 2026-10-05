# Source provenance

The SMAPI profile is derived from Tsumugi commit
`1873fb6666365a7ca898689449f0b7a599e5855e`, under its MIT license:

- `crates/core/src/content/smapi.rs`: JSONC, manifest, native identity and source ranges.
- `crates/core/src/content/build.rs`: canonical flat locale construction and validation.
- `crates/core/src/content/translation.rs`: flat existing-translation decoding baseline.
- `crates/core/src/review.rs`: named marker syntax, counts and control characters.

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

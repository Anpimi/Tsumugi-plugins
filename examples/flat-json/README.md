# Rust JSON message catalog example

`org.tsumugi.examples / flat-json` (`0.1.0-alpha.1`) is an example Native Rust plugin built against the repository's pinned public Tsumugi SDK (`sdk.lock.json`).

It implements the SDK's `NativeComponent` trait over **process protocol 3** (handling framing, invocation identity, cooperative cancellation, and disposal with an empty service table and singleton activation). A single typed Rust [definition](src/definition.rs) generates the plugin manifest and Source, Translation, Review, and Build Resources so authors do not have to maintain duplicate JSON schemas or wire codecs by hand.

## Supported `flat-json-messages` profile

The `flat-json-messages` (`1/1`) profile handles flat JSON string catalogs:

- **Source format (`source.json`)**: A non-empty flat JSON object mapping keys to strings, with an optional UTF-8 BOM, up to 128 KiB and 2,000 messages. Keys are case-sensitive Unicode strings (1–128 UTF-8 bytes, no control characters). Duplicate keys, comments, nested objects/arrays, trailing data, invalid JSON, and NUL characters are rejected. Values can be empty strings or multiline Unicode text up to 16 KiB, preserved without Unicode normalization.
- **Placeholders and byte ranges**: Brace tokens such as `{name}` start with an ASCII letter or underscore followed by ASCII letters, digits, `_`, `.`, or `-` (up to 64 bytes); unmatched or nested braces are rejected. Source occurrences point to the original quoted JSON value using UTF-8 byte offsets, while protected placeholder tokens point to offsets within the decoded message text. Each occurrence includes a canonical opaque key block as its revision basis.
- **Independent source and review checks**: The source checker reparses `source.json` from scratch to verify full coverage, keys, quoted byte ranges, placeholder ranges, ordering, and revision basis blocks. During QA review, source rules are mandatory and non-waivable, while the placeholder token rule compares exact `{placeholder}` counts in translations (allowing the `missing-translation` N/A basis only when the entire selected scope is untranslated).
- **Locale building and artifact checking**: The builder takes decided target texts and one `.json` output path, emitting sorted keys with two-space indentation, a trailing LF, and the source's BOM behavior. The independent artifact checker reparses the generated JSON and verifies every decoded key/value pair, role, BOM, and SDK binding (formatting whitespace differences alone are permitted, whereas missing, extra, or altered entries produce blocking findings).
- **Existing translation import**: Accepts a single `translations/<target-language>.json` file (up to 128 KiB and 2,000 messages) whose filename stem matches the confirmed target language under the `flat-json:source` namespace and `flat-json.message-key` policy. An empty object (`{}`) produces a valid zero-entry proposal, and the `flat-json.translation-semantics` checker independently reparses the file to verify all keys, values, display evidence, and UTF-8 ranges.

The worker requests only `captured-input` permissions and performs all parsing and building in memory without touching the filesystem or network.

## Build and package

Requires Rust 1.98+ and Python 3.11+ on Unix. From the repository root:

```sh
python3 tooling/prepare-sdk.py
cargo test --locked -p tsumugi-flat-json-example
cargo build --locked -p tsumugi-flat-json-example --bin flat-json-worker
mkdir -p .generated artifacts/candidates
target/debug/flat-json-worker --metadata > .generated/flat-json-metadata.json
python3 tooling/package-flat-json.py .generated/flat-json-metadata.json \
  target/debug/flat-json-worker artifacts/candidates/flat-json
tsumugi-plugin-package inspect artifacts/candidates/flat-json
```

When Cargo dependencies are already cached locally, `cargo test` and `cargo build` accept `--offline`. Make sure to compile `flat-json-worker` for the target OS/CPU architecture and rebuild whenever `sdk.lock.json` advances (Process-3 Hosts reject earlier Process-1/2 worker binaries).

`package-flat-json.py` assembles the generated metadata, prebuilt worker binary, `sdk/lock.json`, and license files into a new output directory without running build scripts, and `tsumugi-plugin-package inspect` validates and fingerprints the resulting package.

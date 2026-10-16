# Rust JSON message catalog example

This independent plugin example consumes the repository's verified public SDK
archive. It imports no Core, database, desktop, Cordis or private workspace code.
Its `NativeComponent` uses the SDK entry point for framing, identity, cancellation
and disposal. One typed [definition](src/definition.rs) generates the manifest
and Source/Translation/Review/Build Resources; authors do not maintain another wire codec or
a duplicate JSON manifest. The plugin identity is `org.tsumugi.examples / flat-json`.
This is an experimental, unreleased `0.1.0-alpha.1` example, not a bundled plugin.

The selected public SDK uses process protocol 3. Rebuild and package this
Native worker with the current `sdk.lock.json` before using a Process-3 Host;
earlier Process-1/2 binaries are refused. This component uses an empty service
table and requests only captured inputs. The profile and example version remain
unchanged in the same undistributed alpha.1 batch, with no runtime fallback or
historical conversion.

## Current profile

`flat-json-messages` schema/behavior 1/1 accepts one captured `source.json`:
a nonempty flat JSON object of strings, optional UTF-8 BOM, at most 128 KiB and
2,000 messages. Keys are exact, case-sensitive Unicode strings of 1–128 UTF-8
bytes without control characters. Duplicate decoded keys, comments, nested
values, trailing data, invalid JSON and NUL text are refused. Values may be
empty and contain Unicode and line breaks, up to the SDK's 16 KiB text bound.
No Unicode normalization or key rewriting occurs.

Brace tokens such as `{name}` use an ASCII letter or underscore followed by
letters, digits, `_`, `.` or `-`, at most 64 bytes. Unmatched/nested braces and
other brace syntaxes are unsupported. Source occurrences refer to the original
quoted JSON literal with UTF-8 byte offsets; protected tokens refer to decoded
message text. The native display key is derived from JSON decoding, with no
invented literal source range. Original captured bytes, BOM and line endings
remain source evidence. A canonical opaque per-occurrence key block supplies
the domain revision basis; Core alone allocates project identities/revisions.

The independent source checker reparses captured input and checks complete
coverage, identity, literal ranges, token ranges, order and basis without calling
the extractor. QA always checks source semantics; a separate mandatory token
rule compares exact placeholder multiplicity in selected translations. That
rule permits the SDK's fixed missing-translation N/A only for an entirely
missing scope. Source rules cannot be skipped or waived.

The builder accepts complete already-selected target texts, no configuration,
and one authorized `.json` output path. It emits sorted keys, two-space JSON,
a final LF and the source BOM. This profile does not promise preservation of
source JSON formatting in the translated artifact. The separate artifact
checker reparses actual output and compares every decoded key/value, role,
BOM and fixed SDK association. It does not call the builder as an oracle;
formatting differences alone are allowed. Broken/omitted/extra text remains a
blocking finding even when an attacker recalculates the artifact hash.

Existing translations use one captured `translations/<target-language>.json`
under the same 128 KiB/2,000-message bounds. Filename spelling must exactly match
the explicitly confirmed project target; the `flat-json:source` namespace and
`flat-json.message-key` policy must match the current adopted source scope.
Keys remain exact and case-sensitive; decoded Unicode, empty strings, quoted
UTF-8 ranges, complete file bytes and entry order are preserved. An empty object
retains a complete zero-entry proposal; no project unit or revision is invented.
The independently invoked `flat-json.translation-semantics` checker reparses the
whole original file and verifies language, keys, values, display evidence, ranges
and coverage without calling extraction. Core owns current-source matching,
unmatched rows, selection conflicts, per-entry adoption and uncertain outcomes.
The wire language confirmation is evidence and grants no execution or adoption.

Only captured inputs are requested. The worker never opens source/output paths,
installs packages, performs network requests or obtains project write handles.
Native execution still has operating-system user privileges; approval and
per-attempt consent belong to the public Host/application, and no OS sandbox is
claimed. Installation and metadata generation do not grant execution authority.

## Build and package

Use Rust 1.98 or newer and Python 3.11 or newer on Unix, from this repository root:

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

With a prepared dependency cache, Cargo accepts `--offline`. When sharing a
custom Cargo target, supply its actual worker path. For distributable binaries,
use Cargo/Rust's path-remapping options for the checkout and dependency cache.
`package-flat-json.py` copies explicit prebuilt bytes through the existing public
packager and executes no binary or build script. It refuses an existing output;
the package includes the exact SDK lock and both licenses. The inspector is
the public Host's read-only capture tool, not a publisher authentication or
installation/permission decision. Build the binary for the actual target OS/CPU.

Tests use synthetic catalogs and independent literal expected output, including
Unicode, escaped literals, duplicates, forged coverage, bounded failures and
cancellation. Actual package/Host/Core acceptance is recorded separately;
these domain tests do not establish GUI, Windows, Linux execution or release
acceptance, and do not replace either existing domain's migration.

# Pinned SDK consumer artifact

The selected `.crate` is an immutable source package produced by
[`tsumugi-plugin-sdk` in Tsumugi](https://github.com/Anpimi/Tsumugi),
version `0.1.0-alpha.1`, under its declared MIT license. `sdk.lock.json` records
its SHA-256, producer repository and exact source commit. The source commit is a
development candidate; the SDK is experimental and has not been published to
crates.io. This included archive makes its public code and harness available
without a sibling checkout or an unpublished Git dependency.

Tsumugi remains the sole contract owner. Do not change files inside this archive
or introduce hand-written copies of its types. Generate a replacement in the
producer repository and independently verify its bytes and public contents before
updating the lock. This repository releases domain plugins separately from SDK
and application versions. Third-party registry dependencies are fetched through
Cargo with the checked-in lockfile; their source is not included in this archive.

New development snapshots use `<producer-commit>/<package>-<version>.crate`.
Earlier archives remain unchanged for provenance; `sdk.lock.json` selects exactly
one snapshot and there is no compatibility fallback. Preparation hashes and
extracts the same captured archive bytes, verifies an existing cache, and refuses
unmatched files. The current snapshot includes the Rust source-extraction API,
generated JavaScript content declarations, standalone extraction and source-check
validators, original identity display evidence and fixed check-selection contracts,
with their license notices. Packaged plugins derive those helpers from this artifact.

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

The selected snapshot also supplies the SDK-owned source-import resource types,
strict receiver and generated schema. A package resource fixes material and
independent provider/check policy, while directory and current execution authority
remain application-owned. The added resource stays in this same unreleased
experimental package batch and does not establish a completed desktop migration.

The current selected snapshot also includes generic BuildInput/ArtifactSet,
ArtifactCheckInput/CheckResults, BuildDeclaration and BuildError, with generated
JavaScript build declarations and standalone structural validators. The plugin
uses these public contracts while retaining its own caption semantics.

The selected producer also includes complete existing-translation input/proposal,
independent required-check input and single-file Resource contracts. It supplies
Rust strict receivers and generated JavaScript declarations/structural validators.
SMAPI consumes these shapes without importing project state. The new snapshot
stays within the same undistributed SDK alpha.1 batch; current-source matching,
actual consent and adoption remain application responsibilities.

The selected review snapshot includes ReviewCheckInput, ReviewDeclaration/Binding
and finite ReviewCheckError data, with generated JavaScript review types and
structural validators. Its exact producer commit and archive SHA-256 are retained
in sdk.lock.json; prior development archives remain unchanged. Plugins contribute
mandatory domain rules through these contracts, while Core still owns review
policy, approval, terminology, explicit fallback, waivers and qualification.
These additions stay in the same unpublished SDK alpha.1 batch.

Source-import Resources now use schema/behavior 2/2 and require a named immutable
Review Resource. Binding accepts the captured Review declaration and fixes all
source and Review providers from one package/profile. The precise producer
commit and archive digest are selected in `sdk.lock.json`; earlier archives and
their verified caches remain preserved. This is the same unpublished SDK
alpha.1 batch, with no historical recipe conversion.

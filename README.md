# Tsumugi plugins

Official plugin packages for [Tsumugi](https://github.com/Anpimi/Tsumugi).
This repository owns domain implementations, their tests and independently
versioned artifacts. Tsumugi owns the public SDK, process Host and project engine.
Plugins do not depend on Core, the desktop frontend or a private workspace.

The repository provides a pinned SDK source artifact, an independent Rust consumer
check, and independent WebVTT and SMAPI JavaScript candidates for source extraction,
separate source semantics, locale building and separate artifact checking. SMAPI
translation extraction and independent whole-file checking use the same public
SDK. Both candidates also provide mandatory review-rule Resources and separate
selected-text QA components. Project language confirmation, matching/adoption and full domain cutover
remain application integration work.
Their source-import Resources use schema/behavior 2/2 and select exact immutable
Review Resources; source/profile rules and checker bindings come from the same
SDK-pinned package. These packages are experimental candidates; no plugin release is claimed.

## Build the independent SDK consumer

Use Rust 1.98 or newer and Python 3.11 or newer. From this checkout:

```sh
python3 tooling/prepare-sdk.py
cargo test --locked
cargo run --locked -p tsumugi-sdk-probe -- tooling/sdk-probe/fixtures/manifest.json
```

The first Cargo dependency fetch needs network or a prepared Cargo cache. With
that cache, the same commands accept `--offline`. They do not require another
Tsumugi checkout, a private document or the desktop application.

`sdk.lock.json` pins the included experimental `0.1.0-alpha.1` SDK archive by
SHA-256 and its original source commit. The archive was built from Tsumugi's SDK;
it is a consumer artifact, not a fork or another protocol source. It has not been
published to crates.io. `prepare-sdk.py` verifies and materializes its exact files
under the ignored `.cache/sdk/` directory. Do not edit that cache or the archive.
Changes to SDK contracts belong in Tsumugi and require a new explicitly selected
artifact here. The archive contains the public contract/schema harness and
JavaScript declarations as well as the Rust data API.

Development snapshots are stored under `artifacts/sdk/<producer-commit>/` so an
explicitly selected newer snapshot never replaces an earlier archive's bytes.
Before changing that selection, verify an existing cache against the old lock and
preserve it outside the selected package directory. A mismatched cache is refused.

## Build a WebVTT package

Use Node `>=26.10.0 <27` for this package. From this checkout:

```sh
node --test plugins/webvtt/tests/*.test.mjs
mkdir -p artifacts/candidates
python3 tooling/package-plugin.py plugins/webvtt artifacts/candidates/webvtt-0.1.0-alpha.1
tsumugi-plugin-package inspect artifacts/candidates/webvtt-0.1.0-alpha.1
```

`tsumugi-plugin-package` is the public Host inspector supplied by Tsumugi. The
packager copies the explicit file recipe, SDK-generated extraction validator,
licenses and SDK lock into a new directory. It refuses an existing output and
executes no package scripts. The inspector validates and fingerprints that actual
prebuilt candidate; its output supplies no publisher authentication or execution
grant. Keep approval, installation and current execution consent separate.
See the [package contracts](plugins/webvtt/docs/contracts.md) and
[Host boundary](plugins/webvtt/README.md#host-integration-boundary).

## Package ownership

The [SMAPI package](plugins/stardew-smapi/README.md) uses a frozen pnpm dependency
and explicit parser preparation before packaging. Its prebuilt tree carries all
parser runtime files and licenses, rather than loading developer `node_modules`.
Its source, build and check capabilities pair with the public Host using the same
SDK shapes as WebVTT. Building a package does not complete desktop migration.

- `plugins/stardew-smapi/`: SMAPI discovery, source and translation import,
  identity/matching, checks, building and artifact verification.
- `plugins/webvtt/`: WebVTT caption profile parsing, identity/timing/layout,
  payload checks and preservation of non-payload bytes in output.
- `tooling/`: public SDK consumption and shared build checks.

Each domain package owns its version and changelog. There is no repository
version train. Installing a package will not authorize its execution or adopt
its results; those decisions belong to the application's trusted boundaries.

See [contributing](CONTRIBUTING.md) and [SDK provenance](artifacts/sdk/README.md).
Source is licensed under the [MIT License](LICENSE).

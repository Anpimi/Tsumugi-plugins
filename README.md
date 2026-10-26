# Tsumugi plugins

Official plugin packages and examples for [Tsumugi](https://github.com/Anpimi/Tsumugi).
This repository maintains domain plugin implementations, test suites, and independently versioned package artifacts. Tsumugi provides the public SDK, process Host, and project engine, so plugins build and test here without depending on Core, the desktop frontend, or any external checkout.

What's included in this repository:

- **Domain plugins (`plugins/webvtt/`, `plugins/stardew-smapi/`)**: JavaScript plugins for WebVTT captions and Stardew Valley SMAPI flat translations. Both implement source extraction, existing-translation import, source and translation semantic checks, locale building, artifact validation, and selected-text review rules against the public SDK. Their source-import resources (`schemaVersion: 2`, `behaviorVersion: 2`) pin immutable review resources from the same package.
- **Examples (`examples/philosophy/`, `examples/flat-json/`)**: A format-independent philosophy terminology package (JavaScript) and a flat JSON message catalog plugin (Native Rust worker).
- **SDK consumer & tooling (`artifacts/sdk/`, `tooling/`)**: The pinned `0.1.0-alpha.1` SDK archive (`sdk.lock.json`), a standalone Rust consumer probe (`tsumugi-sdk-probe`), and shared packaging, compatibility, and release scripts.

Unsigned experimental archives for [WebVTT 0.1.0-alpha.1](https://github.com/Anpimi/Tsumugi-plugins/releases/tag/webvtt/v0.1.0-alpha.1) and [SMAPI 0.1.0-alpha.1](https://github.com/Anpimi/Tsumugi-plugins/releases/tag/stardew-smapi/v0.1.0-alpha.1) are published for the macOS aarch64 Host defined in [`compatibility/macos-aarch64.json`](compatibility/macos-aarch64.json) (`minimum = current`).

## Build and check all independent candidates

To run all checks and package every plugin candidate on Unix, install Rust 1.98+, Python 3.11+, Node `>=26.10.0 <27`, and pnpm 12.8.1:

```sh
mkdir -p artifacts/candidates
python3 tooling/candidate-build.py --output artifacts/candidates/local
```

The `--output` path must not already exist; failed or previous runs are preserved for inspection rather than overwritten. Pass `--offline` when Cargo and pnpm caches are already populated locally.

`candidate-build.py` runs the full repository verification pipeline:

1. Verifies the tracked SDK archive selected by `sdk.lock.json` and extracts it to `.cache/sdk/`.
2. Runs Python packaging tests, Rust workspace/SDK consumer checks, and all three Node domain test suites. Test runners must execute actual non-skipped test cases; empty test files or all-skipped/TODO suites fail the build.
3. Prepares dependencies and builds four independently versioned `.tar` archives: `webvtt`, `stardew-smapi`, `philosophy`, and `flat-json`. pnpm installs run with `--ignore-scripts` and copy runtime files so archives never follow hard links into a shared store, while Cargo builds the Rust worker inside the attempt output directory.
4. Writes `candidate-build.json` with the checkout commit, working-tree dirty state, SDK lock metadata, test runner counts and log digests, and each candidate's plugin identity, version, manifest SHA-256, file/byte counts, and `.tar` archive SHA-256.

### Optional Host package inspection

The `.tar` archive SHA-256 is a transport digest, whereas `packageDigest` is computed by Tsumugi's Host inspector (`tsumugi-plugin-package`). Without an inspector binary, `packageDigest` is `null` and inspection status is `not-run`.

To record Host inspection results during the build, pass `--inspector`, `--inspector-sha256`, and `--declared-host-commit` together. The script copies the verified inspector binary into an owner-only temporary file, runs `tsumugi-plugin-package inspect <directory>`, and checks that the reported plugin identity, manifest, and file/byte counts match the packaged archive. In the resulting report, `declaredHostCommit` records the caller's declaration (`sourceProvenanceNotVerified: true`).

### CI, compatibility, and release workflows

- **CI workflow**: [`.github/workflows/candidate-build.yml`](.github/workflows/candidate-build.yml) runs on Ubuntu 24.04 and macOS 14 with pinned tool versions and commit-pinned GitHub Actions. A dedicated Ubuntu job checks Rust workspace compilation against the minimum supported Rust 1.98.0, while the Rust 1.99.0 jobs run the full test and packaging pipeline with read-only repository permissions (`contents: read`).
- **Compatibility matrix**: Even when package inspection succeeds, `runtimeCompatibility` in `candidate-build.json` stays `not-run`. Cross-checking candidate and released plugins against a pinned Host and runtime is handled separately by the [compatibility matrix guide](tooling/COMPATIBILITY.md). See [中文候选构建说明](README.zh-CN.md) for the Chinese overview.
- **Experimental releases**: The [experimental publication guide](tooling/RELEASE.md) covers reviewing a fixed candidate archive and publishing an independent GitHub prerelease.

## Build the independent SDK consumer

For an end-to-end guide connecting plugin builds with the Host inspector, manual loading, and diagnostics, see Tsumugi's [plugin authoring walkthrough](https://github.com/Anpimi/Tsumugi/blob/e0d223f9bcbbca9decad63d62a90aed8510f9cf0/docs/plugin-authoring.md).

With Rust 1.98+ and Python 3.11+:

```sh
python3 tooling/prepare-sdk.py
cargo test --locked
cargo run --locked -p tsumugi-sdk-probe -- tooling/sdk-probe/fixtures/manifest.json
```

Once Cargo dependencies are cached, `cargo test` and `cargo run` also accept `--offline`.

### Pinned SDK snapshot and Process 3 protocol

`sdk.lock.json` pins the experimental `tsumugi-plugin-sdk` `0.1.0-alpha.1` `.crate` archive by SHA-256 and source commit. Each SDK snapshot lives under `artifacts/sdk/<producer-commit>/` so updating the lock never overwrites earlier archives. `prepare-sdk.py` verifies both file bytes and Unix executable permissions when populating `.cache/sdk/` and staging generated JavaScript validators and TypeScript/JSDoc declarations. See [SDK provenance](artifacts/sdk/README.md) for details on what the current archive includes.

The pinned SDK uses **process protocol 3**:

- JavaScript entrypoints register handlers from the frozen `api.contributions` roster via `api.register(id, handler)`. The three default components keep `Project` scope, and the Rust Native worker helper supports singleton components.
- Prebuilt Native workers and JavaScript packages must be built against this SDK snapshot before running on a Process-3 Host (Process-1 and Process-2 workers are rejected).
- The snapshot also provides the `generation-component-input` wrapper, work-plan generation service data types, and declared text-query payload helpers.

## Build a WebVTT package

To test and package `plugins/webvtt` individually with Node `>=26.10.0 <27`:

```sh
node --test plugins/webvtt/tests/*.test.mjs
mkdir -p artifacts/candidates
python3 tooling/package-plugin.py plugins/webvtt artifacts/candidates/webvtt-0.1.0-alpha.1
tsumugi-plugin-package inspect artifacts/candidates/webvtt-0.1.0-alpha.1
```

`package-plugin.py` assembles the files listed in `package-files.json`, the SDK-generated validators, licenses, and `sdk/lock.json` into a new output directory without running lifecycle scripts. You can then validate and fingerprint the directory with `tsumugi-plugin-package inspect`. For details on the WebVTT profile and Host integration, see the [package contracts](plugins/webvtt/docs/contracts.md) and [Host boundary](plugins/webvtt/README.md#host-integration-boundary).

## Package ownership

Each package in this repository is versioned and maintained independently:

- [`plugins/stardew-smapi/`](plugins/stardew-smapi/README.md): Stardew Valley SMAPI flat JSON/JSONC translation plugin. Uses a frozen pnpm lockfile to bundle `jsonc-parser` runtime files and licenses directly into the prebuilt package, supporting source extraction, existing-translation import, semantic and review checks, and locale building.
- [`plugins/webvtt/`](plugins/webvtt/README.md): WebVTT caption plugin supporting profile parsing, cue identity and timing/layout checks, translation import, review checks, and byte-preserving caption builds.
- [`examples/philosophy/`](examples/philosophy/README.md): Format-independent terminology package providing a pinned editorial glossary, deterministic query and text-review capabilities, a Skill and Agent tool selector, a host-rendered query UI contribution, and an optional generation delegate component.
- [`examples/flat-json/`](examples/flat-json/README.md): Native Rust worker example for flat JSON message catalogs. Generates its manifest and resources from a single typed Rust definition and implements extraction, translation import, checks, and locale building over the SDK's `native-worker` protocol.
- `tooling/`: Shared SDK preparation, packaging, compatibility matrix, and release scripts.

See [Contributing](CONTRIBUTING.md) and [SDK provenance](artifacts/sdk/README.md) for development guidelines. Source code in this repository is licensed under the [MIT License](LICENSE).

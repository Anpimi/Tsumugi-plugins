# Contributing

For an end-to-end walkthrough of authoring, packaging, inspecting, and loading a plugin into Tsumugi, start with Tsumugi's [plugin authoring walkthrough](https://github.com/Anpimi/Tsumugi/blob/e0d223f9bcbbca9decad63d62a90aed8510f9cf0/docs/plugin-authoring.md) using a matching Host and SDK snapshot. Within this repository, see:

- [SDK preparation](README.md#build-the-independent-sdk-consumer)
- [Rust JSON example build](examples/flat-json/README.md#build-and-package)
- [WebVTT JavaScript plugin](plugins/webvtt/README.md)
- [Repository-wide candidate build](README.md#build-and-check-all-independent-candidates) (including the `--offline` flag for pre-populated caches)

## Repository scope and package ownership

This repository is the official source and maintenance home for the plugins and examples it contains (`webvtt`, `stardew-smapi`, `philosophy`, and `flat-json`). Third-party plugin authors can develop and host plugins in their own repositories without upstreaming them here.

When maintaining or porting packages:

- Keep each plugin's source repository, publisher, provenance, and maintenance owner clear. Registry metadata or Market listings help users discover packages, and offline signed distribution follows Tsumugi's [signed repository flow](https://github.com/Anpimi/Tsumugi/blob/e0d223f9bcbbca9decad63d62a90aed8510f9cf0/crates/plugin-host/README.md#signed-offline-repositories).
- Keep domain logic and tests inside the owning package directory, and preserve the logical plugin IDs `stardew-smapi` and `webvtt`.
- When porting code from an existing public implementation, record the original repository, source paths, source commit, and initial import commit in `PROVENANCE.md`, and preserve all license notices.

## SDK consumption and boundaries

- **Consume only the pinned public SDK**: Plugins and examples depend strictly on the verified SDK archive selected by `sdk.lock.json` and public conformance tools. Do not import Tsumugi Core, `ProjectStore`, or desktop application internals.
- **Upstream contract changes first**: Protocol and contract updates belong in [Tsumugi](https://github.com/Anpimi/Tsumugi) and arrive here as a new immutable `.crate` archive under `artifacts/sdk/<producer-commit>/`. Retain earlier SDK archives for provenance and never hand-edit generated SDK files or cached artifacts.
- **No install-time code execution**: Package runtime files using `tooling/package-plugin.py` and an explicit `package-files.json` recipe. Do not add lifecycle install scripts, runtime source compilation, or silent fallbacks between plugins.
- **Keep test data clean**: Never commit credentials, personal project data, or build output directories (`artifacts/candidates/`, `.cache/`, `.generated/`).

## Versioning and verification

Each plugin manages its own SemVer version and `CHANGELOG.md` (with `CHANGELOG.zh-CN.md` mirroring the English entries). Packages remain at `0.1.0-alpha.1` while in the initial experimental batch.

When modifying shared tooling or SDK selection, run the checks across all affected packages:

- Run `python3 -m unittest discover -s tooling/tests` to verify SDK preparation, packaging, compatibility, and release scripts.
- Run `tsumugi-sdk-probe` and the domain test suites (`cargo test --locked` and `node --test`) against independent expected fixtures.
- When testing Host integration, always inspect and load the prebuilt package directory produced by the packager rather than pointing the Host at a working source tree.

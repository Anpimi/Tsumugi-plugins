# Changelog

English is authoritative; [简体中文](CHANGELOG.zh-CN.md) mirrors these changes.

## [Unreleased]

## [0.1.0-alpha.1] - 2026-10-23

First [unsigned experimental archive](https://github.com/Anpimi/Tsumugi-plugins/releases/tag/stardew-smapi/v0.1.0-alpha.1) (published in UTC), built from commit `d0e8c826ef099cceeab059c7aed5370034296c54` for the experimental Host commit `e0d223f9bcbbca9decad63d62a90aed8510f9cf0` on macOS aarch64 (`minimum = current`).

### Added

- Snapshot-level source context `note` carrying the manifest's `Name` and its original quoted UTF-8 byte range (when within the 4,096-byte SDK fact limit), paired with a coordinate-free `smapi.manifest-context-basis/1` revision block so manifest whitespace changes alone do not invalidate revisions.
- Source-import Resource at schema/behavior `2/2` referencing the package's immutable `review-profile` Resource.
- Mandatory `review-profile` Resource and `review-check` capability (`smapi.placeholders` and `smapi.format`) using SDK `ReviewCheckInput` and `CheckResults`.
- Standalone JavaScript `smapi-i18n-flat/1` source extraction (`extract-source`) and independent source semantic checking (`source-semantic-check`) with JSONC and BOM support, native key identity, and UTF-8 byte-range evidence.
- Generic SDK locale building (`build`) and independent strict JSON artifact checking (`validate-artifact`), bundling the locked `jsonc-parser` runtime and SDK validators with their licenses.
- Existing-translation extraction (`import-translations`) and whole-file semantic checking (`translation-semantic-check`) for `i18n/<locale>.json`, distinguishing empty objects (`{}`) from empty string values (`""`).

### Changed

- Updated component entrypoint to the Process 3 `contributions` and `register(id, handler)` API with Process 3 component identity for setup and shutdown, retaining `Project` scope.
- Staged SDK helpers and package provenance from the pinned Process 3 SDK snapshot.

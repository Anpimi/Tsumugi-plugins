# Changelog

All notable changes to this example package are recorded here.

## [Unreleased]

### Added

- Existing-translation extraction and independent whole-file semantic checking (`flat-json.translation-semantics`) with exact native keys, locale validation, and empty-object (`{}`) support.
- Native Rust `flat-json-messages` (`1/1`) source extraction, independent source/QA/artifact checking, and locale building built purely on the public Tsumugi SDK.
- Single-source typed Rust generation of the plugin manifest and declarative Resources, packaged via `tooling/package-flat-json.py` with pinned SDK provenance.

### Changed

- Updated the Native worker to reject multi-member activation in the SDK facade before author code runs, keeping the example's singleton component profile.
- Rebuilt the Native worker against the pinned Process 3 SDK snapshot (Process-1/2 worker binaries are rejected by Process-3 Hosts).

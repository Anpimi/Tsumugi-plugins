# Changelog

All notable changes to this experimental example are recorded here.

## [Unreleased]

### Changed

- The public Native facade rejects multi-member activation before author code
  runs; this package continues to use its original singleton profile.

- Rebuild the prebuilt Native worker from the selected public Process-3 SDK.
  Earlier Process-1/2 binaries are refused; the flat catalog profile and same
  undistributed alpha.1 version are unchanged, with no runtime fallback.

### Added

- Captured existing-translation extraction and independent complete-file
  semantic checking with exact native keys, locale evidence and empty-file
  preservation. Core retains source matching and per-entry adoption ownership.
- SDK-only Rust message-catalog extraction, independent source/QA/artifact
  checking and locale building for the current `flat-json-messages` 1/1 profile.
- Typed generation of manifest/resources and explicit prebuilt packaging with
  pinned SDK provenance. No package or application release is implied.

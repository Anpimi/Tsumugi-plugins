# Changelog

All notable changes to this package are documented here.
This package follows Semantic Versioning (`0.1.0-alpha.1` is the initial experimental prerelease).

## [Unreleased]

## [0.1.0-alpha.1] - 2026-10-23

First [unsigned experimental archive](https://github.com/Anpimi/Tsumugi-plugins/releases/tag/webvtt/v0.1.0-alpha.1) (published in UTC), built from commit `d0e8c826ef099cceeab059c7aed5370034296c54` for the experimental Host commit `e0d223f9bcbbca9decad63d62a90aed8510f9cf0` on macOS aarch64 (`minimum = current`).

### Added

- Existing-translation import (`import-translations`) and independent whole-file semantic verification (`translation-semantic-check`) for `translations/<canonical-locale>.vtt`, preserving original file bytes and cue identities.
- Per-cue extracted `time` source-context facts with original UTF-8 byte ranges, verified by the independent source checker while keeping `webvtt.cue-basis/1` as the semantic revision basis (so editing a `NOTE`, newline encoding, or cue byte offset alone does not invalidate unchanged cues).
- Source-import Resource at schema/behavior `2/2` with a required immutable `review-profile` reference.
- Mandatory domain `review-profile` Resource and `review-check` capability (`webvtt.source-structure` and `webvtt.payload`) using SDK `ReviewCheckInput` and `CheckResults`.
- Declarative `source-profile` Resource fixing `source.vtt`, `webvtt-captions/1`, extractor/checker bindings, and revision policy.
- Mandatory source semantic checker (`source-semantic-check`) with an independent JSON oracle verifying full cue coverage, byte ranges, identities, display evidence, and basis blocks.
- JavaScript SDK components for WebVTT source extraction (`extract-source`), byte-range locale building (`build`), and independent artifact checking (`validate-artifact`).
- `webvtt-captions/1` profile supporting explicit ASCII cue IDs, timing and cue settings, and exact byte preservation of BOM, line endings, `NOTE`, `STYLE`, `REGION`, and other non-payload segments.
- Versioned `cue-basis` schema, recoverable domain errors, provenance documentation, and byte-oracle test fixtures.

### Changed

- Updated component entrypoint to the Process 3 `contributions` and `register(id, handler)` API with Process 3 component identity for setup and shutdown, while keeping `Project` scope.
- Staged SDK helpers and package provenance from the pinned Process 3 SDK snapshot.
- Migrated `build` and `validate-artifact` to the generic SDK `BuildInput`, `ArtifactSet`, `BuildDeclaration`, and `CheckResults` contracts, removing earlier dedicated build/check schemas.
- Updated source extraction to emit `tsumugi.content-exchange` schema 2 / behavior 1 with original cue ID display values and UTF-8 byte ranges.

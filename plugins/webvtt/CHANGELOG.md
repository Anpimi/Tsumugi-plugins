# Changelog

All notable changes to this independent package are documented here.
This project follows Semantic Versioning. The first package is experimental.

## [Unreleased]

### Added

- Package-owned SDK source-import resource fixing required material, caption
  profile, independent extraction/checking and mandatory revision/check policy.

- Mandatory fixed-source semantic checking through SDK check requirements/results,
  including a literal source oracle and rejection of forged coverage, ranges,
  identities, display evidence, basis blocks and policy.
- JavaScript SDK components for captured WebVTT source extraction, range-based
  locale building and independent checking of actual artifact bytes.
- Caption profile 1 with explicit ASCII cue identity, timing/settings and preserved
  BOM, newline, NOTE, STYLE, REGION and all other non-payload bytes.
- SDK build/check contracts and versioned basis schema, bounded inputs/results, recoverable domain
  errors, source provenance and fixed byte-oracle/rejection fixtures.

### Changed

- Builds now consume SDK BuildInput and return ArtifactSet. A captured BuildDeclaration makes the independent builder/checker discoverable, and artifact checks return mandatory CheckResults with blocking semantic findings. The previous experimental dedicated build/check JSON is refused without conversion; caption limits and byte fidelity remain unchanged.

- Extraction now emits content-exchange schema 2 / behavior 1, with original cue
  ID display values and UTF-8 byte ranges. Earlier development result shapes are
  refused; consumers must use the same independently selected SDK artifact.

The candidate package version is `0.1.0-alpha.1`; this remains the same unreleased
experimental batch. No release date or completed
application migration is claimed.

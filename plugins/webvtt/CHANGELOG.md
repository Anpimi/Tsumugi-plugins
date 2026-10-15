# Changelog

All notable changes to this independent package are documented here.
This project follows Semantic Versioning. The first package is experimental.

## [Unreleased]

### Added

- Each cue now carries an extracted source-context time fact with its original
  UTF-8 range. The independent source checker rejects missing or forged facts;
  speaker, role and scene remain absent in the plain-text caption profile.
  Revision identity continues to use the semantic cue basis, so changing a
  NOTE, line ending or cue position alone does not expire unchanged cues.

- Source recipes now use schema/behavior 2/2 and require their exact immutable `review-profile` Resource. Consumers must use the newly pinned SDK; earlier experimental recipes are refused without conversion. Source and Review data contracts and the unreleased package version remain unchanged.

- A mandatory review Resource and selected-text QA capability now check fixed source evidence and exact rule versions through SDK CheckResults. Missing text uses only explicitly permitted N/A evidence; source checks continue. Core approval, terminology, fallback, waivers and release eligibility remain separate application responsibilities.

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

- Prepare SDK helpers and package provenance from the selected public Process-2
  SDK snapshot. Use the matching Process-2 Host; caption/domain contracts and the
  same undistributed alpha.1 package version remain unchanged.

- Builds now consume SDK BuildInput and return ArtifactSet. A captured BuildDeclaration makes the independent builder/checker discoverable, and artifact checks return mandatory CheckResults with blocking semantic findings. The previous experimental dedicated build/check JSON is refused without conversion; caption limits and byte fidelity remain unchanged.

- Extraction now emits content-exchange schema 2 / behavior 1, with original cue
  ID display values and UTF-8 byte ranges. Earlier development result shapes are
  refused; consumers must use the same independently selected SDK artifact.

The candidate package version is `0.1.0-alpha.1`; this remains the same unreleased
experimental batch. No release date or completed
application migration is claimed.

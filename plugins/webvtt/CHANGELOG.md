# Changelog

All notable changes to this independent package are documented here.
This project follows Semantic Versioning. The first package is experimental.

## [Unreleased]

## [0.1.0-alpha.1] - 2026-10-23

First [unsigned experimental archive](https://github.com/Anpimi/Tsumugi-plugins/releases/tag/webvtt/v0.1.0-alpha.1), published on the date above in UTC.
Built from `d0e8c826ef099cceeab059c7aed5370034296c54`; supports only the exact
experimental Host `e0d223f9bcbbca9decad63d62a90aed8510f9cf0` on macOS aarch64,
with minimum = current. This publication establishes neither TUF trust nor
automatic bundled-plugin selection.

### Added

- Import existing translated WebVTT captions from an explicitly confirmed language
  file, retaining original bytes and cue identity. Independent mandatory checking
  precedes Core per-entry candidate/selection adoption; source timing and human
  approval remain unchanged. The original caption syntax and limits still apply.

- Each cue now carries an extracted source-context time fact with its original
  UTF-8 range. The independent source checker rejects missing or forged facts;
  speaker, role and scene remain absent in the plain-text caption profile.
  Revision identity continues to use the semantic cue basis, so changing a
  NOTE, line ending or cue position alone does not expire unchanged cues.

- Source recipes now use schema/behavior 2/2 and require their exact immutable `review-profile` Resource. Consumers must use the newly pinned SDK; earlier experimental recipes are refused without conversion. Source and Review data contracts and the alpha.1 package version remain unchanged.

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

- Register the exact callable roster through the public `contributions` and
  `register(id, handler)` API. Setup and shutdown use Process-3 component
  identity; default Project scope and domain behavior remain unchanged.

- Prepare SDK helpers and package provenance from the selected public Process-3
  SDK snapshot. Use the matching Process-3 Host; caption/domain contracts and the
  same alpha.1 package version remain unchanged.

- Builds now consume SDK BuildInput and return ArtifactSet. A captured BuildDeclaration makes the independent builder/checker discoverable, and artifact checks return mandatory CheckResults with blocking semantic findings. The previous experimental dedicated build/check JSON is refused without conversion; caption limits and byte fidelity remain unchanged.

- Extraction now emits content-exchange schema 2 / behavior 1, with original cue
  ID display values and UTF-8 byte ranges. Earlier development result shapes are
  refused; consumers must use the same independently selected SDK artifact.

This plugin archive publication does not declare the complete application migration finished.

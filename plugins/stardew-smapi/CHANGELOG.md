# Changelog

English is authoritative; [简体中文](CHANGELOG.zh-CN.md) mirrors these changes.

## [Unreleased]

## [0.1.0-alpha.1] - 2026-10-23

First [unsigned experimental archive](https://github.com/Anpimi/Tsumugi-plugins/releases/tag/stardew-smapi/v0.1.0-alpha.1), published on the date above in UTC.
Built from `d0e8c826ef099cceeab059c7aed5370034296c54`; supports only the exact
experimental Host `e0d223f9bcbbca9decad63d62a90aed8510f9cf0` on macOS aarch64,
with minimum = current. This publication establishes neither TUF trust nor
automatic bundled-plugin selection.

### Changed

- Register the exact callable roster through the public `contributions` and
  `register(id, handler)` API. Setup and shutdown use Process-3 component
  identity; default Project scope and domain behavior remain unchanged.

- Prepare SDK helpers and package provenance from the selected public Process-3
  SDK snapshot. Use the matching Process-3 Host; SMAPI/domain contracts and the
  same alpha.1 package version remain unchanged.

### Added

- Source extraction now carries the manifest's actual `Name` as a referenced
  snapshot note when it fits the SDK fact limit. Oversized names keep their
  original source import with context unavailable. The independent checker
  rejects omissions, truncation and invented roles or speakers. A separate
  coordinate-free Name basis changes revisions when Name changes, while
  manifest whitespace alone does not.

- Source recipes now use schema/behavior 2/2 and require their exact immutable `review-profile` Resource. Consumers must use the newly pinned SDK; earlier experimental recipes are refused without conversion. Source and Review data contracts and the alpha.1 package version remain unchanged.

- A mandatory review Resource and selected-text QA capability now check fixed source evidence and exact rule versions through SDK CheckResults. Missing text uses only explicitly permitted N/A evidence; source checks continue. Core approval, terminology, fallback, waivers and release eligibility remain separate application responsibilities.

- An independent JavaScript SMAPI flat profile captures source content with native key and original byte-range evidence, and checks the complete proposal separately. The fixed parser retains JSONC and BOM handling with explicit bounded refusals.
- Generic SDK locale builds and separate strict artifact checks preserve complete fixed target coverage, canonical key/value output and named marker rules. The package includes its locked JSONC dependency and public SDK validators with licenses.
- Complete existing-translation extraction retains the current source snapshot, confirmed target, original material and native key references. A separate mandatory checker verifies the whole proposal; empty objects and empty values remain distinct, and unsupported filenames, duplicates and exceeded limits refuse success.

Project matching, per-entry adoption and full desktop migration remain under development.

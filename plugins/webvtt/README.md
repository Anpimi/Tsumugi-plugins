# WebVTT caption plugin

`org.tsumugi/webvtt` (`0.1.0-alpha.1`) is a standalone JavaScript plugin package for the `webvtt-captions/1` profile. It implements source extraction, existing-translation import, source and translation semantic checks, byte-preserving locale builds, artifact validation, and domain review checks using the public Tsumugi SDK and Process 3 Host. It has no third-party runtime dependencies or lifecycle install scripts, and its format operations work purely on in-memory payloads without reading or writing the filesystem.

See [contracts](docs/contracts.md), [manifest](manifest.json), [source provenance](PROVENANCE.md), and [license](LICENSE).

## Supported `webvtt-captions/1` profile

This package targets a well-defined subset of WebVTT rather than full specification coverage:

- **Accepted syntax**: Valid UTF-8 text (with optional leading BOM); LF, CRLF, or CR line endings; explicit printable ASCII cue identifiers; nonempty plain multiline cue text; `NOTE` blocks; and `STYLE` or `REGION` blocks appearing before the first cue (`STYLE` blocks are preserved verbatim without CSS parsing or visual rendering).
- **Cue ordering and settings**: Cue start times must be nondecreasing, end times must be greater than start times, and overlapping cues are allowed. Supported cue settings are `line`, `position`, `size`, `align`, and declared `region`.
- **Rejected syntax**: ASCII case-insensitive duplicate cue IDs (while preserving original case for display), unknown or duplicate cue settings, `vertical`, anonymous cues, inline markup or HTML entities, NUL characters, empty cue payloads, blank lines inside cue payloads, and `-->` inside cue payloads.
- **Size limits**: Up to 128 KiB per source or built file, 2,000 cues per file, and 16 KiB per cue payload.
- **Byte preservation and revision basis**: During locale builds, only cue payload byte ranges are replaced; BOM, headers, notes, timing lines, settings, and separators remain byte-for-byte identical to the source. Source extraction emits a `webvtt.cue-basis/1` semantic revision block and an extracted `time` context fact for each cue. Moving a cue's byte offset (for example, by editing a `NOTE` or changing line endings) updates the `time` fact's byte range without invalidating the cue's revision digest.

## Independent development and packaging

Requires Node `>=26.10.0 <27` and Python 3.11+. The runtime components are standard ESM `.mjs` files with no transpilation step.

From the repository root, prepare the pinned SDK and run the domain test suite:

```sh
python3 tooling/prepare-sdk.py
node --test plugins/webvtt/tests/*.test.mjs
mkdir -p artifacts/candidates
python3 tooling/package-plugin.py plugins/webvtt artifacts/candidates/webvtt-0.1.0-alpha.1
tsumugi-plugin-package inspect artifacts/candidates/webvtt-0.1.0-alpha.1
```

`prepare-sdk.py` extracts the verified `.cache/sdk/` archive and stages the SDK's runtime source-context encoder and standalone structural validators (extraction, source-check, translation, build, and artifact-check) along with their license notices. `package-plugin.py` copies only the files declared in [package-files.json](package-files.json) and the staged SDK files/lock into the output directory, which can then be verified with `tsumugi-plugin-package inspect`.

Note that JavaScript components parse incoming UTF-8 payloads with `JSON.parse`; the host application is responsible for validating arbitrary raw JSON through the SDK's strict Rust receiver before dispatch.

## Host integration boundary

`components/component.mjs` uses the Process 3 SDK entrypoint (`api.instance`, `api.contributions`, and `api.register(contributionId, handler)`) to register the contribution selected by the Host (`extract-source`, `source-semantic-check`, `import-translations`, `translation-semantic-check`, `build`, `validate-artifact`, or `review-check`). All callable components run at **Project** scope.

The package also provides immutable declarative Resources that the Host reads without executing plugin code:

- `source-profile` (`profiles/source-import.json`, schema/behavior `2/2`): Fixes `source.vtt` (128 KiB limit), the `webvtt-captions/1` profile, `extract-source` and mandatory non-waivable `source-semantic-check` contributions, the `webvtt.cue-basis/1` revision policy, and the `review-profile` reference.
- `build-profile` (`profiles/build.json`): Declares generic SDK `BuildInput`/`ArtifactSet` usage, output limits, and the mandatory `validate-artifact` checker.
- `translation-profile` (`profiles/translation-import.json`): Declares existing-translation import for `translations/<canonical-locale>.vtt` and the mandatory `translation-semantic-check` verifier.
- `review-profile` (`profiles/review.json`): Declares the `review-check` capability and mandatory domain review rules.

Payload size budgets across the Host channel are 2 MiB for captured source material and check results, and 4 MiB for `ContentExchange` proposals and combined check/build inputs. Oversized payloads are rejected without truncation. Note that running a Node component in the Host process is not an OS-level security sandbox; package approval, installation, and per-attempt execution consent are managed by the host application.

## Existing translated captions

`translation-profile` imports a single translated file from `translations/<canonical-locale>.vtt` (for example, `translations/zh.vtt`) matching a user-confirmed project target locale with the same base language. While source import requires at least one cue, translation import accepts a valid zero-cue WebVTT file as an empty proposal.

The extractor retains the original file bytes, UTF-8 byte ranges for cue IDs and payloads, and LF-normalized text without Unicode normalization. Cues match source units by explicit cue ID (ASCII case-folded in the `webvtt:source` namespace under `webvtt-cue/1`), never by line order, timing, or source text. The independent `webvtt.translation-semantics/1` checker reparses the file to verify every entry before Core matches entries against the current project source.

## Domain review checks

`review-profile` binds the `review-check` contribution to run standalone QA rules against `ReviewCheckInput` (which carries the original source artifacts alongside selected unit/revision/text entries). It contributes two mandatory rules:

- `webvtt.source-structure`: Verifies original cue identity, semantic basis blocks, and source fidelity.
- `webvtt.payload`: Enforces caption payload byte limits and rejects unsupported markup/entities, NUL bytes, blank lines, and `-->` tokens in translations.

When a selected unit has no translation text, translation-dependent checks require an explicit `notApplicable` (`missing-translation`) basis in the requirement, while source-only checks still run. Core manages human approval, terminology, source fallback, waivers, and release gates on top of these domain check results.

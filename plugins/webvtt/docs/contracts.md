# WebVTT caption contracts

All `ContractRef` declarations in this package use `behaviorVersion: 1`. Source extraction output uses `tsumugi.content-exchange` `schemaVersion: 2`, while all other listed contracts use `schemaVersion: 1`. In the table below, `/1` denotes schema 1 / behavior 1 and `/2:1` denotes schema 2 / behavior 1 (shorthand for documentation only, not part of the `ContractRef.id` string).

Payloads are UTF-8 JSON carried in `EncodedPayload.utf8`. Unknown fields and unsupported versions are rejected. Because JavaScript's `JSON.parse` does not reject duplicate object keys in raw JSON text, the host application validates untrusted JSON inputs through the SDK's strict Rust Serde receivers before passing typed payloads to the component.

| Contribution | Capability | Input | Output | Error |
| --- | --- | --- | --- | --- |
| `extract-source` | `webvtt.extract/1` | `tsumugi.source-extraction-input/1` | `tsumugi.content-exchange/2:1` | `tsumugi.source-extraction-error/1` |
| `source-semantic-check` | `webvtt.source-check/1` | `tsumugi.source-extraction-check-input/1` | `tsumugi.check-results/1` | `tsumugi.source-extraction-error/1` |
| `import-translations` | `webvtt.translation-extract/1` | `tsumugi.translation-extraction-input/1` | `tsumugi.translation-exchange/1` | `tsumugi.source-extraction-error/1` |
| `translation-semantic-check` | `webvtt.translation-check/1` | `tsumugi.translation-extraction-check-input/1` | `tsumugi.check-results/1` | `tsumugi.source-extraction-error/1` |
| `build` | `webvtt.locale-build/1` | `tsumugi.build-input/1` | `tsumugi.artifact-set/1` | `tsumugi.build-error/1` |
| `validate-artifact` | `webvtt.artifact-check/1` | `tsumugi.artifact-check-input/1` | `tsumugi.check-results/1` | `tsumugi.build-error/1` |

Every contribution operates on the `webvtt-captions/1` profile, requests only `captured-input` permissions, and runs serially in a `Project`-scoped worker without filesystem, network, or subprocess access.

## Extraction and cue identity

`extract-source` consumes `SourceExtractionInput` with `sourceSetId`, `sourceLanguage`, and a single verified `CapturedTextArtifact` (`source.vtt`, role `source`, UTF-8 text, and SHA-256).

For each cue, the extractor emits one operation-local unit (`cue-N`), occurrence (`occurrence-N`), and source revision reference (`source-N`):

- **Payload and text**: Each occurrence references the cue payload in `source.vtt` using a half-open `utf8-byte` range. Unit text normalizes CRLF/CR line endings to LF without Unicode normalization.
- **Native identity**: Matching identity uses namespace `webvtt:source`, policy `webvtt-cue/1`, and the ASCII-lowercased cue ID. `display.value` preserves the exact original cue ID casing, and `display.source` records its half-open UTF-8 byte range in `source.vtt`.
- **`webvtt.cue-basis/1` block**: Every occurrence carries a canonical JSON block conforming to [`schemas/cue-basis.schema.json`](../schemas/cue-basis.schema.json) with keys ordered as `version`, `policy` (`webvtt-cue/1`), `nativeId`, `timing`, `settings`, and `layoutDigest`. `layoutDigest` hashes ordered `STYLE` and `REGION` blocks (joined with LF), ignoring `NOTE` blocks, cue indices, and newline style so formatting or note edits do not invalidate unchanged cue revisions.
- **`tsumugi.source-context-facts/1` block**: Every occurrence also includes one extracted `time` fact containing the raw timing token (`start --> end`) and its UTF-8 byte range on the timing line. The `source-profile` revision policy binds only `webvtt.cue-basis/1` for revision digests, so byte-offset shifts in the `time` fact do not trigger revision updates.

## Fixed source semantic checking

`source-semantic-check` verifies `SourceExtractionCheckInput` (`source`, `proposal`, and `requirements`). It requires a single mandatory, non-waivable requirement (`mandatory: true`, `waivable: false`, `notApplicable: null`) for rule `webvtt.source-semantics/1` targeting `[source.sourceSetId]` and bound to `org.tsumugi` / `webvtt` / `0.1.0-alpha.1` (`caption-worker` / `source-semantic-check`).

The checker reparses `source.vtt` from scratch without invoking the extractor:

- Verifies artifact bytes and metadata, profile, source set, language, cue count, occurrence ordering, LF-normalized text, payload byte ranges, canonical and display cue IDs, `webvtt.cue-basis/1` payloads, and `tsumugi.source-context-facts/1` `time` facts.
- Operation-local reference strings (`cue-N`, `occurrence-N`, `source-N`) and array ordering may vary as long as all cross-references are unique and complete.
- Returns `CheckResult[]` with a single entry matching the requirement's `key`, `inputDigest`, `scopeDigest`, and `coveredTargets`. A matching proposal returns `outcome: { kind: "completed", findings: [] }`; a semantic discrepancy returns a blocking error finding (`{ code: "source-mismatch", target: source.sourceSetId, severity: "error" }`). Malformed inputs, mismatched source sets, or mismatched requirements return a `SourceExtractionError`.

## Existing translation extraction and independent checking

Defined in [`profiles/translation-import.json`](../profiles/translation-import.json) (`TranslationImportDeclaration/1`), `import-translations` processes a single `translations/<locale>.vtt` artifact (up to 128 KiB).

- **Locale validation**: The input specifies the import ID, source set/snapshot IDs, the project's target language, and `user-confirmed` language evidence. The `.vtt` filename stem must be a canonical BCP 47 tag (validated via Node ICU) sharing the same base language as the confirmed target locale.
- **Extraction behavior**: A valid WebVTT file with zero cues produces a valid empty proposal. Non-empty files extract LF-normalized cue text, payload byte ranges, and ASCII case-folded cue IDs in the `webvtt:source` / `webvtt-cue/1` namespace while retaining original display casing and ranges.
- **Verification**: `translation-semantic-check` requires one mandatory, non-waivable `webvtt.translation-semantics/1` requirement targeting `input.importId`. It reparses the translation file independently and returns either an empty findings list or a blocking `translation-mismatch` error finding.

## Building

Declared in [`profiles/build.json`](../profiles/build.json) (`BuildDeclaration`), `build` accepts `BuildInput` containing the `source` `ContentExchange`, `targetLanguage`, decided `targets` (one per source unit/revision), an empty `configuration` object, one safe `.vtt` `outputPaths` entry (ASCII basename with a 1–80 character stem), and `outputLimits`.

The builder reparses `source.vtt`, verifies its SHA-256 and `ContentExchange` projection, and substitutes each cue's payload range with the corresponding target text (matched by unit and revision ID). Target line breaks use the source file's newline style (`CRLF`, else `CR`, else `LF`). All non-payload bytes—BOM, headers, `NOTE`/`STYLE`/`REGION` blocks, cue IDs, timing, settings, and separators—are preserved unchanged.

The returned `ArtifactSet` contains a single in-memory artifact (`id: "caption-output"`, `role: "caption"`) with the generated UTF-8 text and its SHA-256 digest.

## Independent artifact checking

`validate-artifact` accepts `ArtifactCheckInput` (`input`, `output`, and one mandatory, non-waivable requirement for `webvtt.artifact-conformance/1` targeting `caption-output`).

Without calling the builder, the checker reparses both the original `source.vtt` and the generated `caption-output`, verifying cue IDs, timing, settings, layout, target payloads, and every non-payload byte segment (including newline sequences). It returns `CheckResults` with zero findings on match or a blocking `artifact-mismatch` error finding on discrepancy.

## Rejections and limits

- **Errors**: Extraction and translation operations return `SourceExtractionError`; build and artifact-check operations return `BuildError` (with a closed error code and optional artifact ID). Error diagnostics are static descriptions that never leak source text, file paths, or environment data.
- **Format limits**: 128 KiB per `.vtt` file, 2,000 cues, and 16 KiB per cue payload in UTF-8 bytes (including newline bytes).
- **Wire budgets**: 2 MiB for captured source, `ArtifactSet`, and `CheckResults`; 4 MiB for `ContentExchange`, `TranslationExchange`, `BuildInput`, and combined check inputs. Payloads exceeding these limits fail immediately without truncation.

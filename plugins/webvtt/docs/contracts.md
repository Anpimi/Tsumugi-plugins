# WebVTT caption contracts

All listed ContractRefs use `schemaVersion: 1` and `behaviorVersion: 1`; `/1`
below is documentation notation and is not part of a ContractRef's `id`.
Inputs and outputs are exact JSON encoded in the SDK `EncodedPayload.utf8`.
Unknown fields and versions are rejected after parsing. JSON.parse does not
reject duplicate keys in original JSON; the application must capture extraction
payloads from SDK-validated typed inputs. SDK strict Serde acceptance and generic
semantic validation remain required for arbitrary raw JSON. No payload grants
execution or adoption.

| Contribution | Capability | Input | Output | Error |
| --- | --- | --- | --- | --- |
| `extract-source` | `webvtt.extract/1` | `tsumugi.source-extraction-input/1` | `tsumugi.content-exchange/1` | `tsumugi.source-extraction-error/1` |
| `build` | `webvtt.locale-build/1` | `webvtt.locale-build-input/1` | `webvtt.locale-build-output/1` | `webvtt.operation-error/1` |
| `validate-artifact` | `webvtt.artifact-check/1` | `webvtt.artifact-check-input/1` | `webvtt.artifact-check-output/1` | `webvtt.operation-error/1` |

Each contribution requires the exact `webvtt-captions/1` profile. Extraction and
building return proposals; checking is read-only. The manifest requests only
`captured-input`. Building returns actual bytes in its payload, not a filesystem
write or a staged-output handle. No services, networking or additional processes
are requested. One project-scoped serial contribution runs per Host process.

## Extraction and cue identity

The SDK owns `SourceExtractionInput`, `SourceExtractionError`, `ContentExchange`,
`CapturedTextArtifact`, text ranges and all common references. This package does
not redefine them. The input selects `sourceSetId` and `sourceLanguage` and
contains exactly one verified artifact: logical path `source.vtt`, role `source`,
with its original well-formed UTF-8 text and actual SHA-256.

Each cue produces one operation-local unit and one occurrence. Unit IDs
`cue-N`, occurrence IDs `occurrence-N` and source revision references `source-N`
are temporary references within this output. They allocate no project identity.
The occurrence points to the captured artifact's original payload using a
half-open `utf8-byte` range. The unit text normalizes CRLF/CR to LF without Unicode
normalization. Native matching identity uses namespace `webvtt:source`, the ASCII
lowercase cue ID and policy `webvtt-cue/1`. The original literal is preserved.

Each occurrence has a required `webvtt.cue-basis/1` domain block. Its exact JSON
contains `version`, `policy` (`webvtt-cue/1`), `nativeId`, original `timing`, ordered
raw `settings` tokens and `layoutDigest`. The [basis schema](../schemas/cue-basis.schema.json)
is owned by this package. The layout digest covers ordered STYLE/REGION lines
with canonical LF separators, excluding NOTE, cue position and file newline
encoding. Changes to notes or newline encoding therefore do not change every
cue's semantic basis. Original layout bytes remain in the captured artifact.
Changing timing/settings, literal ID or global layout changes the cue basis;
matching identical text alone does not establish maintained identity.

## Building

The [input schema](../schemas/locale-build-input.schema.json) fixes:

- `version: 1` and `template: {utf8, sha256}` from independently captured source.
- An explicit `locale` and safe root-level `logicalPath`, for example `zh-CN.vtt`.
- `cues` in exact template order, each containing `ordinal`, `nativeId`,
  `canonicalId`, `sourceText`, `targetText` and the complete captured `basis`.

The application supplies the already decided target text and verifies its
project basis and eligibility before dispatch. These fields do not carry the
application's QA plan, decisions, grants or database handles. Locale syntax here
is a bounded language label; the application owns supported-locale validation.

The builder reparses the captured template, validates its hash and every cue's
coverage/source/basis, and replaces only the original payload byte ranges. It
normalizes target newlines to the template's existing convention: CRLF if present,
otherwise CR if present, otherwise LF. User-saved target text is not mutated.
Every other original byte remains intact, including BOM, notes, timing, settings,
IDs, blank separators and the final terminator. Output is limited to 128 KiB.

The [output schema](../schemas/locale-build-output.schema.json) returns `version`,
`locale`, `logicalPath`, actual `sha256`, exact `utf8`, `cueCount`, and
`builderVersion: "webvtt-locale-build-1"`. An output path is a safe ASCII `.vtt`
basename with a 1–80 character stem, never a directory, source filename or reserved
device name. No file is written by this operation.

## Independent artifact checking

The [check request](../schemas/artifact-check-input.schema.json) contains
`version: 1`, the complete fixed build `input`, and the actual build `output`.
The checker validates metadata/hash/version and reparses both source and actual
output. It verifies all cue identities, timing/settings/layout, decided payloads,
and every inter-payload and trailing byte segment. It never calls the builder or
compares against a builder-generated expected file. It also verifies each changed
payload's exact chosen newline encoding.

The [check result](../schemas/artifact-check-output.schema.json) returns
`version`, `locale`, `logicalPath`, actual `sha256`, `cueCount`, and
`checkerVersion: "webvtt-locale-artifact-1"`. This is a plugin result claim. The
application still performs trusted semantic validation and explicit release
adoption; a successful plugin result cannot authorize itself.

## Rejections and limits

Source errors use the SDK's closed extraction error codes and a captured artifact
reference or `null`. Build/check errors use the package's closed
[operation-error schema](../schemas/operation-error.schema.json). Diagnostics are
static public descriptions, never source excerpts, machine paths or secrets.
Cancellation returns a cancelled domain failure if observed; the Host also
suppresses output after cancellation or close. Unexpected implementation errors
terminate the component channel rather than fabricate a domain success.

The source/output limit is 128 KiB, the cue limit is 2000, and each source/target
payload is at most 16 KiB in actual UTF-8 bytes, including the builder's chosen
newline encoding. Encoded request and result payloads are additionally limited
to 2 MiB and to the parent's stricter invocation budget.
No operation truncates data or returns partial coverage. JSON Schema string
length alone does not prove byte budgets, hashes, safe references or cue fidelity.

# WebVTT caption contracts

All listed ContractRefs use `behaviorVersion: 1`. The extraction output uses
`tsumugi.content-exchange` schema 2; all other listed schemas use version 1. `/1`
below abbreviates schema 1 / behavior 1, and `/2:1` means schema 2 / behavior 1.
These suffixes are documentation notation, not part of a ContractRef's `id`.
Inputs and outputs are exact JSON encoded in the SDK `EncodedPayload.utf8`.
Unknown fields and versions are rejected after parsing. JSON.parse does not
reject duplicate keys in original JSON; the application must capture operation
payloads from SDK-validated typed inputs. SDK strict Serde acceptance and generic
semantic validation remain required for arbitrary raw JSON. No payload grants
execution or adoption.

| Contribution | Capability | Input | Output | Error |
| --- | --- | --- | --- | --- |
| `extract-source` | `webvtt.extract/1` | `tsumugi.source-extraction-input/1` | `tsumugi.content-exchange/2:1` | `tsumugi.source-extraction-error/1` |
| `source-semantic-check` | `webvtt.source-check/1` | `tsumugi.source-extraction-check-input/1` | `tsumugi.check-results/1` | `tsumugi.source-extraction-error/1` |
| `build` | `webvtt.locale-build/1` | `tsumugi.build-input/1` | `tsumugi.artifact-set/1` | `tsumugi.build-error/1` |
| `validate-artifact` | `webvtt.artifact-check/1` | `tsumugi.artifact-check-input/1` | `tsumugi.check-results/1` | `tsumugi.build-error/1` |

Each contribution requires the exact `webvtt-captions/1` profile. Extraction and
building return proposals; checking is read-only. The manifest requests only
`captured-input`. Building returns actual bytes in its payload, not a filesystem
write or a staged-output handle. No services, networking or additional processes
are requested. One project-scoped serial contribution runs per Host process.

## Extraction and cue identity

The SDK owns `SourceExtractionInput`, `SourceExtractionCheckInput`,
`SourceExtractionError`, `ContentExchange`, `CheckRequirement`, `CheckResult`,
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
lowercase cue ID and policy `webvtt-cue/1`. Native identity `display.value` retains
the original literal, while `display.source` points to the exact original ID
using its artifact ID and half-open UTF-8 byte range. Display evidence is required
by this profile and does not replace the canonical matching value.

Each occurrence has a required `webvtt.cue-basis/1` domain block. Its exact JSON
contains `version`, `policy` (`webvtt-cue/1`), `nativeId`, original `timing`, ordered
raw `settings` tokens and `layoutDigest`. The [basis schema](../schemas/cue-basis.schema.json)
is owned by this package. The layout digest covers ordered STYLE/REGION lines
with canonical LF separators, excluding NOTE, cue position and file newline
encoding. Changes to notes or newline encoding therefore do not change every
cue's semantic basis. Original layout bytes remain in the captured artifact.
Changing timing/settings, literal ID or global layout changes the cue basis;
matching identical text alone does not establish maintained identity. The opaque
basis payload uses exact `JSON.stringify` bytes, with properties ordered as
`version`, `policy`, `nativeId`, `timing`, `settings`, `layoutDigest`. The semantic
checker rejects rewritten formatting, duplicate/unknown properties and additional
opaque blocks; it never silently parses them into a different accepted payload.

## Fixed source semantic checking

The SDK-owned check input contains the independently captured `source`, the
proposed complete `proposal`, and captured `requirements`. The generated SDK
validator owns their common structural shape. This capability accepts exactly
one requirement, for rule `webvtt.source-semantics/1`, with the independently
selected provider `org.tsumugi` / `webvtt` / `0.1.0-alpha.1`, component
`caption-worker`, contribution `source-semantic-check`, and fixed package digest.
Its flags must be `mandatory: true`, `waivable: false`, `notApplicable: null`.
Its targets must contain only `source.sourceSetId`, exactly once. Missing, extra,
duplicate, foreign or skippable requirements are invalid inputs.

The verifier reparses the original captured source, without calling the extractor
or using another producer's result as an oracle. It checks unchanged artifact
bytes/metadata, exact profile/source set/language, one unit and occurrence per cue,
full occurrence order, normalized source text, original payload ranges, canonical
identity/policy, literal display and original ID ranges. It accepts different valid
operation-local reference names and unit/block collection order when all references
remain complete. Unit, revision and occurrence references must each be unique.
Every occurrence must have exactly its required basis block at the correct target
with its exact schema, handling and original canonical payload. Additional
relations, protected fragments or opaque blocks are unsupported in this profile.

The result is the SDK standard `CheckResult[]`, containing exactly one result.
`key`, `inputDigest`, `scopeDigest` and `coveredTargets` preserve the captured
requirement. A faithful proposal returns `outcome: {kind: "completed", findings:
[]}`. A semantic mismatch returns completed coverage with an error finding:
`{code: "source-mismatch", target: source.sourceSetId, severity: "error"}`.
Completed coverage can therefore contain a blocker; it is not approval or adoption.
Invalid inputs and observed cancellation return the finite SDK extraction error.
A different source set, profile, language or captured artifact is an invalid
check-input association, rather than a completed domain finding. Common generic
SDK validation remains the application's strict typed-input responsibility.

The component cannot authenticate a supplied package digest. The application must
obtain requirements independently, and the Host must match the result to the
actual selected package, contribution, instance and channel. Requirement data and
a plugin's completed claim grant no permission or project authority. The combined
source/proposal payload each remains bounded by 2 MiB; their combined source-check
input is bounded by 4 MiB. A near-limit
extraction result may not fit when combined with source. Oversized checks are
explicitly refused without truncation or partial coverage.

## Building

The immutable Resource `build-profile` selects the SDK `BuildDeclaration` in
[profiles/build.json](../profiles/build.json), fixing the caption profile, builder,
independent checker, one-artifact/128 KiB limits and mandatory
`webvtt.artifact-conformance/1` rule. The Host reads and binds this declaration
without component execution. It supplies no execution or release authority.

The SDK owns `BuildInput`, `ArtifactSet`, `ArtifactCheckInput`, `CheckResults` and
`BuildError`. The generated standalone validators come from the exact verified
SDK archive; there are no domain-specific replacement wire schemas. Build input
contains a complete `source` ContentExchange, `targetLanguage`, one decided
`targets` entry per source unit/revision, empty `configuration`, one explicit
`outputPaths` entry and the declaration's exact `outputLimits`.

The application fixes project basis, eligible decided text and complete output
choices before dispatch. The builder independently reparses the captured source
artifact, checks its digest and the complete source unit/occurrence/basis
projection, and maps targets by unit/revision rather than array position. No
Core IDs, QA decisions, grants, database handles or directory authority are
passed through the domain contract.

Only original payload byte ranges change. Target newlines use the source's
existing convention: CRLF if present, otherwise CR if present, otherwise LF.
User-saved target text is not mutated. Every other byte remains intact, including
BOM, notes, timing, settings, cue IDs, separators and final terminators.

The returned ArtifactSet binds the fixed profile, source-set and target language.
It contains exactly one artifact: ID `caption-output`, role `caption`, the
requested logical path, literal UTF-8 and its actual SHA-256. The path is a safe
ASCII `.vtt` basename with a 1–80 character stem, never a directory, source
filename or reserved device name. No file is written by this operation.

## Independent artifact checking

ArtifactCheckInput contains the complete fixed build `input`, actual ArtifactSet
`output`, and exactly one captured mandatory, nonwaivable requirement for the
installed `validate-artifact` provider, conformance rule and complete artifact ID.
The checker verifies metadata/hash and reparses both original source and actual
output. It checks all cue identities, timing/settings/layout, decided payloads,
and every inter-payload/trailing byte segment, including exact newline encoding.
It never calls the builder or constructs a builder-derived expected file.

CheckResults repeats the exact fixed key, input/scope digests and covered target.
A completed semantic check returns no findings for faithful output, or an error
finding `artifact-mismatch` targeting `caption-output`. Completed coverage with
an error finding blocks semantic acceptance. Invalid associations, missing
requirements and malformed inputs return typed BuildError instead of fabricated
coverage. The application binds the result to the actual Host provider/channel
and original requirement, persists proof, and separately adopts a release.

## Rejections and limits

Extraction/source-check failures use the SDK SourceExtractionError. Build/check
failures use SDK BuildError, with its closed error code and captured artifact ID
or null. Diagnostics are static public descriptions, never source excerpts,
machine paths or secrets. Cancellation returns a cancelled failure if observed;
the Host also suppresses output after cancellation or close. Unexpected
implementation errors terminate the component channel.

Source/output remain limited to 128 KiB, 2000 cues and 16 KiB per source/target
payload in actual UTF-8 bytes, including the chosen newline encoding. Captured
source/content, ArtifactSet and CheckResults each retain their 2 MiB encoded
ceiling. BuildInput and combined source/artifact-check requests admit 4 MiB,
subject to the Host's fixed invocation budget. Oversized operations are refused
without truncation, partial coverage or fallback to an older protocol.

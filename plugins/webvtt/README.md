# WebVTT caption plugin

The entrypoint uses the current Process3 SDK facade: `api.instance`, the frozen
`api.contributions` roster, and `api.register(contributionId, handler)`. It
registers exactly the members selected by the Host, with no singleton API
fallback. Callable components retain their declared **Project** scope; adapting
the entrypoint does not enable an Application instance or authorize additional
operations. Use the current paired SDK and Host artifacts; older Process2
runtime captures cannot execute this facade.

`webvtt` version `0.1.0-alpha.1` is an independent JavaScript component package for
`webvtt-captions/1`. It extracts captured source and existing translations, builds captions from
explicit decided text, independently checks proposed semantics and actual output through
the same public SDK component facade and process Host. It has no third-party
runtime dependencies or installation
scripts. Its format operations do not read files, write files or access a project.

This is a bounded caption profile, not complete WebVTT support. It accepts valid
UTF-8 with an optional BOM; LF, CRLF or CR; explicit printable ASCII cue IDs;
nonempty plain multiline text; NOTE; and STYLE/REGION before the first cue.
ASCII-case-equivalent duplicate cue IDs are rejected while literals are preserved.
Cue starts are nondecreasing, end must follow start, and overlap is permitted.
Supported settings are `line`, `position`, `size`, `align` and declared `region`.
Unknown/duplicate settings, `vertical`, anonymous cues, markup/entities, NUL,
empty payloads, blank-line payload splitting and structural arrows are rejected.
STYLE content is retained without CSS execution or visual rendering claims.
Existing translated captions use the same bounded syntax through a separately
declared translation-import capability; source and build interpretation is unchanged.

The limits remain 128 KiB per source/built artifact, 2000 cues and 16 KiB per
source/target payload. Only payload ranges change during building. The checker
reparses actual bytes and verifies all non-payload bytes independently of the
builder. The source verifier independently reparses captured source and checks
full cue coverage, text, byte ranges, identity/display and required basis blocks.
It also verifies one extracted, source-referenced time fact per cue without
claiming a speaker or scene from plain caption text. Revision identity uses
the existing semantic cue-basis block; the time fact's changing source offset
does not invalidate an otherwise unchanged cue.
See [contracts](docs/contracts.md), [manifest](manifest.json),
[source provenance](PROVENANCE.md) and [license](LICENSE).

## Independent development and packaging

Use Node `>=26.10.0 <27`. There is no transpilation step: the runtime components
are ESM `.mjs` files. From the plugin repository, prepare the exact selected SDK
with `python3 tooling/prepare-sdk.py`; JSDoc type references resolve only to that
verified `.cache/sdk/` artifact, never another source checkout. Common SDK types
are erased development references. Source context encoding is a runtime import
from the exact pinned SDK helper, staged by `prepare-sdk.py` for source-tree tests
and copied from the verified archive into the candidate package. The public
packager also materializes the SDK-generated standalone extraction, source-check, translation, build and artifact-check
validators and their license from the same verified artifact, recording its lock.
This is a derived SDK dependency, not a hand-edited protocol copy. The component uses JSON.parse:
it does not prove duplicate-key rejection or equivalence to strict Rust SDK
acceptance. The application must serialize typed SDK-validated operation inputs;
arbitrary raw JSON also needs the SDK strict receiver.

From this package directory, run `node --test tests/*.test.mjs` for the domain
unit tests, including literal byte/JSON oracles, malformed sources, forged source
proposals and altered output.
Those tests do not establish a real process channel or an application workflow.
The public repository packager uses [package-files.json](package-files.json) to
include only declared runtime components, schemas and public metadata. The public
Host package inspector owns the actual package digest and complete safe capture;
this package does not implement a competing package hash algorithm. No build or
installation script runs inside a captured package.

## Host integration boundary

The package Resource `source-profile` selects the SDK source-import declaration
in `profiles/source-import.json`. It fixes `source.vtt` with the 128 KiB limit,
the exact caption profile, independent extractor/checker contributions, cue-basis
revision policy and mandatory source-semantic rule before extraction. The Host
reads this immutable resource without executing the component. The application
still selects the directory/runtime and separately authorizes each fixed attempt;
the resource grants no file access or execution permission.

The Resource `build-profile` similarly fixes generic SDK build input/output,
complete output limits and the independent mandatory artifact checker. It lets
installed-capability consumers discover this package without domain-specific
routing. Older experimental build/check JSON is refused. Building and checking
have separate current execution permissions; a semantic error finding prevents
acceptance even though the check completed.

`components/component.mjs` exports the SDK `activate(api)` facade. It registers
exactly one selected contribution: `extract-source`, `source-semantic-check`,
`import-translations`, `translation-semantic-check`, `build`, `validate-artifact`
or `review-check`.
The Host owns transport, identities, cancellation, deadlines and cleanup. The
application independently approves package/runtime bytes, installs and loads
them, chooses the exact contribution/profile, and supplies current execution
permission. Installation and a manifest permission request do not supply that
permission. Required semantic validation and explicit adoption remain separate.
The source-check rule is mandatory and cannot be waived in this profile. A
completed check containing an error finding still blocks semantic acceptance.
Captured requirements must be independent of the proposal, and the Host binds
actual provider/channel evidence. Source and proposal together must fit the
4 MiB check-input limit; captured source retains its 2 MiB limit and the
complete context-bearing proposal has a 4 MiB content limit.
Oversized combinations are rejected without truncation.

The current component is not an OS sandbox. A Node process can access operating
system APIs under its user account; facade restrictions are not a security sandbox
claim. Desktop selection, project adoption, full domain cutover and distribution
have their own integration requirements. No fallback to an embedded parser is
provided by this package.

## Existing translated captions

The Resource `translation-profile` declares one captured file from
`translations/<canonical-locale>.vtt`, such as `translations/zh.vtt`. The user
confirms an existing project target locale with the same base language; the
filename remains separate language evidence and never creates a project locale.
The same 128 KiB/file, 2000-cue and 16 KiB/payload limits apply. A valid empty
WebVTT file yields zero entries; source import still requires at least one cue.

The extractor preserves the complete original file and payload/ID UTF-8 ranges.
Entry text uses LF, without Unicode normalization. Matching uses explicit cue IDs
with ASCII case folding in the original `webvtt:source` namespace and `webvtt-cue/1`
policy. The independent mandatory `webvtt.translation-semantics/1` checker
reparses the captured file and rejects altered, missing or extra evidence. Import
does not match by text, line order or timing, and never updates the source timeline.
Core separately reports missing/unmatched/conflicting entries and requires an
explicit per-entry candidate or selection decision. Import grants no human
approval, QA qualification, execution permission or release eligibility.

## Domain review checks

The source-import Resource uses schema/behavior 2/2 and names this package's
exact `review-profile` as `reviewResource`. Applications capture that selection
with the source; reading metadata grants no checker execution or approval.

The `review-profile` Resource declares the exact `review-check` capability and
mandatory rule versions. Its SDK ReviewCheckInput retains complete original
source evidence plus an explicit selected unit/revision/text scope. This checker
runs separately from source extraction and checking actual built artifacts.
It returns SDK CheckResults with exact captured keys, digests and target coverage.
Missing selected text needs an explicitly captured N/A basis for a rule that
depends on translation; source-only rules still run. Missing requirements, wrong
versions/providers and out-of-scope selections refuse success.

The package contributes `webvtt.source-structure` (original cue identity/basis
and complete source fidelity) and `webvtt.payload` (the existing caption text
limits, unsupported markup/entities, NUL, blank blocks and timing arrows).

Core independently fixes its mandatory rules and owns manual approval, empty
selected-translation policy, terminology, source-fallback decisions, waivers and
release eligibility. Plugin checks cannot replace those rules or approve a
release. Actual Core/Desktop Review integration remains in development. This
remains the same unpublished plugin `0.1.0-alpha.1` batch, without a release or
historical development-format migration.

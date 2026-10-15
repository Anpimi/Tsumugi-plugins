# SMAPI flat translation package

Experimental independent package `org.tsumugi/stardew-smapi` `0.1.0-alpha.1`.
It consumes the pinned public SDK and runs through the same JavaScript component
Host as other packages. No Core, project database, Mod DLL or game is loaded.

## Build and test

Use Node `>=26.10.0 <27`, pnpm 12.8.1 and Python 3.11 or newer. From the repository:

```sh
python3 tooling/prepare-sdk.py
pnpm --dir plugins/stardew-smapi install --frozen-lockfile --ignore-scripts
pnpm --dir plugins/stardew-smapi build
pnpm --dir plugins/stardew-smapi test
mkdir -p artifacts/candidates
python3 tooling/package-plugin.py plugins/stardew-smapi artifacts/candidates/stardew-smapi-0.1.0-alpha.1
tsumugi-plugin-package inspect artifacts/candidates/stardew-smapi-0.1.0-alpha.1
```

The package recipe retains generated SDK validators, exact SDK provenance,
`jsonc-parser` runtime files and licenses. Prepared dependencies are ordinary
files and differing prepared files are refused. Export uses the shared packaging
owner's bounded, link-refusing capture. No package installation script runs.
A prebuilt package does not need pnpm, Python, a developer checkout or external
`node_modules`; its selected Host/runtime is independently approved and captured.
Inspection and installation do not grant worker execution or project adoption.

## Supported candidate profile

`smapi-i18n-flat/1` receives exactly `manifest.json` (companion, at most 16 KiB)
and `i18n/default.json` (source, at most 128 KiB), with explicitly supplied source
language and exact artifact hashes. UTF-8 text may have one leading BOM; JSON
comments and trailing commas are allowed. Single quotes, loose property names,
missing commas, duplicate properties including ASCII case conflicts, nesting
beyond sixteen levels, non-string flat values and empty source objects are
refused. The complete manifest is retained, not executed. Printable ASCII native
keys and UniqueID retain the preceding limits; Unicode values and empty values
are preserved. `$schema` is retained in raw source, without becoming a text unit.
At most 2000 entries and 16 KiB per decoded text are admitted.
Extraction adds one snapshot-level source context `note` containing the actual
manifest `Name`, referenced by its original quoted UTF-8 byte range. The separate
source checker reparses the manifest and rejects omitted, forged or additional
facts. Keys and namespace supply native identity only; they do not imply a
speaker, role, scene or character. The fact is encoded with the pinned SDK helper,
staged for source-tree tests by `prepare-sdk.py` and packaged from that artifact.
One separate snapshot `smapi.manifest-context-basis/1` block records the decoded
Name without a source coordinate. It is the only selected context revision basis;
the fact retains the precise source reference for inspection and checking.
Manifest whitespace can move the fact's range without invalidating revisions;
a changed Name changes the semantic basis. The canonical basis payload is
`{"version":1,"name":"..."}` as described by the packaged
[schema](schemas/manifest-context-basis.schema.json).
If `Name` exceeds the SDK fact's 4096-byte text limit, extraction still retains
the complete source and omits both context blocks. Omission means unavailable
context, not an empty observation; the checker rejects a partial or invented
replacement fact or revision basis.

Every native key remains an independent unit, with actual quoted token ranges in
original UTF-8 bytes and `smapi-native-key/1` identity evidence. No sharing or
rename/continuation is inferred from equal text. Source semantic checking reparses
fixed files and inspects complete coverage, text, identity and ranges. A manifest
version template emits `source-template`, a warning that installed Mod
compatibility was not verified.

`build` consumes SDK BuildInput with empty configuration, complete fixed target
revisions and one explicit safe `i18n/<locale>.json` path matching the target's
base language. Project metadata owns registered/supported locales; this package
also checks well-formed canonical spelling using the fixed Node runtime's ICU.
It returns one translation artifact, at most 1 MiB, with canonical
ordered JSON and its exact digest. New JSON output has no source formatting or
comment preservation promise. The separately invoked artifact checker reparses
actual strict JSON, checks every ordered key/value and canonical token boundary,
and compares named marker inventories and control-character restrictions. It
never uses the builder's output as its expected oracle. Fixed independent
`smapi.artifact-conformance` evidence remains mandatory.

`import-translations` consumes SDK TranslationExtractionInput for one complete
captured `i18n/<locale>.json`, at most 128 KiB, with the current source set/snapshot,
explicit project target and fixed native namespace/policy. The domain validates
canonical filename spelling and matching base language, retains the filename's
declared language separately, and never creates a project language. Registered
language membership, current adopted source and actual user confirmation belong
to the application; the `user-confirmed` wire value is evidence, not a grant.
`default.json`, nested paths, duplicate keys, invalid text and over-limit files
are refused. Empty objects retain a complete zero-entry proposal; empty strings
remain actual values. The proposal keeps original artifacts, native spellings,
quoted UTF-8 references and complete entry order without allocating project units
or revisions. The separately invoked `translation-semantic-check` reparses the
original whole file and verifies all values, keys, references, scope and coverage
under the mandatory `smapi.translation-semantics` rule. Completed check coverage
with an error finding still blocks adoption.

## Integration boundary

The `source-profile`, `translation-profile` and `build-profile` resources use
SDK-owned declarations. Six contributions perform source extraction/checking,
complete translation extraction/checking and locale building/artifact checking.
The domain supplies translation data and filename evidence; application locale
confirmation, current-project matching, candidates/conflicts, per-entry adoption
and uncertain-outcome recovery remain application/Core integration work.
Discovery outside the exact declared
materials, source-update project adoption and final production cutover remain
application integration work. This candidate does not complete SMAPI migration
or claim a release, Windows runtime support, OS isolation or game compatibility.

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

The package contributes `smapi.placeholders` (named marker names/counts) and
`smapi.format` (marker syntax, source fidelity and unsupported control characters).
Malformed marker inventories remain unavailable and format findings block.

Core independently fixes its mandatory rules and owns manual approval, empty
selected-translation policy, terminology, source-fallback decisions, waivers and
release eligibility. Plugin checks cannot replace those rules or approve a
release. Actual Core/Desktop Review integration remains in development. This
remains the same unpublished plugin `0.1.0-alpha.1` batch, without a release or
historical development-format migration.

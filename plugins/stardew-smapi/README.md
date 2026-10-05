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

# SMAPI flat translation package

`org.tsumugi/stardew-smapi` (`0.1.0-alpha.1`) is a standalone JavaScript plugin package for Stardew Valley SMAPI `smapi-i18n-flat/1` translation packs. It consumes the pinned public Tsumugi SDK and runs in the Process 3 JavaScript Host (`api.instance`, `api.contributions`, and `api.register(contributionId, handler)` at **Project** scope) without loading Core, a project database, mod DLLs, or the game runtime.

## Build and test

Requires Node `>=26.10.0 <27`, pnpm 12.8.1, and Python 3.11+. From the repository root:

```sh
python3 tooling/prepare-sdk.py
pnpm --dir plugins/stardew-smapi install --frozen-lockfile --ignore-scripts
pnpm --dir plugins/stardew-smapi build
pnpm --dir plugins/stardew-smapi test
mkdir -p artifacts/candidates
python3 tooling/package-plugin.py plugins/stardew-smapi artifacts/candidates/stardew-smapi-0.1.0-alpha.1
tsumugi-plugin-package inspect artifacts/candidates/stardew-smapi-0.1.0-alpha.1
```

`pnpm --dir plugins/stardew-smapi build` stages the locked `jsonc-parser` runtime files, SDK-generated validators, and license notices as ordinary files so the prebuilt package runs without `node_modules`, pnpm, or lifecycle scripts.

## Supported `smapi-i18n-flat/1` profile

### Source extraction and checking

Source extraction accepts two verified artifacts—`manifest.json` (companion, up to 16 KiB) and `i18n/default.json` (source, up to 128 KiB)—along with the source language:

- **JSONC syntax and limits**: Allows an optional leading UTF-8 BOM, line/block comments, and trailing commas. Single-quoted strings, unquoted property names, missing commas, duplicate keys (including ASCII case-insensitive collisions), objects nested deeper than 16 levels, non-string flat values, and empty `default.json` objects are rejected.
- **Keys and entries**: Accepts up to 2,000 entries and 16 KiB per decoded string. Native keys and `UniqueID` must be printable ASCII; Unicode string values and empty strings (`""`) are preserved. `$schema` is kept in the raw source artifact without becoming a translatable unit. Each key forms an independent unit (`smapi-native-key/1`) with original quoted UTF-8 byte ranges.
- **Manifest context note and revision basis**: When the manifest's `Name` fits within the SDK's 4,096-byte fact limit, extraction emits a snapshot-level `note` fact referencing the quoted `Name`'s UTF-8 byte range, plus a coordinate-free `smapi.manifest-context-basis/1` revision block (`{"version":1,"name":"..."}`, defined in [`schemas/manifest-context-basis.schema.json`](schemas/manifest-context-basis.schema.json)). Because only the coordinate-free basis block participates in revision hashing, whitespace edits in `manifest.json` do not invalidate revisions, whereas changing `Name` does. If `Name` exceeds 4,096 bytes, both blocks are omitted so the source still imports cleanly.
- **Independent source checking**: `source-semantic-check` reparses `manifest.json` and `i18n/default.json` to verify every unit, text, native key, byte range, and context block. If `manifest.json` uses a version template placeholder (such as `%ProjectVersion%`), the checker emits a `source-template` warning.

### Locale building and artifact checking

- `build` consumes SDK `BuildInput` (empty configuration, complete decided target texts, and a safe `i18n/<locale>.json` path whose canonical BCP 47 tag shares the target's base language) and outputs a single canonical, sorted JSON artifact (up to 1 MiB) with its SHA-256 digest. Source comments and custom whitespace are not carried over into built JSON files.
- `validate-artifact` independently parses the generated strict JSON output and verifies key ordering, values, token boundaries, named placeholder inventories, and control-character rules under the mandatory `smapi.artifact-conformance` requirement.

### Existing translation import

- `import-translations` consumes `TranslationExtractionInput` for a single `i18n/<locale>.json` file (up to 128 KiB) paired with the current source snapshot and a `user-confirmed` project target language. It rejects `default.json`, nested paths, duplicate keys, invalid syntax, and oversized files. An empty JSON object (`{}`) yields a valid zero-entry proposal, while empty strings (`""`) are preserved as translated values.
- `translation-semantic-check` reparses the translation file from scratch under the mandatory `smapi.translation-semantics` rule to verify all keys, values, UTF-8 ranges, and scope before Core matches entries against the project.

## Domain review checks and integration boundary

The `source-profile` Resource (schema/behavior `2/2`), `translation-profile` Resource, `build-profile` Resource, and `review-profile` Resource declare all six format contributions plus the `review-check` capability using standard SDK contracts.

`review-profile` runs standalone QA checks on `ReviewCheckInput` (original source evidence plus selected unit/revision/text entries) and provides two mandatory rules:

- `smapi.placeholders`: Verifies that named `{{placeholder}}` token names and counts match between source and translation.
- `smapi.format`: Validates placeholder syntax, source fidelity, and control-character restrictions.

Missing translations require an explicit `missing-translation` N/A basis on translation-dependent rules, while source-only rules still execute. Host package inspection, runtime approval, locale confirmation, project unit matching, per-entry adoption, and release gating are handled by the host application and Tsumugi Core.

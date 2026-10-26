# Pinned SDK consumer artifact

This directory stores immutable `.crate` source archives of `tsumugi-plugin-sdk` (`0.1.0-alpha.1`, MIT-licensed), produced from the [Tsumugi repository](https://github.com/Anpimi/Tsumugi). Because the experimental SDK is not published to `crates.io`, checking the archive into this repository lets plugins and examples build self-contained without a sibling Tsumugi checkout or unpublished Git dependencies.

## Archive management and provenance

- **Single source of truth**: Tsumugi owns all SDK contracts, schemas, and generated validators. Never modify files inside an archive or maintain hand-written copies of SDK types in plugin directories.
- **Immutable snapshots**: Each SDK snapshot is stored at `artifacts/sdk/<producer-commit>/<package>-<version>.crate`. Earlier archives are kept intact for provenance.
- **Exact selection**: [`sdk.lock.json`](../../sdk.lock.json) pins the active archive's path, SHA-256 digest, producer repository, and source commit. `tooling/prepare-sdk.py` verifies the archive digest, extracts its contents into `.cache/sdk/`, verifies existing cache files and executable flags, and stages generated JavaScript helpers and license notices for packaging. Third-party Rust dependencies are fetched separately via Cargo using the committed `Cargo.lock`.

## Capabilities in the current SDK snapshot

The active `0.1.0-alpha.1` snapshot uses **process protocol 3** (`manifestVersion: 1`) and provides both the Rust API and generated JavaScript declarations/standalone validators for:

- **Process 3 component runtime and Native worker**:
  - Freezes a component capability roster (`contributions`) and separates the component instance principal from per-invocation providers.
  - JavaScript components register handlers via `api.register(id, handler)` while retaining their declared scope (`Project` by default, or `Attempt` for generation delegates).
  - The optional Rust `native-worker` feature provides framing, invocation identity, cooperative cancellation, and disposal through the `NativeComponent` trait (with an empty service table and singleton component activation). Prebuilt Native workers must be compiled against this Process-3 SDK; earlier Process-1/2 binaries and environment descriptors are rejected.
- **Source extraction and source-import resources**:
  - Rust and JavaScript contracts for `SourceExtractionInput`, `ContentExchange` (schema 2 / behavior 1), original identity display evidence, source-context facts, and standalone extraction/source-check validators.
  - Source-import Resource declarations at schema/behavior `2/2`, requiring a same-package immutable `reviewResource` reference and fixing source and review providers per profile.
- **Existing-translation import**:
  - Contracts and validators for `TranslationExtractionInput`, `TranslationExchange`, `TranslationImportDeclaration`, and whole-file translation semantic checking.
- **Generic locale build and artifact checking**:
  - `BuildInput`, `ArtifactSet`, `ArtifactCheckInput`, `CheckResults`, `BuildDeclaration`, and `BuildError`, along with standalone JavaScript structural validators.
- **Domain review and text review**:
  - `ReviewCheckInput`, `ReviewDeclaration` / `ReviewBinding`, and `ReviewCheckError` for mandatory domain review rules (`webvtt` and `stardew-smapi`).
  - `tsumugi.text-review-input` (`1/1`) and `tsumugi.text-review-report` (`1/1`) for advisory concept checks (`philosophy`).
- **Capability tools, text queries, and work-plan generation**:
  - Read-only capability tool selector (`tsumugi.capability-tool-declaration` `1/1`) with profile, Resource, and Skill references, plus `createToolQuery` payload preparation helpers.
  - Work-plan generation service data contracts (`1/1` input, child-identity receipt, and finite errors) and the `generation-component-input` (`1/1`) wrapper that pairs a prepared terminology query with a Core generation request.

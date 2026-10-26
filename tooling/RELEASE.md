# Review and publish one experimental plugin

`tooling/release-plugin.py` prepares and publishes unsigned experimental plugin archives (`webvtt` or `stardew-smapi`) as independent GitHub prereleases (`latest=false`).

The release workflow is split into two distinct phases:

1. **`prepare` (offline review bundle)**: Verifies a completed candidate build report, package archive, Host inspector binary, and compatibility matrix reports, then writes a self-contained review directory and prints its `release-plan.json` SHA-256 digest.
2. **`publish` (dry-run by default, `--execute` to publish)**: Verifies the prepared directory against the reviewed plan digest and, when `--execute` is passed by an authorized operator, creates the GitHub prerelease, uploads the assets, verifies their downloaded bytes, and publishes the tag.

Each plugin is released under its own tag namespace (for example, `webvtt/v0.1.0-alpha.1` and `stardew-smapi/v0.1.0-alpha.1`). Releasing one plugin does not require republishing unchanged plugins.

## Security and operational boundaries

- **No build or worker execution during release**: `release-plugin.py` never rebuilds packages, runs package lifecycle scripts, or executes plugin Workers. During `prepare`, it copies the approved `tsumugi-plugin-package` binary into a temporary directory and runs `inspect-archive` on the `.tar` file; during `publish`, it does not run the inspector at all.
- **Run from a trusted checkout**: Always run `release-plugin.py` from a reviewed commit of this repository. CI pull-request workflows remain read-only and never receive publication tokens.
- **Caller declarations**: The script checks consistency across the build report, compatibility reports, SDK lock, and archive digests, while the operator is responsible for reviewing the source commit, CI provenance, and public availability of the declared Host commit.

## 1. Prepare a reviewed selection

Create a selection JSON file (paths are resolved relative to the selection file unless absolute). Replace all angle-bracket placeholders below with actual reviewed values:

```json
{
  "formatVersion": 1,
  "reviewed": true,
  "plugin": {
    "publisher": "tsumugi",
    "id": "webvtt",
    "version": "0.1.0-alpha.1"
  },
  "sourceCommit": "<40 lowercase hex digits: actual build checkout>",
  "buildReport": "candidate-build.json",
  "archive": "webvtt.tar",
  "archiveSha256": "<64 lowercase hex digits: original tar bytes>",
  "packageDigest": "<64 lowercase hex digits: Host package identity>",
  "sdkArtifact": {
    "version": "<exact selected SDK version>",
    "sourceCommit": "<40 lowercase hex digits: SDK producer>",
    "sha256": "<64 lowercase hex digits: SDK archive>",
    "archive": "<exact archive path from the complete SDK lock>"
  },
  "compatibilityReports": [
    "paired/compatibility-matrix.json",
    "declared/compatibility-matrix.json"
  ],
  "hostSupport": {
    "repository": "https://github.com/Anpimi/Tsumugi",
    "commit": "<40 lowercase hex digits: exact supported Host>",
    "platform": {
      "operatingSystem": "macos",
      "architecture": "aarch64"
    },
    "minimumIsCurrent": true
  },
  "inspector": {
    "binary": "tsumugi-plugin-package",
    "sha256": "<64 lowercase hex digits: approved executable>",
    "declaredHostCommit": "<same 40-digit supported Host commit>"
  },
  "bootstrap": {
    "reviewed": true,
    "reason": "No published Process-3 plugin baseline exists."
  }
}
```

Note: `sdkArtifact` in a real selection file must be the **complete JSON object** from `sdk.lock.json` (including `formatVersion`, `package`, `sourceRepository`, `license`, and `publishedToCratesIo`), matching the build report, compatibility reports, and packaged `sdk/lock.json`.

Run `prepare` to create a new review directory:

```sh
python3 tooling/release-plugin.py prepare \
  --selection review/selection.json \
  --output review/prepared-webvtt
```

### What `prepare` verifies

- **Clean candidate build**: `candidate-build.json` must be from a clean checkout (`sourceDirty: false`) with passing Python, Rust, and Node test suites, matching `archiveSha256`, `packageDigest`, and `sdk/lock.json`.
- **Compatibility matrix evidence**: `compatibilityReports` must provide passing `two-domain-core-adoption-v1` journeys for both `paired-candidates` and `candidate-plugins-declared-host` against the exact source commit, package digest, SDK lock, and declared macOS aarch64 Host (`minimumIsCurrent: true`).
- **First-publication bootstrap**: Before an initial public release exists for a protocol baseline, `candidate-host-released-plugins` cannot run against published URLs. Providing a reviewed `bootstrap` object allows publishing the initial prerelease while `candidate-host-released-plugins` is `not-run` (matrix status `incomplete`). Once published release archives exist and all three matrix classes pass, set `"bootstrap": null` (`release-plugin.py` rejects a bootstrap waiver if released-plugin evidence is already present).

### Contents of the prepared directory

`prepare` writes the following files into the output directory and prints the SHA-256 digest of `release-plan.json`:

- `<plugin>-<version>.tar` (exact copy of the original archive bytes)
- `release-plan.json` (binds all uploaded asset filenames, sizes, and SHA-256 digests)
- `sdk-lock.json` and `inspection.json`
- `compatibility.json` and `build-summary.json` (sanitized summaries without local paths, raw command lines, logs, or binaries)
- `release-notes.md`

Record the printed `release-plan.json` SHA-256 digest outside the prepared directory before proceeding to publication.

## 2. Dry-run and publish

`publish` uses the official `gh` CLI via direct `argv` calls targeting `github.com/Anpimi/Tsumugi-plugins` (ignoring `GH_HOST` overrides).

First, run a local dry-run (the default when `--execute` is omitted), which re-verifies all prepared assets and writes a receipt without invoking `gh` or touching the network:

```sh
python3 tooling/release-plugin.py publish \
  --prepared review/prepared-webvtt \
  --expected-plan-sha256 <reviewed-plan-digest> \
  --output review/publication-dry-run
```

Once authorized to publish the reviewed plan, run with `--execute`:

```sh
python3 tooling/release-plugin.py publish \
  --prepared review/prepared-webvtt \
  --expected-plan-sha256 <reviewed-plan-digest> \
  --output review/publication-attempt \
  --execute
```

When `--execute` is passed, `release-plugin.py` performs the following remote steps:

1. Verifies that `sourceCommit` exists on `github.com/Anpimi/Tsumugi-plugins` and confirms that no tag or release (including drafts, checked via GraphQL and REST) already exists for `<id>/v<version>`.
2. Creates a draft prerelease targeting `sourceCommit` with `latest=false`.
3. Uploads the reviewed assets from the captured attempt directory without overwrite flags.
4. Downloads every uploaded asset from the draft release and verifies that its size and SHA-256 match `release-plan.json`.
5. Publishes the prerelease and verifies the final release metadata, asset digests, and tag commit.

## Failure handling and recovery

Each `publish` invocation writes `events.jsonl`, `receipt.json`, and a captured upload directory under `--output`. Receipt statuses are:

- `dry-run`: Local verification succeeded; no remote calls were made.
- `blocked`: A precondition failed before any remote mutation occurred.
- `outcome-unknown`: A remote mutation was started (recorded before execution in `events.jsonl`) and failed or timed out before final verification completed. The script performs a read-only reconciliation check and records the observed GitHub state in `receipt.json`.
- `published`: All upload, readback, and final tag checks succeeded.

If an attempt ends in `outcome-unknown`, inspect `receipt.json` and the GitHub release state before retrying. Standard `publish` runs refuse existing tags or drafts. If the previous attempt only created an **empty draft prerelease** (zero uploaded assets and no Git tag), you can resume from that draft in a new output directory using `--recover-empty-draft <database-id>` together with `--expected-plan-sha256` and `--execute`.

## Running the release tool tests

```sh
python3 -m unittest discover -s tooling/tests -p test_release_plugin.py -v
```

This unit test suite exercises selection validation, byte-change detection, `gh` command construction, draft/upload/readback sequencing, conflict handling, and `--recover-empty-draft` using synthetic fixtures and a mock `gh` state model.

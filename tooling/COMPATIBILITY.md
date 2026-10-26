# Pinned Host compatibility matrix

This guide explains how to run the compatibility matrix that verifies prebuilt `webvtt` and `stardew-smapi` plugin packages against a pinned Tsumugi Host commit and an approved JavaScript runtime.

Running the matrix produces its own report (`compatibility-matrix.json`) without modifying the `runtimeCompatibility: "not-run"` field recorded during an earlier standalone candidate build. For background on candidate builds and SDK preparation, see the [English README](../README.md) and [Chinese README](../README.zh-CN.md).

## Declared experimental macOS endpoint

[`compatibility/macos-aarch64.json`](../compatibility/macos-aarch64.json) defines the active compatibility policy for macOS arm64 (`aarch64`):

- **Pinned Host and runtime**: Selects one exact public Tsumugi Host commit (`minimum = current`) and an approved macOS arm64 Node runtime descriptor.
- **Pinned candidate and released archives**: Records the SDK lock digest, the pinned candidate build commit and `.tar` digests, and the published GitHub release URLs and digests for `webvtt` and `stardew-smapi`.

During CI, `prepare-compatibility.py` fetches those pinned archives with a read-only token, checks out the declared Tsumugi Host commit, builds its JavaScript deployment, prepares the runtime descriptor, inspects and unpacks the plugin archives through the Host's package tools, and runs all three compatibility classes.

When bootstrapping before a first public release exists, setting `releasedBaseline: "not-selected"` leaves the released-plugins row as `not-run` and exits with status `incomplete` (exit code `2`). Once released archives are selected in the policy, all three combination kinds must pass (exit code `0`).

## Run a local matrix

Create a `formatVersion: 1` matrix JSON file and run `compatibility-matrix.py` from the repository root with Python 3.11+:

```sh
mkdir -p artifacts/compatibility/runs
python3 tooling/compatibility-matrix.py \
  --matrix artifacts/compatibility/selection.json \
  --output artifacts/compatibility/runs/local-001
```

The `--output` directory must not already exist (its parent directory must exist). The script writes `compatibility-matrix.json` along with per-row Host reports and logs. Pass `--offline` if the selected Host checkout already has a populated Cargo cache; note that `--offline` applies to Cargo inside the Host harness and does not disable HTTPS downloads for matrix rows that specify remote URLs.

### Path resolution and archive validation

- **Local paths**: `directory`, `tool`, `host`, and `approval` paths are resolved relative to the directory containing the matrix JSON file. A local Host `directory` must be a Git checkout whose `HEAD` matches `host.commit`.
- **Remote archives**: Remote packages and runtimes use uncompressed `.tar` archives over HTTPS paired with a 64-character lowercase hex transport `sha256`. The runner rejects URLs with credentials or fragments, non-HTTPS redirects, digest mismatches, non-regular files, unsafe paths, or archives exceeding file-count and byte limits.

### Combination kinds

A matrix file can define between 1 and 16 uniquely named rows across three required kinds:

| `kind` | Description |
|---|---|
| `candidate-host-released-plugins` | Tests a candidate Host commit against the published `webvtt` and `stardew-smapi` release archives. Requires `sourceDirty: false`. |
| `candidate-plugins-declared-host` | Tests candidate `webvtt` and `stardew-smapi` packages against the declared supported Host commit. |
| `paired-candidates` | Tests a paired Host commit, plugin source commit, SDK lock, candidate package pair, and approved runtime together. |

Full coverage requires at least one passing row for each of the three kinds. Every runnable row tests both `webvtt` and `stardew-smapi`.

## Matrix fields and template

Each runnable combination includes `id`, `kind`, `host`, `plugins`, and `runtime`:

- `host`: Either a local `directory` plus 40-hex `commit`, or `repository` (`https://github.com/Anpimi/Tsumugi`) plus `commit`.
- `plugins`: Contains `sourceCommit` (40-hex string), `sourceDirty` (boolean; must be `false` for `candidate-host-released-plugins`), `sdkArtifact` (the complete, unabridged JSON object from the package's `sdk/lock.json`), and `packages` for both `webvtt` and `stardew-smapi`.
- `packages.<id>`: Specifies either a local `directory` or an `archive` (`url` and transport `sha256`), along with the Host-computed `packageDigest` (from `tsumugi-plugin-package inspect`) and `plugin` identity (`publisher`, `id`, `version`).
- `runtime`: Either local `tool`, `host`, and `approval` paths, or an HTTPS `.tar` `archive` containing `tool/`, `host/`, and `approval.json` at its root. The runtime and `approval.json` must match the Host's Process 3 protocol and the current OS/CPU platform.

Below is an illustrative template showing all required fields and two `not-run` placeholder rows (replace angle-bracket placeholders with real values before running):

```json
{
  "formatVersion": 1,
  "combinations": [
    {
      "id": "paired-local-example",
      "kind": "paired-candidates",
      "host": {
        "directory": "../host-checkout",
        "commit": "<EXACT_40_HEX_HOST_COMMIT>"
      },
      "plugins": {
        "sourceCommit": "<EXACT_40_HEX_PLUGIN_SOURCE_COMMIT>",
        "sourceDirty": "<CAPTURED_BOOLEAN>",
        "sdkArtifact": {
          "formatVersion": 1,
          "package": "<PACKAGE_FROM_LOCK>",
          "version": "<VERSION_FROM_LOCK>",
          "archive": "<ARCHIVE_PATH_FROM_LOCK>",
          "sha256": "<SDK_ARCHIVE_SHA256_FROM_LOCK>",
          "sourceRepository": "<SOURCE_REPOSITORY_FROM_LOCK>",
          "sourceCommit": "<SDK_PRODUCER_COMMIT_FROM_LOCK>",
          "license": "<LICENSE_FROM_LOCK>",
          "publishedToCratesIo": "<BOOLEAN_FROM_LOCK>"
        },
        "packages": {
          "webvtt": {
            "directory": "../plugin-packages/webvtt",
            "packageDigest": "<64_HEX_HOST_PACKAGE_DIGEST>",
            "plugin": {
              "publisher": "<PUBLISHER_FROM_MANIFEST>",
              "id": "webvtt",
              "version": "<VERSION_FROM_MANIFEST>"
            }
          },
          "stardew-smapi": {
            "directory": "../plugin-packages/stardew-smapi",
            "packageDigest": "<64_HEX_HOST_PACKAGE_DIGEST>",
            "plugin": {
              "publisher": "<PUBLISHER_FROM_MANIFEST>",
              "id": "stardew-smapi",
              "version": "<VERSION_FROM_MANIFEST>"
            }
          }
        }
      },
      "runtime": {
        "tool": "../approved-runtime/tool",
        "host": "../approved-runtime/host",
        "approval": "../approved-runtime/approval.json"
      }
    },
    {
      "id": "released-plugins-not-selected",
      "kind": "candidate-host-released-plugins",
      "status": "not-run",
      "reason": "No exact released WebVTT and SMAPI archive pair was selected for this matrix."
    },
    {
      "id": "candidate-plugins-not-selected",
      "kind": "candidate-plugins-declared-host",
      "status": "not-run",
      "reason": "No candidate package pair and matching Host commit were selected for this matrix."
    }
  ]
}
```

Note that `sourceCommit`, `sourceDirty`, and SDK provenance fields are recorded as caller declarations (`provenance: "source and artifact origins are caller declarations, not independently authenticated"`), while the runner verifies the Host checkout commit, package `sdk/lock.json` equality, manifest identity, and Host `packageDigest`.

## Public Host journeys and reports

For each runnable row, the matrix invokes the pinned Host's compatibility harness (`crates/plugin-host/scripts/compatibility.py`):

```text
python3 crates/plugin-host/scripts/compatibility.py \
  --webvtt-package <package-directory> --webvtt-digest <packageDigest> \
  --smapi-package <package-directory> --smapi-digest <packageDigest> \
  --runtime-tool <runtime-tool> --runtime-host <runtime-host> \
  --runtime-approval <approval.json> --output <new-output-directory> [--offline]
```

Each run must verify the Host commit, package manifests, and `packageDigest` values, and pass two end-to-end journeys (1 passed, 0 failed, 0 ignored each):

- **WebVTT**: `source_adoption::official_source_checks_gate_atomic_adoption_revision_updates_and_reopening`
- **SMAPI**: `translation_validation::complete_translation_requires_current_scope_independent_grants_and_saved_check_proof`

The matrix summary reports per-row outcomes (`passed`, `failed`, or `not-run`) and an overall status:

| Overall status | Meaning | CLI exit |
|---|---|---:|
| `passed` | All runnable rows passed, no row is `not-run`, and all three combination kinds have at least one passing row. | 0 |
| `failed` | At least one runnable row failed, or an input/schema/checkout error occurred. | 1 |
| `incomplete` | No row failed, but at least one row is `not-run` or a required combination kind has no passing row. | 2 |

## Manual hosted workflow

The [Pinned Host compatibility workflow](../.github/workflows/compatibility.yml) can be triggered manually via `workflow_dispatch` with a matrix JSON string and a runner selection (`macos-14` or `ubuntu-24.04` matching the approved runtime platform). It runs with read-only permissions and retains the matrix input, summary, Host reports, and logs as workflow artifacts for 14 days.

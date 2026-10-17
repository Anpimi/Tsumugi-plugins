# Pinned Host compatibility matrix

This guide describes a separate, explicit compatibility check for prebuilt
WebVTT and Stardew SMAPI packages against a pinned public Tsumugi Host and an
approved JavaScript runtime. It does not change an independent candidate-build
record: `runtimeCompatibility` in that record remains `not-run` until its own
evidence says otherwise.

See the [English repository README](../README.md) and
[Chinese repository README](../README.zh-CN.md) for candidate-build and SDK
context.

## Run a local matrix

Create a reviewed `formatVersion: 1` matrix JSON, then run from the repository
root with Python 3.11 or newer:

```sh
mkdir -p artifacts/compatibility/runs
python3 tooling/compatibility-matrix.py \
  --matrix artifacts/compatibility/selection.json \
  --output artifacts/compatibility/runs/local-001
```

The output path must not already exist; its parent must exist. The command
creates a report at `compatibility-matrix.json` and preserves per-row Host
reports and logs. Add `--offline` only when the selected Host has prepared Cargo
caches. It enables offline behavior for the Host harness; it does not suppress
HTTPS downloads or the exact public Host checkout when a matrix row selects
remote inputs.

Local `directory` paths are resolved relative to the directory containing the
matrix file, not the current shell directory. A local Host directory must be a
Git checkout whose root and `HEAD` match the selected Host commit. A local
package directory must contain the selected package. For downloaded material,
use an uncompressed `.tar` archive and an exact public HTTPS URL plus its
64-character transport SHA-256. URLs with credentials or fragments, redirects
away from HTTPS, changed bytes, unsafe archive members, and archives outside
the size or file-count bounds are refused. Archive members are validated before
materialization; only unique regular files with portable paths are accepted.
The unpacker preserves executable bits but does not run archive members; the
subsequent Host harness executes the selected plugin journeys.

The matrix supports 1–16 uniquely named, explicit combinations. Its three
combination kinds are:

| `kind` | Selection represented |
|---|---|
| `candidate-host-released-plugins` | A pinned candidate Host with both released plugin package archives. The row must declare `sourceDirty: false`. |
| `candidate-plugins-declared-host` | A pinned Host commit with the selected candidate WebVTT and SMAPI packages. |
| `paired-candidates` | One explicit Host candidate, plugin source selection, SDK selection, both packages, and approved runtime pairing. |

Each row names one combination to assess. The required coverage is one passing
row of each kind; it is not a promise to enumerate every Host, plugin, SDK,
platform, or runtime Cartesian product. Every runnable package pair contains
exactly `webvtt` and `stardew-smapi` because the profile runs one existing core
journey for each domain.

## Matrix fields and a non-runnable template

Each runnable combination has exactly these top-level fields: `id`, `kind`,
`host`, `plugins`, and `runtime`. Host and plugin source commits are exact
lowercase 40-character commit IDs. `sourceDirty` is an explicit boolean captured
from the plugin source state; the released-plugins kind refuses `true`. The
`sdkArtifact` value must be the **complete JSON object** from the selected
package's `sdk/lock.json`, not a shortened reconstruction. The matrix checks
that each selected package's captured SDK lock equals that object.

The following is an illustrative local layout only. Angle-bracket values are
placeholders, so this is **not an acceptance record and cannot be run as shown**.
Replace them only with identities and evidence for the actual selected inputs;
set `sourceDirty` to the captured boolean. The SDK object shows every lock field
to make its required shape explicit; replace the whole object with the complete
JSON object from the exact selected package's `sdk/lock.json`.

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

The SDK object above is a field-complete, intentionally non-runnable template,
not a captured lock. For every actual row, copy the full object from the exact
selected package lock, without placeholders, omitted keys, or an assumed archive
identity. The two `not-run` rows show how to record unselected classes without
inventing a released package. A `not-run` row requires a nonempty reason and
does not count toward coverage.

The `host` selection is either a local `directory` plus exact commit, or the
single automatic checkout source `https://github.com/Anpimi/Tsumugi` plus exact
commit. Plugin package selections are local `directory` paths or `archive`
objects with exactly `url` and transport `sha256`. The plugin declaration also
requires `sourceCommit`, `sourceDirty`, the full `sdkArtifact`, and both package
identities. Each `packageDigest` is the Host's package identity, not the archive
transport SHA-256. Obtain it from evidence for the actual package using the
public Host package inspector; the matrix does not turn a tar hash into that
identity or recompute the package digest for an ordinary local path. For a
downloaded archive, `sha256` identifies the exact tar bytes and is checked
before unpacking.

`sourceCommit`, `sourceDirty`, SDK provenance fields, and artifact origins are
caller declarations, not source authentication. The tool reports this limit as
`provenance: "source and artifact origins are caller declarations, not
independently authenticated"`. It checks selected Host checkout identity,
package SDK lock equality, package manifest identity, and the Host-reported
`packageDigest`; those checks do not prove that a plugin archive was built from
its declared source commit.

The runtime may be explicit `tool`, `host`, and `approval` paths, or a downloaded
archive with exact HTTPS URL and transport SHA-256. A runtime archive must have
the root layout `tool/`, `host/`, and `approval.json`. The approval and runtime
must match the selected Host's current Process 3 protocol and the runner's
platform; use approved runtime material for that exact platform. In particular,
the manually selected hosted runner must match the approval's platform. The
unpacker preserves executable bits but does not execute archive members. The
Host, not the matrix wrapper, decides whether the supplied approved runtime can
run the selected package.

## Public Host journeys and reports

For each runnable row, the matrix locates the pinned Host's
`crates/plugin-host/scripts/compatibility.py` and invokes its public CLI with
both prebuilt package directories and their package digests, the approved
runtime tool/host/approval, an output directory, and optional `--offline`:

```text
python3 crates/plugin-host/scripts/compatibility.py \
  --webvtt-package <package-directory> --webvtt-digest <packageDigest> \
  --smapi-package <package-directory> --smapi-digest <packageDigest> \
  --runtime-tool <runtime-tool> --runtime-host <runtime-host> \
  --runtime-approval <approval.json> --output <new-output-directory> [--offline]
```

The matrix constructs this command from the selected row; the shown placeholders
are not shell-ready. It requires the Host report to identify the selected Host
commit and exactly two passing cases, with domains `webvtt` and
`stardew-smapi`. The WebVTT case runs
`source_adoption::official_source_checks_gate_atomic_adoption_revision_updates_and_reopening`;
the SMAPI case runs
`translation_validation::complete_translation_requires_current_scope_independent_grants_and_saved_check_proof`.
The report must match each package's manifest identity and supplied Host
`packageDigest`, and each case must record one passed, zero failed, and zero
ignored executions. The matrix wrapper itself has no model/provider input and
does not call a language model; the selected existing Host journeys define
their own fixtures and external-integration boundaries.

The matrix summary records each selected row as `passed`, `failed`, or `not-run`
and gives per-kind selected/passed counts. Its overall `status` is:

| Overall status | Meaning | CLI exit |
|---|---|---:|
| `passed` | Every selected runnable row passed, no row is unrun, and all three kinds have at least one passing row. | 0 |
| `failed` | At least one selected runnable row failed. | 1 |
| `incomplete` | No row failed, but a row is `not-run` or any required kind has no passing row. | 2 |

Input/schema/checkout errors also exit 1. Results written by a started matrix
stay at its new output path, including failed Host reports and logs where
available. A successful row proves only the selected package/Host/runtime
journeys and identities; it is not a release attestation, signing result,
installation approval, product-wide compatibility claim, or publication.

## Manual hosted workflow

The [Pinned Host compatibility workflow](../.github/workflows/compatibility.yml)
is manual (`workflow_dispatch`) and accepts a reviewed matrix JSON string plus
one runner choice (`macos-14` or `ubuntu-24.04`). Choose the runner to match the
approved runtime platform. The workflow uses read-only repository permissions,
does not persist checkout credentials, and has no publication secrets, release
step, privileged follow-up job, or pull-request trigger. It retains the selected
matrix, summary, Host reports, and logs for 14 days; it does not upload the
prebuilt packages, runtime trees, or Cargo caches. The workflow definition is
not evidence that a hosted run has passed; cite an actual run's retained report
for that claim.

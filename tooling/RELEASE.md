# Review and publish one experimental plugin

`release-plugin.py` separates fixed-byte review from an explicitly authorized
GitHub publication. It consumes the existing independent build, public Host
archive inspector and compatibility-matrix evidence. It does not rebuild a
plugin, execute its Worker, create SDK artifacts, install anything, enroll a
publisher, access signing keys, or select bundled plugins.

The only supported publication is an **unsigned experimental development
archive**, marked as a GitHub prerelease and never selected as the latest
release. It is not a TUF-authenticated repository or production signing flow.
Installation approval, runtime approval and per-attempt execution remain
separate application decisions.

Each invocation selects one WebVTT or SMAPI package with its own prerelease
version. Tags are independent: `webvtt/v0.1.0-alpha.1` and
`stardew-smapi/v0.1.0-alpha.1`, for example. This does not establish a shared
repository version or require an unchanged plugin to be published again.

## Trust and execution boundary

Run preparation without publication credentials. Use an explicitly reviewed
Host inspector binary and its SHA-256. Preparation captures that binary into a
disposable directory and sends the captured tar bytes to `inspect-archive`.
It runs neither the original binary path after capture nor any package member.
The inspector is not included in the prepared release.

The publisher must run from a trusted, reviewed copy of this tooling and its
existing capture helpers. Do not check out an unreviewed pull request in a
privileged job. Do not run package scripts, builds or an inspector in the
credential-bearing publication step. Existing PR workflows remain read-only;
they do not automatically trigger publication or receive publication secrets.
Run publication only after the operator has permission to create this exact
tag and release. A JSON `reviewed` field or CLI flag cannot grant account
authorization by itself.

The tool verifies agreement between fixed artifacts and reviewed reports. It
does not independently authenticate source compilation, CI report authorship,
the inspector's declared source commit or the declaration of a public support
endpoint. The operator must verify those origins and public availability as
part of review. A source commit is not inferred from a PR head: a hosted PR
merge checkout can be a different commit and must retain its actual identity.

## Prepare a reviewed selection

Requires the same Unix, Python and ordinary-file capture support as the existing
packagers. Preparation needs no GitHub connection. Supply one selection JSON;
all filesystem paths are relative to that file, unless explicitly absolute.
The following is a schema example, not execution evidence. Replace every
placeholder with a reviewed actual value:

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

`sdkArtifact` must contain the **complete unchanged SDK lock object**, including
any additional fields present in the real lock. The abbreviated example does
not authorize dropping them. The build report, relevant compatibility selections
and admitted package's `sdk/lock.json` must agree on that whole object.

```sh
python3 tooling/release-plugin.py prepare \
  --selection review/selection.json \
  --output review/prepared-webvtt
```

Use a new output directory beneath an existing ordinary parent. Existing output,
symlink/hard-link inputs and changed captured files are refused using the
existing packaging owner. Failed attempts are not recursively removed.

Preparation requires a passed clean-source independent build with effective
Python, Rust and Node test execution, exactly one matching package, the exact
tar SHA-256, a matching Host inspection, and the complete captured SDK lock.
The Host owns `packageDigest`; tar SHA-256 is a distinct transport identity.
Host inspection does not authorize installation or execution.

Compatibility evidence must be actual `two-domain-core-adoption-v1` matrix
reports. At least one `paired-candidates` and one
`candidate-plugins-declared-host` row must have passed for this exact source,
selected package, SDK and supported Host. Each original Host report must show
both named domain journeys executing exactly once successfully, the verified
normal Core consumer, a clean Host before and after, and an approved runtime
descriptor that matches the independent runtime inspection. Runtime platform
comes from that descriptor, not from the package build machine.

This initial release policy supports one exact experimental Host endpoint:
minimum equals current, macOS aarch64 only. Other platforms' successful source
builds do not expand runtime support. The endpoint must be publicly obtainable
at that exact commit before the operator authorizes publication.

## First-publication bootstrap

Before the first public package exists, the candidate-Host × released-plugin
class cannot have real released-artifact evidence. Keep its original status
`not-run` and the original matrix status `incomplete`.

An explicitly reviewed `bootstrap` reason permits preparation and publication
of this limited unsigned prerelease only. The paired and declared-Host classes
must still have actual passed results. No other missing or failed class can be
waived. Reports from separate actual matrix runs can supply those two classes;
their original summaries are checked and never rewritten to `passed`.

After publication, download the real fixed release assets and use their exact
HTTPS URLs and tar digests in a new released-plugin compatibility selection.
Only that later executed result can satisfy the released-plugin class. Once
all three classes have passed, use `"bootstrap": null`; the release tool rejects
a bootstrap waiver when released-plugin evidence is already present.

## Review the prepared bytes

The new directory contains exactly:

- One original `<plugin>-<version>.tar`, with no repacking or byte substitution.
- `release-plan.json`, binding the complete uploaded asset set by SHA-256/size.
- `sdk-lock.json` and `inspection.json`.
- `compatibility.json`, retaining identities, effective counts and limitations.
- `build-summary.json` and `release-notes.md`.

The summaries omit raw command lines, local checkout/package/runtime paths,
logs and inspector executables. Review all public text, selected SDK metadata
and the bootstrap reason before approval. The plan digest printed by preparation
identifies the precise review object; retain that value outside the mutable
prepared directory.

Before publication, the publisher recaptures and verifies that plan and every
listed asset. It does not enumerate arbitrary files or execute an inspector.
Changing a prepared asset or the plan invalidates approval; prepare and review
a new result instead of substituting bytes under an existing version/tag.

## Dry-run and explicitly authorized publication

Use a trusted installed official `gh` CLI for real publication. This tool calls
it with argv arrays; it never constructs shell commands or implements another
GitHub client. API calls explicitly select `github.com`, and release commands
use `github.com/Anpimi/Tsumugi-plugins`; `GH_HOST` cannot redirect this target.
Configure account credentials independently, outside build/PR
jobs. The command does not print or package those credentials.

Publication is a local dry-run unless `--execute` is present:

```sh
python3 tooling/release-plugin.py publish \
  --prepared review/prepared-webvtt \
  --expected-plan-sha256 <reviewed-plan-digest> \
  --output review/publication-dry-run
```

The dry-run validates and captures the assets into a new attempt directory and
writes a receipt without invoking `gh` or accessing an account. Only after
explicit authorization for this exact reviewed plan, run:

```sh
python3 tooling/release-plugin.py publish \
  --prepared review/prepared-webvtt \
  --expected-plan-sha256 <reviewed-plan-digest> \
  --output review/publication-attempt \
  --execute
```

The fixed remote sequence is:

1. Read the exact source commit from the official plugin repository; reject any
   existing same-name tag or release, including drafts. The official GraphQL
   lookup resolves a draft's database ID even before a Git tag exists; subsequent
   REST reads bind that exact ID. Authentication/read failures do not count as absence.
2. Create a draft prerelease with the exact source target and `latest=false`.
3. Upload only the captured reviewed assets without overwrite flags.
4. Download every asset from that draft and compare its exact bytes with the
   reviewed capture. Reject unexpected, missing or incomplete assets.
5. Recheck an existing tag's exact commit, publish the prerelease, then confirm
   release identity, unchanged asset identities and the final tag's commit.

Keep this tag's publication exclusive to the trusted operator. GitHub does not
provide this script a transaction spanning concurrent release edits. The script
detects observed conflicts and retains uncertainty; it does not claim release
immutability or prevent another authorized maintainer from later changing a
mutable release. It never silently replaces or removes such changes.

## Failure and recovery

Every publication attempt retains `events.jsonl`, `receipt.json` and its captured
upload directory. Remote mutations are journaled as `outcome-unknown` before
execution. A failed or timed-out command receives only a read-only reconciliation
attempt; the receipt records observed release/asset identities and any unavailable
read. A command that timed out may already have created the draft, uploaded an
asset or published the release.

`dry-run` means no remote operation occurred. `blocked` means a pre-publication
condition failed. `outcome-unknown` means a mutation was attempted without a fully
confirmed final publication. `published` requires the final readback checks.
An interrupted process may leave only its durable event journal; reconcile those
events with GitHub before deciding what happened.

Do not blindly rerun an uncertain attempt. Ordinary publication refuses existing
remote tags/releases, even when they resemble a previous attempt. Inspect the
retained receipt and current remote state before deciding a manual recovery.
There is no automatic resume, asset replacement, deletion, tag rewrite or
rollback operation. One narrow manual recovery is available after read-only
reconciliation: explicitly select `--recover-empty-draft <database-id>` with
the same reviewed plan digest and `--execute`, using a new attempt directory.
The exact draft ID, tag, target commit and prerelease identity must match; the
draft must have **zero assets and no Git tag**. This skips creation and continues
the original capture/upload/readback sequence without replacing anything.
An existing asset, tag or published release refuses this recovery. Preserve the
first attempt and keep the exact continuation within the operator's authorization;
the recovery flag itself cannot grant account permission.

A discovered post-publication mismatch remains an observed
published-state problem and is not disguised as a successful rollback.

## Focused verification

```sh
python3 -m unittest discover -s tooling/tests -p test_release_plugin.py -v
```

The suite uses synthetic prebuilt data, an isolated inspector-protocol fixture
and a recording GitHub CLI state model. It checks review admission, changed
bytes, exact argv, draft/readback/publication ordering, conflicts, and uncertain
outcomes without a network or real account. It does not prove a real Host
inspection, hosted compatibility run or actual GitHub publication passed;
those require their separate fixed-artifact evidence.

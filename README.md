# Tsumugi plugins

Official plugin packages for [Tsumugi](https://github.com/Anpimi/Tsumugi).
This repository owns domain implementations, their tests and independently
versioned artifacts. Tsumugi owns the public SDK, process Host and project engine.
Plugins do not depend on Core, the desktop frontend or a private workspace.

The repository provides a pinned SDK source artifact, an independent Rust consumer
check, and independent WebVTT and SMAPI JavaScript candidates for source extraction,
separate source semantics, locale building and separate artifact checking. Both
translation extractors and independent whole-file checkers use the same public
SDK. Both candidates also provide mandatory review-rule Resources and separate
selected-text QA components. Project language confirmation, matching/adoption and full domain cutover
remain application integration work.
Their source-import Resources use schema/behavior 2/2 and select exact immutable
Review Resources; source/profile rules and checker bindings come from the same
SDK-pinned package. [WebVTT 0.1.0-alpha.1](https://github.com/Anpimi/Tsumugi-plugins/releases/tag/webvtt/v0.1.0-alpha.1)
and [SMAPI 0.1.0-alpha.1](https://github.com/Anpimi/Tsumugi-plugins/releases/tag/stardew-smapi/v0.1.0-alpha.1)
are available as unsigned experimental archives for the exact macOS aarch64 Host
in the [compatibility policy](compatibility/macos-aarch64.json), with minimum =
current. Source builds remain development candidates and do not publish or
install those releases.

## Build and check all independent candidates

The Unix candidate entry uses this repository's existing SDK preparation,
dependency locks, domain tests and explicit packagers. Install Rust 1.98 or newer,
Python 3.11 or newer, Node `>=26.10.0 <27`, and pnpm 12.8.1, then run from this
checkout:

```sh
mkdir -p artifacts/candidates
python3 tooling/candidate-build.py --output artifacts/candidates/local
```

The output directory must be new; existing or partially failed attempts are
retained and refused on retry. Choose another output name after examining a
failed attempt. Add `--offline` only when Cargo and pnpm dependencies have been
prepared. This is an offline *source-build* option, separate from an application's
offline runtime support.

The entry verifies the **tracked** SDK archive selected by `sdk.lock.json`, runs
the packaging tests, Rust workspace/public consumer checks and all three Node
domain suites, and builds four independently versioned candidates: WebVTT,
SMAPI, philosophy and the Native Rust JSON example. Parser preparation is
explicit; pnpm installation disables lifecycle scripts and copies dependency
files so the bounded packager never reads hard links into a shared store.
Cargo installs the Rust example binary under the new output directory before
packaging; it does not install a tool globally or package linked build-cache files.
The entry never fetches
the SDK's producer commit, which is provenance rather than a required publicly
available source checkout. It does not publish or sign anything.

`candidate-build.json` records the checkout commit and initial dirty state, SDK
artifact, platform, command results and logs, and each actual candidate's plugin
identity/version, manifest SHA-256, file/byte counts and deterministic `.tar`
archive SHA-256. A dirty checkout's results cover that working tree, not its
unchanged commit alone. Each package retains its own version; there is no common
repository release version. Archives preserve executable bits and contain only
the explicit prebuilt package, without dependency caches or Cargo output.
Test commands retain their actual runner counts and log SHA-256, including on
failure. Incomplete summaries, zero effective tests and entirely skipped/TODO
Node suites stop packaging. A Node empty-file success is excluded from effective
test execution; Rust's individual zero-test suites are allowed only when the
complete workspace test command executes other non-ignored tests.

Archive SHA-256 is a transport fingerprint, **not** the Host's `packageDigest`.
Without an inspector, `packageDigest` is null and inspection is `not-run`.
For an explicitly approved public Host inspector, supply `--inspector`,
`--inspector-sha256` and `--declared-host-commit` together. The entry verifies and
captures the binary bytes into a new owner-only attempt-local copy, then runs
that copy through the existing `tsumugi-plugin-package inspect <directory>`
interface and matches the returned identity, manifest and complete file/byte
counts to the actual archive before recording the Host package digest.
Later changes to the supplied binary path do not replace the captured executable.
The inspector copy is not included in uploaded candidate artifacts.
`declaredHostCommit` remains a source declaration:
`sourceProvenanceNotVerified: true` means the script has not independently proved
that the supplied binary was compiled from that commit. Inspection runs no
Worker and grants no installation or execution permission.

The [candidate workflow](.github/workflows/candidate-build.yml) is configured for
Ubuntu 24.04 and macOS 14 with exact build-tool versions and full-commit-pinned
Actions. A separate Ubuntu job builds every Rust workspace target and feature
with the declared minimum Rust 1.98.0, using only the tracked SDK artifact. It
checks compilation without rerunning Node suites or producing candidate archives.
The Rust 1.99.0 jobs still check all four packages, including changes to shared
tooling or SDK selection. They install pinned pnpm with automatic lifecycle
scripts disabled, then explicitly run that tool's native-binary setup in the
temporary tool directory. Project dependency lifecycle scripts remain disabled.
PR runs use `contents: read`, retain no checkout
credentials, receive no publication secrets, and have no privileged follow-up
or release job. Uploaded archives and records are untrusted development
candidates, not release inputs. No actual hosted run is claimed by this setup.

`runtimeCompatibility` remains `not-run` even after successful inspection.
Candidate Host × released plugins, candidate plugins × supported Hosts, paired
application/SDK/plugin combinations, real Worker→Core adoption and final clean
offline application runs require separate fixed-combination evidence. A green
independent-build job does not complete those gates or make a package publishable.
See the [compatibility matrix guide](tooling/COMPATIBILITY.md) for those explicit
Host/plugin/runtime combinations and their evidence limits. See
[中文候选构建说明](README.zh-CN.md) for the same candidate-build operation and
evidence boundaries.

The [experimental publication guide](tooling/RELEASE.md) describes reviewing
one plugin's fixed archive and preparing its independent prerelease plan. The
publisher defaults to a local dry run; publication requires separate operator
authorization. PR jobs do not receive publication credentials, and these
unsigned archives do not establish TUF trust or select bundled plugins.

## Build the independent SDK consumer

The public [plugin authoring walkthrough](https://github.com/Anpimi/Tsumugi/blob/e0d223f9bcbbca9decad63d62a90aed8510f9cf0/docs/plugin-authoring.md)
connects these producer commands to the matching Host inspector, explicit manual
loading and diagnostics. Use the same experimental protocol snapshot throughout.

Use Rust 1.98 or newer and Python 3.11 or newer. From this checkout:

```sh
python3 tooling/prepare-sdk.py
cargo test --locked
cargo run --locked -p tsumugi-sdk-probe -- tooling/sdk-probe/fixtures/manifest.json
```

The first Cargo dependency fetch needs network or a prepared Cargo cache. With
that cache, the same commands accept `--offline`. They do not require another
Tsumugi checkout, a private document or the desktop application.

`sdk.lock.json` pins the included experimental `0.1.0-alpha.1` SDK archive by
SHA-256 and its original source commit. The archive was built from Tsumugi's SDK;
it is a consumer artifact, not a fork or another protocol source. It has not been
published to crates.io. `prepare-sdk.py` verifies and materializes its exact files
under the ignored `.cache/sdk/` directory. Do not edit that cache or the archive.
The verified archive owns both file bytes and executable flags. Unix cache
checks compare both, and preparation preserves those flags in selected helper
copies. The packager uses the same immutable archive values after checking its
cache reads; changing cache permissions cannot silently change a package.
Unexpected cache contents or flags are refused and retained for inspection.
Changes to SDK contracts belong in Tsumugi and require a new explicitly selected
artifact here. The archive contains the public contract/schema harness and
JavaScript declarations as well as the Rust data API.

The selected snapshot uses process protocol 3. Rebuild prebuilt Native workers
and prepare JavaScript packages from this SDK before using a Process-3 Host;
old Process-1/2 workers are refused without a transport fallback. JavaScript
entries register each exact contribution from the frozen component roster. The
three default components retain their Project scope; the Native helper remains
explicitly singleton. Manifest and
content-exchange versions, domain profiles and the alpha.1 package versions are
unchanged. SDK selection alone does not publish or install a package.

The selected SDK also includes the bounded generation-component input wrapper,
generation-service data and declared text-query payload preparation. These data helpers grant no execution authority;
see [SDK provenance](artifacts/sdk/README.md) for the current artifact boundary.

Development snapshots are stored under `artifacts/sdk/<producer-commit>/` so an
explicitly selected newer snapshot never replaces an earlier archive's bytes.
Before changing that selection, verify an existing cache against the old lock and
preserve it outside the selected package directory. A mismatched cache is refused.

## Build a WebVTT package

Use Node `>=26.10.0 <27` for this package. From this checkout:

```sh
node --test plugins/webvtt/tests/*.test.mjs
mkdir -p artifacts/candidates
python3 tooling/package-plugin.py plugins/webvtt artifacts/candidates/webvtt-0.1.0-alpha.1
tsumugi-plugin-package inspect artifacts/candidates/webvtt-0.1.0-alpha.1
```

`tsumugi-plugin-package` is the public Host inspector supplied by Tsumugi. The
packager copies the explicit file recipe, SDK-generated extraction validator,
licenses and SDK lock into a new directory. It refuses an existing output and
executes no package scripts. The inspector validates and fingerprints that actual
prebuilt candidate; its output supplies no publisher authentication or execution
grant. Keep approval, installation and current execution consent separate.
See the [package contracts](plugins/webvtt/docs/contracts.md) and
[Host boundary](plugins/webvtt/README.md#host-integration-boundary).

## Package ownership

The [philosophy terminology example](examples/philosophy/README.md) is a knowledge
package independent of file formats. Its immutable editorial resource powers
public query and deterministic check capabilities; a Skill and Agent tool
descriptor select that same query implementation. Product tool integration is
separate from this development candidate's resource and Worker contracts.

The [Rust JSON message catalog example](examples/flat-json/README.md) consumes
the same pinned public SDK without Core or desktop dependencies. It implements
source extraction, independent source/QA/artifact checks and locale building;
one typed definition generates its manifest/resources, and the SDK supplies the
Native Worker protocol. It is an independent development example, not a bundled
plugin or a replacement for either existing domain's migration.

The [SMAPI package](plugins/stardew-smapi/README.md) uses a frozen pnpm dependency
and explicit parser preparation before packaging. Its prebuilt tree carries all
parser runtime files and licenses, rather than loading developer `node_modules`.
Its source, build and check capabilities pair with the public Host using the same
SDK shapes as WebVTT. Building a package does not complete desktop migration.

- `plugins/stardew-smapi/`: SMAPI discovery, source and translation import,
  identity/matching, checks, building and artifact verification.
- `plugins/webvtt/`: WebVTT caption profile parsing, identity/timing/layout,
  payload checks and preservation of non-payload bytes in output.
- `tooling/`: public SDK consumption and shared build checks.

Each domain package owns its version and changelog. There is no repository
version train. Installing a package will not authorize its execution or adopt
its results; those decisions belong to the application's trusted boundaries.

See [contributing](CONTRIBUTING.md) and [SDK provenance](artifacts/sdk/README.md).
Source is licensed under the [MIT License](LICENSE).

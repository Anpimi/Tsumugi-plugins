# Contributing

For the end-to-end development sequence, use Tsumugi's public
[plugin authoring walkthrough](https://github.com/Anpimi/Tsumugi/blob/main/docs/plugin-authoring.md)
with a matching experimental Host/SDK snapshot. This repository's
[SDK preparation](README.md#build-the-independent-sdk-consumer),
[Rust example](examples/flat-json/README.md#build-and-package) and
[JavaScript package](plugins/webvtt/README.md) provide the independent producer
steps. Their domain and packaging checks do not start the desktop application or
prove a complete runtime compatibility matrix.

For the repository-wide package flow, including the prepared-cache `--offline`
option, see the [candidate build workflow](README.md#build-and-check-all-independent-candidates).

## Source and maintenance responsibilities

Third-party developers may develop and host plugins independently; their source
does not need to move into this repository. Keep each package's source
repository, publisher, origin of the package bytes and maintenance owner clear.
This is the official source and maintenance repository for the packages it owns.
Registry metadata supports package discovery; a Market can provide search and
display over that metadata. A listing does not make a package officially maintained or security
audited, and this repository does not promise to host a Registry or Market.

Before installing, verify the package's source and publisher and complete the
consuming application's current trust and permission checks for those exact
package bytes. A Registry or Market listing is not approval to install or
execute a package.
For publication through a signed offline repository, use the matching Host
snapshot's [signed repository flow](https://github.com/Anpimi/Tsumugi/blob/main/crates/plugin-host/README.md#signed-offline-repositories);
this source-build workflow and package discovery do not replace that flow.

Keep domain behavior and tests in the owning plugin directory. Preserve the
logical IDs `stardew-smapi` and `webvtt` when moving existing implementations.
Before copying or porting an existing implementation, record its original public
source paths and source commit, plus the first import commit, in package
provenance; retain applicable licenses and notices.

Consume only the pinned public SDK and public conformance tools. Do not import
Core, ProjectStore, desktop state, or private project documents. Protocol changes
belong in [Tsumugi](https://github.com/Anpimi/Tsumugi), then arrive here through a
verified SDK artifact. A local SDK override is a development choice, not a
release dependency or a replacement for the pinned artifact.

Each plugin uses its own SemVer and changelog. A shared-tool change must exercise
all affected packages. The SDK probe verifies declaration and captured-source
contract consumption. Domain tests use independent expected bytes; Host pairing
must consume the actual prebuilt package with independently approved fingerprints,
not load a source tree or infer a grant from installation. Neither probe nor domain
tests establish an accepted desktop workflow.

Run `python3 -m unittest discover -s tooling/tests` for public preparation and
packaging checks. Package runtime files through `tooling/package-plugin.py` and
the explicit `package-files.json` recipe. Generated SDK helpers must come from the
selected verified archive with their licenses and lock, never a hand-edited copy.
Retain older SDK archives and pin replacements by producer commit. Keep candidate
build directories out of Git; each domain keeps its initial `0.1.0-alpha.1` version
until an actual release boundary requires a version decision.

Do not add installation scripts, automatic source builds at runtime or silent
fallback to a different plugin. Keep credentials, user project data and internal
workspace information out of source, fixtures, logs and artifacts.

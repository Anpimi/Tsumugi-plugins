# Contributing

Keep domain behavior and tests in the owning plugin directory. Preserve the
logical IDs `stardew-smapi` and `webvtt` when moving existing implementations.
Record the original public source paths and commit in each package's provenance
before copying code; retain applicable licenses and notices.

Consume only the pinned public SDK and public conformance tools. Do not import
Core, ProjectStore, desktop state, or private project documents. Protocol changes
belong in [Tsumugi](https://github.com/Anpimi/Tsumugi), then arrive here through a
verified SDK artifact. A local SDK override is a development choice, not a
release dependency or a replacement for the pinned artifact.

Each plugin uses its own SemVer and changelog. A shared-tool change must exercise
all affected packages. The current SDK probe verifies declaration consumption;
it does not prove a domain worker, semantic validation or an accepted application
workflow. Releases need their actual package and Host integration evidence.

Do not add installation scripts, automatic source builds at runtime or silent
fallback to a different plugin. Keep credentials, user project data and internal
workspace information out of source, fixtures, logs and artifacts.

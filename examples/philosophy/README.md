# Philosophy terminology example

An independent knowledge package with the identity
`org.tsumugi.examples/philosophy`, version `0.1.0-alpha.1`. It consumes the pinned
public SDK Component facade. It has no Core, desktop or private-workspace
dependency and does not own a file format. Its original MIT-licensed terminology
resource defines editorial preferences, rather than claiming to be an
authoritative philosophical dictionary.

The `query` and `check` contributions use the same captured terminology engine.
Both require its exact ID, revision and SHA-256, an explicit target locale and
explicit concept IDs. The supported source locale is `en`; targets are `zh-CN`
and `ja`. Matching uses case-sensitive Unicode word boundaries in source English
and literal preferred target forms. A spelling alone does not select a sense.
Queries include empty results and the full corpus/query basis. Checks retain
complete requested item coverage, missing-text status and UTF-16 diagnostic
ranges; they return suggestions, not project QA proofs or approval.

Resources and deterministic functions need no model or Agent runtime. The
`agent-query-tool` resource describes an adapter to the original `query`
contribution through the SDK's `tsumugi.capability-tool-declaration` 1/1 contract,
with its exact profile, terminology Resource and Skill. Its input/output/error
schemas, limits and permissions come from the original capability. The declared
Skill explains its use without granting tools. The prepare command uses the
verified SDK's generated structural validator; actual Host binding separately
checks package references and bounded semantic constraints.
Application editor, batch and Agent tool discovery/invocation are separate
integration work. This package does not claim that those product journeys or an
AI execution loop have been accepted merely because metadata is present.

## Prepare and inspect

Use Node `>=26.10.0 <27` and Python 3.11 or newer. From the repository root:

```sh
python3 tooling/prepare-sdk.py
node examples/philosophy/tooling/prepare.mjs
node --test examples/philosophy/tests/*.test.mjs
mkdir -p artifacts/candidates
python3 tooling/package-plugin.py examples/philosophy artifacts/candidates/philosophy
tsumugi-plugin-package inspect artifacts/candidates/philosophy
```

One public definition generates the manifest and tool selector. The existing
public packager copies only the explicit recipe and the verified SDK license and
lock; it executes no installation scripts. The application Host captures the
actual complete package and separately approved Node/Host environment before
running its components. Installed resources and Skill bytes can be read from
that captured package without executing code. Inspection supplies no publisher
authentication, execution grant, model credential or resource adoption.

Inputs are bounded to 64 KiB, 100 records and 8 KiB per text. Outputs are bounded
to 64 KiB. Unsupported locales, unknown or duplicate concepts, mismatched
resource revisions, malformed input and cancellation fail explicitly. Never
replace a project term or human translation directly with a returned preference.

This independently versioned, unreleased development example adds no application
version, format migration or dependency. Its initial alpha version remains
unchanged until a release boundary requires a new version decision.
The earlier development-only package-specific tool descriptor is replaced by
the explicit public SDK selector; no fallback or historical migration is supplied.

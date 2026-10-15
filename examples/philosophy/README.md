# Philosophy terminology example

The entrypoint uses the current Process3 SDK facade: `api.instance`, the frozen
`api.contributions` roster, and `api.register(contributionId, handler)`. It
registers exactly the members selected by the Host, with no singleton API
fallback. Callable components retain their declared **Project** scope; adapting
the entrypoint does not enable an Application instance or authorize additional
operations. Use the current paired SDK and Host artifacts; older Process2
runtime captures cannot execute this facade.

An independent knowledge package with the identity
`org.tsumugi.examples/philosophy`, version `0.1.0-alpha.1`. It consumes the pinned
public SDK Component facade. It has no Core, desktop or private-workspace
dependency and does not own a file format. Its original MIT-licensed terminology
resource defines editorial preferences, rather than claiming to be an
authoritative philosophical dictionary.

The `query` and `check` contributions use the same captured terminology engine.
The supported source locale is `en`; targets are `zh-CN` and `ja`. Matching uses
case-sensitive Unicode word boundaries in source English and literal preferred
target forms. A spelling alone does not select a sense.

`query` keeps its original 1/1 input, output and error contracts. It requires the
resource's exact ID, revision and SHA-256, an explicit target locale and explicit
concept IDs. Empty lookups retain the full corpus/query basis.

`org.tsumugi.examples.philosophy-check` is now capability **2/2** and accepts the
public SDK `tsumugi.text-review-input` 1/1, emits
`tsumugi.text-review-report` 1/1 and uses `tsumugi.review-check-error` 1/1. Its
generated `text-review` Resource at `resources/text-review.json` declares an
advisory checker with four rules, one per original concept:
`org.tsumugi.examples.philosophy-term.{validity,soundness,premise,inference}`.
Rule titles and explanations come from the same terminology resource.

Each invocation explicitly selects a nonempty rule subset in its requirements;
the selection applies to that invocation only. Every requirement remains
nonmandatory and nonwaivable, has the exact provider, rule version, captured
input/scope digests and complete selected unit coverage. Input selections retain
the supplied unit ID, source revision, source text and nullable translation.
The `terminology` Resource pin uses its contribution ID, schema and exact byte
SHA-256. The component compares the requirement provider to the Host's read-only
invocation provider; the Host separately checks actual package Resource bytes,
request association and execution channel. Payload claims do not establish
authority.

The report contains one outcome for every requested rule and typed diagnostics
for its actual findings. Preferred-term suggestions are warnings with the exact
unit, UTF-16 translation range, usage note, suggested form and original Resource
entry. Irrelevant concepts complete with no findings. A rule whose relevant text
has a missing translation is unavailable for its full requested scope, unless
all selected translations are missing and that requirement already carries the
allowed `missing-translation` NA basis. Mixed present/missing scope cannot invent
NA. Failed or unavailable outcomes do not become passed checks.

These resources and findings remain **unadopted editorial suggestions**. Selecting
a check does not adopt project terminology, make it a required blocker, approve
a translation or create current project QA. Core QA composition and adoption are
separate integration work; this package does not claim those paths are complete.

Resources and deterministic functions need no model or Agent runtime. The
`agent-query-tool` resource describes an adapter to the original `query`
contribution through the SDK's `tsumugi.capability-tool-declaration` 1/1 contract,
with its exact profile, terminology Resource and Skill. Its input/output/error
schemas, limits and permissions come from the original capability. The declared
Skill explains its use without granting tools. The prepare command uses the
verified SDK's generated structural validator; actual Host binding separately
checks package references and bounded semantic constraints.
The tool's optional public `query` presentation is generated from the same
terminology file: its exact pin, original schema references, explicit concept
options, target languages and reference columns. The SDK's shared
`createToolQuery` helper constructs original single or batch inputs, retains
Unicode and scope, and displays typed reference entries or empty results.
It does not execute a component, adopt a term or infer a sense from spelling.
The original worker still verifies the exact resource and domain input.
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

One public definition generates the manifest, tool selector and text-review
declaration from the original terminology resource. Preparation stages the
verified SDK's generated structural validators into the ignored `sdk/` directory
for source tests, using the same `sdkFiles` recipe as packaging. The existing
public packager copies only the explicit recipe and the verified SDK license and
lock; it executes no installation scripts. The application Host captures the
actual complete package and separately approved Node/Host environment before
running its components. Installed resources and Skill bytes can be read from
that captured package without executing code. Inspection supplies no publisher
authentication, execution grant, model credential or resource adoption.

Inputs are bounded to 64 KiB, 100 records and 8 KiB per text. Outputs are bounded
to 64 KiB. Unsupported locales, unknown or duplicate concepts, mismatched
resource pins, substituted providers or rules, malformed input and cancellation
fail explicitly. An oversized complete report is rejected without truncation.
Never replace a project term or human translation directly with a returned
preference.

This independently versioned, unreleased development example adds no application
version, format migration or dependency. Its initial alpha version remains
unchanged until a release boundary requires a new version decision.
The earlier development-only package-specific tool descriptor is replaced by
the explicit public SDK selector; no fallback or historical migration is supplied.
The earlier custom `check` input/output contracts are replaced by the public
text-review contracts, with no compatibility fallback. The query contracts and
resource adoption boundary remain unchanged.

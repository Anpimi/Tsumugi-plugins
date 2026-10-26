# Philosophy terminology example

`org.tsumugi.examples/philosophy` (`0.1.0-alpha.1`) is a format-independent JavaScript knowledge and terminology example built against the pinned public Tsumugi SDK (`sdk.lock.json`). Rather than parsing a document format, it packages an MIT-licensed editorial glossary (`en` source terms with `zh-CN` and `ja` preferred translations) together with deterministic lookup, advisory text-review checks, an Agent tool selector and UI view, and an optional generation delegate.

Its entrypoints use the Process 3 SDK facade (`api.instance`, `api.contributions`, and `api.register(contributionId, handler)`): the knowledge callables (`query` and `check`) run at **Project** scope, while the generation delegate runs at **Attempt** scope.

## Terminology lookup (`query`) and advisory review (`check`)

Both `query` and `check` share the same in-memory terminology engine (`en` → `zh-CN` / `ja`), matching English source terms on case-sensitive Unicode word boundaries and checking target text for literal preferred translations. Because a surface word like "sound" can be unrelated to deductive soundness, matching a word never automatically selects a philosophical sense without an explicit concept ID or rule selection.

- **`query` (schema/behavior `1/1`)**: Requires the terminology resource's exact ID, revision, and SHA-256, a target locale (`zh-CN` or `ja`), and an explicit list of concept IDs. Empty matches still return the full corpus and query basis.
- **`check` (`org.tsumugi.examples.philosophy-check`, schema/behavior `2/2`)**: Consumes SDK `tsumugi.text-review-input` (`1/1`), returns `tsumugi.text-review-report` (`1/1`), and uses `tsumugi.review-check-error` (`1/1`). The generated `resources/text-review.json` Resource declares four non-mandatory, non-waivable advisory rules—one per concept:
  - `org.tsumugi.examples.philosophy-term.validity`
  - `org.tsumugi.examples.philosophy-term.soundness`
  - `org.tsumugi.examples.philosophy-term.premise`
  - `org.tsumugi.examples.philosophy-term.inference`
- **Review behavior**: Each `check` call specifies a non-empty subset of rules and verifies the Host provider and `terminology` Resource SHA-256 pin. When a source unit contains a concept term and its translation omits the preferred target form, the checker returns a warning diagnostic with the UTF-16 translation range, usage note, suggested form, and glossary entry. If a relevant unit has no translation, the rule reports `unavailable` across the requested scope unless all selected units are untranslated and the requirement carries the `missing-translation` N/A basis. All findings are advisory editorial suggestions rather than release-blocking errors.

## Capability tool, Skill, and host-rendered UI (`reference-query`)

- **Tool declaration (`agent-query-tool`)**: Generated using the SDK's `tsumugi.capability-tool-declaration` (`1/1`) contract, binding the read-only `query` capability, the `terminology` Resource pin, and the [`skills/concept-review.md`](skills/concept-review.md) Skill. It also defines a structured `query` presentation (concept options, target locales, and reference result columns) used by the SDK's `createToolQuery` helper to build single or batch lookup payloads.
- **Host-rendered UI (`reference-query`)**: Declared on the `knowledge` component and linked to `agent-query-tool` (`tsumugi.capability-tool-declaration` `1/1`) so Tsumugi Desktop can render reference lookup controls directly from the package metadata without running a custom frontend bundle.

<a id="generation-service-client"></a>

## Optional generation service client

`components/generation.mjs` is an independent **Attempt**-scoped JavaScript component implementing `generation-delegate` (schema/behavior `2/2`). It consumes the SDK's `tsumugi.generation-component-input` (`1/1`) wrapper, which pairs a prepared terminology query with a Core WorkPlan generation request.

### Execution flow

1. **Dependencies and permissions**: Declares required single-provider dependencies and `project-service` permissions for both the Core WorkPlan generation service and the package's `query` capability. The read-only `knowledge` component remains usable even when generation permissions are not granted.
2. **Prerequisite terminology lookup**: Before calling Core generation, the delegate executes the Host-frozen terminology query once and validates its corpus, locales, query basis, and requested concepts. Empty matches succeed; if the query fails (`failed/unavailable`) or returns an unknown outcome (`unknown/outcome-unknown`), the delegate stops immediately without invoking Core generation.
3. **Core generation submission**: After the query succeeds, the delegate forwards the unchanged child `taskId`, `attemptId`, and `unitIds` subset to the Core WorkPlan generation service once, without altering model prompts or injecting terminology into the request. It returns Core's `1/1` child receipt or finite error verbatim. Note that a generation receipt confirms that Core queued the child task; subsequent model or credential outcomes are tracked on that child task in project history.

### Payload budgets

- **Knowledge `query` / `check`**: Inputs up to 64 KiB (max 100 records, 8 KiB per text) and outputs up to 64 KiB. Oversized reports fail without truncation.
- **Generation delegate**: Wrapper input up to 1 MiB, Core child request up to 16 KiB (max 100 units), and receipt/error response up to 1 KiB.

## Prepare and inspect

Requires Node `>=26.10.0 <27` and Python 3.11+. From the repository root:

```sh
python3 tooling/prepare-sdk.py
node examples/philosophy/tooling/prepare.mjs
node --test examples/philosophy/tests/*.test.mjs
mkdir -p artifacts/candidates
python3 tooling/package-plugin.py examples/philosophy artifacts/candidates/philosophy
tsumugi-plugin-package inspect artifacts/candidates/philosophy
```

`examples/philosophy/tooling/prepare.mjs` generates the three-component manifest, `agent-query-tool`, and `text-review` Resource declarations from a single definition and stages the pinned SDK's structural validators into the ignored `sdk/` directory for unit tests. `package-plugin.py` packages the explicit file recipe, SDK validators, license, and `sdk/lock.json` into `artifacts/candidates/philosophy`.

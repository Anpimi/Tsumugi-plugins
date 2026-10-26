# Review explicitly selected concepts

## Looking up terminology (`query`)

Invoke the `query` capability (or its `agent-query-tool` selector) with:

- The captured terminology resource ID, revision, and SHA-256 digest
- Source language (`en`) and target language (`zh-CN` or `ja`)
- The explicit concept IDs to look up (`validity`, `soundness`, `premise`, `inference`)

Do not infer a philosophical concept solely from an ambiguous surface word such as "sound". Retain empty lookup results along with their query basis, report literal match coverage, and treat returned preferred terms as editorial suggestions until a human reviewer adopts them.

## Running advisory checks (`check`)

Invoke the `check` capability with the SDK `tsumugi.text-review-input` payload for the selected units and an explicit non-empty subset of the four advisory concept rules:

- Preserve exact unit IDs, source-revision identities, and captured provider and Resource pins.
- Missing translations remain `unavailable` unless the requirement already carries the allowed `missing-translation` N/A basis for an entirely untranslated selection.
- Check findings are advisory warnings: keep manual edits, source text, and existing project terminology intact unless explicitly updated by the user.

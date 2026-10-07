# Review explicitly selected concepts

Use the declared `query` capability with the captured resource ID, revision and
SHA-256, source language, target language and explicit concept IDs. The tool
descriptor selects that same capability; it contains no alternate query logic.
Keep empty results and their query basis. Do not infer a sense solely from a word
such as “sound”. Report the literal matching coverage and preserve the returned
editorial preferences as suggestions until a human adopts them.

Use the declared `check` capability for fixed selected translations. Findings do
not prove correctness, approve a translation, satisfy the application's required
QA or authorize a project write. Missing translations remain unavailable. Keep
manual edits, the original source and previously adopted terminology intact.
This guidance grants no tools, model access, network permission or credentials.

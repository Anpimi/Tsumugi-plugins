# Upstream maintenance fixture

These two directories are synthetic SMAPI flat translation packages used to test source-update comparison. The expected oracle was authored directly from the input keys and values prior to implementing comparison logic, covering unchanged native keys, modified source text, unambiguous single-key renames, ambiguous split/merge candidates, key reuse, and identical text under distinct keys (alongside the real 532-key `Lookup Anything` fixture in `../stardew-lookup`).

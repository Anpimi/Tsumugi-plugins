# Lookup Anything source fixture

`manifest.json`, `i18n/default.json`, and `i18n/zh.json` are verbatim copies from [Pathoschild/StardewMods](https://github.com/Pathoschild/StardewMods/tree/76565e83ede4bc8b3c293f1c659032ba9c39c213/LookupAnything) at commit `76565e83ede4bc8b3c293f1c659032ba9c39c213` (MIT license included). Because these are raw source-tree files rather than a built mod release, `manifest.json` retains its upstream `%ProjectVersion%` build placeholder.

| File | Bytes | SHA-256 |
|---|---:|---|
| manifest.json | 363 | 58273bb818cab2899e0fc0a45e1f40856cab286e07e9a9af2dbca37199118148 |
| i18n/default.json | 37385 | 29c4c299dee077481a98c1de612a678a6a16e55988ba88a73fa8f1cd92deb609 |
| i18n/zh.json | 40486 | d5b840327b886dab3afccef3e9e9c6cf1b2eb30668699dd70ed0b52ab662b4a7 |

## Expected oracle files

- **`oracle.json`**: Prepared independently of the Tsumugi extractor using `Newtonsoft.Json` 13 and manual verification of empty strings, placeholders, escaped quotes, and identical text shared across distinct barrel/box keys. It records all 532 source entries in their original order with `en` explicitly supplied as the fixture source language. Each key is an independent unit. Do not modify the upstream files' bytes, BOM, or line endings, and never regenerate `oracle.json` from the extractor under test.
- **`translation-oracle.json`**: Prepared independently with .NET `System.Text.Json` (with comment and trailing-comma handling enabled) and cross-checked against `oracle.json`. It records all 532 translated keys from `i18n/zh.json` (which contains a UTF-8 BOM, comments, and trailing commas), their values, and their input order. In this test fixture, the filename `zh.json` provides the SMAPI `zh` locale while `zh-CN` is supplied as the confirmed project target locale, verifying that import preserves both tags distinctly.

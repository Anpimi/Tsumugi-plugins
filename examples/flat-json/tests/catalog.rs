use std::cell::Cell;
use tsumugi_flat_json_example::{definition::*, *};
use tsumugi_plugin_sdk::*;

const SOURCE: &str = "\u{feff}{\r\n  \"z\": \"世界 👩🏽‍💻 é {name} {name}\",\r\n  \"\\u0061\": \"Line\\n\\\"quoted\\\" 😀\"\r\n}\r\n";
const EXPECTED: &str =
    "\u{feff}{\n  \"a\": \"行\\n\\\"引用\\\" 😀\",\n  \"z\": \"你好 {name} 👩🏽‍💻 {name}\"\n}\n";

fn source(text: &str) -> SourceExtractionInput {
    SourceExtractionInput {
        profile: profile(),
        source_set_id: "synthetic-source".into(),
        source_language: "en".into(),
        artifacts: vec![CapturedTextArtifact {
            id: "captured-catalog".into(),
            logical_path: "source.json".into(),
            role: "source".into(),
            sha256: payload_digest(text),
            utf8: text.into(),
        }],
    }
}
fn requirement(op: Operation, rule: &str, targets: Vec<String>) -> CheckRequirement {
    CheckRequirement {
        key: CheckKey {
            rule: contract(rule),
            implementation: CheckImplementation::Plugin {
                provider: ProviderSelectionBinding {
                    plugin: identity(),
                    package_digest: payload_digest("synthetic package identity"),
                    component_id: COMPONENT.into(),
                    contribution_id: op.id().into(),
                },
            },
        },
        input_digest: payload_digest("independently captured input"),
        scope_digest: payload_digest("independently captured scope"),
        targets,
        mandatory: true,
        waivable: false,
        not_applicable: None,
    }
}
fn source_input(proposal: ContentExchange) -> SourceExtractionCheckInput {
    SourceExtractionCheckInput {
        source: source(SOURCE),
        proposal,
        requirements: vec![requirement(
            Operation::SourceCheck,
            SOURCE_RULE,
            vec!["synthetic-source".into()],
        )],
    }
}
fn build_input() -> BuildInput {
    let source = extract(&source(SOURCE), &|| false).unwrap();
    let targets = source
        .units
        .iter()
        .zip(["你好 {name} 👩🏽‍💻 {name}", "行\n\"引用\" 😀"])
        .map(|(unit, text)| BuildTarget {
            unit_id: unit.id.clone(),
            source_revision_id: unit.source_revision_id.clone(),
            text: text.into(),
        })
        .collect();
    BuildInput {
        source,
        targets,
        target_language: "zh-CN".into(),
        configuration: vec![],
        output_paths: vec!["locales/zh-CN.json".into()],
        output_limits: build_declaration().output_limits,
    }
}
fn artifact_input(utf8: &str) -> ArtifactCheckInput {
    let input = build_input();
    let output = ArtifactSet {
        profile: profile(),
        source_set_id: input.source.source_set_id.clone(),
        target_language: input.target_language.clone(),
        artifacts: vec![CapturedTextArtifact {
            id: "independent-output".into(),
            logical_path: input.output_paths[0].clone(),
            role: "locale".into(),
            sha256: payload_digest(utf8),
            utf8: utf8.into(),
        }],
    };
    ArtifactCheckInput {
        input,
        output,
        requirements: vec![requirement(
            Operation::ArtifactCheck,
            ARTIFACT_RULE,
            vec!["independent-output".into()],
        )],
    }
}
fn review_input() -> ReviewCheckInput {
    let input = build_input();
    let selections: Vec<_> = input
        .targets
        .into_iter()
        .map(|target| ReviewSelection {
            unit_id: target.unit_id,
            source_revision_id: target.source_revision_id,
            translation_text: Some(target.text),
        })
        .collect();
    let targets = selections
        .iter()
        .map(|selected| selected.unit_id.clone())
        .collect::<Vec<_>>();
    ReviewCheckInput {
        source: input.source,
        target_language: "zh-CN".into(),
        selections,
        requirements: vec![
            requirement(Operation::Review, SOURCE_RULE, targets.clone()),
            requirement(Operation::Review, PLACEHOLDER_RULE, targets),
        ],
    }
}
fn findings(results: &[CheckResult]) -> usize {
    results
        .iter()
        .map(|result| match &result.outcome {
            CheckOutcome::Completed { findings } => findings.len(),
            _ => panic!("expected a completed semantic check"),
        })
        .sum()
}
fn assert_bound(requirements: &[CheckRequirement], results: &[CheckResult]) {
    for result in results {
        let required = requirements.iter().find(|r| r.key == result.key).unwrap();
        assert_eq!(result.input_digest, required.input_digest);
        assert_eq!(result.scope_digest, required.scope_digest);
        assert_eq!(result.covered_targets, required.targets);
    }
}

#[test]
fn generated_metadata_binds_all_seven_capabilities_and_four_resources() {
    let files = metadata().unwrap();
    let manifest = parse_manifest(files["manifest.json"].as_bytes()).unwrap();
    let digest = payload_digest("synthetic captured package");
    let review = parse_review_declaration(files["profiles/review.json"].as_bytes()).unwrap();
    let source = parse_source_import_declaration(files["profiles/source-import.json"].as_bytes())
        .unwrap()
        .bind(&manifest, &digest, &review)
        .unwrap();
    let build = parse_build_declaration(files["profiles/build.json"].as_bytes())
        .unwrap()
        .bind(&manifest, &digest)
        .unwrap();
    assert_eq!(source.extractor.provider.plugin, identity());
    assert_eq!(
        source.checker.provider.contribution_id,
        Operation::SourceCheck.id()
    );
    assert_eq!(
        source.review.checker.provider.contribution_id,
        Operation::Review.id()
    );
    assert_eq!(
        build.builder.provider.contribution_id,
        Operation::Build.id()
    );
    assert_eq!(
        build.checker.provider.contribution_id,
        Operation::ArtifactCheck.id()
    );
    let translation =
        parse_translation_import_declaration(files["profiles/translation-import.json"].as_bytes())
            .unwrap()
            .bind(&manifest, &digest)
            .unwrap();
    assert_eq!(
        translation.extractor.provider.contribution_id,
        Operation::TranslationExtract.id()
    );
    assert_eq!(
        translation.checker.provider.contribution_id,
        Operation::TranslationCheck.id()
    );
    assert_eq!(manifest.manifest().contributions.len(), 11);
    assert_eq!(
        manifest.manifest().components[0].runtime,
        RuntimeKind::NativeWorker
    );
    assert_eq!(manifest.manifest().components[1].runtime, RuntimeKind::Data);
    assert_eq!(
        files["sdk/lock.json"],
        include_str!("../../../sdk.lock.json")
    );
    let recipe: serde_json::Value = serde_json::from_str(&files["package-files.json"]).unwrap();
    assert_eq!(recipe["files"].as_array().unwrap().len(), 13);
}

fn translation_input(text: &str) -> TranslationExtractionInput {
    TranslationExtractionInput {
        profile: profile(),
        import_id: "captured-import".into(),
        source_set_id: "current-source".into(),
        source_snapshot_id: "current-snapshot".into(),
        target_language: "zh-CN".into(),
        language_evidence: TranslationLanguageEvidence::UserConfirmed,
        native_scope: TranslationNativeScope {
            namespace: "flat-json:source".into(),
            policy: identity_policy(),
        },
        artifacts: vec![CapturedTextArtifact {
            id: "captured-translation".into(),
            logical_path: "translations/zh-CN.json".into(),
            role: "translation".into(),
            sha256: payload_digest(text),
            utf8: text.into(),
        }],
    }
}
fn translation_check_input(input: TranslationExtractionInput) -> TranslationExtractionCheckInput {
    let proposal = extract_translations(&input, &|| false).unwrap();
    let requirement = requirement(
        Operation::TranslationCheck,
        TRANSLATION_RULE,
        vec![input.import_id.clone()],
    );
    TranslationExtractionCheckInput {
        input,
        proposal,
        requirements: vec![requirement],
    }
}

#[test]
fn translation_extraction_retains_exact_unicode_empty_values_and_literal_ranges() {
    let raw = "\u{feff}{\r\n \"\\u0061\": \"你好 {name} 👩🏽‍💻 e\u{301}\",\r\n \"empty\": \"\", \"ghost\": \"unmatched\"\r\n}\n";
    let input = translation_input(raw);
    let proposal = extract_translations(&input, &|| false).unwrap();
    validate_translation_extraction(&input, &proposal).unwrap();
    assert_eq!(proposal.artifacts, input.artifacts);
    assert_eq!(proposal.declared_language, "zh-CN");
    assert_eq!(
        proposal
            .entries
            .iter()
            .map(|entry| entry.text.as_str())
            .collect::<Vec<_>>(),
        ["你好 {name} 👩🏽‍💻 e\u{301}", "", "unmatched"]
    );
    assert_eq!(
        proposal
            .entries
            .iter()
            .map(|entry| entry.native_identity.value.as_str())
            .collect::<Vec<_>>(),
        ["a", "empty", "ghost"]
    );
    for entry in &proposal.entries {
        let literal = &raw[entry.source.range.start as usize..entry.source.range.end as usize];
        assert_eq!(serde_json::from_str::<String>(literal).unwrap(), entry.text);
        assert!(entry.native_identity.display.source.is_none());
    }
    let check = translation_check_input(input);
    let checked = translation_check(&check, &|| false).unwrap();
    assert_eq!(findings(&checked), 0);
    assert_bound(&check.requirements, &checked);
}

#[test]
fn translation_checker_reparses_original_material_and_refuses_forged_semantics() {
    let original = translation_check_input(translation_input("{\"a\":\"译文\",\"empty\":\"\"}"));
    for scenario in 0..6 {
        let mut check = original.clone();
        match scenario {
            0 => check.proposal.entries[0].text = "forged".into(),
            1 => check.proposal.entries[0].native_identity.value = "another".into(),
            2 => {
                check.proposal.entries.pop();
                check.proposal.order.pop();
            }
            3 => check.proposal.order.reverse(),
            4 => check.proposal.declared_language = "ja".into(),
            5 => {
                check.proposal.entries[0].native_identity.display.value =
                    "unverified display".into()
            }
            _ => unreachable!(),
        }
        check.validate().unwrap();
        let result = translation_check(&check, &|| false).unwrap();
        assert_eq!(findings(&result), 1, "scenario {scenario}");
        assert_bound(&check.requirements, &result);
    }
}

#[test]
fn translation_empty_file_remains_complete_zero_entry_evidence() {
    let input = translation_input("\u{feff} { }\r\n");
    let check = translation_check_input(input);
    assert!(check.proposal.entries.is_empty());
    assert!(check.proposal.order.is_empty());
    assert_eq!(check.proposal.artifacts, check.input.artifacts);
    assert_eq!(findings(&translation_check(&check, &|| false).unwrap()), 0);
    assert!(
        extract(&source("{}"), &|| false).is_err(),
        "source establishment still requires messages"
    );
}

#[test]
fn translation_refuses_wrong_scope_locale_role_duplicates_structure_and_limits() {
    for scenario in 0..7 {
        let mut input = translation_input("{\"a\":\"translated\"}");
        match scenario {
            0 => input.native_scope.namespace = "another-domain".into(),
            1 => input.native_scope.policy = contract("another-policy"),
            2 => input.artifacts[0].logical_path = "translations/zh-cn.json".into(),
            3 => input.artifacts[0].role = "source".into(),
            4 => input.artifacts[0].utf8 = "{\"a\":\"one\",\"\\u0061\":\"duplicate\"}".into(),
            5 => input.artifacts[0].utf8 = "{\"a\":{\"nested\":\"unsupported\"}}".into(),
            6 => {
                input.artifacts[0].utf8 = format!("{{\"a\":\"{}\"}}", "x".repeat(MAX_CATALOG_BYTES))
            }
            _ => unreachable!(),
        }
        input.artifacts[0].sha256 = payload_digest(&input.artifacts[0].utf8);
        assert!(
            extract_translations(&input, &|| false).is_err(),
            "scenario {scenario}"
        );
    }
    let input = translation_input("{\"a\":\"translated\"}");
    assert_eq!(
        extract_translations(&input, &|| true).unwrap_err(),
        Error::Cancelled
    );
    let check = translation_check_input(input);
    assert_eq!(
        translation_check(&check, &|| true).unwrap_err(),
        Error::Cancelled
    );
}

#[test]
fn extraction_keeps_exact_captured_bytes_and_original_literal_ranges() {
    let input = source(SOURCE);
    let content = extract(&input, &|| false).unwrap();
    validate_source_extraction(&input, &content).unwrap();
    assert_eq!(content.artifacts, input.artifacts);
    assert_eq!(content.order.len(), 2);
    for (unit, literal, text, key) in [
        (
            &content.units[0],
            "\"世界 👩🏽‍💻 é {name} {name}\"",
            "世界 👩🏽‍💻 é {name} {name}",
            "z",
        ),
        (
            &content.units[1],
            "\"Line\\n\\\"quoted\\\" 😀\"",
            "Line\n\"quoted\" 😀",
            "a",
        ),
    ] {
        let start = SOURCE.find(literal).unwrap();
        assert_eq!(unit.text, text);
        assert_eq!(
            unit.occurrences[0].source.range,
            TextRange {
                encoding: TextEncoding::Utf8Byte,
                start: start as u32,
                end: (start + literal.len()) as u32
            }
        );
        let native = unit.occurrences[0].native_identity.as_ref().unwrap();
        assert_eq!(native.value, key);
        assert_eq!(native.display.value, key);
        assert!(native.display.source.is_none());
        assert_eq!(native.policy, identity_policy());
        assert_eq!(
            content
                .domain_blocks
                .iter()
                .find(|block| block.target
                    == ContentTarget::Occurrence {
                        id: unit.occurrences[0].id.clone()
                    })
                .unwrap()
                .payload_utf8,
            format!("{{\"key\":\"{key}\"}}")
        );
    }
    let unit = &content.units[0];
    assert_eq!(unit.protected_fragments.len(), 2);
    for fragment in &unit.protected_fragments {
        assert_eq!(
            &unit.text[fragment.range.start as usize..fragment.range.end as usize],
            "{name}"
        );
        let converted =
            convert_text_range(&unit.text, fragment.range, TextEncoding::Utf16).unwrap();
        assert_eq!(
            converted.start as usize,
            unit.text[..fragment.range.start as usize]
                .encode_utf16()
                .count()
        );
        assert_eq!(fragment.kind, placeholder_kind());
    }
    assert_ne!(unit.text, unit.text.replace("é", "é"));
}

#[test]
fn invalid_catalog_structures_are_refused_without_truncation_or_normalization() {
    for text in [
        "{}",
        "[]",
        r#"{"a":1}"#,
        r#"{"a":{"b":"text"}}"#,
        r#"{"a":"x","\u0061":"y"}"#,
        "{\"a\":\"x\"} false",
        "{\"a\":\"x\",}",
        "{/*comment*/\"a\":\"x\"}",
        r#"{"a":"\u0000"}"#,
        r#"{"":"x"}"#,
        r#"{"\n":"x"}"#,
        r#"{"a":"{unfinished"}"#,
        r#"{"a":"{{nested}}"}"#,
        r#"{"a":"stray}"}"#,
        r#"{"a":"{1invalid}"}"#,
    ] {
        assert_eq!(
            extract(&source(text), &|| false).unwrap_err(),
            Error::InvalidSource,
            "{text}"
        );
    }
    let content = extract(&source(r#"{"a":"","A":"x","é":"x","é":"x"}"#), &|| false).unwrap();
    assert_eq!(content.units.len(), 4);
    assert_eq!(content.units[0].text, "");
}

#[test]
fn byte_key_text_and_count_boundaries_are_enforced() {
    let key = "é".repeat(64);
    let valid = serde_json::json!({key.clone(): "x"}).to_string();
    assert_eq!(extract(&source(&valid), &|| false).unwrap().units.len(), 1);
    assert_eq!(
        extract(
            &source(&serde_json::json!({format!("{key}x"):"x"}).to_string()),
            &|| false
        )
        .unwrap_err(),
        Error::InvalidSource
    );
    let valid = serde_json::json!({"a":"x".repeat(MAX_TEXT_BYTES)}).to_string();
    assert_eq!(
        extract(&source(&valid), &|| false).unwrap().units[0]
            .text
            .len(),
        MAX_TEXT_BYTES
    );
    assert_eq!(
        extract(
            &source(&serde_json::json!({"a":"x".repeat(MAX_TEXT_BYTES + 1)}).to_string()),
            &|| false
        )
        .unwrap_err(),
        Error::InvalidSource
    );
    let mut valid = r#"{"a":"x"}"#.to_owned();
    valid.push_str(&" ".repeat(MAX_CATALOG_BYTES - valid.len()));
    extract(&source(&valid), &|| false).unwrap();
    valid.push(' ');
    assert_eq!(
        extract(&source(&valid), &|| false).unwrap_err(),
        Error::LimitExceeded
    );
    let entries: serde_json::Map<_, _> = (0..MAX_CONTENT_ITEMS)
        .map(|i| (format!("key-{i}"), serde_json::json!("x")))
        .collect();
    let valid = serde_json::Value::Object(entries.clone()).to_string();
    assert_eq!(
        extract(&source(&valid), &|| false).unwrap().units.len(),
        MAX_CONTENT_ITEMS
    );
    let mut overflow = entries;
    overflow.insert("one-extra".into(), serde_json::json!("x"));
    assert_eq!(
        extract(
            &source(&serde_json::Value::Object(overflow).to_string()),
            &|| false
        )
        .unwrap_err(),
        Error::InvalidSource
    );
}

#[test]
fn source_profile_material_recipe_and_hash_are_fixed() {
    for change in 0..5 {
        let mut input = source(SOURCE);
        match change {
            0 => input.profile.behavior_version += 1,
            1 => input.artifacts[0].logical_path = "different.json".into(),
            2 => input.artifacts[0].role = "companion".into(),
            3 => input.artifacts[0].sha256 = payload_digest("different material"),
            _ => {
                let mut extra = input.artifacts[0].clone();
                extra.id = "extra".into();
                extra.logical_path = "second.json".into();
                input.artifacts.push(extra);
            }
        }
        assert!(extract(&input, &|| false).is_err(), "change {change}");
    }
}

#[test]
fn checker_reparses_every_semantic_field_and_detects_complete_coverage_forgery() {
    let original = extract(&source(SOURCE), &|| false).unwrap();
    for change in 0..9 {
        let mut proposal = original.clone();
        match change {
            0 => proposal.units[1].text = "Other\n\"quoted\" 😀".into(),
            1 => proposal.order.reverse(),
            2 => {
                proposal.units[0].occurrences[0]
                    .native_identity
                    .as_mut()
                    .unwrap()
                    .value = "foreign".into()
            }
            3 => {
                proposal.units[0].occurrences[0]
                    .native_identity
                    .as_mut()
                    .unwrap()
                    .policy
                    .behavior_version += 1
            }
            4 => proposal.units[0].occurrences[0].source.range.start += 1,
            5 => proposal.units[0]
                .protected_fragments
                .pop()
                .map(|_| ())
                .unwrap(),
            6 => proposal.domain_blocks[0].payload_utf8 = r#"{"key":"wrong"}"#.into(),
            7 => {
                proposal.units[0].occurrences[0]
                    .native_identity
                    .as_mut()
                    .unwrap()
                    .display
                    .value = "wrong".into()
            }
            _ => {
                proposal.units.pop();
                proposal.order.pop();
                proposal.domain_blocks.pop();
            }
        }
        let input = source_input(proposal);
        input.validate().unwrap(); // Generic wire validity must not prove domain truth.
        let results = source_check(&input, &|| false).unwrap();
        assert_eq!(findings(&results), 1, "change {change}");
        assert_bound(&input.requirements, &results);
    }
}

#[test]
fn checker_accepts_opaque_remapped_ids_unordered_vectors_and_preserved_blocks() {
    let mut proposal = extract(&source(SOURCE), &|| false).unwrap();
    for (i, unit) in proposal.units.iter_mut().enumerate() {
        let old = unit.occurrences[0].id.clone();
        unit.id = format!("core-unit-{i}");
        unit.source_revision_id = format!("core-revision-{i}");
        unit.occurrences[0].id = format!("core-occurrence-{i}");
        proposal.order[i] = unit.occurrences[0].id.clone();
        for block in &mut proposal.domain_blocks {
            if block.target == (ContentTarget::Occurrence { id: old.clone() }) {
                block.target = ContentTarget::Occurrence {
                    id: unit.occurrences[0].id.clone(),
                };
            }
        }
    }
    proposal.domain_blocks.push(DomainBlock {
        target: ContentTarget::Snapshot,
        schema: contract("uninterpreted.extra"),
        handling: ExtensionHandling::Preserve,
        payload_utf8: "opaque bytes\r\n".into(),
    });
    proposal.units.reverse();
    proposal.domain_blocks.reverse();
    let input = source_input(proposal.clone());
    input.validate().unwrap();
    assert_eq!(findings(&source_check(&input, &|| false).unwrap()), 0);
    proposal.domain_blocks[0].handling = ExtensionHandling::Required;
    assert_eq!(
        findings(&source_check(&source_input(proposal), &|| false).unwrap()),
        1
    );
}

#[test]
fn checker_refuses_wrong_rule_identity_permissions_and_not_applicable_scope() {
    let original = source_input(extract(&source(SOURCE), &|| false).unwrap());
    for change in 0..7 {
        let mut input = original.clone();
        match change {
            0 => input.requirements[0].key.rule.behavior_version += 1,
            1 => input.requirements[0].mandatory = false,
            2 => input.requirements[0].waivable = true,
            3 => input.requirements[0].targets = vec!["foreign-source".into()],
            4 => {
                input.requirements[0].not_applicable = Some(NotApplicableBasis {
                    code: MISSING_REVIEW_TRANSLATION.into(),
                    basis_digest: payload_digest("missing"),
                })
            }
            5 => {
                if let CheckImplementation::Plugin { provider } =
                    &mut input.requirements[0].key.implementation
                {
                    provider.contribution_id = Operation::Extract.id().into();
                }
            }
            _ => input.requirements.push(input.requirements[0].clone()),
        }
        assert!(source_check(&input, &|| false).is_err(), "change {change}");
    }
}

#[test]
fn builder_emits_literal_sorted_json_bom_unicode_and_complete_targets() {
    let mut input = build_input();
    input.targets.reverse();
    input.source.units.reverse();
    let output = build(&input, &|| false).unwrap();
    assert_eq!(output.artifacts[0].utf8, EXPECTED);
    assert_eq!(output.artifacts[0].sha256, payload_digest(EXPECTED));
    assert_eq!(output.artifacts[0].logical_path, "locales/zh-CN.json");
    assert_eq!(output.artifacts[0].role, "locale");
    validate_build_artifacts(&input, &output).unwrap();
    let mut no_bom = build_input();
    no_bom.source.artifacts[0].utf8.remove(0);
    no_bom.source.artifacts[0].sha256 = payload_digest(&no_bom.source.artifacts[0].utf8);
    for unit in &mut no_bom.source.units {
        unit.occurrences[0].source.range.start -= 3;
        unit.occurrences[0].source.range.end -= 3;
    }
    assert_eq!(
        build(&no_bom, &|| false).unwrap().artifacts[0].utf8,
        EXPECTED.trim_start_matches('\u{feff}')
    );
}

#[test]
fn builder_refuses_wrong_placeholder_multiplicity_and_incomplete_or_stale_targets() {
    for text in [
        "你好 {name}",
        "你好 {other} {name}",
        "你好 {name} {name} {name}",
        "你好 {name} {name",
        "你好 {{name}}",
    ] {
        let mut input = build_input();
        input.targets[0].text = text.into();
        assert_eq!(
            build(&input, &|| false).unwrap_err(),
            Error::InvalidTarget,
            "{text}"
        );
    }
    for change in 0..7 {
        let mut input = build_input();
        match change {
            0 => {
                input.targets.pop();
            }
            1 => input.targets[0].source_revision_id = "stale".into(),
            2 => input.targets.push(input.targets[0].clone()),
            3 => input.output_paths = vec!["../escape.json".into()],
            4 => input.output_paths = vec!["output.txt".into()],
            5 => input.configuration.push(
                EncodedPayload::capture(contract("unsupported-options"), "{}".into()).unwrap(),
            ),
            _ => input.output_limits.max_total_bytes = 1,
        }
        assert!(build(&input, &|| false).is_err(), "change {change}");
    }
}

#[test]
fn artifact_checker_uses_independent_literal_output_and_allows_formatting_only() {
    for text in [
        EXPECTED,
        "\u{feff}{\"z\":\"你好 {name} 👩🏽‍💻 {name}\",\"a\":\"行\\n\\\"引用\\\" 😀\"}\r\n",
    ] {
        let input = artifact_input(text);
        assert_eq!(findings(&artifact_check(&input, &|| false).unwrap()), 0);
    }
}

#[test]
fn artifact_checker_blocks_rehashed_wrong_extra_missing_and_invalid_json() {
    for text in [
        EXPECTED.replace("你好", "错误"),
        EXPECTED.replace("\"a\":", "\"other\":"),
        EXPECTED.replace("\n}", ",\n  \"extra\": \"x\"\n}"),
        "\u{feff}{\"a\":\"行\\n\\\"引用\\\" 😀\"}".into(),
        EXPECTED.trim_start_matches('\u{feff}').into(),
        "\u{feff}{\"a\":1}".into(),
        "invalid output".into(),
    ] {
        let input = artifact_input(&text);
        input.validate().unwrap(); // A recalculated digest and valid SDK association are insufficient.
        let results = artifact_check(&input, &|| false).unwrap();
        assert_eq!(findings(&results), 1, "{text}");
        assert_bound(&input.requirements, &results);
    }
    let mut input = artifact_input(EXPECTED);
    input.output.artifacts[0].role = "companion".into();
    assert_eq!(findings(&artifact_check(&input, &|| false).unwrap()), 1);
}

#[test]
fn artifact_checker_refuses_foreign_path_language_requirement_and_stale_digest() {
    for change in 0..4 {
        let mut input = artifact_input(EXPECTED);
        match change {
            0 => input.output.artifacts[0].logical_path = "elsewhere.json".into(),
            1 => input.output.target_language = "ja".into(),
            2 => input.requirements[0].targets = vec!["foreign-artifact".into()],
            _ => input.output.artifacts[0].utf8.push('x'),
        }
        assert!(
            artifact_check(&input, &|| false).is_err(),
            "change {change}"
        );
    }
}

#[test]
fn review_checks_both_mandatory_rules_with_complete_fixed_coverage() {
    let input = review_input();
    let results = review(&input, &|| false).unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(findings(&results), 0);
    assert_bound(&input.requirements, &results);
    for text in [Some("你好 {name}".into()), Some("{broken".into()), None] {
        let mut input = input.clone();
        input.selections[0].translation_text = text;
        let results = review(&input, &|| false).unwrap();
        assert_eq!(findings(&results), 1);
        assert_eq!(results[1].covered_targets.len(), 2);
    }
    let mut forged = input;
    forged.source.units[1].text = "Other\n\"quoted\" 😀".into();
    let results = review(&forged, &|| false).unwrap();
    assert_eq!(findings(&results), 2); // Source mismatch blocks every selected unit.
}

#[test]
fn missing_translation_na_requires_entire_scope_and_cannot_skip_source_semantics() {
    let mut input = review_input();
    for selection in &mut input.selections {
        selection.translation_text = None;
    }
    let basis = NotApplicableBasis {
        code: MISSING_REVIEW_TRANSLATION.into(),
        basis_digest: payload_digest("fixed all-missing scope"),
    };
    input.requirements[1].not_applicable = Some(basis.clone());
    let results = review(&input, &|| false).unwrap();
    assert!(
        matches!(&results[0].outcome, CheckOutcome::Completed { findings } if findings.is_empty())
    );
    assert!(
        matches!(&results[1].outcome, CheckOutcome::NotApplicable { basis: actual } if *actual == basis)
    );
    input.selections[0].translation_text = Some("{name} {name}".into());
    assert!(review(&input, &|| false).is_err());
    input.selections[0].translation_text = None;
    input.requirements[0].not_applicable = Some(basis);
    assert!(review(&input, &|| false).is_err());
}

#[test]
fn review_refuses_changed_revision_partial_rules_and_waived_domain_scope() {
    for change in 0..5 {
        let mut input = review_input();
        match change {
            0 => input.selections[0].source_revision_id = "stale".into(),
            1 => {
                input.requirements.pop();
            }
            2 => input.requirements[0].waivable = true,
            3 => input.requirements[1].key.rule.behavior_version += 1,
            _ => input.requirements[0].targets.pop().map(|_| ()).unwrap(),
        }
        assert!(review(&input, &|| false).is_err(), "change {change}");
    }
}

#[test]
fn every_operation_observes_immediate_and_mid_loop_cancellation() {
    let input = source(SOURCE);
    let proposal = extract(&input, &|| false).unwrap();
    assert_eq!(extract(&input, &|| true).unwrap_err(), Error::Cancelled);
    assert_eq!(
        source_check(&source_input(proposal), &|| true).unwrap_err(),
        Error::Cancelled
    );
    assert_eq!(
        review(&review_input(), &|| true).unwrap_err(),
        Error::Cancelled
    );
    assert_eq!(
        build(&build_input(), &|| true).unwrap_err(),
        Error::Cancelled
    );
    assert_eq!(
        artifact_check(&artifact_input(EXPECTED), &|| true).unwrap_err(),
        Error::Cancelled
    );
    for threshold in [4, 12, 20] {
        let observed = Cell::new(0);
        let cancelled = || {
            observed.set(observed.get() + 1);
            observed.get() >= threshold
        };
        let text = serde_json::json!({"a": "x".repeat(8_000)}).to_string();
        assert_eq!(
            extract(&source(&text), &cancelled).unwrap_err(),
            Error::Cancelled
        );
        assert!(observed.get() >= threshold);
    }
}

fn invocation_metadata() -> NativeInvocationMetadata {
    NativeInvocationMetadata {
        profile: Some(profile()),
        cancellation: NativeCancellation::default(),
        context: InvocationContext {
            project_id: "project".into(),
            operation_id: "operation".into(),
            attempt_id: "attempt".into(),
            item_id: "item".into(),
            dispatch_id: "dispatch".into(),
            scope_id: "scope".into(),
            input_digest: payload_digest("fixed input"),
            scope_digest: payload_digest("fixed scope"),
            environment_digest: payload_digest("independent Host"),
            configuration_digest: payload_digest("configuration"),
        },
    }
}

#[test]
fn worker_refuses_unknown_activation_and_returns_finite_nonleaking_typed_errors() {
    let mut worker = CatalogComponent::default();
    assert!(
        worker
            .activate(&NativeComponentContext {
                contribution_id: "foreign".into(),
                contract: contract("foreign"),
                cancellation: NativeCancellation::default()
            })
            .is_err()
    );
    assert!(
        worker
            .activate(&NativeComponentContext {
                contribution_id: Operation::Extract.id().into(),
                contract: contract("wrong"),
                cancellation: NativeCancellation::default()
            })
            .is_err()
    );
    for operation in Operation::ALL {
        worker
            .activate(&NativeComponentContext {
                contribution_id: operation.id().into(),
                contract: operation.declaration().contract,
                cancellation: NativeCancellation::default(),
            })
            .unwrap();
        let payload = EncodedPayload::capture(
            operation.declaration().input_schema,
            "{\"untrusted-secret\":\"do not echo this\"}".into(),
        )
        .unwrap();
        let NativeCapabilityOutput::Failed(text) = worker.invoke(&payload, &invocation_metadata())
        else {
            panic!("invalid wire input was accepted")
        };
        assert!(!text.contains("untrusted-secret"));
        assert!(!text.contains("do not echo this"));
        match operation {
            Operation::Extract | Operation::SourceCheck => assert_eq!(
                parse_source_extraction_error(text.as_bytes()).unwrap().code,
                SourceExtractionErrorCode::InvalidInput
            ),
            Operation::Review => assert_eq!(
                parse_review_check_error(text.as_bytes()).unwrap().code,
                ReviewCheckErrorCode::InvalidInput
            ),
            _ => assert_eq!(
                parse_build_error(text.as_bytes()).unwrap().code,
                BuildErrorCode::InvalidInput
            ),
        }
        worker.dispose().unwrap();
    }
}

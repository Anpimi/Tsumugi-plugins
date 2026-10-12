use std::{fs::File, io::Read};
use tsumugi_plugin_sdk::{MAX_MANIFEST_BYTES, parse_manifest};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args_os().skip(1);
    let path = args.next().ok_or("usage: tsumugi-sdk-probe MANIFEST")?;
    if args.next().is_some() {
        return Err("usage: tsumugi-sdk-probe MANIFEST".into());
    }
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_MANIFEST_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    let validated = parse_manifest(&bytes)?;
    let manifest = validated.manifest();
    println!(
        "{} / {} @ {}: {} components, {} contributions",
        manifest.plugin.publisher,
        manifest.plugin.id,
        manifest.plugin.version,
        manifest.components.len(),
        manifest.contributions.len()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tsumugi_plugin_sdk::{ContractErrorCode, bind_capability};

    #[test]
    fn standalone_source_consumer_adopts_each_packages_declared_review_resource() {
        use tsumugi_plugin_sdk::*;
        for (manifest, source, review) in [
            (
                include_bytes!("../../../plugins/stardew-smapi/manifest.json").as_slice(),
                include_bytes!("../../../plugins/stardew-smapi/profiles/source-import.json")
                    .as_slice(),
                include_bytes!("../../../plugins/stardew-smapi/profiles/review.json").as_slice(),
            ),
            (
                include_bytes!("../../../plugins/webvtt/manifest.json").as_slice(),
                include_bytes!("../../../plugins/webvtt/profiles/source-import.json").as_slice(),
                include_bytes!("../../../plugins/webvtt/profiles/review.json").as_slice(),
            ),
        ] {
            let manifest = parse_manifest(manifest).unwrap();
            let declaration = parse_source_import_declaration(source).unwrap();
            let review = parse_review_declaration(review).unwrap();
            let binding = declaration
                .bind(&manifest, &"a".repeat(64), &review)
                .unwrap();
            assert_eq!(binding.declaration.review_resource, "review-profile");
            assert_eq!(binding.review.declaration, review);
            assert_eq!(
                binding.review.checker.provider.package_digest,
                binding.extractor.provider.package_digest
            );
            assert_eq!(
                binding.review.declaration.profile,
                binding.declaration.profile
            );
            binding.validate().unwrap();
        }
    }

    #[test]
    fn standalone_review_consumer_binds_both_actual_package_resources() {
        use tsumugi_plugin_sdk::*;
        for (manifest, resource, expected) in [
            (
                include_bytes!("../../../plugins/stardew-smapi/manifest.json").as_slice(),
                include_bytes!("../../../plugins/stardew-smapi/profiles/review.json").as_slice(),
                "smapi.placeholders",
            ),
            (
                include_bytes!("../../../plugins/webvtt/manifest.json").as_slice(),
                include_bytes!("../../../plugins/webvtt/profiles/review.json").as_slice(),
                "webvtt.source-structure",
            ),
        ] {
            let manifest = parse_manifest(manifest).unwrap();
            let declaration = parse_review_declaration(resource).unwrap();
            let binding = declaration.bind(&manifest, &"a".repeat(64)).unwrap();
            assert_eq!(binding.checker.provider.contribution_id, "review-check");
            assert_eq!(binding.declaration.rules[0].rule.id, expected);
            assert_eq!(
                binding.checker.declaration.input_schema,
                review_check_input_contract()
            );
            assert_eq!(
                binding.checker.declaration.error_schema,
                review_check_error_contract()
            );
            binding.validate().unwrap();
        }
    }

    #[test]
    fn standalone_consumer_reads_the_pinned_sdk_and_exact_binding() {
        let manifest = parse_manifest(include_bytes!("../fixtures/manifest.json")).unwrap();
        let binding = bind_capability(&manifest, "inspect", &"a".repeat(64)).unwrap();
        assert_eq!(binding.provider.plugin.id, "example.sdk-consumer");
        assert_eq!(binding.provider.component_id, "inspector");
        assert_eq!(binding.declaration.contract.id, "example.inspect");
        binding.validate().unwrap();
    }

    #[test]
    fn malformed_input_is_rejected_by_the_sdk_owner() {
        assert_eq!(
            parse_manifest(br#"{"protocolVersion":1}"#)
                .unwrap_err()
                .code,
            ContractErrorCode::InvalidSchema
        );
    }

    #[test]
    fn standalone_source_contract_keeps_the_exact_captured_artifact_basis() {
        use tsumugi_plugin_sdk::{
            CapturedTextArtifact, ContentExchange, ContractRef, SourceExtractionInput,
            payload_digest, validate_source_extraction,
        };
        let input = SourceExtractionInput {
            profile: ContractRef {
                id: "example.text".into(),
                schema_version: 1,
                behavior_version: 1,
            },
            source_set_id: "captured-source".into(),
            source_language: "en-US".into(),
            artifacts: vec![CapturedTextArtifact {
                id: "captured-file".into(),
                logical_path: "source.txt".into(),
                role: "source".into(),
                sha256: payload_digest("\u{feff}中文 👩🏽‍💻\r\n"),
                utf8: "\u{feff}中文 👩🏽‍💻\r\n".into(),
            }],
        };
        // Empty domain interpretation exercises data association only; this
        // probe cannot approve extraction completeness or project adoption.
        let mut proposal = ContentExchange {
            profile: input.profile.clone(),
            source_set_id: input.source_set_id.clone(),
            source_language: input.source_language.clone(),
            artifacts: input.artifacts.clone(),
            units: vec![],
            order: vec![],
            relations: vec![],
            domain_blocks: vec![],
        };
        validate_source_extraction(&input, &proposal).unwrap();
        proposal.artifacts[0].utf8.push('\n');
        proposal.artifacts[0].sha256 = payload_digest(&proposal.artifacts[0].utf8);
        assert_eq!(
            validate_source_extraction(&input, &proposal)
                .unwrap_err()
                .code,
            ContractErrorCode::ResultMismatch
        );
    }

    #[test]
    fn standalone_translation_consumer_uses_sdk_data_and_real_resource_bindings() {
        use tsumugi_plugin_sdk::*;
        let manifest = parse_manifest(include_bytes!(
            "../../../plugins/stardew-smapi/manifest.json"
        ))
        .unwrap();
        let declaration = parse_translation_import_declaration(include_bytes!(
            "../../../plugins/stardew-smapi/profiles/translation-import.json"
        ))
        .unwrap();
        let binding = declaration.bind(&manifest, &"a".repeat(64)).unwrap();
        assert_eq!(
            binding.extractor.provider.contribution_id,
            "import-translations"
        );
        assert_eq!(
            binding.checker.provider.contribution_id,
            "translation-semantic-check"
        );
        let input = TranslationExtractionInput {
            profile: declaration.profile.clone(),
            import_id: "fixed-import".into(),
            source_set_id: "fixed-set".into(),
            source_snapshot_id: "fixed-snapshot".into(),
            target_language: "zh-CN".into(),
            language_evidence: TranslationLanguageEvidence::UserConfirmed,
            native_scope: TranslationNativeScope {
                namespace: "Example.Mod".into(),
                policy: ContractRef {
                    id: "smapi-native-key".into(),
                    schema_version: 1,
                    behavior_version: 1,
                },
            },
            artifacts: vec![CapturedTextArtifact {
                id: "translated-file".into(),
                logical_path: "i18n/zh.json".into(),
                role: "translation".into(),
                sha256: payload_digest("\u{feff}{}\r\n"),
                utf8: "\u{feff}{}\r\n".into(),
            }],
        };
        binding.validate_input(&input).unwrap();
        let mut proposal = TranslationExchange {
            profile: input.profile.clone(),
            import_id: input.import_id.clone(),
            source_set_id: input.source_set_id.clone(),
            source_snapshot_id: input.source_snapshot_id.clone(),
            target_language: input.target_language.clone(),
            declared_language: "zh".into(),
            language_evidence: input.language_evidence,
            native_scope: input.native_scope.clone(),
            artifacts: input.artifacts.clone(),
            entries: vec![],
            order: vec![],
        };
        validate_translation_extraction(&input, &proposal).unwrap();
        proposal.artifacts[0].utf8.push('\n');
        proposal.artifacts[0].sha256 = payload_digest(&proposal.artifacts[0].utf8);
        proposal.validate().unwrap();
        assert_eq!(
            validate_translation_extraction(&input, &proposal)
                .unwrap_err()
                .code,
            ContractErrorCode::ResultMismatch
        );
    }

    #[test]
    fn standalone_generation_consumer_requires_exact_contracts_and_child_receipts() {
        use tsumugi_plugin_sdk::*;
        let binding = ServiceBinding {
            handle_id: "generation-handle".into(),
            provider_id: "example.generator".into(),
            contract: generation_service_contract(),
            input_schema: generation_service_input_contract(),
            output_schema: generation_service_receipt_contract(),
            error_schema: generation_service_error_contract(),
            effect: EffectKind::External,
            project_id: "example-project".into(),
            scope_id: "original-plan".into(),
            activation_generation: 1,
            configuration_digest: "a".repeat(64),
            limits: CapabilityLimits {
                max_input_bytes: MAX_GENERATION_SERVICE_INPUT_BYTES as u32,
                max_output_bytes: MAX_GENERATION_SERVICE_RECEIPT_BYTES as u32,
                concurrency: 1,
                timeout_ms: 5000,
            },
        };
        for (reference, id) in [
            (&binding.contract, "tsumugi.work-plan-generation"),
            (&binding.input_schema, "tsumugi.work-plan-generation-input"),
            (
                &binding.output_schema,
                "tsumugi.work-plan-generation-receipt",
            ),
            (&binding.error_schema, "tsumugi.work-plan-generation-error"),
        ] {
            assert_eq!(reference.id, id);
            assert_eq!(reference.schema_version, 1);
            assert_eq!(reference.behavior_version, 1);
        }
        // Descriptor and receipt checks are data-only; neither grants execution.
        validate_generation_service_binding(&binding).unwrap();
        for field in 0..4 {
            for change in 0..3 {
                let mut changed = binding.clone();
                let reference = match field {
                    0 => &mut changed.contract,
                    1 => &mut changed.input_schema,
                    2 => &mut changed.output_schema,
                    _ => &mut changed.error_schema,
                };
                match change {
                    0 => reference.id.push_str(".other"),
                    1 => reference.schema_version = 2,
                    _ => reference.behavior_version = 2,
                }
                assert_eq!(
                    validate_generation_service_binding(&changed)
                        .unwrap_err()
                        .code,
                    ContractErrorCode::IncompatibleContract
                );
            }
        }
        let mut changed = binding.clone();
        changed.effect = EffectKind::ReadOnly;
        assert_eq!(
            validate_generation_service_binding(&changed)
                .unwrap_err()
                .code,
            ContractErrorCode::IncompatibleContract
        );

        let input = parse_generation_service_input(
            br#"{"taskId":"child-task","attemptId":"child-attempt","unitIds":["unit-b","unit-a"]}"#,
        )
        .unwrap();
        let wire = format!(
            r#"{{"taskId":"child-task","attemptId":"child-attempt","inputDigest":"{}"}}"#,
            "a".repeat(64)
        );
        let receipt = parse_generation_service_receipt(wire.as_bytes()).unwrap();
        receipt.validate_against(&input).unwrap();
        for field in 0..2 {
            let mut changed = receipt.clone();
            if field == 0 {
                changed.task_id = "other-task".into();
            } else {
                changed.attempt_id = "other-attempt".into();
            }
            assert_eq!(
                changed.validate_against(&input).unwrap_err().code,
                ContractErrorCode::ResultMismatch
            );
        }
        let extra_authority = format!(
            r#"{{"taskId":"child-task","attemptId":"child-attempt","inputDigest":"{}","grant":"new-grant"}}"#,
            "a".repeat(64)
        );
        assert_eq!(
            parse_generation_service_receipt(extra_authority.as_bytes())
                .unwrap_err()
                .code,
            ContractErrorCode::InvalidSchema
        );
        let invalid_digest = format!(
            r#"{{"taskId":"child-task","attemptId":"child-attempt","inputDigest":"{}"}}"#,
            "A".repeat(64)
        );
        assert_eq!(
            parse_generation_service_receipt(invalid_digest.as_bytes())
                .unwrap_err()
                .code,
            ContractErrorCode::InvalidDeclaration
        );
        let mut bounded = wire.into_bytes();
        bounded.resize(MAX_GENERATION_SERVICE_RECEIPT_BYTES, b' ');
        assert_eq!(parse_generation_service_receipt(&bounded).unwrap(), receipt);
        bounded.push(b' ');
        assert_eq!(
            parse_generation_service_receipt(&bounded).unwrap_err().code,
            ContractErrorCode::LimitExceeded
        );
    }

    #[test]
    fn standalone_generation_receiver_rejects_authority_overrides_and_unbounded_input() {
        use tsumugi_plugin_sdk::*;
        assert_eq!(MAX_GENERATION_SERVICE_UNITS, 100);
        assert_eq!(MAX_GENERATION_SERVICE_INPUT_BYTES, 16 * 1024);
        assert_eq!(MAX_GENERATION_SERVICE_RECEIPT_BYTES, 1024);
        assert_eq!(MAX_GENERATION_SERVICE_ERROR_BYTES, 1024);
        let wire =
            br#"{"taskId":"child-task","attemptId":"child-attempt","unitIds":["unit-b","unit-a"]}"#;
        let input = parse_generation_service_input(wire).unwrap();
        assert_eq!(input.unit_ids, ["unit-b", "unit-a"]);
        for extra in [
            r#""model":"other-model""#,
            r#""payload":"replacement text""#,
            r#""destination":"https://example.invalid""#,
            r#""confirmed":true"#,
            r#""lease":{"id":"replacement"}"#,
            r#""budget":999"#,
            r#""parentTaskId":"other-parent""#,
        ] {
            let changed = format!(
                r#"{{"taskId":"child-task","attemptId":"child-attempt","unitIds":["unit-b","unit-a"],{extra}}}"#
            );
            assert_eq!(
                parse_generation_service_input(changed.as_bytes())
                    .unwrap_err()
                    .code,
                ContractErrorCode::InvalidSchema
            );
        }
        assert_eq!(
            parse_generation_service_input(
                br#"{"taskId":"child-task","taskId":"other-task","attemptId":"child-attempt","unitIds":["unit-a"]}"#
            )
            .unwrap_err()
            .code,
            ContractErrorCode::InvalidSchema
        );
        let mut bounded = wire.to_vec();
        bounded.resize(MAX_GENERATION_SERVICE_INPUT_BYTES, b' ');
        assert_eq!(parse_generation_service_input(&bounded).unwrap(), input);
        bounded.push(b' ');
        assert_eq!(
            parse_generation_service_input(&bounded).unwrap_err().code,
            ContractErrorCode::LimitExceeded
        );

        let mut changed = input.clone();
        changed.unit_ids = (0..MAX_GENERATION_SERVICE_UNITS)
            .map(|index| format!("{index:0128}"))
            .collect();
        changed.validate().unwrap();
        changed.unit_ids.push("one-more-unit".into());
        assert_eq!(
            changed.validate().unwrap_err().code,
            ContractErrorCode::LimitExceeded
        );
        changed.unit_ids.clear();
        assert_eq!(
            changed.validate().unwrap_err().code,
            ContractErrorCode::LimitExceeded
        );
        changed.unit_ids = vec!["unit-a".into(), "unit-a".into()];
        assert_eq!(
            changed.validate().unwrap_err().code,
            ContractErrorCode::DuplicateIdentity
        );
        for invalid in [
            String::new(),
            "é".into(),
            "space id".into(),
            "x".repeat(129),
        ] {
            for field in 0..3 {
                let mut changed = input.clone();
                match field {
                    0 => changed.task_id = invalid.clone(),
                    1 => changed.attempt_id = invalid.clone(),
                    _ => changed.unit_ids[0] = invalid.clone(),
                }
                assert_eq!(
                    changed.validate().unwrap_err().code,
                    ContractErrorCode::InvalidDeclaration
                );
            }
        }

        for (code, expected) in [
            ("invalid-input", GenerationServiceErrorCode::InvalidInput),
            ("unavailable", GenerationServiceErrorCode::Unavailable),
            (
                "permission-denied",
                GenerationServiceErrorCode::PermissionDenied,
            ),
            ("cancelled", GenerationServiceErrorCode::Cancelled),
            ("limit-exceeded", GenerationServiceErrorCode::LimitExceeded),
            ("conflict", GenerationServiceErrorCode::Conflict),
            ("busy", GenerationServiceErrorCode::Busy),
            ("storage-failed", GenerationServiceErrorCode::StorageFailed),
            (
                "outcome-unknown",
                GenerationServiceErrorCode::OutcomeUnknown,
            ),
        ] {
            let wire = format!(r#"{{"code":"{code}"}}"#);
            assert_eq!(
                parse_generation_service_error(wire.as_bytes())
                    .unwrap()
                    .code,
                expected
            );
        }
        for invalid in [
            br#"{"code":"invented"}"#.as_slice(),
            br#"{"code":"busy","retry":true}"#.as_slice(),
        ] {
            assert_eq!(
                parse_generation_service_error(invalid).unwrap_err().code,
                ContractErrorCode::InvalidSchema
            );
        }
        let mut bounded = br#"{"code":"outcome-unknown"}"#.to_vec();
        bounded.resize(MAX_GENERATION_SERVICE_ERROR_BYTES, b' ');
        assert_eq!(
            parse_generation_service_error(&bounded).unwrap().code,
            GenerationServiceErrorCode::OutcomeUnknown
        );
        bounded.push(b' ');
        assert_eq!(
            parse_generation_service_error(&bounded).unwrap_err().code,
            ContractErrorCode::LimitExceeded
        );
    }

    #[test]
    fn standalone_tool_consumer_prepares_the_actual_philosophy_resource_without_execution() {
        use tsumugi_plugin_sdk::*;
        let manifest =
            parse_manifest(include_bytes!("../../../examples/philosophy/manifest.json")).unwrap();
        let declaration = parse_tool_declaration(include_bytes!(
            "../../../examples/philosophy/resources/agent-query-tool.json"
        ))
        .unwrap();
        let binding = declaration.bind(&manifest, &"a".repeat(64)).unwrap();
        binding.validate().unwrap();
        assert_eq!(binding.capability.provider.contribution_id, "query");
        assert_eq!(binding.capability.declaration.effect, EffectKind::ReadOnly);
        assert_eq!(
            binding.capability.declaration.permissions,
            [PermissionRequest::CapturedInput]
        );
        assert_eq!(binding.resources.len(), 1);
        assert_eq!(binding.resources[0].contribution_id, "terminology");

        let query = binding.declaration.query.as_ref().unwrap();
        let template = query.input_template.clone();
        let selections = vec!["inference".into(), "validity".into()];
        let text = "  逻辑👩🏽‍💻e\u{301}\r\n\"quoted\"\\path  ";
        let maximum = binding.capability.declaration.limits.max_input_bytes;
        // Prepare only data. The bound resource does not start its component.
        let payload = query
            .prepare_payload(text, "ja", &selections, maximum)
            .unwrap();
        assert_eq!(payload["queries"][0]["text"].as_str(), Some(text));
        assert_eq!(payload["targetLanguage"].as_str(), Some("ja"));
        assert_eq!(
            payload["queries"][0]["conceptIds"]
                .as_array()
                .unwrap()
                .iter()
                .map(|value| value.as_str().unwrap())
                .collect::<Vec<_>>(),
            ["inference", "validity"]
        );
        let mut unchanged = payload.clone();
        unchanged["queries"][0]["text"] = template["queries"][0]["text"].clone();
        unchanged["targetLanguage"] = template["targetLanguage"].clone();
        unchanged["queries"][0]["conceptIds"] = template["queries"][0]["conceptIds"].clone();
        assert_eq!(unchanged, template);
        assert_eq!(query.input_template, template);

        let exact_limit = u32::try_from(payload.to_string().len()).unwrap();
        assert_eq!(
            query
                .prepare_payload(text, "ja", &selections, exact_limit)
                .unwrap(),
            payload
        );
        assert_eq!(
            query
                .prepare_payload(text, "ja", &selections, exact_limit - 1)
                .unwrap_err()
                .code,
            ContractErrorCode::InvalidDeclaration
        );
        assert_eq!(
            query
                .prepare_payload(text, "ja", &selections, 0)
                .unwrap_err()
                .code,
            ContractErrorCode::InvalidDeclaration
        );
        for target in ["JA", "en", " ja"] {
            assert_eq!(
                query
                    .prepare_payload(text, target, &selections, maximum)
                    .unwrap_err()
                    .code,
                ContractErrorCode::InvalidDeclaration
            );
        }
        for selections in [
            vec![],
            vec!["validity".into(), "validity".into()],
            vec!["unknown".into()],
            vec![
                "validity".into(),
                "soundness".into(),
                "premise".into(),
                "inference".into(),
                "validity".into(),
            ],
        ] {
            assert_eq!(
                query
                    .prepare_payload(text, "ja", &selections, maximum)
                    .unwrap_err()
                    .code,
                ContractErrorCode::InvalidDeclaration
            );
        }
        let boundary_text = format!("{}ab", "界".repeat(2730));
        assert_eq!(boundary_text.len(), query.max_text_bytes as usize);
        assert_eq!(
            query
                .prepare_payload(&boundary_text, "ja", &selections, maximum)
                .unwrap()["queries"][0]["text"]
                .as_str(),
            Some(boundary_text.as_str())
        );
        let oversized_text = format!("{boundary_text}c");
        assert_eq!(
            query
                .prepare_payload(&oversized_text, "ja", &selections, maximum)
                .unwrap_err()
                .code,
            ContractErrorCode::InvalidDeclaration
        );
        assert_eq!(
            query
                .prepare_payload(" \u{feff}\r\n\u{3000}", "ja", &selections, maximum)
                .unwrap_err()
                .code,
            ContractErrorCode::InvalidDeclaration
        );
    }
}

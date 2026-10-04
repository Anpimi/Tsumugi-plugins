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
}

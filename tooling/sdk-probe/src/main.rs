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
}

use tsumugi_flat_json_example::{CatalogComponent, definition};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.as_slice() == ["--metadata"] {
        println!(
            "{}",
            serde_json::to_string_pretty(&definition::metadata()?)?
        );
    } else if args.is_empty() {
        tsumugi_plugin_sdk::serve_native_component(CatalogComponent::default())?;
    } else {
        return Err("usage: flat-json-worker [--metadata]".into());
    }
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

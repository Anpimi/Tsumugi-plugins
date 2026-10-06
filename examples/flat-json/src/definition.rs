//! One typed definition generates the package metadata and selects runtime code.
use tsumugi_plugin_sdk::*;

pub const COMPONENT: &str = "catalog-worker";
pub const SOURCE_RULE: &str = "flat-json.source-semantics";
pub const PLACEHOLDER_RULE: &str = "flat-json.placeholders";
pub const ARTIFACT_RULE: &str = "flat-json.artifact-conformance";
pub const MAX_CATALOG_BYTES: usize = 131_072;

pub fn contract(id: &str) -> ContractRef {
    ContractRef {
        id: id.into(),
        schema_version: 1,
        behavior_version: 1,
    }
}
pub fn profile() -> ContractRef {
    contract("flat-json-messages")
}
pub fn basis() -> ContractRef {
    contract("flat-json.message-basis")
}
pub fn identity_policy() -> ContractRef {
    contract("flat-json.message-key")
}
pub fn placeholder_kind() -> ContractRef {
    contract("flat-json.placeholder")
}
pub fn identity() -> PluginIdentity {
    PluginIdentity {
        publisher: "org.tsumugi.examples".into(),
        id: "flat-json".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Operation {
    Extract,
    SourceCheck,
    Review,
    Build,
    ArtifactCheck,
}
impl Operation {
    pub const ALL: [Self; 5] = [
        Self::Extract,
        Self::SourceCheck,
        Self::Review,
        Self::Build,
        Self::ArtifactCheck,
    ];
    pub fn id(self) -> &'static str {
        match self {
            Self::Extract => "extract-source",
            Self::SourceCheck => "source-semantic-check",
            Self::Review => "review-check",
            Self::Build => "build",
            Self::ArtifactCheck => "validate-artifact",
        }
    }
    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|op| op.id() == id)
    }
    pub fn declaration(self) -> CapabilityDeclaration {
        let (id, input_schema, output_schema, error_schema, effect) = match self {
            Self::Extract => (
                "flat-json.extract",
                source_extraction_input_contract(),
                content_exchange_contract(),
                source_extraction_error_contract(),
                EffectKind::Proposal,
            ),
            Self::SourceCheck => (
                "flat-json.source-check",
                source_extraction_check_input_contract(),
                check_results_contract(),
                source_extraction_error_contract(),
                EffectKind::ReadOnly,
            ),
            Self::Review => (
                "flat-json.review",
                review_check_input_contract(),
                check_results_contract(),
                review_check_error_contract(),
                EffectKind::ReadOnly,
            ),
            Self::Build => (
                "flat-json.locale-build",
                build_input_contract(),
                artifact_set_contract(),
                build_error_contract(),
                EffectKind::Proposal,
            ),
            Self::ArtifactCheck => (
                "flat-json.artifact-check",
                artifact_check_input_contract(),
                check_results_contract(),
                build_error_contract(),
                EffectKind::ReadOnly,
            ),
        };
        CapabilityDeclaration {
            contract: contract(id),
            input_schema,
            output_schema,
            error_schema,
            profiles: vec![profile()],
            effect,
            permissions: vec![PermissionRequest::CapturedInput],
            limits: CapabilityLimits {
                max_input_bytes: if self == Self::Extract {
                    MAX_EXCHANGE_BYTES as u32
                } else {
                    MAX_INVOCATION_PAYLOAD_BYTES as u32
                },
                max_output_bytes: MAX_EXCHANGE_BYTES as u32,
                concurrency: 1,
                timeout_ms: 10_000,
            },
        }
    }
}

pub fn source_declaration() -> SourceImportDeclaration {
    SourceImportDeclaration {
        display_name: "JSON message catalog".into(),
        profile: profile(),
        materials: vec![SourceMaterialDeclaration {
            logical_path: "source.json".into(),
            role: "source".into(),
            max_bytes: MAX_CATALOG_BYTES as u32,
        }],
        extractor: Operation::Extract.id().into(),
        checker: Operation::SourceCheck.id().into(),
        review_resource: "review-profile".into(),
        revision_policy: SourceRevisionPolicy {
            profile: profile(),
            revision_basis: vec![basis()],
        },
        semantic_rules: vec![contract(SOURCE_RULE)],
    }
}
pub fn build_declaration() -> BuildDeclaration {
    BuildDeclaration {
        display_name: "JSON message catalog".into(),
        profile: profile(),
        builder: Operation::Build.id().into(),
        checker: Operation::ArtifactCheck.id().into(),
        output_limits: BuildOutputLimits {
            max_artifacts: 1,
            max_total_bytes: MAX_CATALOG_BYTES as u32,
        },
        artifact_rules: vec![contract(ARTIFACT_RULE)],
    }
}
pub fn review_declaration() -> ReviewDeclaration {
    ReviewDeclaration {
        profile: profile(),
        checker: Operation::Review.id().into(),
        rules: vec![
            ReviewRuleDeclaration {
                rule: contract(SOURCE_RULE),
                requires_translation: false,
            },
            ReviewRuleDeclaration {
                rule: contract(PLACEHOLDER_RULE),
                requires_translation: true,
            },
        ],
    }
}
pub fn manifest() -> PluginManifest {
    let mut contributions: Vec<_> = Operation::ALL
        .into_iter()
        .map(|op| ContributionDeclaration {
            id: op.id().into(),
            component_id: COMPONENT.into(),
            contribution: ContributionKind::Capability {
                declaration: op.declaration(),
            },
        })
        .collect();
    for (id, schema, path) in [
        (
            "source-profile",
            source_import_declaration_contract(),
            "profiles/source-import.json",
        ),
        (
            "build-profile",
            build_declaration_contract(),
            "profiles/build.json",
        ),
        (
            "review-profile",
            review_declaration_contract(),
            "profiles/review.json",
        ),
    ] {
        contributions.push(ContributionDeclaration {
            id: id.into(),
            component_id: "profiles".into(),
            contribution: ContributionKind::Resource {
                schema,
                path: path.into(),
            },
        });
    }
    PluginManifest {
        protocol_version: MANIFEST_PROTOCOL,
        plugin: identity(),
        permissions: vec![PermissionRequest::CapturedInput],
        components: vec![
            ComponentDeclaration {
                id: COMPONENT.into(),
                scope: ComponentScope::Project,
                runtime: RuntimeKind::NativeWorker,
                entrypoint: Some("bin/flat-json-worker".into()),
                dependencies: vec![],
                exit: ExitRequirements {
                    stop_timeout_ms: 1000,
                    cleanup_timeout_ms: 1000,
                },
            },
            ComponentDeclaration {
                id: "profiles".into(),
                scope: ComponentScope::Application,
                runtime: RuntimeKind::Data,
                entrypoint: None,
                dependencies: vec![],
                exit: ExitRequirements {
                    stop_timeout_ms: 1000,
                    cleanup_timeout_ms: 1000,
                },
            },
        ],
        contributions,
    }
}

pub fn metadata()
-> Result<std::collections::BTreeMap<&'static str, String>, Box<dyn std::error::Error>> {
    let manifest = manifest();
    parse_manifest(&serde_json::to_vec(&manifest)?)?;
    source_declaration().validate()?;
    build_declaration().validate()?;
    review_declaration().validate()?;
    let files = [
        "manifest.json",
        "profiles/source-import.json",
        "profiles/build.json",
        "profiles/review.json",
        "bin/flat-json-worker",
        "README.md",
        "LICENSE",
        "CHANGELOG.md",
        "CHANGELOG.zh-CN.md",
        "sdk/lock.json",
        "sdk/LICENSE",
        "package-files.json",
    ];
    Ok(std::collections::BTreeMap::from([
        ("manifest.json", serde_json::to_string_pretty(&manifest)?),
        (
            "profiles/source-import.json",
            serde_json::to_string_pretty(&source_declaration())?,
        ),
        (
            "profiles/build.json",
            serde_json::to_string_pretty(&build_declaration())?,
        ),
        (
            "profiles/review.json",
            serde_json::to_string_pretty(&review_declaration())?,
        ),
        (
            "sdk/lock.json",
            include_str!("../../../sdk.lock.json").to_owned(),
        ),
        (
            "package-files.json",
            serde_json::to_string_pretty(&serde_json::json!({"formatVersion":1,"files":files}))?,
        ),
    ]))
}

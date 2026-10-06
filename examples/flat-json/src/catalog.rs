//! Domain interpretation of captured values. No filesystem or project handles.
use crate::definition::*;
use serde::Deserializer;
use serde::de::{self, MapAccess, Visitor};
use serde_json::value::RawValue;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use tsumugi_plugin_sdk::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    InvalidInput,
    UnsupportedProfile,
    InvalidSource,
    UnsupportedStructure,
    InvalidTarget,
    LimitExceeded,
    Cancelled,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for Error {}
pub type Cancel<'a> = &'a dyn Fn() -> bool;
fn current(cancel: Cancel<'_>) -> Result<(), Error> {
    if cancel() {
        Err(Error::Cancelled)
    } else {
        Ok(())
    }
}
fn range(start: usize, end: usize) -> TextRange {
    TextRange {
        encoding: TextEncoding::Utf8Byte,
        start: start as u32,
        end: end as u32,
    }
}
fn sha256(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

#[derive(Debug)]
struct Message {
    key: String,
    text: String,
    literal: TextRange,
}
struct CatalogVisitor<'a> {
    original: &'a str,
    cancel: Cancel<'a>,
}
impl<'de> Visitor<'de> for CatalogVisitor<'_> {
    type Value = Vec<Message>;
    fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("a flat JSON string catalog")
    }
    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
        let mut entries = Vec::new();
        let mut keys = BTreeSet::new();
        while let Some(key) = map.next_key::<String>()? {
            if (self.cancel)() {
                return Err(de::Error::custom("cancelled"));
            }
            if key.is_empty()
                || key.len() > 128
                || key.chars().any(char::is_control)
                || !keys.insert(key.clone())
                || entries.len() == MAX_CONTENT_ITEMS
            {
                return Err(de::Error::custom("invalid catalog key or count"));
            }
            let raw: &RawValue = map.next_value()?;
            let text: String = serde_json::from_str(raw.get())
                .map_err(|_| de::Error::custom("a catalog value must be a string"))?;
            if text.len() > MAX_TEXT_BYTES || text.contains('\0') {
                return Err(de::Error::custom("invalid catalog text"));
            }
            // RawValue borrows the actual parser input. Keep exact literal byte
            // coordinates, including quotes, escapes and any leading BOM.
            let start = (raw.get().as_ptr() as usize)
                .checked_sub(self.original.as_ptr() as usize)
                .ok_or_else(|| de::Error::custom("invalid literal range"))?;
            let end = start + raw.get().len();
            if self.original.get(start..end) != Some(raw.get()) {
                return Err(de::Error::custom("invalid literal range"));
            }
            entries.push(Message {
                key,
                text,
                literal: range(start, end),
            });
        }
        if entries.is_empty() {
            return Err(de::Error::custom("an empty catalog has no messages"));
        }
        Ok(entries)
    }
}
fn catalog(text: &str, cancel: Cancel<'_>) -> Result<Vec<Message>, Error> {
    current(cancel)?;
    if text.len() > MAX_CATALOG_BYTES {
        return Err(Error::LimitExceeded);
    }
    let mut parser =
        serde_json::Deserializer::from_str(text.strip_prefix('\u{feff}').unwrap_or(text));
    let entries = parser.deserialize_map(CatalogVisitor {
        original: text,
        cancel,
    });
    current(cancel)?;
    let entries = entries.map_err(|_| Error::InvalidSource)?;
    parser.end().map_err(|_| Error::InvalidSource)?;
    Ok(entries)
}
fn placeholders(text: &str, cancel: Cancel<'_>) -> Result<Vec<(String, TextRange)>, Error> {
    current(cancel)?;
    if text.len() > MAX_TEXT_BYTES || text.contains('\0') {
        return Err(Error::InvalidTarget);
    }
    let bytes = text.as_bytes();
    let mut position = 0;
    let mut tokens = Vec::new();
    while position < bytes.len() {
        if position % 256 == 0 {
            current(cancel)?;
        }
        match bytes[position] {
            b'{' => {
                let start = position;
                let end = text[position + 1..]
                    .find('}')
                    .map(|offset| position + 1 + offset)
                    .ok_or(Error::InvalidTarget)?;
                let name = &text[position + 1..end];
                if name.is_empty()
                    || name.len() > 64
                    || !name.as_bytes()[0].is_ascii_alphabetic() && name.as_bytes()[0] != b'_'
                    || !name
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
                {
                    return Err(Error::InvalidTarget);
                }
                tokens.push((name.into(), range(start, end + 1)));
                position = end + 1;
            }
            b'}' => return Err(Error::InvalidTarget),
            _ => position += 1,
        }
    }
    current(cancel)?;
    Ok(tokens)
}
fn token_counts(text: &str, cancel: Cancel<'_>) -> Result<BTreeMap<String, usize>, Error> {
    let mut counts = BTreeMap::new();
    for (token, _) in placeholders(text, cancel)? {
        *counts.entry(token).or_default() += 1;
    }
    Ok(counts)
}
fn fragments(text: &str, cancel: Cancel<'_>) -> Result<Vec<ProtectedFragment>, Error> {
    Ok(placeholders(text, cancel)?
        .into_iter()
        .map(|(_, range)| ProtectedFragment {
            kind: placeholder_kind(),
            range,
        })
        .collect())
}
fn captured(source: &SourceExtractionInput, cancel: Cancel<'_>) -> Result<Vec<Message>, Error> {
    source.validate().map_err(|_| Error::InvalidInput)?;
    if source.profile != profile() {
        return Err(Error::UnsupportedProfile);
    }
    if source.artifacts.len() != 1
        || source.artifacts[0].logical_path != "source.json"
        || source.artifacts[0].role != "source"
    {
        return Err(Error::UnsupportedStructure);
    }
    let messages = catalog(&source.artifacts[0].utf8, cancel)?;
    for message in &messages {
        fragments(&message.text, cancel).map_err(|error| {
            if error == Error::Cancelled {
                error
            } else {
                Error::InvalidSource
            }
        })?;
    }
    Ok(messages)
}

pub fn extract(
    input: &SourceExtractionInput,
    cancel: Cancel<'_>,
) -> Result<ContentExchange, Error> {
    let messages = captured(input, cancel)?;
    let mut output = ContentExchange {
        profile: input.profile.clone(),
        source_set_id: input.source_set_id.clone(),
        source_language: input.source_language.clone(),
        artifacts: input.artifacts.clone(),
        units: vec![],
        order: vec![],
        relations: vec![],
        domain_blocks: vec![],
    };
    for (i, message) in messages.into_iter().enumerate() {
        current(cancel)?;
        let occurrence = format!("message-{i}");
        output.domain_blocks.push(DomainBlock {
            target: ContentTarget::Occurrence {
                id: occurrence.clone(),
            },
            schema: basis(),
            handling: ExtensionHandling::Required,
            payload_utf8: serde_json::json!({"key":message.key}).to_string(),
        });
        output.order.push(occurrence.clone());
        output.units.push(ContentUnit {
            id: format!("unit-{i}"),
            source_revision_id: format!("revision-{i}"),
            protected_fragments: fragments(&message.text, cancel)?,
            text: message.text,
            occurrences: vec![ContentOccurrence {
                id: occurrence,
                source: SourceReference {
                    artifact_id: input.artifacts[0].id.clone(),
                    range: message.literal,
                },
                native_identity: Some(NativeIdentityEvidence {
                    namespace: "flat-json:source".into(),
                    value: message.key.clone(),
                    policy: identity_policy(),
                    display: NativeIdentityDisplay {
                        value: message.key,
                        source: None,
                    },
                }),
            }],
        });
    }
    output.validate().map_err(|_| Error::LimitExceeded)?;
    Ok(output)
}
fn material(content: &ContentExchange) -> SourceExtractionInput {
    SourceExtractionInput {
        profile: content.profile.clone(),
        source_set_id: content.source_set_id.clone(),
        source_language: content.source_language.clone(),
        artifacts: content.artifacts.clone(),
    }
}
// This verifier reparses original captured material and inspects every field;
// it does not call extract or trust the producer's returned identities/text.
fn faithful(
    content: &ContentExchange,
    messages: &[Message],
    cancel: Cancel<'_>,
) -> Result<bool, Error> {
    if content.require_supported_extensions(&[basis()]).is_err()
        || content.units.len() != messages.len()
        || content.order.len() != messages.len()
        || !content.relations.is_empty()
    {
        return Ok(false);
    }
    let mut occurrences = BTreeMap::new();
    let mut revisions = BTreeSet::new();
    for unit in &content.units {
        current(cancel)?;
        if unit.occurrences.len() != 1 || !revisions.insert(&unit.source_revision_id) {
            return Ok(false);
        }
        occurrences.insert(&unit.occurrences[0].id, (unit, &unit.occurrences[0]));
    }
    let blocks: Vec<_> = content
        .domain_blocks
        .iter()
        .filter(|b| b.schema == basis())
        .collect();
    if blocks.len() != messages.len() {
        return Ok(false);
    }
    for (message, occurrence) in messages.iter().zip(&content.order) {
        current(cancel)?;
        let Some((unit, actual)) = occurrences.get(occurrence) else {
            return Ok(false);
        };
        let Some(native) = &actual.native_identity else {
            return Ok(false);
        };
        if unit.text != message.text
            || actual.source.artifact_id != content.artifacts[0].id
            || actual.source.range != message.literal
            || native.namespace != "flat-json:source"
            || native.value != message.key
            || native.policy != identity_policy()
            || native.display.value != message.key
            || native.display.source.is_some()
            || unit.protected_fragments != fragments(&message.text, cancel)?
        {
            return Ok(false);
        }
        let expected = serde_json::json!({"key":message.key}).to_string();
        if !blocks.iter().any(|block| {
            block.target
                == ContentTarget::Occurrence {
                    id: (*occurrence).clone(),
                }
                && block.handling == ExtensionHandling::Required
                && block.payload_utf8 == expected
        }) {
            return Ok(false);
        }
    }
    Ok(true)
}
fn provider(requirement: &CheckRequirement, operation: Operation, rule: &str) -> bool {
    matches!(&requirement.key.implementation, CheckImplementation::Plugin { provider } if provider.plugin == identity() && provider.component_id == COMPONENT && provider.contribution_id == operation.id())
        && requirement.key.rule == contract(rule)
        && requirement.mandatory
        && !requirement.waivable
}
fn result(requirement: &CheckRequirement, findings: Vec<CheckFinding>) -> CheckResult {
    CheckResult {
        key: requirement.key.clone(),
        input_digest: requirement.input_digest.clone(),
        scope_digest: requirement.scope_digest.clone(),
        covered_targets: requirement.targets.clone(),
        outcome: CheckOutcome::Completed { findings },
    }
}
fn finding(code: &str, target: &str) -> CheckFinding {
    CheckFinding {
        code: code.into(),
        target: target.into(),
        severity: FindingSeverity::Error,
    }
}

pub fn source_check(
    input: &SourceExtractionCheckInput,
    cancel: Cancel<'_>,
) -> Result<Vec<CheckResult>, Error> {
    current(cancel)?;
    input.validate().map_err(|_| Error::InvalidInput)?;
    if input.requirements.len() != 1
        || !provider(&input.requirements[0], Operation::SourceCheck, SOURCE_RULE)
    {
        return Err(Error::InvalidInput);
    }
    let messages = captured(&input.source, cancel)?;
    let findings = if faithful(&input.proposal, &messages, cancel)? {
        vec![]
    } else {
        vec![finding("source-mismatch", &input.source.source_set_id)]
    };
    current(cancel)?;
    Ok(vec![result(&input.requirements[0], findings)])
}
fn qualified_source(source: &ContentExchange, cancel: Cancel<'_>) -> Result<Vec<Message>, Error> {
    source.validate().map_err(|_| Error::InvalidInput)?;
    let messages = captured(&material(source), cancel)?;
    if !faithful(source, &messages, cancel)? {
        return Err(Error::InvalidSource);
    }
    Ok(messages)
}
fn target_map(input: &BuildInput, cancel: Cancel<'_>) -> Result<BTreeMap<String, String>, Error> {
    current(cancel)?;
    input.validate().map_err(|_| Error::InvalidInput)?;
    if !input.configuration.is_empty()
        || input.output_paths.len() != 1
        || !input.output_paths[0].ends_with(".json")
    {
        return Err(Error::UnsupportedStructure);
    }
    let messages = qualified_source(&input.source, cancel)?;
    let mut output = BTreeMap::new();
    for (message, occurrence) in messages.iter().zip(&input.source.order) {
        current(cancel)?;
        let unit = input
            .source
            .units
            .iter()
            .find(|u| u.occurrences[0].id == *occurrence)
            .ok_or(Error::InvalidSource)?;
        let target = input
            .targets
            .iter()
            .find(|t| t.unit_id == unit.id)
            .ok_or(Error::InvalidInput)?;
        if token_counts(&message.text, cancel)? != token_counts(&target.text, cancel)? {
            return Err(Error::InvalidTarget);
        }
        output.insert(message.key.clone(), target.text.clone());
    }
    Ok(output)
}
pub fn build(input: &BuildInput, cancel: Cancel<'_>) -> Result<ArtifactSet, Error> {
    let targets = target_map(input, cancel)?;
    let mut utf8 = serde_json::to_string_pretty(&targets).map_err(|_| Error::InvalidTarget)?;
    utf8.push('\n');
    if input.source.artifacts[0].utf8.starts_with('\u{feff}') {
        utf8.insert(0, '\u{feff}');
    }
    if utf8.len() > MAX_CATALOG_BYTES || utf8.len() > input.output_limits.max_total_bytes as usize {
        return Err(Error::LimitExceeded);
    }
    let output = ArtifactSet {
        profile: profile(),
        source_set_id: input.source.source_set_id.clone(),
        target_language: input.target_language.clone(),
        artifacts: vec![CapturedTextArtifact {
            id: "catalog-output".into(),
            logical_path: input.output_paths[0].clone(),
            role: "locale".into(),
            sha256: sha256(&utf8),
            utf8,
        }],
    };
    current(cancel)?;
    validate_build_artifacts(input, &output).map_err(|_| Error::LimitExceeded)?;
    Ok(output)
}
pub fn artifact_check(
    input: &ArtifactCheckInput,
    cancel: Cancel<'_>,
) -> Result<Vec<CheckResult>, Error> {
    current(cancel)?;
    input.validate().map_err(|_| Error::InvalidInput)?;
    if input.requirements.len() != 1
        || !provider(
            &input.requirements[0],
            Operation::ArtifactCheck,
            ARTIFACT_RULE,
        )
    {
        return Err(Error::InvalidInput);
    }
    let expected = target_map(&input.input, cancel)?;
    let actual = &input.output.artifacts[0];
    let parsed = catalog(&actual.utf8, cancel);
    if matches!(parsed, Err(Error::Cancelled)) {
        return Err(Error::Cancelled);
    }
    let actual_values = parsed.ok().map(|values| {
        values
            .into_iter()
            .map(|m| (m.key, m.text))
            .collect::<BTreeMap<_, _>>()
    });
    let valid = actual.role == "locale"
        && actual.utf8.len() <= MAX_CATALOG_BYTES
        && actual.utf8.starts_with('\u{feff}')
            == input.input.source.artifacts[0].utf8.starts_with('\u{feff}')
        && actual_values.as_ref() == Some(&expected);
    current(cancel)?;
    Ok(vec![result(
        &input.requirements[0],
        if valid {
            vec![]
        } else {
            vec![finding("artifact-mismatch", &actual.id)]
        },
    )])
}
pub fn review(input: &ReviewCheckInput, cancel: Cancel<'_>) -> Result<Vec<CheckResult>, Error> {
    current(cancel)?;
    input.validate().map_err(|_| Error::InvalidInput)?;
    if input.requirements.len() != 2 {
        return Err(Error::InvalidInput);
    }
    let messages = captured(&material(&input.source), cancel)?;
    let source_valid = faithful(&input.source, &messages, cancel)?;
    let mut output = Vec::new();
    for rule in [SOURCE_RULE, PLACEHOLDER_RULE] {
        current(cancel)?;
        let requirement = input
            .requirements
            .iter()
            .find(|r| provider(r, Operation::Review, rule))
            .ok_or(Error::InvalidInput)?;
        if rule == SOURCE_RULE && requirement.not_applicable.is_some() {
            return Err(Error::InvalidInput);
        }
        if let Some(basis) = &requirement.not_applicable {
            output.push(CheckResult {
                outcome: CheckOutcome::NotApplicable {
                    basis: basis.clone(),
                },
                ..result(requirement, vec![])
            });
            continue;
        }
        let mut findings = Vec::new();
        for selected in &input.selections {
            current(cancel)?;
            let unit = input
                .source
                .units
                .iter()
                .find(|u| u.id == selected.unit_id)
                .ok_or(Error::InvalidInput)?;
            if rule == SOURCE_RULE {
                if !source_valid {
                    findings.push(finding("source-mismatch", &unit.id));
                }
            } else {
                let valid = match &selected.translation_text {
                    Some(text) => match token_counts(text, cancel) {
                        Ok(actual) => actual == token_counts(&unit.text, cancel)?,
                        Err(Error::Cancelled) => return Err(Error::Cancelled),
                        Err(_) => false,
                    },
                    None => false,
                };
                if !valid {
                    findings.push(finding("placeholder-mismatch", &unit.id));
                }
            }
        }
        output.push(result(requirement, findings));
    }
    current(cancel)?;
    Ok(output)
}

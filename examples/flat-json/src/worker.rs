use crate::{catalog, definition::*};
use tsumugi_plugin_sdk::*;

#[derive(Default)]
pub struct CatalogComponent {
    operation: Option<Operation>,
}
impl NativeComponent for CatalogComponent {
    fn activate(&mut self, context: &NativeComponentContext) -> Result<(), NativeComponentError> {
        let op = Operation::from_id(&context.contribution_id)
            .ok_or("unsupported catalog contribution")?;
        if context.contract != op.declaration().contract {
            return Err("unsupported catalog contract".into());
        }
        self.operation = Some(op);
        Ok(())
    }
    fn invoke(
        &mut self,
        input: &EncodedPayload,
        metadata: &NativeInvocationMetadata,
    ) -> NativeCapabilityOutput {
        let op = self
            .operation
            .expect("SDK activates the selected contribution before invocation");
        let cancelled = || metadata.cancellation.is_cancelled();
        let output = if metadata.profile.as_ref() != Some(&profile()) {
            Err(catalog::Error::UnsupportedProfile)
        } else if input.schema != op.declaration().input_schema {
            Err(catalog::Error::InvalidInput)
        } else {
            let bytes = input.utf8.as_bytes();
            // Every public receiver validates the complete SDK shape before
            // domain interpretation; the SDK owns transport/result identity.
            match op {
                Operation::Extract => parse_source_extraction_input(bytes)
                    .map_err(|_| catalog::Error::InvalidInput)
                    .and_then(|v| catalog::extract(&v, &cancelled))
                    .map(|v| serde_json::to_string(&v).expect("typed content serializes")),
                Operation::SourceCheck => parse_source_extraction_check_input(bytes)
                    .map_err(|_| catalog::Error::InvalidInput)
                    .and_then(|v| catalog::source_check(&v, &cancelled))
                    .map(|v| serde_json::to_string(&v).expect("typed checks serialize")),
                Operation::Review => parse_review_check_input(bytes)
                    .map_err(|_| catalog::Error::InvalidInput)
                    .and_then(|v| catalog::review(&v, &cancelled))
                    .map(|v| serde_json::to_string(&v).expect("typed checks serialize")),
                Operation::Build => parse_build_input(bytes)
                    .map_err(|_| catalog::Error::InvalidInput)
                    .and_then(|v| catalog::build(&v, &cancelled))
                    .map(|v| serde_json::to_string(&v).expect("typed artifacts serialize")),
                Operation::ArtifactCheck => parse_artifact_check_input(bytes)
                    .map_err(|_| catalog::Error::InvalidInput)
                    .and_then(|v| catalog::artifact_check(&v, &cancelled))
                    .map(|v| serde_json::to_string(&v).expect("typed checks serialize")),
            }
        };
        match output {
            Ok(output) => NativeCapabilityOutput::Succeeded(output),
            Err(error) => NativeCapabilityOutput::Failed(error_payload(op, error)),
        }
    }
    fn dispose(&mut self) -> Result<(), NativeComponentError> {
        self.operation = None;
        Ok(())
    }
}
fn error_payload(op: Operation, error: catalog::Error) -> String {
    use catalog::Error::*;
    let detail = "The captured catalog operation does not satisfy this profile.".to_string();
    match op {
        Operation::Extract | Operation::SourceCheck => {
            serde_json::to_string(&SourceExtractionError {
                code: match error {
                    InvalidInput => SourceExtractionErrorCode::InvalidInput,
                    UnsupportedProfile => SourceExtractionErrorCode::UnsupportedProfile,
                    LimitExceeded => SourceExtractionErrorCode::LimitExceeded,
                    Cancelled => SourceExtractionErrorCode::Cancelled,
                    UnsupportedStructure => SourceExtractionErrorCode::UnsupportedStructure,
                    _ => SourceExtractionErrorCode::InvalidSource,
                },
                artifact_id: None,
                detail,
            })
        }
        Operation::Review => serde_json::to_string(&ReviewCheckError {
            code: match error {
                InvalidInput => ReviewCheckErrorCode::InvalidInput,
                UnsupportedProfile => ReviewCheckErrorCode::UnsupportedProfile,
                LimitExceeded => ReviewCheckErrorCode::LimitExceeded,
                Cancelled => ReviewCheckErrorCode::Cancelled,
                UnsupportedStructure => ReviewCheckErrorCode::UnsupportedStructure,
                InvalidTarget => ReviewCheckErrorCode::InvalidTranslation,
                _ => ReviewCheckErrorCode::InvalidSource,
            },
            unit_id: None,
            detail,
        }),
        Operation::Build | Operation::ArtifactCheck => serde_json::to_string(&BuildError {
            code: match error {
                InvalidInput => BuildErrorCode::InvalidInput,
                UnsupportedProfile => BuildErrorCode::UnsupportedProfile,
                LimitExceeded => BuildErrorCode::LimitExceeded,
                Cancelled => BuildErrorCode::Cancelled,
                _ => BuildErrorCode::InvalidTarget,
            },
            artifact_id: None,
            detail,
        }),
    }
    .expect("finite public error data serializes")
}

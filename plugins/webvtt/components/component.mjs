import validateSourceExtractionInput from '../sdk/validate-source-extraction-input.mjs';
import { WebvttError, MAX_PAYLOAD_BYTES, extractSource, buildCaptions, checkArtifact, encoded } from './webvtt.mjs';

/** @typedef {import('../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/component.js').ComponentModule} ComponentModule */
/** @typedef {import('../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/content.js').SourceExtractionError} SourceExtractionError */

const extractionCodes = new Set(['invalid-input', 'unsupported-profile', 'invalid-source', 'unsupported-structure', 'limit-exceeded', 'cancelled']);
const operationCodes = new Set(['invalid-input', 'invalid-template', 'invalid-payload', 'identity-mismatch', 'invalid-output', 'unsafe-path', 'limit-exceeded', 'cancelled']);
const operations = new Map([
  ['extract-source', { contract: 'webvtt.extract', input: 'tsumugi.source-extraction-input', handler: extractSource }],
  ['build', { contract: 'webvtt.locale-build', input: 'webvtt.locale-build-input', handler: buildCaptions }],
  ['validate-artifact', { contract: 'webvtt.artifact-check', input: 'webvtt.artifact-check-input', handler: checkArtifact }],
]);

/** @type {ComponentModule} */
const component = {
  activate(api) {
    const id = api.contribution.id;
    const operation = operations.get(id);
    const contract = api.contribution.contract;
    if (!operation || contract.id !== operation.contract || contract.schemaVersion !== 1 || contract.behaviorVersion !== 1) {
      throw new Error('Unsupported selected WebVTT contribution.');
    }
    api.register((payload, metadata) => {
      let input;
      try {
        if (metadata.signal.aborted || api.signal.aborted) throw new WebvttError('cancelled', 'Operation cancelled.');
        if (payload.schema.id !== operation.input || payload.schema.schemaVersion !== 1 || payload.schema.behaviorVersion !== 1
          || metadata.profile?.id !== 'webvtt-captions' || metadata.profile.schemaVersion !== 1 || metadata.profile.behaviorVersion !== 1
          || typeof payload.utf8 !== 'string' || !payload.utf8.isWellFormed()) {
          throw new WebvttError('invalid-input', 'Captured invocation schema or profile mismatch.');
        }
        if (Buffer.byteLength(payload.utf8) > MAX_PAYLOAD_BYTES) throw new WebvttError('limit-exceeded', 'Encoded operation input exceeds 2 MiB.');
        try { input = JSON.parse(payload.utf8); }
        catch { throw new WebvttError('invalid-input', 'Invalid operation JSON.'); }
        if (id === 'extract-source' && !validateSourceExtractionInput(input)) {
          throw new WebvttError('invalid-input', 'Operation input does not match the SDK schema.');
        }
        const output = operation.handler(input, metadata.signal);
        if (metadata.signal.aborted || api.signal.aborted) throw new WebvttError('cancelled', 'Operation cancelled.');
        return { kind: 'succeeded', utf8: encoded(output) };
      } catch (error) {
        if (!(error instanceof WebvttError)) throw error;
        if (id === 'extract-source') {
          const artifactId = input?.artifacts?.[0]?.id;
          /** @type {SourceExtractionError} */
          const result = {
            code: extractionCodes.has(error.code) ? error.code : 'invalid-input',
            artifactId: typeof artifactId === 'string' && /^[A-Za-z0-9._:/-]{1,128}$/.test(artifactId) ? artifactId : null,
            detail: error.detail,
          };
          return { kind: 'failed', utf8: encoded(result) };
        }
        return { kind: 'failed', utf8: encoded({ code: operationCodes.has(error.code) ? error.code : 'invalid-input', detail: error.detail }) };
      }
    });
  },
};
export default component;

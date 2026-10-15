import validateReviewCheckInput from '../sdk/validate-review-check-input.mjs';
import validateBuildInput from '../sdk/validate-build-input.mjs';
import validateArtifactCheckInput from '../sdk/validate-artifact-check-input.mjs';
import validateSourceExtractionInput from '../sdk/validate-source-extraction-input.mjs';
import validateSourceExtractionCheckInput from '../sdk/validate-source-extraction-check-input.mjs';
import { WebvttError, MAX_PAYLOAD_BYTES, MAX_CONTENT_BYTES, MAX_SOURCE_CHECK_BYTES, extractSource, checkSourceSemantics, buildCaptions, checkArtifact, checkReview, encoded } from './webvtt.mjs';

/** @typedef {import('../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/component.js').ComponentModule} ComponentModule */
/** @typedef {import('../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/content.js').SourceExtractionError} SourceExtractionError */

const extractionCodes = new Set(['invalid-input', 'unsupported-profile', 'invalid-source', 'unsupported-structure', 'limit-exceeded', 'cancelled']);
const buildCodes = new Set(['invalid-input', 'unsupported-profile', 'invalid-target', 'invalid-artifact', 'limit-exceeded', 'cancelled']);
const buildCode = code => ({ 'invalid-payload': 'invalid-target', 'invalid-output': 'invalid-artifact' }[code] ?? code);
const operations = new Map([
  ['review-check', { contract: 'webvtt.review-check', input: 'tsumugi.review-check-input', handler: checkReview }],
  ['extract-source', { contract: 'webvtt.extract', input: 'tsumugi.source-extraction-input', handler: extractSource }],
  ['source-semantic-check', { contract: 'webvtt.source-check', input: 'tsumugi.source-extraction-check-input', handler: checkSourceSemantics }],
  ['build', { contract: 'webvtt.locale-build', input: 'tsumugi.build-input', handler: buildCaptions }],
  ['validate-artifact', { contract: 'webvtt.artifact-check', input: 'tsumugi.artifact-check-input', handler: checkArtifact }],
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
        const inputLimit = id === 'extract-source' ? MAX_PAYLOAD_BYTES : MAX_SOURCE_CHECK_BYTES;
        if (Buffer.byteLength(payload.utf8) > inputLimit) throw new WebvttError('limit-exceeded', 'Encoded operation input exceeds its captured byte limit.');
        try { input = JSON.parse(payload.utf8); }
        catch { throw new WebvttError('invalid-input', 'Invalid operation JSON.'); }
        if (id === 'extract-source' && !validateSourceExtractionInput(input)) {
          throw new WebvttError('invalid-input', 'Operation input does not match the SDK schema.');
        }
        if (id === 'source-semantic-check' && !validateSourceExtractionCheckInput(input)) {
          throw new WebvttError('invalid-input', 'Operation input does not match the SDK schema.');
        }
        if ((id === 'build' && !validateBuildInput(input)) || (id === 'validate-artifact' && !validateArtifactCheckInput(input))) {
          throw new WebvttError('invalid-input', 'Operation input does not match the SDK schema.');
        }
        if (id === 'review-check' && !validateReviewCheckInput(input)) {
          throw new WebvttError('invalid-input', 'Review input does not match the SDK schema.');
        }
        const output = operation.handler(input, metadata.signal);
        if (metadata.signal.aborted || api.signal.aborted) throw new WebvttError('cancelled', 'Operation cancelled.');
        return { kind: 'succeeded', utf8: encoded(output, id === 'extract-source' ? MAX_CONTENT_BYTES : MAX_PAYLOAD_BYTES) };
      } catch (error) {
        if (!(error instanceof WebvttError)) throw error;
        if (id === 'review-check') {
          const code = error.code === 'invalid-payload' ? 'invalid-translation' : error.code;
          const supported = new Set(['invalid-input', 'unsupported-profile', 'invalid-source', 'invalid-translation', 'unsupported-structure', 'limit-exceeded', 'cancelled']);
          const unit = input?.selections?.[0]?.unitId;
          return { kind: 'failed', utf8: encoded({ code: supported.has(code) ? code : 'invalid-input',
            unitId: typeof unit === 'string' && /^[A-Za-z0-9._:/-]{1,128}$/.test(unit) ? unit : null, detail: error.detail }) };
        }
        if (id === 'extract-source' || id === 'source-semantic-check') {
          const artifactId = (id === 'extract-source' ? input : input?.source)?.artifacts?.[0]?.id;
          /** @type {SourceExtractionError} */
          const result = {
            code: extractionCodes.has(error.code) ? error.code : 'invalid-input',
            artifactId: typeof artifactId === 'string' && /^[A-Za-z0-9._:/-]{1,128}$/.test(artifactId) ? artifactId : null,
            detail: error.detail,
          };
          return { kind: 'failed', utf8: encoded(result) };
        }
        const code = buildCode(error.code);
        const artifactId = id === 'validate-artifact' ? input?.output?.artifacts?.[0]?.id : null;
        return { kind: 'failed', utf8: encoded({ code: buildCodes.has(code) ? code : 'invalid-input',
          artifactId: typeof artifactId === 'string' && /^[A-Za-z0-9._:/-]{1,128}$/.test(artifactId) ? artifactId : null, detail: error.detail }) };
      }
    });
  },
};
export default component;

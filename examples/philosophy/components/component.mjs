import { readFileSync } from 'node:fs';
import { createKnowledgeEngine, KnowledgeError, OPERATIONS, PROFILE, sameContract, MAX_INPUT_BYTES, encode, digest } from './knowledge.mjs';
import { createTextReview } from './text-review.mjs';

/** @typedef {import('../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/component.js').ComponentModule} ComponentModule */
/** @type {ComponentModule} */
export default {
  activate(api) {
    const operation = OPERATIONS[api.contribution.id];
    if (!operation || !sameContract(api.contribution.contract, operation.contract)) throw new Error('Unsupported philosophy contribution.');
    const engine = createKnowledgeEngine(readFileSync(new URL('../resources/terminology.json', import.meta.url), 'utf8'));
    const review = api.contribution.id === 'check'
      ? createTextReview(engine,
        JSON.parse(readFileSync(new URL('../resources/text-review.json', import.meta.url), 'utf8')),
        JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version)
      : null;
    api.register((payload, metadata) => {
      try {
        if (api.signal.aborted || metadata.signal.aborted) throw new KnowledgeError('cancelled');
        if (!sameContract(payload.schema, operation.input) || !sameContract(metadata.profile, PROFILE)
          || typeof payload.utf8 !== 'string' || !payload.utf8.isWellFormed()) throw new KnowledgeError('invalid-input');
        if (Buffer.byteLength(payload.utf8) > MAX_INPUT_BYTES) throw new KnowledgeError('limit-exceeded');
        let input;
        try { input = JSON.parse(payload.utf8); } catch { throw new KnowledgeError('invalid-input'); }
        if (payload.sha256 !== digest(payload.utf8)) throw new KnowledgeError('invalid-input');
        const output = review ? review(input, metadata, api.signal) : engine.query(input, metadata.signal);
        if (api.signal.aborted || metadata.signal.aborted) throw new KnowledgeError('cancelled');
        return { kind: 'succeeded', utf8: encode(output) };
      } catch (error) {
        if (!(error instanceof KnowledgeError)) throw error;
        if (!review) return { kind: 'failed', utf8: encode({ code: error.code }) };
        const code = new Set(['unsupported-profile', 'limit-exceeded', 'cancelled']).has(error.code) ? error.code : 'invalid-input';
        return { kind: 'failed', utf8: encode({ code, unitId: null, detail: {
          'unsupported-profile': 'This resource supports English source text and the declared Chinese or Japanese target language.',
          'limit-exceeded': 'The complete text-review input or report exceeds the declared limit.',
          cancelled: 'The text review was cancelled before completion.',
          'invalid-input': 'The captured text-review schema, rule subset, resource or execution binding is invalid.',
        }[code] }) };
      }
    });
  },
};

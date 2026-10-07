import { readFileSync } from 'node:fs';
import { createKnowledgeEngine, KnowledgeError, OPERATIONS, ERROR_SCHEMA, PROFILE, sameContract, MAX_INPUT_BYTES, encode } from './knowledge.mjs';

/** @typedef {import('../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/component.js').ComponentModule} ComponentModule */
/** @type {ComponentModule} */
export default {
  activate(api) {
    const operation = OPERATIONS[api.contribution.id];
    if (!operation || !sameContract(api.contribution.contract, operation.contract)) throw new Error('Unsupported philosophy contribution.');
    const engine = createKnowledgeEngine(readFileSync(new URL('../resources/terminology.json', import.meta.url), 'utf8'));
    api.register((payload, metadata) => {
      try {
        if (api.signal.aborted || metadata.signal.aborted) throw new KnowledgeError('cancelled');
        if (!sameContract(payload.schema, operation.input) || !sameContract(metadata.profile, PROFILE)
          || typeof payload.utf8 !== 'string' || !payload.utf8.isWellFormed()) throw new KnowledgeError('invalid-input');
        if (Buffer.byteLength(payload.utf8) > MAX_INPUT_BYTES) throw new KnowledgeError('limit-exceeded');
        let input;
        try { input = JSON.parse(payload.utf8); } catch { throw new KnowledgeError('invalid-input'); }
        const output = engine[api.contribution.id](input, metadata.signal);
        if (api.signal.aborted || metadata.signal.aborted) throw new KnowledgeError('cancelled');
        return { kind: 'succeeded', utf8: encode(output) };
      } catch (error) {
        if (!(error instanceof KnowledgeError)) throw error;
        return { kind: 'failed', utf8: encode({ code: error.code }) };
      }
    });
  },
};

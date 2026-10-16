import { isDeepStrictEqual as same } from 'node:util';
import validateInput from '../sdk/validate-generation-service-input.mjs';
import validateReceipt from '../sdk/validate-generation-service-receipt.mjs';
import validateError from '../sdk/validate-generation-service-error.mjs';
import { GENERATION } from './definition.mjs';
import { digest } from './knowledge.mjs';

const failure = code => ({ kind: 'failed', utf8: JSON.stringify({ code }) });
const serviceMatches = binding => binding && same(binding.contract, GENERATION.service)
  && same(binding.inputSchema, GENERATION.input) && same(binding.outputSchema, GENERATION.output)
  && same(binding.errorSchema, GENERATION.error) && binding.effect === 'external';

/** @typedef {import('../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/component.js').ComponentModule} ComponentModule */
/** @type {ComponentModule} */
export default {
  activate(api) {
    if (api.instance.componentId !== GENERATION.componentId || api.contributions.length !== 1
      || api.contributions[0].id !== GENERATION.contributionId
      || !same(api.contributions[0].contract, GENERATION.contract)) {
      throw new Error('Unsupported philosophy generation contribution.');
    }
    // The real Host resolves this required single dependency before activation.
    // These captured descriptors supply no authority by themselves.
    if (api.services.length !== 1 || !serviceMatches(api.services[0])) {
      throw new Error('Missing exact captured generation service.');
    }
    const service = api.services[0];
    api.register(GENERATION.contributionId, async (payload, metadata) => {
      const stopped = () => api.signal.aborted || metadata.signal.aborted;
      if (stopped()) return failure('cancelled');
      if (!same(payload.schema, GENERATION.input) || metadata.profile !== null
        || typeof payload.utf8 !== 'string' || !payload.utf8.isWellFormed()) return failure('invalid-input');
      if (Buffer.byteLength(payload.utf8) > GENERATION.limits.maxInputBytes) return failure('limit-exceeded');
      if (payload.sha256 !== digest(payload.utf8)) return failure('invalid-input');
      let input;
      try { input = JSON.parse(payload.utf8); }
      catch { return failure('invalid-input'); }
      if (!validateInput(input) || !same(metadata.services.bindings, [service])) return failure('invalid-input');
      if (stopped()) return failure('cancelled');

      // One original call with unchanged child identities and source subset.
      // Transport rejection is left to the Host; it is not a fabricated service
      // failure, a retry, or proof that enqueueing had no effect.
      const response = await metadata.services.call(service.handleId, payload.utf8);
      // A cancelled pending call may already have admitted its child. Suppress
      // delivery through the original signals rather than replacing its ACK.
      api.signal.throwIfAborted();
      metadata.signal.throwIfAborted();
      const outcome = response.outcome;
      const succeeded = outcome.kind === 'succeeded';
      const output = succeeded ? outcome.output : outcome.error;
      if (!['succeeded', 'failed', 'unknown'].includes(outcome.kind) || !output
        || !same(output.schema, succeeded ? GENERATION.output : GENERATION.error)
        || typeof output.utf8 !== 'string' || !output.utf8.isWellFormed()
        || Buffer.byteLength(output.utf8) > GENERATION.limits.maxOutputBytes
        || output.sha256 !== digest(output.utf8)) throw new Error('Invalid generation service response.');
      let value;
      try { value = JSON.parse(output.utf8); }
      catch { throw new Error('Invalid generation service response.'); }
      if (succeeded ? !validateReceipt(value) || value.taskId !== input.taskId || value.attemptId !== input.attemptId
        : !validateError(value)) throw new Error('Invalid generation service response.');

      // A successful receipt acknowledges child admission, not model completion.
      return { kind: outcome.kind, utf8: output.utf8 };
    });
  },
};

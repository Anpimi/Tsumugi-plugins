import { isDeepStrictEqual as same } from 'node:util';
import { readFileSync } from 'node:fs';
import validateComponentInput from '../sdk/validate-generation-component-input.mjs';
import validateInput from '../sdk/validate-generation-service-input.mjs';
import validateReceipt from '../sdk/validate-generation-service-receipt.mjs';
import validateError from '../sdk/validate-generation-service-error.mjs';
import { createToolQuery, ToolQueryError } from '../sdk/tool-query.mjs';
import { GENERATION, OPERATIONS } from './definition.mjs';
import { createKnowledgeEngine, digest, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES } from './knowledge.mjs';

const failure = code => ({ kind: 'failed', utf8: JSON.stringify({ code }) });
const serviceMatches = binding => binding && binding.providerId === 'tsumugi.core' && same(binding.contract, GENERATION.service)
  && same(binding.inputSchema, GENERATION.serviceInput) && same(binding.outputSchema, GENERATION.output)
  && same(binding.errorSchema, GENERATION.error) && binding.effect === 'external';
const queryMatches = binding => binding && same(binding.contract, OPERATIONS.query.contract)
  && same(binding.inputSchema, OPERATIONS.query.input) && same(binding.outputSchema, OPERATIONS.query.output)
  && same(binding.errorSchema, OPERATIONS.query.error) && binding.effect === 'read-only';

function serviceOutput(response, binding, context, maxBytes, message, callId = null) {
  if (response?.handleId !== binding.handleId || !same(response.context, context)
    || typeof response.callId !== 'string' || !response.callId || callId !== null && response.callId !== callId) throw new Error(message);
  const outcome = response.outcome;
  const succeeded = outcome?.kind === 'succeeded';
  const output = succeeded ? outcome.output : outcome?.error;
  if (!['succeeded', 'failed', 'unknown'].includes(outcome?.kind) || !output
    || !same(output.schema, succeeded ? binding.outputSchema : binding.errorSchema)
    || typeof output.utf8 !== 'string' || !output.utf8.isWellFormed()
    || Buffer.byteLength(output.utf8) > Math.min(maxBytes, binding.limits.maxOutputBytes)
    || output.sha256 !== digest(output.utf8)) throw new Error(message);
  let value;
  try { value = JSON.parse(output.utf8); }
  catch { throw new Error(message); }
  return { outcome, output, value };
}

/** @typedef {import('../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/component.js').ComponentModule} ComponentModule */
/** @type {ComponentModule} */
export default {
  activate(api) {
    if (api.instance.componentId !== GENERATION.componentId || api.contributions.length !== 1
      || api.contributions[0].id !== GENERATION.contributionId
      || !same(api.contributions[0].contract, GENERATION.contract)) {
      throw new Error('Unsupported philosophy generation contribution.');
    }
    // The real Host resolves both required single dependencies before activation.
    // Captured descriptors expose no authority to select another tool or scope.
    const bindings = structuredClone(api.services);
    const service = bindings.find(serviceMatches), query = bindings.find(queryMatches);
    if (bindings.length !== 2 || !service || !query || service.handleId === query.handleId
      || service.projectId !== query.projectId || service.scopeId !== query.scopeId
      || service.activationGeneration !== query.activationGeneration) {
      throw new Error('Missing exact captured generation and query services.');
    }
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    const declaration = JSON.parse(readFileSync(new URL('../resources/agent-query-tool.json', import.meta.url), 'utf8'));
    const capability = manifest.contributions.find(value => value.id === declaration.capabilityId)?.contribution;
    if (capability?.kind !== 'capability' || !same(capability.declaration.contract, OPERATIONS.query.contract)) {
      throw new Error('Missing original philosophy query declaration.');
    }
    const presentation = createToolQuery({ declaration, capability: { declaration: capability.declaration } });
    const engine = createKnowledgeEngine(readFileSync(new URL('../resources/terminology.json', import.meta.url), 'utf8'));
    api.register(GENERATION.contributionId, async (payload, metadata) => {
      const stopped = () => api.signal.aborted || metadata.signal.aborted;
      const checkStopped = () => { api.signal.throwIfAborted(); metadata.signal.throwIfAborted(); };
      if (stopped()) return failure('cancelled');
      if (!same(payload.schema, GENERATION.input) || metadata.profile !== null
        || typeof payload.utf8 !== 'string' || !payload.utf8.isWellFormed()) return failure('invalid-input');
      if (Buffer.byteLength(payload.utf8) > GENERATION.limits.maxInputBytes) return failure('limit-exceeded');
      if (payload.sha256 !== digest(payload.utf8)) return failure('invalid-input');
      let input, prepared, queryInput, generationUtf8;
      try {
        input = JSON.parse(payload.utf8);
        if (!validateComponentInput(input) || !validateInput(input.generation) || input.preparedTools.length !== 1
          || !same(metadata.services.bindings, bindings)
          || metadata.context.projectId !== service.projectId || metadata.context.scopeId !== service.scopeId) return failure('invalid-input');
        prepared = input.preparedTools[0];
        if (prepared.handleId !== query.handleId || query.providerId !== `prepared-tool.${prepared.toolHandle}`
          || !same(prepared.input.schema, OPERATIONS.query.input) || !prepared.input.utf8.isWellFormed()
          || prepared.input.sha256 !== digest(prepared.input.utf8)) return failure('invalid-input');
        generationUtf8 = JSON.stringify(input.generation);
        if (Buffer.byteLength(generationUtf8) > Math.min(GENERATION.serviceLimits.maxInputBytes, service.limits.maxInputBytes)
          || Buffer.byteLength(prepared.input.utf8) > Math.min(MAX_INPUT_BYTES, query.limits.maxInputBytes)) return failure('limit-exceeded');
        queryInput = JSON.parse(prepared.input.utf8);
        if (!queryInput || typeof queryInput !== 'object' || Array.isArray(queryInput)) return failure('invalid-input');
        const original = queryInput.queries?.[0];
        if (!same(queryInput, presentation.prepare({ text: original?.text, target: queryInput.targetLanguage, selections: original?.conceptIds }))) return failure('invalid-input');
      } catch (error) {
        if (error instanceof SyntaxError) return failure('invalid-input');
        if (error instanceof ToolQueryError) return failure(error.code === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-input');
        throw error;
      }
      if (stopped()) return failure('cancelled');

      // Query exactly the input prepared by the Host, with its original call ID.
      // A transport rejection stays the original rejection and is never retried.
      const queryResponse = await metadata.services.call(query.handleId, prepared.input.utf8, prepared.callId);
      checkStopped();
      const reference = serviceOutput(queryResponse, query, metadata.context, MAX_OUTPUT_BYTES, 'Invalid philosophy query response.', prepared.callId);
      if (reference.outcome.kind !== 'succeeded') {
        if (!reference.value || !same(Object.keys(reference.value), ['code'])
          || typeof reference.value.code !== 'string' || !reference.value.code || !reference.value.code.isWellFormed()) throw new Error('Invalid philosophy query response.');
        // The component reports an unavailable prerequisite under its own error
        // contract. The original domain error stays in the tool's ledger.
        return reference.outcome.kind === 'unknown'
          ? { kind: 'unknown', utf8: JSON.stringify({ code: 'outcome-unknown' }) } : failure('unavailable');
      }
      const value = reference.value, original = queryInput.queries[0];
      if (!value || !same(Object.keys(value).sort(), ['basis', 'results']) || !value.basis
        || !same(Object.keys(value.basis).sort(), ['authority', 'coverage', 'querySha256', 'resource', 'sourceLanguage', 'targetLanguage'])
        || !same(value.basis.resource, engine.pin) || !same(value.basis.resource, queryInput.resource)
        || value.basis.sourceLanguage !== queryInput.sourceLanguage || value.basis.targetLanguage !== queryInput.targetLanguage
        || value.basis.querySha256 !== digest(JSON.stringify(queryInput)) || value.basis.authority !== engine.resource.authority
        || typeof value.basis.coverage !== 'string' || !value.basis.coverage.isWellFormed()
        || !Array.isArray(value.results) || value.results.length !== 1 || value.results[0]?.id !== original.id
        || !same(Object.keys(value.results[0]).sort(), ['entries', 'id'])) throw new Error('Invalid philosophy query response.');
      let entries;
      try { entries = presentation.entries(value); }
      catch { throw new Error('Invalid philosophy query response.'); }
      if (new Set(entries.map(entry => entry[0])).size !== entries.length
        || entries.some(entry => !original.conceptIds.includes(entry[0]))) throw new Error('Invalid philosophy query response.');
      checkStopped();

      // Empty reference results are valid. They remain unadopted suggestions;
      // this service accepts no prompt or reference-text override. The original
      // fixed model configuration, child identities and source subset are kept.
      const response = await metadata.services.call(service.handleId, generationUtf8);
      // A pending generation call may already have admitted its child. Suppress
      // delivery through the original signals rather than replacing its ACK.
      checkStopped();
      const result = serviceOutput(response, service, metadata.context, GENERATION.serviceLimits.maxOutputBytes, 'Invalid generation service response.');
      if (result.outcome.kind === 'succeeded'
        ? !validateReceipt(result.value) || result.value.taskId !== input.generation.taskId || result.value.attemptId !== input.generation.attemptId
        : !validateError(result.value)) throw new Error('Invalid generation service response.');

      // A successful receipt acknowledges child admission, not model completion.
      // Preserve original failed/unknown generation outcomes and payload bytes.
      return { kind: result.outcome.kind, utf8: result.output.utf8 };
    });
  },
};

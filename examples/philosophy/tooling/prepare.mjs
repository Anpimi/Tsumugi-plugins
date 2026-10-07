import { readFileSync, writeFileSync } from 'node:fs';
import { OPERATIONS, ERROR_SCHEMA, PROFILE, RESOURCE_SCHEMA, contract, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES } from '../components/knowledge.mjs';

// One public definition owns capability metadata; preparation executes no worker.
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const manifest = {
  protocolVersion: 1,
  plugin: { publisher: 'org.tsumugi.examples', id: 'philosophy', version },
  permissions: [{ kind: 'captured-input' }],
  components: [
    { id: 'knowledge', scope: 'project', runtime: 'javascript', entrypoint: 'components/component.mjs', dependencies: [], exit: { stopTimeoutMs: 1000, cleanupTimeoutMs: 1000 } },
    { id: 'reference', scope: 'application', runtime: 'data', entrypoint: null, dependencies: [], exit: { stopTimeoutMs: 1000, cleanupTimeoutMs: 1000 } },
  ],
  contributions: [
    ...Object.entries(OPERATIONS).map(([id, operation]) => ({ id, componentId: 'knowledge', contribution: { kind: 'capability', declaration: {
      contract: operation.contract, inputSchema: operation.input, outputSchema: operation.output, errorSchema: ERROR_SCHEMA, profiles: [PROFILE],
      effect: 'read-only', permissions: [{ kind: 'captured-input' }], limits: { maxInputBytes: MAX_INPUT_BYTES, maxOutputBytes: MAX_OUTPUT_BYTES, concurrency: 1, timeoutMs: 5000 },
    } } })),
    { id: 'terminology', componentId: 'reference', contribution: { kind: 'resource', schema: RESOURCE_SCHEMA, path: 'resources/terminology.json' } },
    { id: 'agent-query-tool', componentId: 'reference', contribution: { kind: 'resource', schema: contract('org.tsumugi.examples.capability-tool'), path: 'resources/agent-query-tool.json' } },
    { id: 'concept-review', componentId: 'reference', contribution: { kind: 'skill', path: 'skills/concept-review.md' } },
  ],
};
const tool = { name: 'philosophy_query', contributionId: 'query', capability: OPERATIONS.query.contract,
  inputSchema: OPERATIONS.query.input, outputSchema: OPERATIONS.query.output, profile: PROFILE,
  effect: 'read-only', description: 'Query explicitly selected philosophical concepts using the exact captured terminology resource. Returned preferences are unadopted suggestions.' };
for (const [path, value] of [['manifest.json', manifest], ['resources/agent-query-tool.json', tool]]) {
  writeFileSync(new URL(`../${path}`, import.meta.url), JSON.stringify(value, null, 2) + '\n');
}

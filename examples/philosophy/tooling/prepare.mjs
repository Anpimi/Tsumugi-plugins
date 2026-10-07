import { readFileSync, writeFileSync } from 'node:fs';
import { OPERATIONS, ERROR_SCHEMA, PROFILE, RESOURCE_SCHEMA, contract, digest, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES } from '../components/knowledge.mjs';
import validateTool from '../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/validate-tool-declaration.mjs';

// One public definition owns capability metadata; preparation executes no worker.
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const resourceUtf8 = readFileSync(new URL('../resources/terminology.json', import.meta.url), 'utf8');
const resource = JSON.parse(resourceUtf8);
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
    { id: 'agent-query-tool', componentId: 'reference', contribution: { kind: 'resource', schema: contract('tsumugi.capability-tool-declaration'), path: 'resources/agent-query-tool.json' } },
    { id: 'concept-review', componentId: 'reference', contribution: { kind: 'skill', path: 'skills/concept-review.md' } },
  ],
};
const tool = { name: 'philosophy_query', title: 'Philosophy terminology lookup', capabilityId: 'query',
  profile: PROFILE, supportingResources: ['terminology'], skill: 'concept-review',
  description: 'Query explicitly selected philosophical concepts using the exact captured terminology resource. Returned preferences are unadopted suggestions.',
  query: {
    inputSchema: OPERATIONS.query.input, outputSchema: OPERATIONS.query.output,
    inputTemplate: { resource: { id: resource.id, revision: resource.revision, sha256: digest(resourceUtf8) },
      sourceLanguage: resource.sourceLanguage, targetLanguage: 'zh-CN', queries: [{ id: 'query', text: '', conceptIds: [] }] },
    textPath: ['queries', 0, 'text'], maxTextBytes: 8192,
    target: { label: 'Target language', description: 'Choose the language of the reference preferences.', path: ['targetLanguage'],
      options: [{ value: 'zh-CN', label: '简体中文', description: 'Simplified Chinese editorial preferences.' },
        { value: 'ja', label: '日本語', description: 'Japanese editorial preferences.' }], minSelected: 1, maxSelected: 1 },
    selections: { label: 'Intended concepts', description: 'Choose the intended logic senses. A matching spelling alone does not select a sense.',
      path: ['queries', 0, 'conceptIds'], options: resource.concepts.map(concept => ({ value: concept.id, label: concept.sourceForms[0], description: concept.note })),
      minSelected: 1, maxSelected: resource.concepts.length },
    output: { entriesPath: ['results', 0, 'entries'], columns: [
      { label: 'Concept', path: ['conceptId'] }, { label: 'Preferred translation', path: ['preferredTarget'] }, { label: 'Usage note', path: ['note'] }],
      maxEntries: resource.concepts.length, emptyDescription: 'No preference matches this text and the explicitly selected concepts.' },
  } };
if (!validateTool(tool)) throw new Error('Tool declaration does not match the selected public SDK.');
for (const [path, value] of [['manifest.json', manifest], ['resources/agent-query-tool.json', tool]]) {
  writeFileSync(new URL(`../${path}`, import.meta.url), JSON.stringify(value, null, 2) + '\n');
}

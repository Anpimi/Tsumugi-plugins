import { constants, openSync, closeSync, fstatSync, lstatSync, readSync, writeFileSync, ftruncateSync, mkdirSync } from 'node:fs';
import { OPERATIONS, PROFILE, RESOURCE_SCHEMA, contract, digest, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, createKnowledgeEngine } from '../components/knowledge.mjs';
import { TEXT_REVIEW_DECLARATION_SCHEMA, textReviewDeclaration } from '../components/definition.mjs';
import validateTool from '../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/validate-tool-declaration.mjs';
import validateReview from '../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/validate-text-review-declaration.mjs';

const maximumFileBytes = 1024 * 1024;
function boundedFile(url) {
  const descriptor = openSync(url, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || before.size > maximumFileBytes) throw new Error('SDK preparation input is not a bounded ordinary file.');
    const buffer = Buffer.alloc(maximumFileBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = readSync(descriptor, buffer, size, buffer.length - size, null);
      if (read === 0) break;
      size += read;
    }
    const after = fstatSync(descriptor);
    if (size > maximumFileBytes || ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'].some(key => before[key] !== after[key])) {
      throw new Error('SDK preparation input changed or exceeded its bound.');
    }
    return buffer.subarray(0, size);
  } finally { closeSync(descriptor); }
}
function ordinaryDirectory(url) {
  const info = lstatSync(url);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Preparation output directory is not ordinary.');
}
function writeOutput(path, data) {
  if (Buffer.byteLength(data) > maximumFileBytes) throw new Error('Preparation output exceeds its bound.');
  const url = new URL(`../${path}`, import.meta.url);
  ordinaryDirectory(new URL('.', url));
  // Open without truncating first: a selected symlink or hardlink is rejected
  // before any existing output bytes can change.
  const descriptor = openSync(url, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.nlink !== 1 || info.size > maximumFileBytes) throw new Error('Preparation output is not a bounded ordinary file.');
    ftruncateSync(descriptor, 0);
    writeFileSync(descriptor, data);
  } finally { closeSync(descriptor); }
}

// One public definition owns capability metadata; preparation executes no worker.
const version = JSON.parse(boundedFile(new URL('../package.json', import.meta.url)).toString('utf8')).version;
const resourceUtf8 = boundedFile(new URL('../resources/terminology.json', import.meta.url)).toString('utf8');
const resource = createKnowledgeEngine(resourceUtf8).resource;
const review = textReviewDeclaration(resource);
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
      contract: operation.contract, inputSchema: operation.input, outputSchema: operation.output, errorSchema: operation.error, profiles: [PROFILE],
      effect: 'read-only', permissions: [{ kind: 'captured-input' }], limits: { maxInputBytes: MAX_INPUT_BYTES, maxOutputBytes: MAX_OUTPUT_BYTES, concurrency: 1, timeoutMs: 5000 },
    } } })),
    { id: 'terminology', componentId: 'reference', contribution: { kind: 'resource', schema: RESOURCE_SCHEMA, path: 'resources/terminology.json' } },
    { id: 'text-review', componentId: 'reference', contribution: { kind: 'resource', schema: TEXT_REVIEW_DECLARATION_SCHEMA, path: 'resources/text-review.json' } },
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
if (!validateReview(review)) throw new Error('Text-review declaration does not match the selected public SDK.');

// The same recipe selects source-test helpers and packaged SDK files. The
// repository's prepare-sdk owner verifies the archive/cache before this command.
const recipe = JSON.parse(boundedFile(new URL('../package-files.json', import.meta.url)).toString('utf8'));
try { mkdirSync(new URL('../sdk', import.meta.url), { mode: 0o700 }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
ordinaryDirectory(new URL('../sdk', import.meta.url));
for (const selected of recipe.sdkFiles) {
  if (!/^(?:LICENSE|javascript\/[a-z0-9-]+\.mjs)$/.test(selected.source)
    || !/^sdk\/(?:LICENSE|[a-z0-9-]+\.mjs)$/.test(selected.target)) throw new Error('Unsupported SDK file selector.');
  const data = boundedFile(new URL(`../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/${selected.source}`, import.meta.url));
  writeOutput(selected.target, data);
}
for (const [path, value] of [['manifest.json', manifest], ['resources/agent-query-tool.json', tool], ['resources/text-review.json', review]]) {
  writeOutput(path, JSON.stringify(value, null, 2) + '\n');
}

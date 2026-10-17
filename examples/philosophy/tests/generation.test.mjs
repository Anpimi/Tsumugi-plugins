import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import component from '../components/generation.mjs';
import { GENERATION, OPERATIONS, PROFILE } from '../components/definition.mjs';
import { createKnowledgeEngine, digest, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES } from '../components/knowledge.mjs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const engine = createKnowledgeEngine(readFileSync(new URL('../resources/terminology.json', import.meta.url), 'utf8'));
const taskId = '00000000-0000-4000-8000-000000000001';
const attemptId = '00000000-0000-4000-8000-000000000002';
const unitId = '00000000-0000-4000-8000-000000000003';
const generation = () => ({ taskId, attemptId, unitIds: [unitId] });
const queryInput = (text = 'A sound inference') => ({ resource: structuredClone(engine.pin), sourceLanguage: 'en', targetLanguage: 'zh-CN',
  queries: [{ id: 'query', text, conceptIds: ['soundness'] }] });
const encoded = (schema, utf8) => ({ schema: structuredClone(schema), utf8, sha256: digest(utf8) });
const prepared = (utf8 = JSON.stringify(queryInput())) => ({ handleId: 'prepared-tool-0', callId: '00000000-0000-4000-8000-000000000004',
  toolHandle: '00000000-0000-4000-8000-000000000005', input: encoded(OPERATIONS.query.input, utf8) });
const input = () => ({ generation: generation(), preparedTools: [prepared()] });
const receipt = () => ({ taskId, attemptId, inputDigest: 'c'.repeat(64) });
const context = () => ({ projectId: 'original-project', operationId: 'outer-operation', attemptId: 'outer-attempt',
  itemId: 'outer-item', dispatchId: 'outer-dispatch', inputDigest: 'd'.repeat(64), scopeDigest: 'e'.repeat(64),
  scopeId: 'outer-attempt', configurationDigest: 'f'.repeat(64), environmentDigest: '1'.repeat(64) });
const service = () => ({
  handleId: 'original-generation-handle', providerId: 'tsumugi.core', contract: structuredClone(GENERATION.service),
  inputSchema: structuredClone(GENERATION.serviceInput), outputSchema: structuredClone(GENERATION.output), errorSchema: structuredClone(GENERATION.error),
  effect: 'external', projectId: 'original-project', scopeId: 'outer-attempt', activationGeneration: 1,
  configurationDigest: 'b'.repeat(64), limits: { ...GENERATION.serviceLimits },
});
const queryService = () => ({
  handleId: prepared().handleId, providerId: `prepared-tool.${prepared().toolHandle}`, contract: structuredClone(OPERATIONS.query.contract),
  inputSchema: structuredClone(OPERATIONS.query.input), outputSchema: structuredClone(OPERATIONS.query.output), errorSchema: structuredClone(OPERATIONS.query.error),
  effect: 'read-only', projectId: 'original-project', scopeId: 'outer-attempt', activationGeneration: 1,
  configurationDigest: 'a'.repeat(64), limits: { maxInputBytes: MAX_INPUT_BYTES, maxOutputBytes: MAX_OUTPUT_BYTES, concurrency: 1, timeoutMs: 5000 },
});
const payload = (utf8 = JSON.stringify(input())) => encoded(GENERATION.input, utf8);
const response = (kind = 'succeeded', utf8 = JSON.stringify(receipt())) => ({
  callId: 'host-generated-call', handleId: service().handleId, context: context(),
  outcome: kind === 'succeeded' ? { kind, output: encoded(GENERATION.output, utf8) } : { kind, error: encoded(GENERATION.error, utf8) },
});
const queryResponse = (kind = 'succeeded', utf8 = JSON.stringify(engine.query(queryInput())), callId = prepared().callId) => ({
  callId, handleId: queryService().handleId, context: context(),
  outcome: kind === 'succeeded' ? { kind, output: encoded(OPERATIONS.query.output, utf8) } : { kind, error: encoded(OPERATIONS.query.error, utf8) },
});

// These are the real Process-3 facade fields with synthetic service responses.
// They establish no actual Host channel, model call or execution authority.
function activate({ bindings = [service(), queryService()], selected, instance, answer = () => response(),
  referenceAnswer = (utf8, callId) => queryResponse('succeeded', JSON.stringify(engine.query(JSON.parse(utf8))), callId) } = {}) {
  const calls = [], scope = new AbortController(), invocation = new AbortController();
  let handler;
  const principal = instance ?? { plugin: manifest.plugin, componentId: GENERATION.componentId,
    packageDigest: 'a'.repeat(64), instanceId: 'original-instance', activationGeneration: 1 };
  component.activate({
    instance: principal, services: bindings, signal: scope.signal,
    contributions: selected ?? [{ id: GENERATION.contributionId, contract: structuredClone(GENERATION.contract) }],
    register(id, value) { assert.equal(id, GENERATION.contributionId); assert.equal(handler, undefined); handler = value; },
    onDispose() {},
  });
  const metadata = { provider: { ...principal, contributionId: GENERATION.contributionId }, profile: null, signal: invocation.signal,
    context: context(), services: { bindings, async call(...args) {
      calls.push(args);
      return args[0] === queryService().handleId ? referenceAnswer(args[1], args[2]) : answer(args[1]);
    } } };
  assert.equal(typeof handler, 'function');
  return { handler, metadata, calls, scope, invocation };
}

const callSequence = value => [
  [queryService().handleId, value.preparedTools[0].input.utf8, value.preparedTools[0].callId],
  [service().handleId, JSON.stringify(value.generation)],
];

test('generated metadata opts Attempt generation into the wrapper and two separate required services', () => {
  assert.deepEqual(Object.keys(OPERATIONS).sort(), ['check', 'query']);
  const selected = manifest.components.find(value => value.id === 'generation');
  assert.deepEqual(selected, {
    id: 'generation', scope: 'attempt', runtime: 'javascript', entrypoint: 'components/generation.mjs',
    dependencies: [GENERATION.service, OPERATIONS.query.contract].map(contract => ({ contract, required: true, selection: 'single' })),
    exit: { stopTimeoutMs: 1000, cleanupTimeoutMs: 1000 },
  });
  const contribution = manifest.contributions.find(value => value.id === 'generation-delegate');
  assert.equal(contribution.componentId, 'generation');
  assert.deepEqual(contribution.contribution, { kind: 'capability', declaration: {
    contract: { id: 'org.tsumugi.examples.philosophy-generation-delegate', schemaVersion: 2, behaviorVersion: 2 },
    inputSchema: { id: 'tsumugi.generation-component-input', schemaVersion: 1, behaviorVersion: 1 },
    outputSchema: { id: 'tsumugi.work-plan-generation-receipt', schemaVersion: 1, behaviorVersion: 1 },
    errorSchema: { id: 'tsumugi.work-plan-generation-error', schemaVersion: 1, behaviorVersion: 1 },
    profiles: [], effect: 'external', permissions: [GENERATION.service, OPERATIONS.query.contract].map(contract => ({ kind: 'project-service', contract })), limits: GENERATION.limits,
  } });
  assert.deepEqual(manifest.permissions, [{ kind: 'captured-input' }, ...[GENERATION.service, OPERATIONS.query.contract].map(contract => ({ kind: 'project-service', contract }))]);
  assert.deepEqual(GENERATION.serviceInput, { id: 'tsumugi.work-plan-generation-input', schemaVersion: 1, behaviorVersion: 1 });
  assert.equal(GENERATION.limits.maxInputBytes, 1024 * 1024);
  assert.equal(GENERATION.serviceLimits.maxInputBytes, 16 * 1024);
  for (const id of ['query', 'check']) {
    const selected = manifest.contributions.find(value => value.id === id);
    assert.equal(selected.componentId, 'knowledge');
    assert.equal(selected.contribution.declaration.effect, 'read-only');
    assert.deepEqual(selected.contribution.declaration.permissions, [{ kind: 'captured-input' }]);
    assert.deepEqual(selected.contribution.declaration.profiles, [PROFILE]);
  }
  assert.deepEqual(manifest.components.filter(value => ['knowledge', 'reference'].includes(value.id)).map(value => [value.id, value.scope, value.dependencies]),
    [['knowledge', 'project', []], ['reference', 'application', []]]);
});

test('query succeeds before the one unchanged generation call and every original generation outcome retains its bytes', async () => {
  const value = input();
  value.preparedTools[0] = prepared(` ${JSON.stringify(queryInput())}\n`);
  for (const [kind, utf8] of [
    ['succeeded', ` { "taskId": "${taskId}", "attemptId": "${attemptId}", "inputDigest": "${'c'.repeat(64)}" }\n`],
    ['failed', ' { "code": "permission-denied" }\n'],
    ['unknown', '\n{"code":"outcome-unknown"}\n'],
  ]) {
    const selected = activate({ answer: () => response(kind, utf8) });
    const result = await selected.handler(payload(` ${JSON.stringify(value)}\n`), selected.metadata);
    assert.deepEqual(result, { kind, utf8 });
    assert.deepEqual(selected.calls, callSequence(value));
    if (kind === 'succeeded') assert.deepEqual(Object.keys(JSON.parse(result.utf8)).sort(), ['attemptId', 'inputDigest', 'taskId']);
  }
});

test('an empty valid reference result still permits the original child without adding prompt or terminology fields', async () => {
  const value = input(); value.preparedTools[0] = prepared(JSON.stringify(queryInput('No selected term here')));
  assert.deepEqual(engine.query(JSON.parse(value.preparedTools[0].input.utf8)).results[0].entries, []);
  const selected = activate({ bindings: [queryService(), service()] });
  assert.deepEqual(await selected.handler(payload(JSON.stringify(value)), selected.metadata), { kind: 'succeeded', utf8: JSON.stringify(receipt()) });
  assert.deepEqual(selected.calls, callSequence(value));
  assert.deepEqual(Object.keys(JSON.parse(selected.calls[1][1])).sort(), ['attemptId', 'taskId', 'unitIds']);
});

test('activation requires one exact Core service and one captured read-only query service in the same caller scope', () => {
  assert.throws(() => activate({ selected: [] }), /Unsupported philosophy generation contribution/);
  assert.throws(() => activate({ selected: [{ id: 'query', contract: GENERATION.contract }] }), /Unsupported philosophy generation contribution/);
  assert.throws(() => activate({ instance: { componentId: 'knowledge' } }), /Unsupported philosophy generation contribution/);
  for (const field of ['id', 'schemaVersion', 'behaviorVersion']) {
    const contract = structuredClone(GENERATION.contract); contract[field] = field === 'id' ? 'org.example.other' : 1;
    assert.throws(() => activate({ selected: [{ id: GENERATION.contributionId, contract }] }), /Unsupported philosophy generation contribution/);
  }
  for (const bindings of [[], [service()], [queryService()], [service(), service()], [queryService(), queryService()], [service(), queryService(), queryService()]])
    assert.throws(() => activate({ bindings }), /Missing exact captured generation and query services/);
  for (const index of [0, 1]) for (const field of ['contract', 'inputSchema', 'outputSchema', 'errorSchema']) for (const version of ['id', 'schemaVersion', 'behaviorVersion']) {
    const bindings = [service(), queryService()]; bindings[index][field][version] = version === 'id' ? 'tsumugi.other' : 2;
    assert.throws(() => activate({ bindings }), /Missing exact captured generation and query services/);
  }
  for (const mutate of [
    bindings => { bindings[0].providerId = 'other.core'; },
    bindings => { bindings[0].effect = 'read-only'; },
    bindings => { bindings[1].effect = 'external'; },
    bindings => { bindings[1].handleId = bindings[0].handleId; },
    bindings => { bindings[1].projectId = 'other-project'; },
    bindings => { bindings[1].scopeId = 'other-attempt'; },
    bindings => { bindings[1].activationGeneration += 1; },
  ]) {
    const bindings = [service(), queryService()]; mutate(bindings);
    assert.throws(() => activate({ bindings }), /Missing exact captured generation and query services/);
  }
});

test('wrong schemas profiles digests and replaced invocation descriptors never call either service', async () => {
  for (const mutate of [
    (value, metadata) => { value.schema.id = GENERATION.serviceInput.id; },
    (value, metadata) => { value.schema.schemaVersion = 2; },
    (value, metadata) => { value.schema.behaviorVersion = 2; },
    (value, metadata) => { value.sha256 = '0'.repeat(64); },
    (value, metadata) => { metadata.profile = structuredClone(PROFILE); },
    (value, metadata) => { delete metadata.profile; },
    (value, metadata) => { metadata.services.bindings = []; },
    (value, metadata) => { metadata.services.bindings[0].handleId = 'replacement'; },
    (value, metadata) => { metadata.services.bindings[1].providerId = 'other-tool'; },
    (value, metadata) => { metadata.services.bindings[1].projectId = 'other-project'; },
    (value, metadata) => { metadata.services.bindings[1].activationGeneration += 1; },
    (value, metadata) => { metadata.context.projectId = 'other-project'; },
    (value, metadata) => { metadata.context.scopeId = 'other-attempt'; },
  ]) {
    const selected = activate(), value = payload(); mutate(value, selected.metadata);
    assert.deepEqual(await selected.handler(value, selected.metadata), { kind: 'failed', utf8: '{"code":"invalid-input"}' });
    assert.deepEqual(selected.calls, []);
  }
});

test('the wrapper and exact prepared query refuse missing tools scope expansion replaced payloads and legacy input', async () => {
  for (const mutate of [
    value => { value.generation.prompt = 'replacement'; },
    value => { value.generation.budget = 99; },
    value => { value.generation.unitIds = [unitId, unitId]; },
    value => { value.generation.unitIds = []; },
    value => { value.generation.unitIds = Array.from({ length: 101 }, (_, index) => `source-${index}`); },
    value => { value.preparedTools = []; },
    value => { value.preparedTools.push(structuredClone(value.preparedTools[0])); },
    value => { value.preparedTools[0].handleId = 'unselected-handle'; },
    value => { value.preparedTools[0].toolHandle = 'unselected-tool'; },
    value => { value.preparedTools[0].callId = ''; },
    value => { value.preparedTools[0].input.schema.behaviorVersion = 2; },
    value => { value.preparedTools[0].input.sha256 = '0'.repeat(64); },
    value => { const parsed = queryInput(); parsed.queries[0].id = 'unselected-query'; value.preparedTools[0] = prepared(JSON.stringify(parsed)); },
    value => { const parsed = queryInput(); parsed.resource.revision = 'other-resource'; value.preparedTools[0] = prepared(JSON.stringify(parsed)); },
    value => { const parsed = queryInput(); parsed.queries.push(structuredClone(parsed.queries[0])); value.preparedTools[0] = prepared(JSON.stringify(parsed)); },
  ]) {
    const selected = activate(), value = input(); mutate(value);
    assert.deepEqual(await selected.handler(payload(JSON.stringify(value)), selected.metadata), { kind: 'failed', utf8: '{"code":"invalid-input"}' });
    assert.deepEqual(selected.calls, []);
  }
  for (const utf8 of ['{', JSON.stringify(generation())]) {
    const selected = activate();
    assert.deepEqual(await selected.handler(payload(utf8), selected.metadata), { kind: 'failed', utf8: '{"code":"invalid-input"}' });
    assert.deepEqual(selected.calls, []);
  }
});

test('the complete wrapper bound and each original service input bound apply before any query', async () => {
  const base = JSON.stringify(input()), atLimit = base + ' '.repeat(GENERATION.limits.maxInputBytes - Buffer.byteLength(base));
  const accepted = activate();
  assert.equal((await accepted.handler(payload(atLimit), accepted.metadata)).kind, 'succeeded');
  assert.deepEqual(accepted.calls, callSequence(input()));
  const oversized = activate();
  assert.deepEqual(await oversized.handler(payload(atLimit + ' '), oversized.metadata), { kind: 'failed', utf8: '{"code":"limit-exceeded"}' });
  assert.deepEqual(oversized.calls, []);
  for (const index of [0, 1]) {
    const bindings = [service(), queryService()]; bindings[index].limits.maxInputBytes = 1;
    const selected = activate({ bindings });
    assert.deepEqual(await selected.handler(payload(), selected.metadata), { kind: 'failed', utf8: '{"code":"limit-exceeded"}' });
    assert.deepEqual(selected.calls, []);
  }
  const selected = activate(), value = input();
  value.preparedTools[0] = prepared(JSON.stringify(queryInput('x'.repeat(8193))));
  assert.deepEqual(await selected.handler(payload(JSON.stringify(value)), selected.metadata), { kind: 'failed', utf8: '{"code":"limit-exceeded"}' });
  assert.deepEqual(selected.calls, []);
});

test('query failed and unknown outcomes block Core admission and use the component error contract without a forged receipt', async () => {
  for (const [kind, code] of [['failed', 'unavailable'], ['unknown', 'outcome-unknown']]) {
    const selected = activate({ referenceAnswer: () => queryResponse(kind, ' {"code":"resource-mismatch"}\n') });
    assert.deepEqual(await selected.handler(payload(), selected.metadata), { kind, utf8: JSON.stringify({ code }) });
    assert.deepEqual(selected.calls, [callSequence(input())[0]]);
  }
  for (const utf8 of ['{', '{}', '{"code":12}', '{"code":"cancelled","retry":true}']) {
    const selected = activate({ referenceAnswer: () => queryResponse('failed', utf8) });
    await assert.rejects(() => selected.handler(payload(), selected.metadata), /Invalid philosophy query response/);
    assert.equal(selected.calls.length, 1);
  }
});

test('query replies must retain the original call context resource language query and selected concept association', async () => {
  for (const mutate of [
    response => { response.handleId = 'other-handle'; },
    response => { response.callId = 'other-call'; },
    response => { response.context.projectId = 'other-project'; },
    response => { response.context.scopeId = 'other-attempt'; },
    response => { response.outcome.output.schema.behaviorVersion = 2; },
    response => { response.outcome.output.sha256 = '0'.repeat(64); },
  ]) {
    const invalid = queryResponse(); mutate(invalid);
    const selected = activate({ referenceAnswer: () => invalid });
    await assert.rejects(() => selected.handler(payload(), selected.metadata), /Invalid philosophy query response/);
    assert.equal(selected.calls.length, 1);
  }
  for (const mutate of [
    value => { value.basis.resource.revision = 'other-resource'; },
    value => { value.basis.querySha256 = '0'.repeat(64); },
    value => { value.basis.sourceLanguage = 'other-source'; },
    value => { value.basis.targetLanguage = 'ja'; },
    value => { value.basis.authority = 'adopted'; },
    value => { value.results[0].id = 'other-query'; },
    value => { value.results.push(structuredClone(value.results[0])); },
    value => { value.results[0].entries[0].preferredTarget = 12; },
    value => { value.results[0].entries[0].conceptId = 'premise'; },
    value => { value.results[0].entries.push(structuredClone(value.results[0].entries[0])); },
  ]) {
    const invalid = structuredClone(engine.query(queryInput())); mutate(invalid);
    const selected = activate({ referenceAnswer: () => queryResponse('succeeded', JSON.stringify(invalid)) });
    await assert.rejects(() => selected.handler(payload(), selected.metadata), /Invalid philosophy query response/);
    assert.equal(selected.calls.length, 1);
  }
});

test('cancellation before or during query never starts Core and cancellation during generation never retries its unknown admission', async () => {
  for (const owner of ['scope', 'invocation']) {
    const selected = activate(); selected[owner].abort();
    assert.deepEqual(await selected.handler(payload(), selected.metadata), { kind: 'failed', utf8: '{"code":"cancelled"}' });
    assert.deepEqual(selected.calls, []);
    let querying;
    querying = activate({ referenceAnswer: () => { querying[owner].abort(); return queryResponse(); } });
    await assert.rejects(() => querying.handler(payload(), querying.metadata), error => error.name === 'AbortError');
    assert.equal(querying.calls.length, 1);
    assert.deepEqual(await querying.handler(payload(), querying.metadata), { kind: 'failed', utf8: '{"code":"cancelled"}' });
    assert.equal(querying.calls.length, 1);
  }
  let selected;
  selected = activate({ answer: () => { selected.invocation.abort(); return response(); } });
  await assert.rejects(() => selected.handler(payload(), selected.metadata), error => error.name === 'AbortError');
  assert.equal(selected.calls.length, 2);
  assert.deepEqual(await selected.handler(payload(), selected.metadata), { kind: 'failed', utf8: '{"code":"cancelled"}' });
  assert.equal(selected.calls.length, 2);
});

test('query and generation transport rejections remain their original exceptions without automatic retries', async () => {
  const original = new Error('original service transport failed');
  for (const phase of ['query', 'generation']) {
    const selected = activate(phase === 'query'
      ? { referenceAnswer: () => { throw original; } } : { answer: () => { throw original; } });
    await assert.rejects(() => selected.handler(payload(), selected.metadata), error => error === original);
    assert.equal(selected.calls.length, phase === 'query' ? 1 : 2);
  }
});

test('invalid generation receipts errors schemas and oversized replies cannot become successful acknowledgements after query', async () => {
  for (const mutate of [
    value => { value.handleId = 'other-generation-handle'; },
    value => { value.context.attemptId = 'other-outer-attempt'; },
    value => { value.outcome.output.schema.behaviorVersion = 2; },
    value => { value.outcome.output.sha256 = '0'.repeat(64); },
    value => { value.outcome.output = encoded(GENERATION.output, JSON.stringify({ ...receipt(), taskId: 'other-child' })); },
    value => { value.outcome.output = encoded(GENERATION.output, JSON.stringify({ ...receipt(), attemptId: 'other-attempt' })); },
    value => { value.outcome.output = encoded(GENERATION.output, JSON.stringify({ ...receipt(), completed: true })); },
    value => { value.outcome.output = encoded(GENERATION.output, value.outcome.output.utf8 + ' '.repeat(1025)); },
  ]) {
    const invalid = response(); mutate(invalid);
    const selected = activate({ answer: () => invalid });
    await assert.rejects(() => selected.handler(payload(), selected.metadata), /Invalid generation service response/);
    assert.equal(selected.calls.length, 2);
  }
  for (const [kind, utf8] of [['failed', '{"code":"unknown-code"}'], ['unknown', '{"code":"outcome-unknown","retry":true}'], ['failed', '{']]) {
    const selected = activate({ answer: () => response(kind, utf8) });
    await assert.rejects(() => selected.handler(payload(), selected.metadata), /Invalid generation service response/);
    assert.equal(selected.calls.length, 2);
  }
});

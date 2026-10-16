import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import component from '../components/generation.mjs';
import { GENERATION, OPERATIONS, PROFILE } from '../components/definition.mjs';
import { digest } from '../components/knowledge.mjs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const taskId = '00000000-0000-4000-8000-000000000001';
const attemptId = '00000000-0000-4000-8000-000000000002';
const unitId = '00000000-0000-4000-8000-000000000003';
const input = () => ({ taskId, attemptId, unitIds: [unitId] });
const receipt = () => ({ taskId, attemptId, inputDigest: 'c'.repeat(64) });
const service = () => ({
  handleId: 'original-generation-handle', providerId: 'tsumugi.core', contract: structuredClone(GENERATION.service),
  inputSchema: structuredClone(GENERATION.input), outputSchema: structuredClone(GENERATION.output), errorSchema: structuredClone(GENERATION.error),
  effect: 'external', projectId: 'original-project', scopeId: 'outer-attempt', activationGeneration: 1,
  configurationDigest: 'b'.repeat(64), limits: { ...GENERATION.limits },
});
const payload = (utf8 = JSON.stringify(input())) => ({ schema: structuredClone(GENERATION.input), utf8, sha256: digest(utf8) });
const response = (kind = 'succeeded', utf8 = JSON.stringify(receipt())) => ({
  callId: 'host-generated-call', handleId: 'original-generation-handle', context: {},
  outcome: kind === 'succeeded'
    ? { kind, output: { schema: structuredClone(GENERATION.output), utf8, sha256: digest(utf8) } }
    : { kind, error: { schema: structuredClone(GENERATION.error), utf8, sha256: digest(utf8) } },
});

// These are the real Process-3 facade fields with a synthetic service response.
// They establish no actual Host channel, model call or execution authority.
function activate({ bindings = [service()], selected, instance, answer = () => response() } = {}) {
  const calls = [];
  const scope = new AbortController();
  const invocation = new AbortController();
  let handler;
  const principal = instance ?? { plugin: manifest.plugin, componentId: GENERATION.componentId,
    packageDigest: 'a'.repeat(64), instanceId: 'original-instance', activationGeneration: 1 };
  component.activate({
    instance: principal, services: bindings, signal: scope.signal,
    contributions: selected ?? [{ id: GENERATION.contributionId, contract: structuredClone(GENERATION.contract) }],
    register(id, value) { assert.equal(id, GENERATION.contributionId); assert.equal(handler, undefined); handler = value; },
    onDispose() {},
  });
  const metadata = {
    provider: { ...principal, contributionId: GENERATION.contributionId }, profile: null, signal: invocation.signal,
    context: { projectId: 'original-project', operationId: 'outer-operation', attemptId: 'outer-attempt',
      itemId: 'outer-item', dispatchId: 'outer-dispatch', inputDigest: 'd'.repeat(64),
      scopeDigest: 'e'.repeat(64), scopeId: 'outer-attempt', configurationDigest: 'f'.repeat(64), environmentDigest: '1'.repeat(64) },
    services: { bindings, async call(...args) { calls.push(args); return answer(); } },
  };
  assert.equal(typeof handler, 'function');
  return { handler, metadata, calls, scope, invocation };
}

test('generated generation metadata keeps effectful Attempt delegation separate from knowledge', () => {
  assert.deepEqual(Object.keys(OPERATIONS).sort(), ['check', 'query']);
  const generation = manifest.components.find(value => value.id === 'generation');
  assert.deepEqual(generation, {
    id: 'generation', scope: 'attempt', runtime: 'javascript', entrypoint: 'components/generation.mjs',
    dependencies: [{ contract: { id: 'tsumugi.work-plan-generation', schemaVersion: 1, behaviorVersion: 1 }, required: true, selection: 'single' }],
    exit: { stopTimeoutMs: 1000, cleanupTimeoutMs: 1000 },
  });
  const selected = manifest.contributions.find(value => value.id === 'generation-delegate');
  assert.equal(selected.componentId, 'generation');
  assert.deepEqual(selected.contribution, { kind: 'capability', declaration: {
    contract: { id: 'org.tsumugi.examples.philosophy-generation-delegate', schemaVersion: 1, behaviorVersion: 1 },
    inputSchema: { id: 'tsumugi.work-plan-generation-input', schemaVersion: 1, behaviorVersion: 1 },
    outputSchema: { id: 'tsumugi.work-plan-generation-receipt', schemaVersion: 1, behaviorVersion: 1 },
    errorSchema: { id: 'tsumugi.work-plan-generation-error', schemaVersion: 1, behaviorVersion: 1 },
    profiles: [], effect: 'external', permissions: [{ kind: 'project-service', contract: GENERATION.service }], limits: GENERATION.limits,
  } });
  assert.deepEqual(manifest.permissions, [{ kind: 'captured-input' }, { kind: 'project-service', contract: GENERATION.service }]);
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

test('delegate makes one exact facade call and preserves every service outcome and original bytes', async () => {
  const original = ` { "taskId": "${taskId}", "attemptId": "${attemptId}", "unitIds": ["${unitId}"] }\n`;
  for (const [kind, utf8] of [
    ['succeeded', ` { "taskId": "${taskId}", "attemptId": "${attemptId}", "inputDigest": "${'c'.repeat(64)}" }\n`],
    ['failed', ' { "code": "permission-denied" }\n'],
    ['unknown', '\n{"code":"outcome-unknown"}\n'],
  ]) {
    const selected = activate({ answer: () => response(kind, utf8) });
    const result = await selected.handler(payload(original), selected.metadata);
    assert.deepEqual(result, { kind, utf8 });
    assert.deepEqual(selected.calls, [['original-generation-handle', original]]);
    if (kind === 'succeeded') assert.deepEqual(Object.keys(JSON.parse(result.utf8)).sort(), ['attemptId', 'inputDigest', 'taskId']);
  }
});

test('activation requires the exact selected contribution and one matching generation service', () => {
  assert.throws(() => activate({ selected: [] }), /Unsupported philosophy generation contribution/);
  assert.throws(() => activate({ selected: [{ id: 'query', contract: GENERATION.contract }] }), /Unsupported philosophy generation contribution/);
  assert.throws(() => activate({ instance: { componentId: 'knowledge' } }), /Unsupported philosophy generation contribution/);
  for (const field of ['id', 'schemaVersion', 'behaviorVersion']) {
    const contract = structuredClone(GENERATION.contract);
    contract[field] = field === 'id' ? 'org.example.other' : 2;
    assert.throws(() => activate({ selected: [{ id: GENERATION.contributionId, contract }] }), /Unsupported philosophy generation contribution/);
  }
  assert.throws(() => activate({ bindings: [] }), /Missing exact captured generation service/);
  assert.throws(() => activate({ bindings: [service(), service()] }), /Missing exact captured generation service/);
  for (const field of ['contract', 'inputSchema', 'outputSchema', 'errorSchema']) {
    for (const version of ['id', 'schemaVersion', 'behaviorVersion']) {
      const binding = service();
      binding[field][version] = version === 'id' ? 'tsumugi.other' : 2;
      assert.throws(() => activate({ bindings: [binding] }), /Missing exact captured generation service/);
    }
  }
  const binding = service(); binding.effect = 'read-only';
  assert.throws(() => activate({ bindings: [binding] }), /Missing exact captured generation service/);
});

test('wrong invocation schemas profiles digests and replaced service bindings never call the service', async () => {
  for (const mutate of [
    (value, metadata) => { value.schema.id = 'example.other'; },
    (value, metadata) => { value.schema.schemaVersion = 2; },
    (value, metadata) => { value.schema.behaviorVersion = 2; },
    (value, metadata) => { value.sha256 = '0'.repeat(64); },
    (value, metadata) => { metadata.profile = structuredClone(PROFILE); },
    (value, metadata) => { delete metadata.profile; },
    (value, metadata) => { metadata.services.bindings = []; },
    (value, metadata) => { metadata.services.bindings = [service()]; metadata.services.bindings[0].handleId = 'replacement'; },
    (value, metadata) => { metadata.services.bindings = [service()]; metadata.services.bindings[0].projectId = 'other-project'; },
    (value, metadata) => { metadata.services.bindings = [service()]; metadata.services.bindings[0].activationGeneration += 1; },
  ]) {
    const selected = activate();
    const value = payload();
    mutate(value, selected.metadata);
    assert.deepEqual(await selected.handler(value, selected.metadata), { kind: 'failed', utf8: '{"code":"invalid-input"}' });
    assert.deepEqual(selected.calls, []);
  }
});

test('SDK input validation and the complete byte bound refuse scope expansion before a call', async () => {
  const forbidden = { ...input(), endpoint: 'https://example.invalid', prompt: 'replacement', budget: 99 };
  const duplicate = { ...input(), unitIds: [unitId, unitId] };
  const empty = { ...input(), unitIds: [] };
  const tooMany = { ...input(), unitIds: Array.from({ length: 101 }, (_, index) => `source-${index}`) };
  for (const utf8 of ['{', JSON.stringify(forbidden), JSON.stringify(duplicate), JSON.stringify(empty), JSON.stringify(tooMany)]) {
    const selected = activate();
    assert.deepEqual(await selected.handler(payload(utf8), selected.metadata), { kind: 'failed', utf8: '{"code":"invalid-input"}' });
    assert.deepEqual(selected.calls, []);
  }
  const base = JSON.stringify(input());
  const atLimit = base + ' '.repeat(16 * 1024 - Buffer.byteLength(base));
  const accepted = activate();
  assert.equal((await accepted.handler(payload(atLimit), accepted.metadata)).kind, 'succeeded');
  assert.deepEqual(accepted.calls, [['original-generation-handle', atLimit]]);
  const oversized = activate();
  assert.deepEqual(await oversized.handler(payload(atLimit + ' '), oversized.metadata), { kind: 'failed', utf8: '{"code":"limit-exceeded"}' });
  assert.deepEqual(oversized.calls, []);
});

test('cancellation prevents new service calls and never retries an already submitted call', async () => {
  for (const owner of ['scope', 'invocation']) {
    const selected = activate();
    selected[owner].abort();
    assert.deepEqual(await selected.handler(payload(), selected.metadata), { kind: 'failed', utf8: '{"code":"cancelled"}' });
    assert.deepEqual(selected.calls, []);
  }
  let selected;
  selected = activate({ answer: () => { selected.invocation.abort(); return response(); } });
  await assert.rejects(() => selected.handler(payload(), selected.metadata), error => error.name === 'AbortError');
  assert.equal(selected.calls.length, 1);
  assert.deepEqual(await selected.handler(payload(), selected.metadata), { kind: 'failed', utf8: '{"code":"cancelled"}' });
  assert.equal(selected.calls.length, 1);
});

test('transport rejection stays an original rejection without a fabricated unavailable result or retry', async () => {
  const original = new Error('original service transport failed');
  const selected = activate({ answer: () => { throw original; } });
  await assert.rejects(() => selected.handler(payload(), selected.metadata), error => error === original);
  assert.equal(selected.calls.length, 1);
});

test('invalid receipts errors schemas or oversized replies cannot become successful acknowledgements', async () => {
  for (const mutate of [
    value => { value.outcome.output.schema.behaviorVersion = 2; },
    value => { value.outcome.output.sha256 = '0'.repeat(64); },
    value => { value.outcome.output.utf8 = JSON.stringify({ ...receipt(), taskId: 'other-child' }); value.outcome.output.sha256 = digest(value.outcome.output.utf8); },
    value => { value.outcome.output.utf8 = JSON.stringify({ ...receipt(), attemptId: 'other-attempt' }); value.outcome.output.sha256 = digest(value.outcome.output.utf8); },
    value => { value.outcome.output.utf8 = JSON.stringify({ ...receipt(), completed: true }); value.outcome.output.sha256 = digest(value.outcome.output.utf8); },
    value => { value.outcome.output.utf8 += ' '.repeat(1025); value.outcome.output.sha256 = digest(value.outcome.output.utf8); },
  ]) {
    const invalid = response(); mutate(invalid);
    const selected = activate({ answer: () => invalid });
    await assert.rejects(() => selected.handler(payload(), selected.metadata), /Invalid generation service response/);
    assert.equal(selected.calls.length, 1);
  }
  for (const [kind, utf8] of [
    ['failed', '{"code":"unknown-code"}'],
    ['unknown', '{"code":"outcome-unknown","retry":true}'],
    ['failed', '{'],
  ]) {
    const selected = activate({ answer: () => response(kind, utf8) });
    await assert.rejects(() => selected.handler(payload(), selected.metadata), /Invalid generation service response/);
    assert.equal(selected.calls.length, 1);
  }
});

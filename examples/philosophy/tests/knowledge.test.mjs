import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import component from '../components/component.mjs';
import { createKnowledgeEngine, digest, KnowledgeError, OPERATIONS, PROFILE } from '../components/knowledge.mjs';
import validateTool from '../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/validate-tool-declaration.mjs';

const bytes = readFileSync(new URL('../resources/terminology.json', import.meta.url), 'utf8');
const engine = createKnowledgeEngine(bytes);
const query = (text = 'sound premises and a valid inference') => ({ resource: structuredClone(engine.pin),
  sourceLanguage: 'en', targetLanguage: 'zh-CN', queries: [{ id: 'u-1', text, conceptIds: ['soundness', 'premise', 'validity', 'inference'] }] });
const check = (translationText = '可靠性的前提与有效性推理') => ({ resource: structuredClone(engine.pin),
  sourceLanguage: 'en', targetLanguage: 'zh-CN', items: [{ id: 'u-1', sourceText: 'sound premises and a valid inference', translationText,
    conceptIds: ['soundness', 'premise', 'validity', 'inference'] }] });
const fails = (call, code) => assert.throws(call, error => error instanceof KnowledgeError && error.code === code);

test('query retains exact editorial resource and selected concepts without adopting them', () => {
  const input = query(); const before = structuredClone(input); const output = engine.query(input);
  assert.deepEqual(output.results[0].entries.map(e => [e.conceptId, e.preferredTarget]),
    [['soundness', '可靠性'], ['premise', '前提'], ['validity', '有效性'], ['inference', '推理']]);
  assert.equal(output.basis.resource.sha256, digest(bytes));
  assert.equal(output.basis.authority, 'unadopted-editorial-suggestion');
  assert.equal(output.basis.querySha256, digest(JSON.stringify(input))); assert.deepEqual(input, before);
});
test('empty lookup keeps corpus and query basis and never guesses a sense', () => {
  const input = query('soundtrack and invalid premiseX'); input.queries[0].conceptIds = ['soundness', 'validity', 'premise'];
  const result = engine.query(input); assert.deepEqual(result.results, [{ id: 'u-1', entries: [] }]);
  assert.equal(result.basis.resource.revision, 'editorial-1'); assert.equal(result.basis.querySha256, digest(JSON.stringify(input)));
  input.queries[0].text = 'sound'; input.queries[0].conceptIds = []; assert.deepEqual(engine.query(input).results[0].entries, []);
});
test('Unicode and locale matching are explicit and preserve original text', () => {
  const input = query('👩🏽‍💻 e\u0301 sound — soundness'); input.targetLanguage = 'ja'; input.queries[0].conceptIds = ['soundness'];
  assert.deepEqual(engine.query(input).results[0].entries.map(e => e.preferredTarget), ['健全性']);
  assert.ok(input.queries[0].text.includes('e\u0301')); input.queries[0].text = 'sound\u0301'; assert.deepEqual(engine.query(input).results[0].entries, []);
});
test('deterministic checks distinguish completed findings, missing text and irrelevant scope', () => {
  assert.deepEqual(engine.check(check()).results, [{ id: 'u-1', status: 'completed', findings: [] }]);
  const result = engine.check(check('👩🏽‍💻 e\u0301 前提'));
  assert.deepEqual(result.results[0].findings.map(f => f.conceptId), ['soundness', 'validity', 'inference']);
  assert.deepEqual(result.results[0].findings[0].range, { encoding: 'utf-16', start: 0, end: '👩🏽‍💻 e\u0301 前提'.length });
  assert.equal(engine.check(check(null)).results[0].status, 'unavailable');
  const input = check(null); input.items[0].sourceText = 'audio soundtrack'; assert.equal(engine.check(input).results[0].status, 'not-applicable');
  assert.equal(engine.check(check('')).results[0].findings.length, 4);
});
test('resource identity, revision and bytes must all match before query or check', () => {
  for (const operation of ['query', 'check']) for (const [key, value] of [['id', 'other'], ['revision', 'editorial-2'], ['sha256', 'a'.repeat(64)]]) {
    const input = operation === 'query' ? query() : check(); input.resource[key] = value; fails(() => engine[operation](input), 'resource-mismatch');
  }
});
test('strict scope, unsupported locales and unknown concepts fail without a fallback', () => {
  for (const mutate of [i => { i.extra = true; }, i => { i.queries.push(structuredClone(i.queries[0])); },
    i => { i.queries[0].conceptIds.push('soundness'); }, i => { i.queries[0].text = '\ud800'; }]) {
    const input = query(); mutate(input); fails(() => engine.query(input), 'invalid-input');
  }
  const locale = query(); locale.targetLanguage = 'fr'; fails(() => engine.query(locale), 'unsupported-locale');
  const concept = query(); concept.queries[0].conceptIds = ['invented']; fails(() => engine.query(concept), 'unknown-concept');
});
test('limits and cancellation do not emit partial successful coverage', () => {
  const input = query(); input.queries[0].text = 'a'.repeat(8193); fails(() => engine.query(input), 'limit-exceeded');
  fails(() => engine.query(query(), AbortSignal.abort()), 'cancelled'); fails(() => engine.check(check(), AbortSignal.abort()), 'cancelled');
});
test('resource capture is independent of a later caller mutation', () => {
  const selected = JSON.parse(bytes); const captured = createKnowledgeEngine(JSON.stringify(selected));
  selected.concepts[0].targets['zh-CN'] = 'changed'; const input = query(); input.resource = { ...captured.pin };
  assert.equal(captured.query(input).results[0].entries[2].preferredTarget, '有效性'); assert.ok(Object.isFrozen(captured.pin));
});
test('SDK component exposes the same query and check engine with exact bindings', () => {
  for (const operation of ['query', 'check']) {
    let handler; const scope = new AbortController(); const signal = new AbortController();
    component.activate({ contribution: { id: operation, contract: OPERATIONS[operation].contract }, signal: scope.signal,
      register(h) { assert.equal(handler, undefined); handler = h; }, onDispose() {} });
    const input = operation === 'query' ? query() : check();
    const payload = { schema: OPERATIONS[operation].input, utf8: JSON.stringify(input), sha256: digest(JSON.stringify(input)) };
    const metadata = { profile: PROFILE, signal: signal.signal, context: {} };
    assert.deepEqual(JSON.parse(handler(payload, metadata).utf8), engine[operation](input));
    const bad = structuredClone(payload); bad.schema.behaviorVersion = 2; assert.deepEqual(JSON.parse(handler(bad, metadata).utf8), { code: 'invalid-input' });
    signal.abort(); assert.deepEqual(JSON.parse(handler(payload, metadata).utf8), { code: 'cancelled' });
  }
});
test('AI tool metadata selects the original capability and does not replace its logic', () => {
  const tool = JSON.parse(readFileSync(new URL('../resources/agent-query-tool.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.plugin.version, metadata.version);
  assert.equal(validateTool(tool), true);
  assert.deepEqual(Object.keys(tool).sort(), ['name', 'title', 'description', 'capabilityId', 'profile', 'supportingResources', 'skill'].sort());
  const selected = manifest.contributions.find(c => c.id === tool.capabilityId).contribution.declaration;
  assert.deepEqual(tool.profile, PROFILE); assert.ok(selected.profiles.some(p => JSON.stringify(p) === JSON.stringify(tool.profile)));
  assert.equal(selected.effect, 'read-only');
  assert.deepEqual(tool.supportingResources, ['terminology']); assert.equal(tool.skill, 'concept-review');
  assert.equal(manifest.contributions.find(c => c.id === tool.supportingResources[0]).contribution.kind, 'resource');
  assert.equal(manifest.contributions.find(c => c.id === tool.skill).contribution.kind, 'skill');
  assert.deepEqual(manifest.contributions.find(c => c.id === 'agent-query-tool').contribution.schema,
    { id: 'tsumugi.capability-tool-declaration', schemaVersion: 1, behaviorVersion: 1 });
  assert.deepEqual(selected.permissions, [{ kind: 'captured-input' }]);
  assert.deepEqual(manifest.components.map(c => c.dependencies), [[], []]);
  assert.equal(manifest.contributions.filter(c => c.contribution.kind === 'skill').length, 1);
});

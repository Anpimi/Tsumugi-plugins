import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import component from '../components/component.mjs';
import { createKnowledgeEngine, digest, KnowledgeError } from '../components/knowledge.mjs';
import { createTextReview } from '../components/text-review.mjs';
import { conceptRule, OPERATIONS, PROFILE, RESOURCE_SCHEMA, TEXT_REVIEW_DECLARATION_SCHEMA, textReviewDeclaration } from '../components/definition.mjs';
import validateInput from '../sdk/validate-text-review-input.mjs';
import validateReport from '../sdk/validate-text-review-report.mjs';

const bytes = readFileSync(new URL('../resources/terminology.json', import.meta.url), 'utf8');
const engine = createKnowledgeEngine(bytes);
const declaration = JSON.parse(readFileSync(new URL('../resources/text-review.json', import.meta.url), 'utf8'));
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const checker = createTextReview(engine, declaration, version);
// Synthetic metadata exercises the component contract; it does not establish
// an actual Host channel or prove package/activation identity receiving.
const actualProvider = () => ({ plugin: { publisher: 'org.tsumugi.examples', id: 'philosophy', version },
  componentId: 'knowledge', contributionId: 'check', packageDigest: 'a'.repeat(64),
  instanceId: 'test-channel', activationGeneration: 1 });
const metadata = () => ({ profile: structuredClone(PROFILE), provider: actualProvider(), signal: new AbortController().signal, context: {} });
const selection = (unitId = 'u-1', translationText = '可靠性') => ({ unitId, sourceRevisionId: `source-${unitId}`,
  sourceText: 'valid sound premise inference', translationText });
const inputFor = (conceptIds = ['soundness'], selections = [selection()]) => {
  const { instanceId, activationGeneration, ...provider } = actualProvider();
  return { profile: structuredClone(PROFILE), sourceLanguage: 'en', targetLanguage: 'zh-CN',
    resources: [{ contributionId: 'terminology', schema: structuredClone(RESOURCE_SCHEMA), sha256: engine.pin.sha256 }],
    selections: structuredClone(selections), requirements: conceptIds.map(concept => ({
      key: { rule: conceptRule(concept), implementation: { kind: 'plugin', provider: structuredClone(provider) } },
      inputDigest: 'b'.repeat(64), scopeDigest: 'c'.repeat(64), targets: selections.map(selected => selected.unitId),
      mandatory: false, waivable: false, notApplicable: null,
    })) };
};
const fails = (input, expected = 'invalid-input', selectedMetadata = metadata()) => {
  assert.throws(() => checker(input, selectedMetadata), error => error instanceof KnowledgeError && error.code === expected);
};
const activate = signal => {
  let handler;
  component.activate({ contribution: { id: 'check', contract: OPERATIONS.check.contract }, signal,
    register(value) { assert.equal(handler, undefined); handler = value; }, onDispose() {} });
  return handler;
};
const invoke = (handler, input, selectedMetadata = metadata()) => {
  const utf8 = JSON.stringify(input);
  return handler({ schema: OPERATIONS.check.input, utf8, sha256: digest(utf8) }, selectedMetadata);
};

test('one generated declaration exposes four original senses as advisory public text-review rules', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(declaration, textReviewDeclaration(engine.resource));
  assert.equal(declaration.disposition, 'advisory');
  assert.deepEqual(declaration.rules.map(rule => rule.rule), engine.resource.concepts.map(concept => conceptRule(concept.id)));
  assert.deepEqual(declaration.rules.map(rule => [rule.title, rule.description]), engine.resource.concepts.map(concept => [concept.sourceForms[0], concept.note]));
  assert.deepEqual(declaration.supportingResources, ['terminology']);
  const resource = manifest.contributions.find(row => row.id === 'text-review').contribution;
  assert.deepEqual(resource, { kind: 'resource', schema: TEXT_REVIEW_DECLARATION_SCHEMA, path: 'resources/text-review.json' });
  const capability = manifest.contributions.find(row => row.id === 'check').contribution.declaration;
  assert.deepEqual(capability.contract, OPERATIONS.check.contract);
  assert.deepEqual([capability.inputSchema, capability.outputSchema, capability.errorSchema], [OPERATIONS.check.input, OPERATIONS.check.output, OPERATIONS.check.error]);
  assert.equal(capability.contract.schemaVersion, 2); assert.equal(capability.contract.behaviorVersion, 2);
  assert.equal(manifest.contributions.find(row => row.id === 'query').contribution.declaration.contract.behaviorVersion, 1);
});

test('the explicit nonempty rule subset alone selects senses and emits complete requested coverage', () => {
  const input = inputFor(['soundness']); const before = structuredClone(input);
  assert.equal(validateInput(input), true);
  const report = checker(input, metadata());
  assert.equal(validateReport(report), true);
  assert.deepEqual(report, { results: [{ key: input.requirements[0].key, inputDigest: 'b'.repeat(64), scopeDigest: 'c'.repeat(64),
    coveredTargets: ['u-1'], outcome: { kind: 'completed', findings: [] } }], diagnostics: [] });
  assert.deepEqual(input, before);
  const emptyText = inputFor(['soundness'], [selection('empty', '')]);
  assert.equal(checker(emptyText, metadata()).results[0].outcome.findings.length, 1);
  const empty = inputFor([]); fails(empty);
  const irrelevant = inputFor(['soundness'], [{ ...selection('irrelevant', null), sourceText: 'soundtrack invalid premiseX' }]);
  assert.deepEqual(checker(irrelevant, metadata()).results[0].outcome, { kind: 'completed', findings: [] });
});

test('multiple selected rules and units reuse the engine and retain distinct typed keys and diagnostics', () => {
  const input = inputFor(['soundness', 'validity'], [selection('one', '前提'), selection('two', '可靠性')]);
  const report = checker(input, metadata());
  assert.equal(report.results.length, 2);
  assert.deepEqual(report.results.map(row => row.coveredTargets), [['one', 'two'], ['one', 'two']]);
  assert.deepEqual(report.results[0].outcome.findings, [{ code: 'preferred-term-missing', target: 'one', severity: 'warning' }]);
  assert.deepEqual(report.results[1].outcome.findings.map(row => row.target), ['one', 'two']);
  assert.deepEqual(report.diagnostics.map(row => [row.key.rule.id, row.target, row.resourceEntry.entryId]), [
    [conceptRule('soundness').id, 'one', 'soundness'], [conceptRule('validity').id, 'one', 'validity'], [conceptRule('validity').id, 'two', 'validity'],
  ]);
  assert.ok(report.diagnostics.every(row => row.resourceEntry.contributionId === 'terminology' && row.detail && row.suggestion));
});

test('missing translation needs the captured permitted NA basis or stays explicitly unavailable', () => {
  const input = inputFor(['soundness'], [selection('missing', null)]);
  assert.deepEqual(checker(input, metadata()).results[0].outcome, { kind: 'unavailable' });
  input.requirements[0].notApplicable = { code: 'missing-translation', basisDigest: 'd'.repeat(64) };
  assert.deepEqual(checker(input, metadata()).results[0].outcome, { kind: 'not-applicable', basis: input.requirements[0].notApplicable });
  const partial = inputFor(['soundness'], [selection('missing', null), selection('present', '可靠性')]);
  const partialReport = checker(partial, metadata());
  assert.deepEqual(partialReport.results[0].outcome, { kind: 'unavailable' });
  assert.deepEqual(partialReport.results[0].coveredTargets, ['missing', 'present']);
  assert.deepEqual(partialReport.diagnostics, []);
  partial.requirements[0].notApplicable = { code: 'missing-translation', basisDigest: 'd'.repeat(64) };
  fails(partial);
  const falseReason = structuredClone(input); falseReason.requirements[0].notApplicable.code = 'irrelevant'; fails(falseReason);
  const badBasis = structuredClone(input); badBasis.requirements[0].notApplicable.basisDigest = 'wrong'; fails(badBasis);
  const unknownLocale = inputFor(); unknownLocale.targetLanguage = 'fr'; fails(unknownLocale, 'unsupported-profile');
});

test('UTF-16 diagnostics preserve emoji and combining text without counting bytes or code points', () => {
  const translation = '👩🏽‍💻 e\u0301 前提';
  const input = inputFor(['soundness'], [selection('unicode', translation)]);
  const report = checker(input, metadata());
  assert.deepEqual(report.diagnostics[0].location, { field: 'translation', range: { encoding: 'utf16', start: 0, end: translation.length } });
  assert.notEqual(translation.length, Buffer.byteLength(translation));
  assert.notEqual(translation.length, [...translation].length);
  assert.equal(report.diagnostics[0].suggestion, '可靠性');
  input.targetLanguage = 'ja'; assert.equal(checker(input, metadata()).diagnostics[0].suggestion, '健全性');
  assert.equal(input.selections[0].translationText, translation);
});

test('component receiving refuses substituted provider profile resource rules scope and unsafe policy', () => {
  const mutations = [
    input => { input.profile.behaviorVersion += 1; },
    input => { input.resources[0].sha256 = 'e'.repeat(64); },
    input => { input.resources[0].schema.behaviorVersion += 1; },
    input => { input.resources.push(structuredClone(input.resources[0])); },
    input => { input.requirements[0].key.implementation.provider.packageDigest = 'e'.repeat(64); },
    input => { input.requirements[0].key.implementation.provider.plugin.id = 'other'; },
    input => { input.requirements[0].key.implementation.provider.componentId = 'reference'; },
    input => { input.requirements[0].key.implementation.provider.contributionId = 'query'; },
    input => { input.requirements[0].key.rule.id = 'org.tsumugi.examples.philosophy-term.invented'; },
    input => { input.requirements[0].key.rule.behaviorVersion += 1; },
    input => { input.requirements[0].mandatory = true; },
    input => { input.requirements[0].waivable = true; },
    input => { input.requirements[0].targets = ['other']; },
    input => { input.requirements[0].targets.push('u-1'); },
    input => { input.requirements.push(structuredClone(input.requirements[0])); },
    input => { input.selections.push(structuredClone(input.selections[0])); },
    input => { input.selections[0].sourceRevisionId = ''; },
    input => { input.selections[0].sourceText = '\ud800'; },
    input => { input.extra = true; },
  ];
  const handler = activate(new AbortController().signal);
  for (const mutate of mutations) {
    const input = inputFor(); mutate(input); const result = invoke(handler, input);
    assert.equal(result.kind, 'failed'); assert.equal(JSON.parse(result.utf8).code, 'invalid-input');
  }
  for (const mutate of [value => { delete value.provider; }, value => { value.profile.behaviorVersion += 1; },
    value => { value.provider.plugin.version = 'replaced'; }, value => { value.provider.activationGeneration = 0; }]) {
    const selectedMetadata = metadata(); mutate(selectedMetadata); fails(inputFor(), 'invalid-input', selectedMetadata);
  }
});

test('the public check contribution replaces the old custom shape and emits existing ReviewCheckError', () => {
  const handler = activate(new AbortController().signal);
  const completed = invoke(handler, inputFor());
  assert.equal(completed.kind, 'succeeded'); assert.deepEqual(JSON.parse(completed.utf8), checker(inputFor(), metadata()));
  const originalShape = { resource: engine.pin, sourceLanguage: 'en', targetLanguage: 'zh-CN', items: [] };
  const failed = invoke(handler, originalShape);
  assert.equal(failed.kind, 'failed'); assert.deepEqual(Object.keys(JSON.parse(failed.utf8)).sort(), ['code', 'detail', 'unitId']);
  assert.equal(JSON.parse(failed.utf8).code, 'invalid-input');
  const badDigest = handler({ schema: OPERATIONS.check.input, utf8: JSON.stringify(inputFor()), sha256: 'd'.repeat(64) }, metadata());
  assert.equal(JSON.parse(badDigest.utf8).code, 'invalid-input');
});

test('text record input report limits and cancellation never emit partial successful reports', () => {
  const handler = activate(new AbortController().signal);
  const oversized = inputFor(['soundness'], [selection('large', 'x'.repeat(8193))]);
  assert.equal(JSON.parse(invoke(handler, oversized).utf8).code, 'limit-exceeded');
  const tooMany = inputFor(['soundness'], Array.from({ length: 101 }, (_, index) => selection(`u-${index}`, '可靠性')));
  assert.equal(JSON.parse(invoke(handler, tooMany).utf8).code, 'limit-exceeded');
  const oversizedReport = inputFor(['validity', 'soundness', 'premise', 'inference'], Array.from({ length: 100 }, (_, index) => selection(`u-${index}`, 'x')));
  const rejected = invoke(handler, oversizedReport);
  assert.equal(rejected.kind, 'failed'); assert.equal(JSON.parse(rejected.utf8).code, 'limit-exceeded');
  const invocationStop = metadata(); invocationStop.signal = AbortSignal.abort();
  assert.equal(JSON.parse(invoke(handler, inputFor(), invocationStop).utf8).code, 'cancelled');
  const scope = new AbortController(); const stoppedHandler = activate(scope.signal); scope.abort();
  assert.equal(JSON.parse(invoke(stoppedHandler, inputFor()).utf8).code, 'cancelled');
});

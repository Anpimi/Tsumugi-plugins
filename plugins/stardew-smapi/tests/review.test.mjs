import assert from 'node:assert/strict';
import test from 'node:test';
import { PROFILE, REVIEW_RULES, SmapiError, extractSource, checkReview, sha256 } from '../components/smapi.mjs';

const ref = id => ({ id, schemaVersion: 1, behaviorVersion: 1 });
function request(sourceText = 'Hi {{name}} {{name}}', translationText = '你好 {{name}} {{name}}') {
  const manifest = '{"UniqueID":"Example.Mod","Name":"Test","Version":"1.0.0","EntryDll":"Test.dll"}';
  const raw = JSON.stringify({ first: sourceText, second: 'Other' });
  const source = extractSource({ profile: { ...PROFILE }, sourceSetId: 'source-set', sourceLanguage: 'en', artifacts: [
    { id: 'manifest', logicalPath: 'manifest.json', role: 'companion', sha256: sha256(manifest), utf8: manifest },
    { id: 'default', logicalPath: 'i18n/default.json', role: 'source', sha256: sha256(raw), utf8: raw },
  ] });
  const unit = source.units[0];
  return { source, targetLanguage: 'zh-CN', selections: [{ unitId: unit.id, sourceRevisionId: unit.sourceRevisionId, translationText }], requirements: REVIEW_RULES.map(rule => ({
    key: { rule: structuredClone(rule.rule), implementation: { kind: 'plugin', provider: {
      plugin: { publisher: 'org.tsumugi', id: 'stardew-smapi', version: '0.1.0-alpha.1' }, componentId: 'smapi-worker', contributionId: 'review-check', packageDigest: 'a'.repeat(64),
    } } }, inputDigest: 'b'.repeat(64), scopeDigest: 'c'.repeat(64), targets: [unit.id], mandatory: true, waivable: false, notApplicable: null,
  })) };
}
const findings = result => result.outcome.findings ?? [];
const fails = run => assert.throws(run, error => error instanceof SmapiError && error.code === 'invalid-input');

test('review literal marker inventories retain counts, exact Unicode and only the selected scope', () => {
  for (const [text, code] of [['你好 {{name}} {{name}}', null], ['你好 {{name}}', 'marker-mismatch'], ['你好 {{other}} {{other}}', 'marker-mismatch']]) {
    const input = request(undefined, text); const before = structuredClone(input);
    const result = checkReview(input);
    assert.deepEqual(result.map(r => r.key.rule.id), ['smapi.placeholders', 'smapi.format']);
    assert.deepEqual(findings(result[0]), code ? [{ code, target: input.selections[0].unitId, severity: 'error' }] : []);
    assert.deepEqual(findings(result[1]), []);
    for (let i = 0; i < result.length; i++) {
      assert.deepEqual(result[i].key, input.requirements[i].key);
      assert.deepEqual(result[i].coveredTargets, input.requirements[i].targets);
      assert.equal(result[i].inputDigest, 'b'.repeat(64)); assert.equal(result[i].scopeDigest, 'c'.repeat(64));
    }
    assert.deepEqual(input, before);
  }
  const input = request('e\u0301 👩🏽‍💻 {literal}', '译文 e\u0301 👩🏽‍💻 {literal}');
  assert.deepEqual(checkReview(input).map(findings), [[], []]);
  assert.ok(input.selections[0].translationText.includes('e\u0301'));
});

test('malformed source or target markers block format and leave inventories unavailable', () => {
  for (const [source, text, code] of [['Hi {{', '你好', 'source-marker'], ['Hi {{name}}', '你好 {{name', 'translation-marker'], ['Hi', '}}', 'translation-marker']]) {
    const input = request(source, text); const result = checkReview(input);
    assert.equal(result[0].outcome.kind, 'unavailable');
    assert.deepEqual(findings(result[1]), [{ code, target: input.selections[0].unitId, severity: 'error' }]);
  }
});

test('review control characters follow the existing profile and do not normalize saved text', () => {
  const input = request('source\u0000', 'target\u0085');
  assert.deepEqual(findings(checkReview(input)[1]).map(f => f.code), ['source-control-character', 'control-character']);
  assert.deepEqual(checkReview(request('source\r\n\t', 'target\r\n\t')).map(findings), [[], []]);
  assert.deepEqual(checkReview(request('source', '')).map(findings), [[], []]); // Core owns empty selected translation.
});

test('missing-text applicability is explicit and never skips source format', () => {
  const input = request('Hi {{', null);
  assert.equal(checkReview(input)[0].outcome.kind, 'unavailable');
  input.requirements[0].notApplicable = { code: 'missing-translation', basisDigest: 'd'.repeat(64) };
  const result = checkReview(input);
  assert.deepEqual(result[0].outcome, { kind: 'not-applicable', basis: input.requirements[0].notApplicable });
  assert.equal(findings(result[1])[0].code, 'source-marker');
  input.requirements[1].notApplicable = input.requirements[0].notApplicable;
  fails(() => checkReview(input));
});

test('wrong rule versions, providers, coverage, source revisions and waiver attempts refuse success', () => {
  for (const change of [
    r => { r.requirements = []; }, r => { r.requirements.push(structuredClone(r.requirements[0])); },
    r => { r.requirements[0].key.rule.behaviorVersion = 2; }, r => { r.requirements[0].key.rule = ref('core.required-translation'); },
    r => { r.requirements[0].key.implementation.provider.packageDigest = 'd'.repeat(64); },
    r => { r.requirements[0].targets = ['other']; }, r => { r.requirements[0].waivable = true; },
    r => { r.requirements[0].mandatory = false; }, r => { r.selections[0].sourceRevisionId = 'other'; },
    r => { r.selections.push(structuredClone(r.selections[0])); },
  ]) { const input = request(); change(input); fails(() => checkReview(input)); }
  const signal = AbortSignal.abort();
  assert.throws(() => checkReview(request(), signal), error => error instanceof SmapiError && error.code === 'cancelled');
  const forged = request(); forged.source.units[0].text = 'forged';
  assert.equal(findings(checkReview(forged)[1])[0].code, 'source-mismatch');
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PROFILE, REVIEW_RULES, WebvttError, extractSource, checkReview, sha256 } from '../components/webvtt.mjs';

function request(text = '译文 e\u0301 👩🏽‍💻\n第二行') {
  const utf8 = readFileSync(new URL('fixtures/s1.vtt', import.meta.url), 'utf8');
  const source = extractSource({ profile: { ...PROFILE }, sourceSetId: 'source-set', sourceLanguage: 'en', artifacts: [
    { id: 'source', logicalPath: 'source.vtt', role: 'source', sha256: sha256(utf8), utf8 },
  ] });
  const unit = source.units[0];
  return { source, targetLanguage: 'zh-CN', selections: [{ unitId: unit.id, sourceRevisionId: unit.sourceRevisionId, translationText: text }], requirements: REVIEW_RULES.map(rule => ({
    key: { rule: structuredClone(rule.rule), implementation: { kind: 'plugin', provider: {
      plugin: { publisher: 'org.tsumugi', id: 'webvtt', version: '0.1.0-alpha.1' }, componentId: 'caption-worker', contributionId: 'review-check', packageDigest: 'a'.repeat(64),
    } } }, inputDigest: 'b'.repeat(64), scopeDigest: 'c'.repeat(64), targets: [unit.id], mandatory: true, waivable: false, notApplicable: null,
  })) };
}
const fails = run => assert.throws(run, error => error instanceof WebvttError && error.code === 'invalid-input');

test('caption review retains original bytes, complete selected evidence and explicit Unicode text', () => {
  const input = request(); const before = structuredClone(input); const result = checkReview(input);
  assert.deepEqual(result.map(r => r.key.rule.id), ['webvtt.source-structure', 'webvtt.payload']);
  assert.deepEqual(result.map(r => r.outcome), [{ kind: 'completed', findings: [] }, { kind: 'completed', findings: [] }]);
  for (let i = 0; i < result.length; i++) {
    assert.deepEqual(result[i].key, input.requirements[i].key);
    assert.deepEqual(result[i].coveredTargets, [input.selections[0].unitId]);
    assert.equal(result[i].inputDigest, 'b'.repeat(64)); assert.equal(result[i].scopeDigest, 'c'.repeat(64));
  }
  assert.deepEqual(input, before); assert.ok(input.selections[0].translationText.includes('e\u0301'));
});

test('literal unsupported caption payloads produce nonwaivable domain findings', () => {
  for (const text of ['', '\0', 'a\n\nb', 'a\n', '<b>markup</b>', '&amp;', 'a --> b']) {
    const input = request(text); const result = checkReview(input);
    assert.deepEqual(result[1].outcome, { kind: 'completed', findings: [{ code: 'invalid-payload', target: input.selections[0].unitId, severity: 'error' }] });
    assert.deepEqual(result[0].outcome.findings, []);
  }
});

test('caption fallback needs fixed missing-text N/A and still checks source structure', () => {
  const input = request(null); assert.equal(checkReview(input)[1].outcome.kind, 'unavailable');
  input.requirements[1].notApplicable = { code: 'missing-translation', basisDigest: 'd'.repeat(64) };
  assert.deepEqual(checkReview(input)[1].outcome, { kind: 'not-applicable', basis: input.requirements[1].notApplicable });
  input.source.domainBlocks[0].payloadUtf8 = '{}';
  assert.equal(checkReview(input)[0].outcome.findings[0].code, 'source-mismatch');
  input.requirements[0].notApplicable = input.requirements[1].notApplicable;
  fails(() => checkReview(input));
});

test('caption checker refuses replaced rules, scope, current source basis and waived coverage', () => {
  for (const change of [
    r => { r.requirements = []; }, r => { r.requirements.push(structuredClone(r.requirements[0])); },
    r => { r.requirements[1].key.rule.schemaVersion = 2; }, r => { r.requirements[0].key.implementation.provider.contributionId = 'other'; },
    r => { r.requirements[0].key.implementation.provider.packageDigest = 'd'.repeat(64); },
    r => { r.requirements[1].waivable = true; }, r => { r.requirements[1].mandatory = false; },
    r => { r.requirements[1].targets = ['other']; }, r => { r.selections[0].sourceRevisionId = 'other'; },
    r => { r.selections[0].translationText = 'x'.repeat(16385); },
  ]) { const input = request(); change(input); fails(() => checkReview(input)); }
  assert.throws(() => checkReview(request(), AbortSignal.abort()), error => error instanceof WebvttError && error.code === 'cancelled');
});

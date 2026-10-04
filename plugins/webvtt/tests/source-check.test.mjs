import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { checkSourceSemantics, extractSource, WebvttError, MAX_PAYLOAD_BYTES, MAX_SOURCE_CHECK_BYTES } from '../components/webvtt.mjs';

const ORACLE = JSON.parse(await readFile(new URL('fixtures/source-check.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(ORACLE);
const outcome = request => checkSourceSemantics(request)[0].outcome;
const failure = callback => assert.throws(callback, error => error instanceof WebvttError && error.code === 'invalid-input');

test('two thousand cues and a full source fit the separate combined checker budget', () => {
  const request = fresh();
  const cues = Array.from({ length: 2000 }, (_, index) => `C${index}\n00:00.000 --> 00:01.000\na\n\n`).join('');
  const prefix = 'WEBVTT\n\nNOTE ';
  const utf8 = prefix + 'x'.repeat(128 * 1024 - Buffer.byteLength(cues + prefix + '\n\n')) + '\n\n' + cues;
  const hash = value => createHash('sha256').update(value).digest('hex');
  request.source.sourceSetId = '00000000-0000-4000-8000-000000000001';
  const artifact = request.source.artifacts[0];
  artifact.id = '00000000-0000-4000-8000-000000000002';
  artifact.utf8 = utf8; artifact.sha256 = hash(utf8);
  request.proposal = extractSource(request.source);
  const requirement = request.requirements[0];
  requirement.targets = [request.source.sourceSetId];
  requirement.inputDigest = hash(JSON.stringify(request.source));
  requirement.scopeDigest = hash(JSON.stringify(request.proposal));
  const bytes = value => Buffer.byteLength(JSON.stringify(value));
  assert.equal(Buffer.byteLength(utf8), 128 * 1024);
  assert.equal(request.proposal.units.length, 2000);
  assert.ok(bytes(request.source) <= MAX_PAYLOAD_BYTES);
  assert.ok(bytes(request.proposal) <= MAX_PAYLOAD_BYTES);
  assert.ok(bytes(request) > MAX_PAYLOAD_BYTES);
  assert.ok(bytes(request) <= MAX_SOURCE_CHECK_BYTES);
  assert.deepEqual(outcome(request), { kind: 'completed', findings: [] });
});

test('literal source oracle checks complete UTF-8 coverage and original native display evidence', () => {
  const request = fresh();
  const result = checkSourceSemantics(request);
  const requirement = request.requirements[0];
  assert.deepEqual(result, [{ key: requirement.key, inputDigest: requirement.inputDigest,
    scopeDigest: requirement.scopeDigest, coveredTargets: requirement.targets,
    outcome: { kind: 'completed', findings: [] } }]);
  // This fixed JSON was authored from literal byte offsets, not produced by
  // extractSource. The verifier is tested on it before examining the producer.
  assert.deepEqual(extractSource(request.source), request.proposal);
  const bytes = Buffer.from(request.source.artifacts[0].utf8);
  for (const unit of request.proposal.units) {
    const identity = unit.occurrences[0].nativeIdentity;
    const range = identity.display.source.range;
    assert.equal(bytes.subarray(range.start, range.end).toString('utf8'), identity.display.value);
  }
  assert.equal(request.proposal.units[0].occurrences[0].nativeIdentity.value, 'keep');
  assert.equal(request.proposal.units[0].occurrences[0].nativeIdentity.display.value, 'Keep');
});

test('source verifier accepts arbitrary local references and unordered unit/block collections', () => {
  const request = fresh();
  request.proposal.units.forEach((unit, index) => {
    unit.id = `local-unit-${index}`;
    unit.sourceRevisionId = `local-revision-${index}`;
    unit.occurrences[0].id = `local-occurrence-${index}`;
    request.proposal.order[index] = `local-occurrence-${index}`;
    request.proposal.domainBlocks[index].target.id = `local-occurrence-${index}`;
  });
  request.proposal.units.reverse();
  request.proposal.domainBlocks.reverse();
  assert.deepEqual(outcome(request), { kind: 'completed', findings: [] });
});

test('semantically forged proposals complete coverage with a blocking source mismatch', () => {
  const mutations = [
    ['unit text', p => { p.units[0].text = 'Forged'; }],
    ['missing cue', p => { p.units.pop(); p.order.pop(); p.domainBlocks.pop(); }],
    ['additional cue', p => { p.units.push(structuredClone(p.units[0])); }],
    ['duplicate local unit', p => { p.units[1].id = p.units[0].id; }],
    ['duplicate revision', p => { p.units[1].sourceRevisionId = p.units[0].sourceRevisionId; }],
    ['duplicate occurrence', p => { p.units[1].occurrences[0].id = p.units[0].occurrences[0].id; }],
    ['extra occurrence', p => { p.units[0].occurrences.push(structuredClone(p.units[0].occurrences[0])); }],
    ['order', p => { p.order.reverse(); }],
    ['duplicate order', p => { p.order[1] = p.order[0]; }],
    ['payload byte start', p => { p.units[0].occurrences[0].source.range.start++; }],
    ['payload byte end', p => { p.units[0].occurrences[0].source.range.end--; }],
    ['payload artifact', p => { p.units[0].occurrences[0].source.artifactId = 'different'; }],
    ['coordinate encoding', p => { p.units[0].occurrences[0].source.range.encoding = 'utf16-code-unit'; }],
    ['native namespace', p => { p.units[0].occurrences[0].nativeIdentity.namespace = 'different'; }],
    ['canonical value', p => { p.units[0].occurrences[0].nativeIdentity.value = 'Keep'; }],
    ['native policy', p => { p.units[0].occurrences[0].nativeIdentity.policy.behaviorVersion = 2; }],
    ['missing native identity', p => { p.units[0].occurrences[0].nativeIdentity = null; }],
    ['display literal', p => { p.units[0].occurrences[0].nativeIdentity.display.value = 'keep'; }],
    ['display range', p => { p.units[0].occurrences[0].nativeIdentity.display.source.range.start++; }],
    ['display artifact', p => { p.units[0].occurrences[0].nativeIdentity.display.source.artifactId = 'other'; }],
    ['absent display range', p => { p.units[0].occurrences[0].nativeIdentity.display.source = null; }],
    ['missing basis', p => { p.domainBlocks.pop(); }],
    ['extra opaque block', p => { p.domainBlocks.push(structuredClone(p.domainBlocks[0])); }],
    ['duplicate block target', p => { p.domainBlocks[1].target.id = p.domainBlocks[0].target.id; }],
    ['wrong block position', p => { p.domainBlocks[0].target = { kind: 'unit', id: p.units[0].id }; }],
    ['optional basis', p => { p.domainBlocks[0].handling = 'preserve'; }],
    ['unknown required schema', p => { p.domainBlocks[0].schema.id = 'unknown-required'; }],
    ['unknown schema version', p => { p.domainBlocks[0].schema.schemaVersion = 2; }],
    ['basis timing', p => { p.domainBlocks[0].payloadUtf8 = p.domainBlocks[0].payloadUtf8.replace('00:01.000', '00:02.000'); }],
    ['basis settings', p => { p.domainBlocks[0].payloadUtf8 = p.domainBlocks[0].payloadUtf8.replace('align:center', 'align:left'); }],
    ['basis layout', p => { p.domainBlocks[0].payloadUtf8 = p.domainBlocks[0].payloadUtf8.replace('e3b0c442', '00000000'); }],
    ['basis literal', p => { p.domainBlocks[0].payloadUtf8 = p.domainBlocks[0].payloadUtf8.replace('Keep', 'keep'); }],
    ['rewritten opaque bytes', p => { p.domainBlocks[0].payloadUtf8 = JSON.stringify(JSON.parse(p.domainBlocks[0].payloadUtf8), null, 2); }],
    ['duplicate opaque key', p => { p.domainBlocks[0].payloadUtf8 = p.domainBlocks[0].payloadUtf8.replace('{', '{"version":0,'); }],
    ['unknown opaque field', p => { p.domainBlocks[0].payloadUtf8 = p.domainBlocks[0].payloadUtf8.replace('{', '{"extra":true,'); }],
    ['unexpected relation', p => { p.relations.push({ kind: { id: 'other', schemaVersion: 1, behaviorVersion: 1 }, fromOccurrence: 'occurrence-0', toOccurrence: 'occurrence-1' }); }],
    ['unexpected protected fragment', p => { p.units[0].protectedFragments.push({ kind: { id: 'other', schemaVersion: 1, behaviorVersion: 1 }, range: { encoding: 'utf8-byte', start: 0, end: 1 } }); }],
  ];
  for (const [name, mutate] of mutations) {
    const request = fresh(); mutate(request.proposal);
    assert.deepEqual(outcome(request), { kind: 'completed', findings: [
      { code: 'source-mismatch', target: 'captured-set-1', severity: 'error' },
    ] }, name);
  }
});

test('check input rejects a proposal associated with different captured source material', () => {
  for (const mutate of [
    p => { p.artifacts[0].utf8 += '\nNOTE Forged\n'; },
    p => { p.artifacts[0].sha256 = '0'.repeat(64); },
    p => { p.artifacts[0].id = 'other'; }, p => { p.artifacts[0].logicalPath = 'other.vtt'; },
    p => { p.artifacts[0].role = 'other'; }, p => { p.artifacts.push(structuredClone(p.artifacts[0])); },
    p => { p.sourceSetId = 'different'; }, p => { p.sourceLanguage = 'zh-CN'; },
    p => { p.profile.behaviorVersion = 2; },
  ]) { const request = fresh(); mutate(request.proposal); failure(() => checkSourceSemantics(request)); }
});

test('fixed source requirements reject missing, extra, duplicate, waivable and foreign policy', () => {
  for (const mutate of [
    r => r.requirements.pop(), r => r.requirements.push(structuredClone(r.requirements[0])),
    r => { r.requirements[0].key.rule.id = 'different'; }, r => { r.requirements[0].key.rule.behaviorVersion = 2; },
    r => { r.requirements[0].key.implementation.kind = 'core'; },
    r => { r.requirements[0].key.implementation.provider.plugin.publisher = 'other'; },
    r => { r.requirements[0].key.implementation.provider.plugin.id = 'other'; },
    r => { r.requirements[0].key.implementation.provider.plugin.version = '0.1.0-alpha.2'; },
    r => { r.requirements[0].key.implementation.provider.componentId = 'other'; },
    r => { r.requirements[0].key.implementation.provider.contributionId = 'extract-source'; },
    r => { r.requirements[0].key.implementation.provider.packageDigest = 'not-a-digest'; },
    r => { r.requirements[0].inputDigest = 'invalid'; }, r => { r.requirements[0].scopeDigest = 'invalid'; },
    r => { r.requirements[0].targets = []; }, r => { r.requirements[0].targets = ['other']; },
    r => { r.requirements[0].targets.push('captured-set-1'); }, r => { r.requirements[0].targets.push('extra'); },
    r => { r.requirements[0].mandatory = false; }, r => { r.requirements[0].waivable = true; },
    r => { r.requirements[0].notApplicable = { code: 'skip', basisDigest: '0'.repeat(64) }; },
  ]) { const request = fresh(); mutate(request); failure(() => checkSourceSemantics(request)); }
});

test('source checking preserves independently captured bases and observes cancellation and combined budget', () => {
  const request = fresh();
  request.requirements[0].inputDigest = '4'.repeat(64);
  request.requirements[0].scopeDigest = '5'.repeat(64);
  request.requirements[0].key.implementation.provider.packageDigest = '6'.repeat(64);
  const [result] = checkSourceSemantics(request);
  assert.equal(result.inputDigest, '4'.repeat(64));
  assert.equal(result.scopeDigest, '5'.repeat(64));
  assert.equal(result.key.implementation.provider.packageDigest, '6'.repeat(64));
  const controller = new AbortController(); controller.abort();
  assert.throws(() => checkSourceSemantics(request, controller.signal), error => error instanceof WebvttError && error.code === 'cancelled');
  request.proposal.units[0].text = 'x'.repeat(MAX_PAYLOAD_BYTES);
  assert.throws(() => checkSourceSemantics(request), error => error instanceof WebvttError && error.code === 'limit-exceeded');
});

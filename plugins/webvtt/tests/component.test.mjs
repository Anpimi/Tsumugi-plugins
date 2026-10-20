import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import component from '../components/component.mjs';
import { PROFILE, BUILD_LIMITS } from '../components/webvtt.mjs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const members = manifest.contributions.filter(value => value.contribution.kind === 'capability');
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');
// This facade fixture exercises the entrypoint, not a real Host channel or grant.
function activate(selected) {
  let handler;
  const scope = new AbortController();
  component.activate({
    instance: { plugin: manifest.plugin, componentId: selected.componentId, packageDigest: 'a'.repeat(64), instanceId: 'synthetic-channel', activationGeneration: 1 },
    contributions: [{ id: selected.id, contract: selected.contribution.declaration.contract }],
    services: [], signal: scope.signal, onDispose() {},
    register(id, value) { assert.equal(id, selected.id); assert.equal(handler, undefined); assert.equal(typeof value, 'function'); handler = value; },
  });
  assert.equal(typeof handler, 'function');
  return { handler, scope };
}
function invoke(selected, input, signal = new AbortController().signal) {
  const { handler } = activate(selected);
  const utf8 = JSON.stringify(input);
  return handler({ schema: selected.contribution.declaration.inputSchema, utf8, sha256: digest(utf8) }, { profile: PROFILE, signal, context: {} });
}

test('every Project selection registers only its exact activated member', () => {
  for (const selected of members) {
    assert.equal(manifest.components.find(value => value.id === selected.componentId).scope, 'project');
    activate(selected);
  }
});

test('unknown members and altered contracts fail before exposing a handler', () => {
  for (const selected of [
    { ...structuredClone(members[0]), id: 'undeclared' },
    (() => { const selected = structuredClone(members[0]); selected.contribution.declaration.contract.behaviorVersion += 1; return selected; })(),
  ]) {
    let registered = false;
    assert.throws(() => component.activate({ contributions: [{ id: selected.id, contract: selected.contribution.declaration.contract }],
      signal: new AbortController().signal, register() { registered = true; } }));
    assert.equal(registered, false);
  }
});

test('the selected extractor and builder preserve their original byte and cancellation behavior', () => {
  const raw = 'WEBVTT\n\ncue-1\n00:00:01.000 --> 00:00:02.000\nHello\n';
  const input = { profile: PROFILE, sourceSetId: 'synthetic-set', sourceLanguage: 'en-US',
    artifacts: [{ id: 'source', logicalPath: 'source.vtt', role: 'source', sha256: digest(raw), utf8: raw }] };
  const extractor = members.find(value => value.id === 'extract-source');
  const extracted = invoke(extractor, input);
  assert.equal(extracted.kind, 'succeeded');
  const source = JSON.parse(extracted.utf8);
  assert.deepEqual(source.units.map(unit => unit.text), ['Hello']);
  assert.deepEqual(source.artifacts, input.artifacts);
  const build = { source, targetLanguage: 'zh-CN', configuration: [], outputPaths: ['zh-CN.vtt'], outputLimits: BUILD_LIMITS,
    targets: source.units.map(unit => ({ unitId: unit.id, sourceRevisionId: unit.sourceRevisionId, text: '你好' })) };
  const result = invoke(members.find(value => value.id === 'build'), build);
  assert.equal(result.kind, 'succeeded');
  assert.equal(JSON.parse(result.utf8).artifacts[0].utf8, raw.replace('Hello', '你好'));
  const cancelled = invoke(extractor, input, AbortSignal.abort());
  assert.equal(cancelled.kind, 'failed');
  assert.equal(JSON.parse(cancelled.utf8).code, 'cancelled');
});

test('declared translation facade validates SDK shapes and emits independent checks and typed errors', () => {
  const raw = '\uFEFFWEBVTT\r\n\r\nMiX\r\n00:01.000 --> 00:02.000\r\n译文 👩🏽‍💻\r\n';
  const input = { profile: PROFILE, importId: 'import', sourceSetId: 'source-set', sourceSnapshotId: 'snapshot',
    targetLanguage: 'zh-CN', languageEvidence: 'user-confirmed',
    nativeScope: { namespace: 'webvtt:source', policy: { id: 'webvtt-cue', schemaVersion: 1, behaviorVersion: 1 } },
    artifacts: [{ id: 'translation-file', logicalPath: 'translations/zh.vtt', role: 'translation', sha256: digest(raw), utf8: raw }] };
  const extractor = members.find(value => value.id === 'import-translations');
  const checker = members.find(value => value.id === 'translation-semantic-check');
  const extracted = invoke(extractor, input);
  assert.equal(extracted.kind, 'succeeded');
  const proposal = JSON.parse(extracted.utf8);
  assert.deepEqual(proposal.artifacts, input.artifacts);
  assert.equal(proposal.entries[0].nativeIdentity.value, 'mix');
  const requirement = { key: { rule: { id: 'webvtt.translation-semantics', schemaVersion: 1, behaviorVersion: 1 },
    implementation: { kind: 'plugin', provider: { plugin: manifest.plugin, packageDigest: 'a'.repeat(64),
      componentId: checker.componentId, contributionId: checker.id } } },
    inputDigest: digest(JSON.stringify(input)), scopeDigest: 'b'.repeat(64), targets: [input.importId],
    mandatory: true, waivable: false, notApplicable: null };
  const request = { input, proposal, requirements: [requirement] };
  const checked = invoke(checker, request);
  assert.equal(checked.kind, 'succeeded');
  assert.deepEqual(JSON.parse(checked.utf8)[0].outcome, { kind: 'completed', findings: [] });
  const altered = structuredClone(request); altered.proposal.entries[0].text = 'forged';
  assert.equal(JSON.parse(invoke(checker, altered).utf8)[0].outcome.findings[0].code, 'translation-mismatch');
  for (const [selected, value] of [[extractor, { ...input, unexpected: true }],
    [checker, { ...request, unexpected: true }], [checker, { input, proposal: {}, requirements: [] }]]) {
    const failed = invoke(selected, value);
    assert.equal(failed.kind, 'failed');
    assert.deepEqual(JSON.parse(failed.utf8), { code: 'invalid-input', artifactId: 'translation-file', detail: 'Operation input does not match the SDK schema.' });
  }
  assert.equal(JSON.parse(invoke(extractor, input, AbortSignal.abort()).utf8).code, 'cancelled');
});

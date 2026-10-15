import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import component from '../components/component.mjs';
import { PROFILE, BUILD_LIMITS } from '../components/smapi.mjs';

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

test('the selected extractor preserves captured bytes and the builder retains canonical output and cancellation', () => {
  const raw = '{"greeting":"Hello"}\n';
  const companion = '{"UniqueID":"Example.Mod","Name":"Test","Version":"1.0.0","EntryDll":"Test.dll"}';
  const input = { profile: PROFILE, sourceSetId: 'synthetic-set', sourceLanguage: 'en', artifacts: [
    { id: 'manifest', logicalPath: 'manifest.json', role: 'companion', sha256: digest(companion), utf8: companion },
    { id: 'default', logicalPath: 'i18n/default.json', role: 'source', sha256: digest(raw), utf8: raw },
  ] };
  const extractor = members.find(value => value.id === 'extract-source');
  const extracted = invoke(extractor, input);
  assert.equal(extracted.kind, 'succeeded');
  const source = JSON.parse(extracted.utf8);
  assert.deepEqual(source.units.map(unit => unit.text), ['Hello']);
  assert.deepEqual(source.artifacts, input.artifacts);
  const build = { source, targetLanguage: 'zh-CN', configuration: [], outputPaths: ['i18n/zh.json'], outputLimits: BUILD_LIMITS,
    targets: source.units.map(unit => ({ unitId: unit.id, sourceRevisionId: unit.sourceRevisionId, text: '你好' })) };
  const result = invoke(members.find(value => value.id === 'build'), build);
  assert.equal(result.kind, 'succeeded');
  assert.equal(JSON.parse(result.utf8).artifacts[0].utf8, '{\n  "greeting": "你好"\n}\n');
  const cancelled = invoke(extractor, input, AbortSignal.abort());
  assert.equal(cancelled.kind, 'failed');
  assert.equal(JSON.parse(cancelled.utf8).code, 'cancelled');
});

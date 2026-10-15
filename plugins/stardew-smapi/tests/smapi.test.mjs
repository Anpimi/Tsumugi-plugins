import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PROFILE, ARTIFACT_ID, BUILD_LIMITS, MAX_SOURCE_BYTES, MAX_MANIFEST_BYTES,
  MAX_TEXT_BYTES, MAX_ENTRIES, SmapiError, sha256, parseJsonc, parseFlat,
  extractSource, checkSourceSemantics, buildLocale, checkArtifact, safeOutputPath, markers,
} from '../components/smapi.mjs';

const fixture = name => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const json = name => JSON.parse(fixture(name));
const ref = id => ({ id, schemaVersion: 1, behaviorVersion: 1 });
const clone = structuredClone;
const baseManifest = '{"UniqueID":"Example.Mod","Name":"Test","Version":"1.0.0","EntryDll":"Test.dll"}';
const SOURCE_IMPORT = JSON.parse(readFileSync(new URL('../profiles/source-import.json', import.meta.url), 'utf8'));
const original = '\ufeff{\r\n // retained 中文 😀\r\n "MiX\\u0041": "Hi {{name}} 👩🏽‍💻 é",\r\n "same-a": "same",\r\n "same-b": "same",\r\n "empty": "",\r\n "$schema": "schema.json",\r\n}\r\n';
const captured = (raw = original, manifest = baseManifest) => ({ profile: { ...PROFILE }, sourceSetId: 'synthetic-set', sourceLanguage: 'en', artifacts: [
  { id: 'manifest', logicalPath: 'manifest.json', role: 'companion', sha256: sha256(manifest), utf8: manifest },
  { id: 'default', logicalPath: 'i18n/default.json', role: 'source', sha256: sha256(raw), utf8: raw },
] });
const fails = (run, code) => assert.throws(run, error => error instanceof SmapiError && (!code || error.code === code));
const requirement = (rule, contribution, target) => ({ key: { rule: ref(rule), implementation: { kind: 'plugin', provider: {
  plugin: { publisher: 'org.tsumugi', id: 'stardew-smapi', version: '0.1.0-alpha.1' },
  componentId: 'smapi-worker', contributionId: contribution, packageDigest: 'a'.repeat(64),
} } }, inputDigest: 'b'.repeat(64), scopeDigest: 'c'.repeat(64), targets: [target], mandatory: true, waivable: false, notApplicable: null });
const sourceCheck = (source, proposal = extractSource(source)) => ({ source, proposal, requirements: [requirement('smapi.source-semantics', 'source-semantic-check', source.sourceSetId)] });
const buildInput = (source = extractSource(captured()), texts = ['你好 {{name}} 😀', '同じ', '同じ', '']) => ({
  source, targetLanguage: 'zh-CN', configuration: [], outputPaths: ['i18n/zh.json'], outputLimits: { ...BUILD_LIMITS },
  targets: source.units.map((unit, index) => ({ unitId: unit.id, sourceRevisionId: unit.sourceRevisionId, text: texts[index] })),
});
const artifactCheck = (input, output = buildLocale(input)) => ({ input, output, requirements: [requirement('smapi.artifact-conformance', 'validate-artifact', ARTIFACT_ID)] });
const errors = results => results[0].outcome.findings.filter(finding => finding.severity === 'error');

test('licensed 532-entry source matches the independent .NET oracle and original bytes', () => {
  const source = captured(fixture('stardew-lookup/i18n/default.json'), fixture('stardew-lookup/manifest.json'));
  const oracle = json('stardew-lookup/oracle.json');
  assert.equal(source.artifacts[0].sha256, '58273bb818cab2899e0fc0a45e1f40856cab286e07e9a9af2dbca37199118148');
  assert.equal(source.artifacts[1].sha256, '29c4c299dee077481a98c1de612a678a6a16e55988ba88a73fa8f1cd92deb609');
  const exchange = extractSource(source);
  assert.equal(exchange.units.length, oracle.count);
  assert.deepEqual(exchange.artifacts, source.artifacts);
  assert.deepEqual(exchange.units.map((unit, ordinal) => ({ ordinal, key: unit.occurrences[0].nativeIdentity.display.value, text: unit.text })), oracle.occurrences);
  for (const unit of exchange.units) {
    const occurrence = unit.occurrences[0];
    assert.equal(occurrence.nativeIdentity.namespace, oracle.namespace);
    for (const [reference, expected] of [[occurrence.source, unit.text], [occurrence.nativeIdentity.display.source, occurrence.nativeIdentity.display.value]]) {
      const bytes = Buffer.from(source.artifacts[1].utf8);
      assert.equal(reference.range.encoding, 'utf8-byte');
      assert.equal(JSON.parse(bytes.subarray(reference.range.start, reference.range.end).toString()), expected);
    }
  }
  const result = checkSourceSemantics(sourceCheck(source, exchange));
  assert.deepEqual(result[0].outcome.findings, [{ code: 'source-template', target: source.sourceSetId, severity: 'warning' }]);
  const block = exchange.domainBlocks[0];
  assert.equal(block.target.kind, 'snapshot');
  const [name] = JSON.parse(block.payloadUtf8).facts;
  assert.deepEqual({ id: name.id, kind: name.kind, origin: name.origin.kind },
    { id: 'manifest-name', kind: 'note', origin: 'extracted' });
  assert.equal(JSON.parse(Buffer.from(source.artifacts[0].utf8).subarray(
    name.origin.sources[0].range.start, name.origin.sources[0].range.end).toString()), name.text);
  assert.equal(exchange.domainBlocks[1].schema.id, 'smapi.manifest-context-basis');
  assert.equal(exchange.domainBlocks[1].payloadUtf8, JSON.stringify({ version: 1, name: 'Lookup Anything' }));
});

test('manifest whitespace moves the referenced Name without changing semantic revision basis', () => {
  assert.deepEqual(SOURCE_IMPORT.revisionPolicy.revisionBasis,
    [{ id: 'smapi.manifest-context-basis', schemaVersion: 1, behaviorVersion: 1 }]);
  const beforeSource = captured('{"a":"x"}');
  const spacedSource = captured('{"a":"x"}', baseManifest.replace('"Name"', '  "Name"'));
  const renamedSource = captured('{"a":"x"}', baseManifest.replace('"Name":"Test"', '"Name":"Changed"'));
  const before = extractSource(beforeSource); const spaced = extractSource(spacedSource); const renamed = extractSource(renamedSource);
  const basis = exchange => exchange.domainBlocks.find(block => block.schema.id === 'smapi.manifest-context-basis').payloadUtf8;
  const fact = exchange => JSON.parse(exchange.domainBlocks.find(block => block.schema.id === 'tsumugi.source-context-facts').payloadUtf8).facts[0];
  assert.equal(basis(before), basis(spaced));
  assert.notEqual(fact(before).origin.sources[0].range.start, fact(spaced).origin.sources[0].range.start);
  assert.notEqual(basis(before), basis(renamed));
  const reordered = clone(before); reordered.domainBlocks.reverse();
  assert.deepEqual(errors(checkSourceSemantics(sourceCheck(beforeSource, reordered))), []);
  for (const [source, exchange] of [[beforeSource, before], [spacedSource, spaced], [renamedSource, renamed]]) {
    const observed = fact(exchange); const range = observed.origin.sources[0].range;
    assert.equal(JSON.parse(Buffer.from(source.artifacts[0].utf8).subarray(range.start, range.end).toString()), observed.text);
    assert.deepEqual(errors(checkSourceSemantics(sourceCheck(source, exchange))), []);
  }
});

test('quoted original UTF-8 ranges include BOM, escaped keys, astral and combining text', () => {
  const exchange = extractSource(captured());
  assert.equal(exchange.units[0].occurrences[0].nativeIdentity.value, 'mixa');
  assert.equal(exchange.units[0].occurrences[0].nativeIdentity.display.value, 'MiXA');
  assert.equal(exchange.units[0].text, 'Hi {{name}} 👩🏽‍💻 é');
  const occurrence = exchange.units[0].occurrences[0];
  const bytes = Buffer.from(original);
  assert.equal(bytes.subarray(occurrence.nativeIdentity.display.source.range.start, occurrence.nativeIdentity.display.source.range.end).toString(), '"MiX\\u0041"');
  assert.equal(bytes.subarray(occurrence.source.range.start, occurrence.source.range.end).toString(), '"Hi {{name}} 👩🏽‍💻 é"');
  assert.notEqual(exchange.units[1].id, exchange.units[2].id);
  assert.deepEqual(exchange.relations, []);
  assert.deepEqual(JSON.parse(exchange.domainBlocks[0].payloadUtf8).facts.map(fact => fact.kind), ['note']);
});

test('JSONC recovery, duplicate keys, invalid scalars and unsupported flat structures block', () => {
  for (const raw of ['{"A":"x","a":"y"}', '{"a":"x","\\u0061":"y"}']) fails(() => parseFlat(raw), 'unsupported-structure');
  for (const raw of ['{"a":{"Nested":1,"nested":2}}', '{"a":[{"Same":1,"same":2}]}']) fails(() => parseJsonc(raw), 'unsupported-structure');
  for (const raw of ['{"a":"x" "b":"y"}', '{"a":"x"} {}', '{"a":"x",,}', '{"a":"\\uD800"}', '{"a":"\\q"}', '{"a":"x" /*', '\ufeff\ufeff{"a":"x"}', '{"a":"x\n"}']) fails(() => parseFlat(raw));
  for (const raw of ['[]', 'null', '{"a":1}', '{"a":{}}', '{"a":[]}', '{"é":"x"}', '{"":"x"}']) fails(() => parseFlat(raw), 'unsupported-structure');
  fails(() => parseFlat('{}'), 'invalid-source');
  assert.deepEqual(parseFlat('{}', { allowEmpty: true }), []);
  assert.equal(parseFlat('{"a":"",}')[0].text, '');
  fails(() => parseFlat('{"$schema":7,"a":"x"}'), 'unsupported-structure');
  fails(() => parseFlat('{"$schema":"' + 'x'.repeat(MAX_TEXT_BYTES + 1) + '","a":"x"}'), 'limit-exceeded');
});

test('manifest has exactly one valid entry kind and complete duplicate checking', () => {
  const validPack = '{"UniqueID":"Example.Pack","Name":"Pack","Version":"1","ContentPackFor":{"UniqueID":"Parent"}}';
  assert.equal(extractSource(captured('{"a":"x"}', validPack)).units[0].occurrences[0].nativeIdentity.namespace, 'Example.Pack');
  for (const manifest of ['{}', baseManifest.replace('"1.0.0"', '""'), baseManifest.replace('"Example.Mod"', '"中文"'), baseManifest.replace('"EntryDll":"Test.dll"', '"ContentPackFor":{}'), baseManifest.replace('}', ',"ContentPackFor":{"UniqueID":"Parent"}}'), baseManifest.replace('}', ',"extra":{"A":1,"a":2}}')]) fails(() => extractSource(captured('{"a":"x"}', manifest)));
});

test('oversized manifest names preserve the source while context remains unavailable', () => {
  const fitting = baseManifest.replace('"Name":"Test"', `"Name":"${'é'.repeat(2048)}"`);
  assert.equal(extractSource(captured('{"a":"x"}', fitting)).domainBlocks.length, 2);
  const manifest = baseManifest.replace('"Name":"Test"', `"Name":"${'N'.repeat(4097)}"`);
  const source = captured('{"a":"x"}', manifest);
  const proposal = extractSource(source);
  assert.deepEqual(proposal.domainBlocks, []);
  assert.deepEqual(errors(checkSourceSemantics(sourceCheck(source, proposal))), []);
  const forged = clone(proposal);
  forged.domainBlocks.push(extractSource(captured('{"a":"x"}')).domainBlocks[0]);
  assert.deepEqual(errors(checkSourceSemantics(sourceCheck(source, forged))),
    [{ code: 'source-mismatch', target: 'synthetic-set', severity: 'error' }]);
});

test('exact byte, text, key, count and nesting limits accept N and reject N+1', () => {
  const small = '{"a":"x"}';
  assert.equal(parseFlat(small + ' '.repeat(MAX_SOURCE_BYTES - Buffer.byteLength(small))).length, 1);
  fails(() => parseFlat(small + ' '.repeat(MAX_SOURCE_BYTES - Buffer.byteLength(small) + 1)), 'limit-exceeded');
  assert.equal(extractSource(captured(small, baseManifest + ' '.repeat(MAX_MANIFEST_BYTES - Buffer.byteLength(baseManifest)))).units.length, 1);
  fails(() => extractSource(captured(small, baseManifest + ' '.repeat(MAX_MANIFEST_BYTES - Buffer.byteLength(baseManifest) + 1))), 'limit-exceeded');
  assert.equal(parseFlat(JSON.stringify({ a: 'é'.repeat(MAX_TEXT_BYTES / 2) }))[0].text.length, MAX_TEXT_BYTES / 2);
  fails(() => parseFlat(JSON.stringify({ a: 'é'.repeat(MAX_TEXT_BYTES / 2) + 'x' })), 'limit-exceeded');
  assert.equal(parseFlat(JSON.stringify({ ['k'.repeat(1024)]: 'x' })).length, 1);
  fails(() => parseFlat(JSON.stringify({ ['k'.repeat(1025)]: 'x' })), 'unsupported-structure');
  const entries = count => '{' + Array.from({ length: count }, (_, i) => `"k${i}":""`).join(',') + '}';
  assert.equal(parseFlat(entries(MAX_ENTRIES)).length, MAX_ENTRIES);
  fails(() => parseFlat(entries(MAX_ENTRIES + 1)), 'limit-exceeded');
  parseJsonc('['.repeat(16) + '0' + ']'.repeat(16));
  fails(() => parseJsonc('['.repeat(17) + '0' + ']'.repeat(17)), 'limit-exceeded');
});

test('separate source checker accepts reordered units but blocks forged semantic evidence', () => {
  const fixed = sourceCheck(captured());
  fixed.proposal.units.reverse();
  assert.deepEqual(errors(checkSourceSemantics(fixed)), []);
  const mutations = [
    value => { value.units[0].text = 'forged'; },
    value => { value.units[0].occurrences[0].source.range.start++; },
    value => { value.units[0].occurrences[0].nativeIdentity.value = 'other'; },
    value => { value.units[0].occurrences[0].nativeIdentity.display.value = 'other'; },
    value => { value.order.reverse(); },
    value => { value.order[0] = value.order[1]; },
    value => { value.artifacts.pop(); },
    value => { value.domainBlocks.push({ id: 'forged' }); },
    value => { value.domainBlocks.pop(); },
    value => { value.domainBlocks[0].payloadUtf8 = value.domainBlocks[0].payloadUtf8.replace('Test', 'False'); },
    value => { value.domainBlocks[0].payloadUtf8 = value.domainBlocks[0].payloadUtf8.replace('extracted', 'inferred'); },
    value => { value.domainBlocks[1].payloadUtf8 = value.domainBlocks[1].payloadUtf8.replace('Test', 'False'); },
    value => { value.domainBlocks[1].handling = 'optional'; },
    value => { value.domainBlocks[0].handling = 'optional'; },
    value => { const context = JSON.parse(value.domainBlocks[0].payloadUtf8); context.facts.push({
      id: 'role', kind: 'role', text: 'Narrator', origin: context.facts[0].origin });
      value.domainBlocks[0].payloadUtf8 = JSON.stringify(context); },
    value => { value.units[0].protectedFragments.push({ id: 'forged' }); },
  ];
  for (const mutate of mutations) {
    const request = clone(fixed); mutate(request.proposal);
    assert.deepEqual(errors(checkSourceSemantics(request)), [{ code: 'source-mismatch', target: 'synthetic-set', severity: 'error' }]);
  }
  const wrong = clone(fixed); wrong.requirements[0].waivable = true;
  fails(() => checkSourceSemantics(wrong), 'invalid-input');
  const badHash = captured(); badHash.artifacts[1].sha256 = '0'.repeat(64);
  fails(() => extractSource(badHash), 'invalid-input');
});

test('locale builder matches independent literal bytes with full target/revision coverage', () => {
  const input = buildInput(); input.source.units.reverse(); input.targets.reverse();
  const expected = '{\n  "MiXA": "你好 {{name}} 😀",\n  "same-a": "同じ",\n  "same-b": "同じ",\n  "empty": ""\n}\n';
  const actual = buildLocale(input);
  assert.equal(actual.artifacts[0].utf8, expected);
  assert.equal(actual.artifacts[0].sha256, sha256(expected));
  assert.equal(actual.artifacts[0].logicalPath, 'i18n/zh.json');
  assert.deepEqual(errors(checkArtifact(artifactCheck(input, actual))), []);
  for (const mutate of [value => value.targets.pop(), value => { value.targets[0].sourceRevisionId = 'stale'; }, value => { value.targets[0].text = '\ud800'; }, value => { value.targets[0].text = 'x'.repeat(MAX_TEXT_BYTES + 1); }, value => { value.targets[1] = clone(value.targets[0]); }]) {
    const changed = clone(input); mutate(changed); fails(() => buildLocale(changed), 'invalid-target');
  }
  for (const mutate of [value => { value.configuration = [{ key: 'unknown', value: true }]; }, value => { value.outputLimits.maxArtifacts = 2; }, value => { value.source.units[0].text = 'forged'; }]) {
    const changed = clone(input); mutate(changed); fails(() => buildLocale(changed), 'invalid-input');
  }
});

test('locale paths require canonical spelling, explicit scope and matching base language', () => {
  for (const path of ['i18n/zh.json', 'i18n/zh-CN.json', 'i18n/zh-Hans.json']) assert.equal(safeOutputPath(path, 'zh-CN'), true, path);
  for (const path of ['i18n/default.json', '../zh.json', '/i18n/zh.json', 'i18n/zh-cn.json', 'i18n/ZH.json', 'i18n/zh--CN.json', 'i18n/en.json', 'i18n/con.json', 'i18n/com0.json', 'i18n/zh.json/extra']) assert.equal(safeOutputPath(path, 'zh-CN'), false, path);
  assert.equal(safeOutputPath('i18n/zh.json', 'zh-cn'), false);
  const input = buildInput(); input.outputPaths = ['i18n/en.json']; fails(() => buildLocale(input), 'invalid-input');
});

test('independent artifact checker blocks rehashed corruption and noncanonical JSON', () => {
  const input = buildInput(); const fixed = artifactCheck(input);
  const raw = fixed.output.artifacts[0].utf8;
  for (const changed of [raw.replace('你好', 'wrong'), raw.replace('MiXA', 'other'), raw.replace('  "', ' "'), raw.trim(), '\ufeff' + raw, raw.replace('{', '{ // comment'), raw.replace('\n}', ',\n}'), raw.replace('"same-b": "同じ",\n', ''), raw.replace('"empty": ""', '"empty": "",\n  "extra": "x"')]) {
    const request = clone(fixed); request.output.artifacts[0].utf8 = changed; request.output.artifacts[0].sha256 = sha256(changed);
    assert.equal(errors(checkArtifact(request)).length, 1, changed);
  }
  for (const mutate of [request => { request.output.artifacts[0].logicalPath = 'i18n/en.json'; }, request => { request.output.artifacts[0].sha256 = '0'.repeat(64); }, request => { request.output.targetLanguage = 'ja'; }]) {
    const request = clone(fixed); mutate(request); fails(() => checkArtifact(request), 'invalid-artifact');
  }
});

test('marker name/count and Unicode control checks inspect both fixed source and target', () => {
  assert.deepEqual([...markers('{{a}} {{a}} {{b_-1}}')], [['a', 2], ['b_-1', 1]]);
  for (const text of ['{{}}', '{{a b}}', '{{a', 'a}}', '{{a{{b}}', '{{中文}}']) assert.equal(markers(text), null);
  for (const target of ['你好', '{{Name}}', '{{name}} {{name}}', '{{name}}\u0085', '{{name}}\u009f', '{{name}}\u007f', '{{name}}\u0000', '{{bad']) {
    const input = buildInput(); input.targets[0].text = target;
    assert.equal(errors(checkArtifact(artifactCheck(input))).length, 1, target);
  }
  const controls = buildInput(extractSource(captured('{"a":"\\u0085"}')), ['ok']);
  assert.equal(errors(checkArtifact(artifactCheck(controls))).length, 1);
  const allowed = buildInput(extractSource(captured('{"a":"\\t\\r\\n"}')), ['\t\r\n']);
  assert.deepEqual(errors(checkArtifact(artifactCheck(allowed))), []);
});

test('existing translation fixture decodes all 532 oracle entries without claiming project adoption', () => {
  const raw = fixture('stardew-lookup/i18n/zh.json'); const oracle = json('stardew-lookup/translation-oracle.json');
  assert.equal(sha256(raw), oracle.translationSha256);
  const entries = parseFlat(raw, { allowEmpty: true });
  assert.equal(entries.length, oracle.count);
  assert.deepEqual(entries.map((entry, ordinal) => ({ ordinal, key: entry.key, text: entry.text })), oracle.entries.map(({ ordinal, key, text }) => ({ ordinal, key, text })));
});

test('maintenance extraction retains distinct native identities without inferring rename or sharing', () => {
  const oracle = json('upstream-maintenance/oracle.json');
  for (const version of ['s1', 's2']) {
    const source = captured(fixture(`upstream-maintenance/${version}/i18n/default.json`), fixture(`upstream-maintenance/${version}/manifest.json`));
    const result = extractSource(source);
    assert.equal(result.units.length, oracle[`${version}Count`]);
    assert.equal(new Set(result.units.map(unit => unit.occurrences[0].nativeIdentity.value)).size, oracle[`${version}Count`]);
    assert.deepEqual(result.relations, []);
    assert.ok(result.units.every(unit => unit.occurrences[0].nativeIdentity.namespace === oracle.namespace));
  }
});

test('every domain operation observes an already cancelled invocation', () => {
  const signal = AbortSignal.abort(); const source = captured(); const input = buildInput();
  for (const run of [() => parseJsonc(original, { signal }), () => extractSource(source, signal), () => checkSourceSemantics(sourceCheck(source), signal), () => buildLocale(input, signal), () => checkArtifact(artifactCheck(input), signal)]) fails(run, 'cancelled');
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import validateInput from '../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/validate-translation-extraction-input.mjs';
import validateProposal from '../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/validate-translation-exchange.mjs';
import validateCheck from '../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/validate-translation-extraction-check-input.mjs';
import { PROFILE, MAX_SOURCE_BYTES, MAX_TEXT_BYTES, MAX_ENTRIES, SmapiError,
  sha256, extractTranslations, checkTranslationSemantics } from '../components/smapi.mjs';

const ref = id => ({ id, schemaVersion: 1, behaviorVersion: 1 });
const original = '\ufeff{\r\n // 原始 中文 😀\r\n "MiX\\u0041": "译文 👩🏽‍💻 é",\r\n "same-a": "同文",\r\n "same-b": "同文",\r\n "empty": "",\r\n "$schema": "schema.json",\r\n}\r\n';
const capture = (utf8 = original, logicalPath = 'i18n/zh.json') => ({ profile: { ...PROFILE }, importId: 'translation-import',
  sourceSetId: 'fixed-source-set', sourceSnapshotId: 'fixed-source-snapshot', targetLanguage: 'zh-CN', languageEvidence: 'user-confirmed',
  nativeScope: { namespace: 'Example.Mod', policy: ref('smapi-native-key') },
  artifacts: [{ id: 'translated-file', logicalPath, role: 'translation', sha256: sha256(utf8), utf8 }] });
const requirement = input => ({ key: { rule: ref('smapi.translation-semantics'), implementation: { kind: 'plugin', provider: {
  plugin: { publisher: 'org.tsumugi', id: 'stardew-smapi', version: '0.1.0-alpha.1' }, componentId: 'smapi-worker',
  contributionId: 'translation-semantic-check', packageDigest: 'a'.repeat(64),
} } }, inputDigest: sha256(JSON.stringify(input)), scopeDigest: 'b'.repeat(64), targets: [input.importId], mandatory: true, waivable: false, notApplicable: null });
const check = input => ({ input, proposal: extractTranslations(input), requirements: [requirement(input)] });
const findings = request => checkTranslationSemantics(request)[0].outcome.findings;
const fail = (run, code) => assert.throws(run, error => error instanceof SmapiError && (!code || error.code === code));
const fixture = name => readFileSync(new URL(`fixtures/stardew-lookup/${name}`, import.meta.url), 'utf8');

test('complete translation proposal matches all 532 independent .NET oracle entries', () => {
  const oracle = JSON.parse(fixture('translation-oracle.json'));
  const input = capture(fixture('i18n/zh.json'), oracle.translationPath);
  input.nativeScope.namespace = 'Pathoschild.LookupAnything';
  assert.equal(input.artifacts[0].sha256, oracle.translationSha256);
  assert.equal(validateInput(input), true);
  const proposal = extractTranslations(input);
  assert.equal(validateProposal(proposal), true);
  assert.equal(proposal.entries.length, oracle.count);
  assert.deepEqual(proposal.entries.map((entry, ordinal) => ({ ordinal, key: entry.nativeIdentity.display.value, text: entry.text })),
    oracle.entries.map(({ ordinal, key, text }) => ({ ordinal, key, text })));
  assert.equal(proposal.declaredLanguage, oracle.declaredLocale);
  assert.equal(proposal.targetLanguage, oracle.confirmedProjectLocale);
  assert.equal(proposal.sourceSnapshotId, input.sourceSnapshotId);
  assert.deepEqual(proposal.artifacts, input.artifacts);
  assert.deepEqual(proposal.order, proposal.entries.map(entry => entry.id));
  const bytes = Buffer.from(input.artifacts[0].utf8);
  for (const entry of proposal.entries) {
    assert.equal(entry.nativeIdentity.value, entry.nativeIdentity.display.value.toLowerCase());
    assert.equal(entry.nativeIdentity.namespace, input.nativeScope.namespace);
    for (const [source, expected] of [[entry.source, entry.text], [entry.nativeIdentity.display.source, entry.nativeIdentity.display.value]]) {
      assert.equal(JSON.parse(bytes.subarray(source.range.start, source.range.end).toString()), expected);
    }
  }
  const request = { input, proposal, requirements: [requirement(input)] };
  assert.equal(validateCheck(request), true);
  assert.deepEqual(findings(request), []);
});

test('original Unicode and quoted key ranges have independently computed byte offsets', () => {
  const input = capture(); const proposal = extractTranslations(input);
  assert.deepEqual(proposal.entries.map(entry => [entry.nativeIdentity.value, entry.text]),
    [['mixa', '译文 👩🏽‍💻 é'], ['same-a', '同文'], ['same-b', '同文'], ['empty', '']]);
  const first = proposal.entries[0];
  for (const [source, token] of [[first.source, '"译文 👩🏽‍💻 é"'], [first.nativeIdentity.display.source, '"MiX\\u0041"']]) {
    const start = Buffer.byteLength(original.slice(0, original.indexOf(token)));
    assert.deepEqual(source, { artifactId: 'translated-file', range: { encoding: 'utf8-byte', start, end: start + Buffer.byteLength(token) } });
  }
  assert.equal(first.nativeIdentity.display.value, 'MiXA');
  assert.notEqual(proposal.entries[1].id, proposal.entries[2].id);
  assert.equal(proposal.entries.some(entry => 'unitId' in entry || 'sourceRevisionId' in entry), false);
});

test('filename and target remain distinct explicit canonical base-language evidence', () => {
  for (const path of ['i18n/zh.json', 'i18n/zh-CN.json', 'i18n/zh-Hans.json']) {
    const input = capture(original, path); const proposal = extractTranslations(input);
    assert.equal(proposal.declaredLanguage, path.slice(5, -5));
    assert.equal(proposal.targetLanguage, 'zh-CN');
  }
  for (const path of ['i18n/default.json', 'i18n/DEFAULT.json', 'i18n/ZH.json', 'i18n/zh-cn.json', 'i18n/en.json', 'i18n/zz.json',
    'i18n/deep/zh.json', '../zh.json', 'i18n/zh--CN.json', 'i18n/zh.json/extra', 'i18n/zh.JSON']) fail(() => extractTranslations(capture(original, path)), 'invalid-input');
  const inferred = capture(); inferred.languageEvidence = 'inferred';
  assert.equal(validateInput(inferred), false); fail(() => extractTranslations(inferred), 'invalid-input');
  const target = capture(); target.targetLanguage = 'zh-cn'; fail(() => extractTranslations(target), 'invalid-input');
  const reserved = capture(original, 'i18n/con.json'); reserved.targetLanguage = 'con';
  fail(() => extractTranslations(reserved), 'invalid-input');
});

test('empty complete objects retain evidence; empty files and malformed flat files refuse success', () => {
  for (const raw of ['{}', '\ufeff{\r\n // empty\r\n}\r\n', '{"$schema":"schema.json"}']) {
    const input = capture(raw); const proposal = extractTranslations(input);
    assert.deepEqual(proposal.entries, []); assert.deepEqual(proposal.order, []);
    assert.deepEqual(proposal.artifacts, input.artifacts); assert.deepEqual(findings(check(input)), []);
  }
  for (const raw of ['', ' \r\n', '\ufeff\ufeff{}', '{"a":"\\uD800"}', '{"a":1}', '{"A":"x","a":"y"}', '{"a":"x","\\u0061":"y"}', '{"a":"x"} {}']) fail(() => extractTranslations(capture(raw)));
  assert.equal(extractTranslations(capture('{"a":""}')).entries[0].text, '');
});

test('whole translation file, decoded UTF-8 text and entry limits accept N and refuse N+1', () => {
  const small = '{"a":"x"}';
  const full = small + ' '.repeat(MAX_SOURCE_BYTES - Buffer.byteLength(small));
  assert.equal(extractTranslations(capture(full)).entries.length, 1);
  fail(() => extractTranslations(capture(full + ' ')), 'limit-exceeded');
  assert.equal(extractTranslations(capture(JSON.stringify({ a: 'é'.repeat(MAX_TEXT_BYTES / 2) }))).entries.length, 1);
  fail(() => extractTranslations(capture(JSON.stringify({ a: 'é'.repeat(MAX_TEXT_BYTES / 2) + 'x' }))), 'limit-exceeded');
  const entries = count => '{' + Array.from({ length: count }, (_, i) => `"k${i}":""`).join(',') + '}';
  const max = capture(entries(MAX_ENTRIES)); const proposal = extractTranslations(max);
  assert.equal(proposal.entries.length, MAX_ENTRIES); assert.equal(validateProposal(proposal), true);
  assert.deepEqual(findings({ input: max, proposal, requirements: [requirement(max)] }), []);
  fail(() => extractTranslations(capture(entries(MAX_ENTRIES + 1))), 'limit-exceeded');
});

test('independent full-file checker blocks forged text, identity, capture, scope and omissions', () => {
  const original = check(capture()); original.proposal.entries.reverse();
  assert.deepEqual(findings(original), []);
  const mutations = [
    value => { value.entries[0].text = 'forged'; }, value => { value.entries[0].nativeIdentity.value = 'other'; },
    value => { value.entries[0].nativeIdentity.display.value = 'other'; }, value => { value.entries[0].source.range.start++; },
    value => { value.entries[0].nativeIdentity.display.source.range.end--; }, value => { value.entries.pop(); value.order.pop(); },
    value => { value.order.reverse(); }, value => { value.order[0] = value.order[1]; },
    value => { value.sourceSnapshotId = 'different'; }, value => { value.targetLanguage = 'zh-TW'; },
    value => { value.declaredLanguage = 'zh-CN'; }, value => { value.nativeScope.namespace = 'other'; },
    value => { value.nativeScope.policy.behaviorVersion++; },
    value => { value.artifacts[0].utf8 += ' '; value.artifacts[0].sha256 = sha256(value.artifacts[0].utf8); },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original); mutate(changed.proposal);
    assert.deepEqual(findings(changed), [{ code: 'translation-mismatch', target: original.input.importId, severity: 'error' }]);
  }
  const forged = structuredClone(original); forged.proposal.entries[0].text = 'forged';
  assert.equal(validateCheck(forged), true); // Structure does not prove domain semantics.
});

test('frozen requirements and original capture cannot be weakened or reassigned', () => {
  const original = check(capture());
  for (const mutate of [value => { value.requirements = []; }, value => { value.requirements[0].waivable = true; },
    value => { value.requirements[0].mandatory = false; }, value => { value.requirements[0].targets = ['other']; },
    value => { value.requirements[0].key.rule.behaviorVersion++; }, value => { value.requirements[0].key.implementation.provider.contributionId = 'source-semantic-check'; }]) {
    const changed = structuredClone(original); mutate(changed); fail(() => checkTranslationSemantics(changed), 'invalid-input');
  }
  for (const mutate of [value => { value.artifacts[0].sha256 = '0'.repeat(64); }, value => { value.artifacts[0].role = 'source'; },
    value => { value.sourceSnapshotId = ''; }, value => { value.nativeScope.policy.behaviorVersion++; },
    value => { value.nativeScope.namespace = '中文'; }, value => { value.artifacts.push(structuredClone(value.artifacts[0])); }]) {
    const changed = capture(); mutate(changed); fail(() => extractTranslations(changed), 'invalid-input');
  }
});

test('translation extraction and independent checking observe cancellation', () => {
  const input = capture(); const request = check(input); const signal = AbortSignal.abort();
  fail(() => extractTranslations(input, signal), 'cancelled');
  fail(() => checkTranslationSemantics(request, signal), 'cancelled');
});

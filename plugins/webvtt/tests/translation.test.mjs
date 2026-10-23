import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import validateInput from '../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/validate-translation-extraction-input.mjs';
import validateProposal from '../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/validate-translation-exchange.mjs';
import validateCheck from '../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/validate-translation-extraction-check-input.mjs';
import { PROFILE, MAX_SOURCE_BYTES, MAX_CUES, MAX_TEXT_BYTES, MAX_PAYLOAD_BYTES, MAX_CONTENT_BYTES, MAX_SOURCE_CHECK_BYTES,
  WebvttError, extractSource, parseCaptions, extractTranslations, checkTranslationSemantics } from '../components/webvtt.mjs';

const ref = id => ({ id, schemaVersion: 1, behaviorVersion: 1 });
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const firstText = '译文 👩🏽‍💻 e\u0301\n第二行';
const originalLf = 'WEBVTT translated captions\n\nSTYLE\n::cue { color: lime; }\n\nREGION\nid:main\nwidth:50%\n\n'
  + 'NOTE 原始 😀\nkept as evidence\n\nMiX\n00:01.000 --> 00:02.000 align:center region:main\n'
  + firstText + '\n\nSame-A\n00:03.000 --> 00:04.000\n同文\n\nSame-B\n00:03.000 --> 00:04.000\n同文\n\nNOTE tail\n';
const original = '\uFEFF' + originalLf.replaceAll('\n', '\r\n');
const capture = (utf8 = original, logicalPath = 'translations/zh.vtt') => ({ profile: { ...PROFILE },
  importId: 'translation-import', sourceSetId: 'fixed-source-set', sourceSnapshotId: 'fixed-source-snapshot',
  targetLanguage: 'zh-CN', languageEvidence: 'user-confirmed',
  nativeScope: { namespace: 'webvtt:source', policy: ref('webvtt-cue') },
  artifacts: [{ id: 'translated-file', logicalPath, role: 'translation', sha256: hash(utf8), utf8 }] });
const requirement = input => ({ key: { rule: ref('webvtt.translation-semantics'), implementation: { kind: 'plugin', provider: {
  plugin: { publisher: 'org.tsumugi', id: 'webvtt', version: '0.1.0-alpha.1' }, packageDigest: 'a'.repeat(64),
  componentId: 'caption-worker', contributionId: 'translation-semantic-check',
} } }, inputDigest: hash(JSON.stringify(input)), scopeDigest: 'b'.repeat(64), targets: [input.importId],
  mandatory: true, waivable: false, notApplicable: null });
const request = (input, proposal = extractTranslations(input)) => ({ input, proposal, requirements: [requirement(input)] });
const findings = value => checkTranslationSemantics(value)[0].outcome.findings;
const fail = (run, code) => assert.throws(run, error => error instanceof WebvttError && (!code || error.code === code));

// This oracle names the literal cue IDs/text and computes byte coordinates from
// their known file tokens. It never uses the caption parser or the extractor.
function literalProposal(input, newline = '\r\n') {
  const artifact = input.artifacts[0]; const raw = artifact.utf8;
  const reference = (literal, from = 0) => {
    const position = raw.indexOf(literal, from); assert.notEqual(position, -1);
    const start = Buffer.byteLength(raw.slice(0, position));
    return { artifactId: artifact.id, range: { encoding: 'utf8-byte', start, end: start + Buffer.byteLength(literal) } };
  };
  const entries = [
    ['local-first', 'MiX', 'mix', firstText],
    ['local-second', 'Same-A', 'same-a', '同文'],
    ['local-third', 'Same-B', 'same-b', '同文'],
  ].map(([id, display, value, text]) => {
    const cueStart = raw.indexOf(display + newline); assert.notEqual(cueStart, -1);
    return { id, text, source: reference(text.replaceAll('\n', newline), cueStart),
      nativeIdentity: { namespace: 'webvtt:source', value, policy: ref('webvtt-cue'),
        display: { value: display, source: reference(display, cueStart) } } };
  });
  return { ...structuredClone(input), declaredLanguage: 'zh', entries, order: ['local-first', 'local-second', 'local-third'] };
}

test('literal whole-file oracle checks Unicode, original payload/ID ranges and operation-local entries', () => {
  const input = capture(); const oracle = literalProposal(input);
  assert.equal(validateInput(input), true); assert.equal(validateProposal(oracle), true);
  const check = request(input, oracle);
  assert.equal(validateCheck(check), true);
  const fixed = check.requirements[0];
  assert.deepEqual(checkTranslationSemantics(check), [{ key: fixed.key, inputDigest: fixed.inputDigest,
    scopeDigest: fixed.scopeDigest, coveredTargets: [input.importId], outcome: { kind: 'completed', findings: [] } }]);
  const expected = structuredClone(oracle);
  expected.entries.forEach((entry, index) => { entry.id = `translation-${index}`; });
  expected.order = ['translation-0', 'translation-1', 'translation-2'];
  assert.deepEqual(extractTranslations(input), expected);
  const bytes = Buffer.from(original);
  for (const entry of expected.entries) {
    const payload = entry.source.range; const display = entry.nativeIdentity.display;
    assert.equal(bytes.subarray(payload.start, payload.end).toString().replaceAll('\r\n', '\n'), entry.text);
    assert.equal(bytes.subarray(display.source.range.start, display.source.range.end).toString(), display.value);
    assert.equal('unitId' in entry || 'sourceRevisionId' in entry || 'timing' in entry, false);
  }
  assert.notEqual(expected.entries[1].id, expected.entries[2].id);
  assert.deepEqual(expected.artifacts, input.artifacts);
  assert.equal('domainBlocks' in expected, false);
});

test('BOM and every original line ending preserve literal evidence while entry text uses LF', () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    for (const bom of ['', '\uFEFF']) {
      const input = capture(bom + originalLf.replaceAll('\n', newline));
      const oracle = literalProposal(input, newline);
      assert.deepEqual(findings(request(input, oracle)), []);
      const actual = extractTranslations(input);
      assert.deepEqual(actual.entries.map(entry => entry.text), [firstText, '同文', '同文']);
      assert.deepEqual(actual.entries.map(entry => entry.source), oracle.entries.map(entry => entry.source));
      assert.deepEqual(actual.entries.map(entry => entry.nativeIdentity), oracle.entries.map(entry => entry.nativeIdentity));
      assert.deepEqual(actual.artifacts, input.artifacts);
    }
  }
});

test('canonical filename locale remains separate from the confirmed same-base target', () => {
  for (const stem of ['zh', 'zh-CN', 'zh-Hans', 'zh-Hant-TW']) {
    const input = capture(original, `translations/${stem}.vtt`);
    const proposal = extractTranslations(input);
    assert.equal(proposal.declaredLanguage, stem); assert.equal(proposal.targetLanguage, 'zh-CN');
    assert.deepEqual(findings(request(input, proposal)), []);
  }
  for (const path of ['translations/ZH.vtt', 'translations/zh-cn.vtt', 'translations/zh--CN.vtt',
    'translations/en.vtt', 'translations/zz.vtt', 'translations/deep/zh.vtt', '../zh.vtt',
    'zh.vtt', 'translations/zh.VTT', 'translations/zh.vtt/extra', 'translations/zh_CN.vtt']) {
    fail(() => extractTranslations(capture(original, path)), 'invalid-input');
  }
  const noncanonical = capture(); noncanonical.targetLanguage = 'zh-cn';
  fail(() => extractTranslations(noncanonical), 'invalid-input');
  const reserved = capture(original, 'translations/con.vtt'); reserved.targetLanguage = 'con';
  fail(() => extractTranslations(reserved), 'invalid-input');
});

test('complete empty WEBVTT translation files keep evidence without weakening source parsing', () => {
  for (const raw of ['WEBVTT\n\n', '\uFEFFWEBVTT\r\n\r\n',
    'WEBVTT empty\n\nNOTE no translations\n\nSTYLE\n::cue { color: lime; }\n']) {
    const input = capture(raw); const proposal = extractTranslations(input);
    assert.deepEqual(proposal.entries, []); assert.deepEqual(proposal.order, []);
    assert.deepEqual(proposal.artifacts, input.artifacts); assert.equal(validateProposal(proposal), true);
    assert.deepEqual(findings(request(input, proposal)), []);
    fail(() => parseCaptions(raw), 'invalid-source');
    fail(() => extractSource({ profile: PROFILE, sourceSetId: 'source', sourceLanguage: 'en-US',
      artifacts: [{ ...input.artifacts[0], logicalPath: 'source.vtt', role: 'source' }] }), 'invalid-source');
  }
  for (const raw of ['', ' \r\n', 'WEBVTT', '\uFEFF\uFEFFWEBVTT\n\n',
    'WEBVTT\n\n00:00.000 --> 00:01.000\nAnonymous\n',
    'WEBVTT\n\nA\n00:00.000 --> 00:01.000\nx\n\na\n00:01.000 --> 00:02.000\ny\n',
    'WEBVTT\n\nA\n00:00.000 --> 00:01.000\n\n',
    'WEBVTT\n\nA\n00:00.000 --> 00:01.000\n<v speaker>x\n',
    'WEBVTT\n\nA\n00:00.000 --> 00:01.000\n&amp;\n']) fail(() => extractTranslations(capture(raw)));
});

test('fixed scope, original SHA, role and the single captured artifact are required', () => {
  const mutations = [
    input => { input.importId = ''; }, input => { input.sourceSetId = 'not an opaque id'; },
    input => { input.sourceSnapshotId = ''; }, input => { input.languageEvidence = 'inferred'; },
    input => { input.nativeScope.namespace = 'other'; }, input => { input.nativeScope.policy.id = 'other'; },
    input => { input.nativeScope.policy.schemaVersion++; }, input => { input.nativeScope.policy.behaviorVersion++; },
    input => { input.artifacts[0].id = ''; }, input => { input.artifacts[0].role = 'source'; },
    input => { input.artifacts[0].sha256 = '0'.repeat(64); },
    input => { input.artifacts[0].utf8 += ' '; },
    input => { input.artifacts[0].utf8 = '\uD800'; input.artifacts[0].sha256 = hash(input.artifacts[0].utf8); },
    input => { input.artifacts = []; }, input => { input.artifacts.push(structuredClone(input.artifacts[0])); },
  ];
  for (const mutate of mutations) {
    const input = capture(); mutate(input); fail(() => extractTranslations(input), 'invalid-input');
  }
  for (const field of ['id', 'schemaVersion', 'behaviorVersion']) {
    const input = capture(); input.profile[field] = field === 'id' ? 'other' : 2;
    fail(() => extractTranslations(input), 'unsupported-profile');
  }
});

test('whole-file, original payload UTF-8 and cue count limits accept N and refuse N+1', () => {
  const cue = 'Cue\n00:00.000 --> 00:01.000\nx\n';
  const prefix = 'WEBVTT\n\nNOTE ';
  const full = prefix + 'x'.repeat(MAX_SOURCE_BYTES - Buffer.byteLength(prefix + '\n\n' + cue)) + '\n\n' + cue;
  assert.equal(Buffer.byteLength(full), MAX_SOURCE_BYTES);
  const fullInput = capture(full); const fullProposal = extractTranslations(fullInput);
  assert.equal(fullProposal.entries.length, 1); assert.deepEqual(findings(request(fullInput, fullProposal)), []);
  fail(() => extractTranslations(capture(full + '\n')), 'limit-exceeded');
  const payload = 'é'.repeat(MAX_TEXT_BYTES / 2);
  const raw = text => `WEBVTT\n\nCue\n00:00.000 --> 00:01.000\n${text}\n`;
  assert.equal(Buffer.byteLength(payload), MAX_TEXT_BYTES);
  assert.equal(extractTranslations(capture(raw(payload))).entries[0].text, payload);
  fail(() => extractTranslations(capture(raw(payload + 'a'))), 'unsupported-structure');
  const cues = count => 'WEBVTT\n\n' + Array.from({ length: count }, (_, index) => `C${index}\n00:00.000 --> 00:01.000\nx\n\n`).join('');
  const input = capture(cues(MAX_CUES)); const proposal = extractTranslations(input);
  assert.equal(proposal.entries.length, MAX_CUES); assert.equal(validateProposal(proposal), true);
  assert.equal(proposal.entries[0].nativeIdentity.value, 'c0');
  assert.equal(proposal.entries.at(-1).nativeIdentity.value, 'c1999');
  assert.ok(Buffer.byteLength(JSON.stringify(proposal)) <= MAX_CONTENT_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(request(input, proposal))) <= MAX_SOURCE_CHECK_BYTES);
  assert.deepEqual(findings(request(input, proposal)), []);
  fail(() => extractTranslations(capture(cues(MAX_CUES + 1))), 'limit-exceeded');
});

test('checker follows order references and allows arbitrary local IDs and collection order', () => {
  const input = capture(); const oracle = literalProposal(input); oracle.entries.reverse();
  assert.deepEqual(findings(request(input, oracle)), []);
});

test('independent checker blocks forged complete proposals, byte evidence and missing/extra/reordered cues', () => {
  const input = capture(); const originalRequest = request(input, literalProposal(input));
  const mutations = [
    p => { p.profile.id = 'other'; }, p => { p.profile.schemaVersion++; }, p => { p.profile.behaviorVersion++; },
    ...['importId', 'sourceSetId', 'sourceSnapshotId', 'targetLanguage', 'declaredLanguage', 'languageEvidence']
      .map(key => p => { p[key] = 'other'; }),
    p => { p.nativeScope.namespace = 'other'; }, p => { p.nativeScope.policy.id = 'other'; },
    p => { p.nativeScope.policy.schemaVersion++; }, p => { p.nativeScope.policy.behaviorVersion++; },
    p => { p.artifacts[0].id = 'other'; }, p => { p.artifacts[0].role = 'source'; },
    p => { p.artifacts[0].logicalPath = 'translations/zh-CN.vtt'; }, p => { p.artifacts[0].sha256 = '0'.repeat(64); },
    p => { p.artifacts[0].utf8 = p.artifacts[0].utf8.replace('NOTE tail', 'NOTE forged'); p.artifacts[0].sha256 = hash(p.artifacts[0].utf8); },
    p => { p.artifacts.push(structuredClone(p.artifacts[0])); },
    p => { p.entries[0].text = 'forged'; }, p => { p.entries[0].source.artifactId = 'other'; },
    p => { p.entries[0].source.range.start++; }, p => { p.entries[0].source.range.end--; },
    p => { p.entries[0].source.range.encoding = 'utf16-code-unit'; },
    p => { p.entries[0].nativeIdentity.namespace = 'other'; }, p => { p.entries[0].nativeIdentity.value = 'MiX'; },
    p => { p.entries[0].nativeIdentity.policy.id = 'other'; }, p => { p.entries[0].nativeIdentity.policy.schemaVersion++; },
    p => { p.entries[0].nativeIdentity.policy.behaviorVersion++; },
    p => { p.entries[0].nativeIdentity.display.value = 'mix'; },
    p => { p.entries[0].nativeIdentity.display.source.artifactId = 'other'; },
    p => { p.entries[0].nativeIdentity.display.source.range.start++; },
    p => { p.entries[0].nativeIdentity.display.source.range.end++; },
    p => { p.entries[0].nativeIdentity.display.source.range.encoding = 'utf16-code-unit'; },
    p => { p.entries[0].id = 'invalid local id'; }, p => { p.entries[0].id = p.entries[1].id; },
    p => { p.entries.pop(); p.order.pop(); },
    p => { const entry = structuredClone(p.entries[0]); entry.id = 'extra'; p.entries.push(entry); p.order.push(entry.id); },
    p => { p.order.reverse(); }, p => { p.order[0] = p.order[1]; }, p => { p.order[0] = 'absent'; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(originalRequest); mutate(changed.proposal);
    assert.deepEqual(findings(changed), [{ code: 'translation-mismatch', target: input.importId, severity: 'error' }]);
  }
  const forged = structuredClone(originalRequest); forged.proposal.entries[0].text = 'forged';
  assert.equal(validateCheck(forged), true);
  assert.deepEqual(findings(forged), [{ code: 'translation-mismatch', target: input.importId, severity: 'error' }]);
});

test('retimed and reordered translated captions retain their own evidence without source-update claims', () => {
  const raw = 'WEBVTT\n\nSame-B\n00:07.000 --> 00:09.000\n后译文\n\nMiX\n00:10.000 --> 00:11.000\n前译文\n';
  const input = capture(raw); const proposal = extractTranslations(input);
  assert.deepEqual(proposal.entries.map(entry => [entry.nativeIdentity.value, entry.text]), [['same-b', '后译文'], ['mix', '前译文']]);
  assert.deepEqual(findings(request(input, proposal)), []);
  assert.equal('units' in proposal || 'domainBlocks' in proposal || 'sourceRevisionId' in proposal, false);
});

test('the exact fixed rule, provider shape and mandatory import target cannot be weakened', () => {
  const originalRequest = request(capture());
  const mutations = [
    r => { r.requirements = []; }, r => { r.requirements.push(structuredClone(r.requirements[0])); },
    r => { r.requirements[0].mandatory = false; }, r => { r.requirements[0].waivable = true; },
    r => { r.requirements[0].notApplicable = { code: 'skip', basisDigest: 'c'.repeat(64) }; },
    r => { r.requirements[0].targets = ['other']; }, r => { r.requirements[0].targets.push(r.input.importId); },
    r => { r.requirements[0].key.rule.id = 'webvtt.source-semantics'; },
    r => { r.requirements[0].key.rule.schemaVersion++; }, r => { r.requirements[0].key.rule.behaviorVersion++; },
    r => { r.requirements[0].key.implementation.kind = 'core'; },
    r => { r.requirements[0].key.implementation.provider.plugin.publisher = 'other'; },
    r => { r.requirements[0].key.implementation.provider.plugin.id = 'other'; },
    r => { r.requirements[0].key.implementation.provider.plugin.version = '0.1.0-alpha.2'; },
    r => { r.requirements[0].key.implementation.provider.componentId = 'other'; },
    r => { r.requirements[0].key.implementation.provider.contributionId = 'source-semantic-check'; },
    r => { r.requirements[0].key.implementation.provider.packageDigest = 'invalid'; },
    r => { r.requirements[0].inputDigest = 'invalid'; }, r => { r.requirements[0].scopeDigest = 'invalid'; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(originalRequest); mutate(changed);
    fail(() => checkTranslationSemantics(changed), 'invalid-input');
  }
});

test('both entrypoints reject cancelled work and oversized encoded payloads', () => {
  const input = capture(); const check = request(input, literalProposal(input)); const signal = AbortSignal.abort();
  fail(() => extractTranslations(input, signal), 'cancelled');
  fail(() => checkTranslationSemantics(check, signal), 'cancelled');
  const oversizedInput = capture(); oversizedInput.importId = 'x'.repeat(MAX_PAYLOAD_BYTES);
  fail(() => extractTranslations(oversizedInput), 'limit-exceeded');
  const oversizedCheck = structuredClone(check); oversizedCheck.proposal.entries[0].text = 'x'.repeat(MAX_SOURCE_CHECK_BYTES);
  fail(() => checkTranslationSemantics(oversizedCheck), 'limit-exceeded');
});

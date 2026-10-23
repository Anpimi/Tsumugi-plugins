import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  PROFILE, BUILD_LIMITS, ARTIFACT_ID, ARTIFACT_RULE, MAX_CUES, MAX_SOURCE_BYTES, MAX_TEXT_BYTES, MAX_PAYLOAD_BYTES,
  WebvttError, sha256, parseCaptions, extractSource, validPayload,
  buildCaptions, checkArtifact, safeOutputPath, encoded,
} from '../components/webvtt.mjs';

const S1 = await readFile(new URL('fixtures/s1.vtt', import.meta.url), 'utf8');
const S2 = await readFile(new URL('fixtures/s2.vtt', import.meta.url), 'utf8');
const EXPECTED = await readFile(new URL('fixtures/expected-zh-CN.vtt', import.meta.url), 'utf8');
const REJECTIONS = JSON.parse(await readFile(new URL('fixtures/rejections.json', import.meta.url), 'utf8'));
const TARGETS = ['你好\n世界', '等待', '旧', '布局', '相同', '消失'];
const extraction = raw => ({ profile: { ...PROFILE }, sourceSetId: 'captured-set-1', sourceLanguage: 'en-US',
  artifacts: [{ id: 'artifact-source', logicalPath: 'source.vtt', role: 'source', sha256: sha256(raw), utf8: raw }] });
function buildInput(raw = S1, targets = TARGETS) {
  const source = extractSource(extraction(raw));
  return { source, targetLanguage: 'zh-CN', outputPaths: ['zh-CN.vtt'], outputLimits: { ...BUILD_LIMITS }, configuration: [],
    targets: source.units.map((unit, ordinal) => ({ unitId: unit.id, sourceRevisionId: unit.sourceRevisionId, text: targets[ordinal] })) };
}
const actualOutput = (raw, input) => ({ profile: { ...PROFILE }, sourceSetId: input.source.sourceSetId,
  targetLanguage: input.targetLanguage, artifacts: [{ id: ARTIFACT_ID, role: 'caption', logicalPath: input.outputPaths[0], sha256: sha256(raw), utf8: raw }] });
const checkInput = (input, output) => ({ input, output, requirements: [{ key: { rule: { id: ARTIFACT_RULE, schemaVersion: 1, behaviorVersion: 1 },
  implementation: { kind: 'plugin', provider: { plugin: { publisher: 'org.tsumugi', id: 'webvtt', version: '0.1.0-alpha.1' },
    packageDigest: 'a'.repeat(64), componentId: 'caption-worker', contributionId: 'validate-artifact' } } },
  inputDigest: 'b'.repeat(64), scopeDigest: 'c'.repeat(64), targets: [ARTIFACT_ID], mandatory: true, waivable: false, notApplicable: null }] });
const semanticFailure = request => assert.deepEqual(checkArtifact(request)[0].outcome.findings,
  [{ code: 'artifact-mismatch', target: ARTIFACT_ID, severity: 'error' }]);
const domainError = callback => assert.throws(callback, error => error instanceof WebvttError);

test('all original line endings and BOM combinations match the literal independent byte oracle', () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    for (const bom of ['', '\uFEFF']) {
      const source = bom + S1.replaceAll('\n', newline);
      const expected = bom + EXPECTED.replaceAll('\n', newline);
      const input = buildInput(source);
      const output = buildCaptions(input);
      assert.deepEqual(Buffer.from(output.artifacts[0].utf8), Buffer.from(expected));
      assert.equal(output.artifacts[0].sha256, sha256(expected));
      assert.equal(output.artifacts.length, 1);
      // The checker is also exercised directly on the fixed oracle, without
      // using any bytes returned by the builder to define what is correct.
      const checked = checkArtifact(checkInput(input, actualOutput(expected, input)));
      assert.deepEqual(checked[0].outcome, { kind: 'completed', findings: [] });
      assert.deepEqual(checked[0].key, checkInput(input, actualOutput(expected, input)).requirements[0].key);
    }
  }
});

test('SDK content exchange retains original artifact, byte ranges and canonical native evidence', () => {
  const source = '\uFEFF' + S1.replaceAll('\n', '\r\n').replace('Hello 世界', 'Hello 世界 e\u0301 👩‍👩‍👦').replace('keep\r\n', 'Keep\r\n');
  const request = extraction(source);
  const result = extractSource(request);
  assert.deepEqual(result.artifacts, request.artifacts);
  assert.deepEqual(result.units.map(unit => unit.text), ['Hello 世界 e\u0301 👩‍👩‍👦\nWorld', 'Wait', 'Old', 'Layout', 'Same', 'Gone']);
  assert.equal(result.units.length, result.order.length);
  const original = Buffer.from(source);
  for (const [index, unit] of result.units.entries()) {
    assert.equal(unit.occurrences.length, 1);
    const occurrence = unit.occurrences[0];
    assert.equal(occurrence.source.range.encoding, 'utf8-byte');
    assert.equal(original.subarray(occurrence.source.range.start, occurrence.source.range.end).toString('utf8').replaceAll('\r\n', '\n'), unit.text);
    assert.equal(occurrence.nativeIdentity.value, ['keep', 'timed', 'word', 'layout', 'rename', 'removed'][index]);
    assert.deepEqual(occurrence.nativeIdentity.policy, { id: 'webvtt-cue', schemaVersion: 1, behaviorVersion: 1 });
    const display = occurrence.nativeIdentity.display;
    assert.equal(display.source.artifactId, request.artifacts[0].id);
    assert.equal(display.source.range.encoding, 'utf8-byte');
    assert.equal(original.subarray(display.source.range.start, display.source.range.end).toString('utf8'), display.value);
    assert.equal(display.value, ['Keep', 'timed', 'word', 'layout', 'rename', 'removed'][index]);
    assert.equal(result.domainBlocks[index].handling, 'required');
    assert.equal(result.domainBlocks[index].target.id, occurrence.id);
    const basis = JSON.parse(result.domainBlocks[index].payloadUtf8);
    assert.equal(basis.nativeId, ['Keep', 'timed', 'word', 'layout', 'rename', 'removed'][index]);
    assert.ok(basis.timing.includes('-->'));
  }
});

test('NOTE and newline changes do not alter semantic basis while timing and layout changes do', () => {
  const before = parseCaptions(S1).cues;
  for (const changed of [S1.replace('NOTE Keep', 'NOTE Another'), S1.replaceAll('\n', '\r\n')]) {
    assert.deepEqual(parseCaptions(changed).cues.map(cue => cue.basis), before.map(cue => cue.basis));
  }
  const timed = parseCaptions(S1.replace('00:01.000', '00:01.500')).cues;
  assert.deepEqual(timed[0].basis, before[0].basis);
  assert.notDeepEqual(timed[1].basis, before[1].basis);
  const layout = parseCaptions(S1.replace('color: lime', 'color: red')).cues;
  assert.ok(layout.every((cue, index) => cue.basis.layoutDigest !== before[index].basis.layoutDigest));
  const next = parseCaptions(S2).cues;
  assert.equal(next[0].canonicalId, before[0].canonicalId);
  assert.equal(next[0].sourceText, before[0].sourceText);
  assert.deepEqual(next[0].basis, before[0].basis);
});

test('source rejects malformed, unsupported, ambiguous and injected structure', () => {
  for (const fixture of REJECTIONS) {
    assert.throws(() => parseCaptions(fixture.utf8), error => error instanceof WebvttError && error.code === fixture.code, fixture.name);
  }
  const malformed = [
    S1.replace('WEBVTT', 'INVALID'), S1.replace('timed\n', 'keep\n'), S1.replace('timed\n', 'KEEP\n'),
    S1.replace('timed\n', ''), S1.replace('00:01.000', '00:60.000'), S1.replace('00:01.000', '00:05.000'),
    S1.replace('00:02.000', '00:00.000'), S1.replace('00:03.000 --> 00:04.000', '00:00.500 --> 00:04.000'),
    S1.replace('align:center', 'align:bogus'), S1.replace('align:center', 'vertical:rl'), S1.replace('align:center', 'size:101%'),
    S1.replace('align:center', 'size:20% size:30%'), S1.replace('region:main', 'region:missing'),
    S1.replace('Wait', '<b>Wait</b>'), S1.replace('Wait', 'A --> B'), S1.replace('Wait', '&amp;'), S1.replace('Wait', ''),
    S1.replace('Wait', 'a\0b'), S1.replace(' --> ', '\u00A0-->\u00A0'), S1.replace(' --> ', '\v-->\v'),
    S1 + '\nSTYLE\n::cue { color: red; }\n', S1.replace('NOTE Keep', 'NOTE --> Keep'),
    S1.replace('width:80%', 'width:101%'), S1.replace('lines:3', 'lines:0'), S1.replace('id:main', 'id:bad region'),
    S1.replace('Hello 世界', '\uD800'), S1.replace('keep\n', '保留\n'),
  ];
  for (const source of malformed) domainError(() => parseCaptions(source));
});

test('bounded source, cue and Unicode text limits reject complete operations without truncation', () => {
  domainError(() => parseCaptions('a'.repeat(MAX_SOURCE_BYTES + 1)));
  domainError(() => parseCaptions(S1.replace('Wait', 'a'.repeat(MAX_TEXT_BYTES + 1))));
  domainError(() => parseCaptions(S1.replace('Wait', '世'.repeat(Math.floor(MAX_TEXT_BYTES / 3) + 1))));
  for (const count of [MAX_CUES, MAX_CUES + 1]) {
    const raw = 'WEBVTT\n\n' + Array.from({ length: count }, (_, index) => `cue-${index}\n00:00.000 --> 00:01.000\nx\n\n`).join('');
    if (count === MAX_CUES) assert.equal(parseCaptions(raw).cues.length, MAX_CUES);
    else domainError(() => parseCaptions(raw));
  }
  domainError(() => encoded({ value: 'x'.repeat(MAX_PAYLOAD_BYTES) }));
  const target = 'a\n'.repeat(MAX_TEXT_BYTES / 2 - 1) + 'a';
  assert.equal(validPayload(target), true);
  const input = buildInput(S1.replaceAll('\n', '\r\n'));
  input.targets[0].text = target;
  assert.throws(() => buildCaptions(input), error => error instanceof WebvttError && error.code === 'limit-exceeded');
});

test('supported timing/settings and region fields remain exact and finite', () => {
  const source = 'WEBVTT\n\nREGION\nid:main\nwidth:.5%\nlines:4294967295\nregionanchor:0%,100%\nviewportanchor:50%,50%\nscroll:up\n\nCue\n00000001:00:00.000 --> 00000001:00:01.000 line:-2147483648,end position:25%,line-right size:20% align:left region:main\nText\n';
  assert.equal(parseCaptions(source).cues[0].canonicalId, 'cue');
  for (const raw of [source.replace('lines:4294967295', 'lines:4294967296'), source.replace('line:-2147483648', 'line:-2147483649'),
    source.replace('width:.5%', 'width:NaN%'), source.replace('scroll:up', 'scroll:down')]) domainError(() => parseCaptions(raw));
});

test('build rejects missing coverage, forged source/basis, unsafe paths and unsupported target text', () => {
  for (const mutate of [
    input => input.targets.pop(), input => input.targets.push(input.targets[0]),
    input => { input.targets[0].sourceRevisionId = 'other'; }, input => { input.targets[0].unitId = 'other'; },
    input => { input.source.units[0].text = 'forged'; }, input => { input.source.order.reverse(); },
    input => { input.source.units[0].occurrences[0].nativeIdentity.value = 'other'; },
    input => { input.source.domainBlocks[0].payloadUtf8 = '{}'; },
    input => { input.source.artifacts[0].sha256 = '0'.repeat(64); }, input => { input.executionGrant = true; },
    input => { input.configuration = [{}]; }, input => { input.outputPaths.push('another.vtt'); },
    input => { input.outputLimits.maxArtifacts = 2; }, input => { input.outputLimits.maxTotalBytes -= 1; },
  ]) { const input = buildInput(); mutate(input); domainError(() => buildCaptions(input)); }
  const permuted = buildInput(); permuted.targets.reverse(); permuted.source.units.reverse();
  assert.equal(buildCaptions(permuted).artifacts[0].utf8, EXPECTED);
  for (const text of ['', 'a\n\nb', 'x --> y', '<v speaker>x', '&amp;', 'a\0b', 'a\n', '\uD800']) {
    const input = buildInput(); input.targets[0].text = text; domainError(() => buildCaptions(input));
  }
  for (const path of ['../zh.vtt', 'i18n/zh.vtt', 'con.vtt', 'CON.vtt', 'source.vtt', 'zh.json', 'COM0.vtt', 'lpt9.vtt']) {
    assert.equal(safeOutputPath(path), false); const input = buildInput(); input.outputPaths[0] = path; domainError(() => buildCaptions(input));
  }
  assert.equal(safeOutputPath('zh-CN.vtt'), true);
  assert.equal(validPayload('e\u0301\n👩‍👩‍👦'), true);
});

test('checker rejects every non-payload mutation even when the attacker recomputes SHA-256', () => {
  const input = buildInput();
  for (const [before, after] of [['00:00.000', '00:00.100'], ['color: lime', 'color: red'], ['NOTE Keep', 'NOTE Altered'],
    ['keep\n', 'different\n'], ['你好', '错误'], ['align:center', 'align:left'], ['\n\n', '\n\n\n']]) {
    const forged = actualOutput(EXPECTED.replace(before, after), input);
    semanticFailure(checkInput(input, forged));
  }
  for (const mutate of [
    output => { output.artifacts[0].sha256 = '0'.repeat(64); }, output => { output.artifacts[0].id = 'other'; },
    output => { output.artifacts[0].role = 'other'; }, output => { output.targetLanguage = 'en'; },
    output => { output.artifacts[0].logicalPath = 'different.vtt'; }, output => { output.sourceSetId = 'other'; },
    output => { output.profile.behaviorVersion = 2; }, output => { output.artifacts.push(output.artifacts[0]); },
    output => { output.adopted = true; },
  ]) { const output = actualOutput(EXPECTED, input); mutate(output); domainError(() => checkArtifact(checkInput(input, output))); }

});

test('checker preserves mixed original line endings and rejects changed payload encoding', () => {
  const template = 'WEBVTT\r\n\r\nCue\r\n00:00.000 --> 00:01.000\r\nA\nB\r\n\r\nNOTE tail\r\n';
  const input = buildInput(template, ['甲\n乙']);
  const expected = 'WEBVTT\r\n\r\nCue\r\n00:00.000 --> 00:01.000\r\n甲\r\n乙\r\n\r\nNOTE tail\r\n';
  assert.deepEqual(Buffer.from(buildCaptions(input).artifacts[0].utf8), Buffer.from(expected));
  checkArtifact(checkInput(input, actualOutput(expected, input)));
  semanticFailure(checkInput(input, actualOutput(expected.replace('甲\r\n乙', '甲\n乙'), input)));
});

test('domain operations honor cancellation and independently captured source bindings', () => {
  const controller = new AbortController(); controller.abort();
  for (const callback of [() => parseCaptions(S1, controller.signal), () => extractSource(extraction(S1), controller.signal),
    () => buildCaptions(buildInput(), controller.signal), () => checkArtifact(checkInput(buildInput(), actualOutput(EXPECTED, buildInput())), controller.signal)]) {
    assert.throws(callback, error => error instanceof WebvttError && error.code === 'cancelled');
  }
  for (const mutate of [
    request => { request.artifacts[0].sha256 = '0'.repeat(64); }, request => { request.artifacts[0].logicalPath = 'other.vtt'; },
    request => { request.artifacts[0].role = 'other'; }, request => { request.artifacts.push(request.artifacts[0]); },
    request => { request.profile.behaviorVersion = 2; },
  ]) { const request = extraction(S1); mutate(request); domainError(() => extractSource(request)); }
});


test('artifact requirements retain exact mandatory provider, basis and complete coverage', () => {
  const input = buildInput();
  const output = actualOutput(EXPECTED, input);
  for (const mutate of [
    r => { r.requirements = []; }, r => { r.requirements.push(r.requirements[0]); },
    r => { r.requirements[0].mandatory = false; }, r => { r.requirements[0].waivable = true; },
    r => { r.requirements[0].notApplicable = 'ignored'; }, r => { r.requirements[0].targets = []; },
    r => { r.requirements[0].targets.push('other'); }, r => { r.requirements[0].inputDigest = 'bad'; },
    r => { r.requirements[0].scopeDigest = 'bad'; }, r => { r.requirements[0].key.rule.behaviorVersion = 2; },
    r => { r.requirements[0].key.implementation.provider.contributionId = 'build'; },
    r => { r.requirements[0].key.implementation.provider.packageDigest = 'bad'; },
  ]) { const request = checkInput(input, output); mutate(request); domainError(() => checkArtifact(request)); }
  const request = checkInput(input, output);
  const frozen = structuredClone(request);
  assert.deepEqual(checkArtifact(request), [{ key: request.requirements[0].key,
    inputDigest: request.requirements[0].inputDigest, scopeDigest: request.requirements[0].scopeDigest,
    coveredTargets: [ARTIFACT_ID], outcome: { kind: 'completed', findings: [] } }]);
  assert.deepEqual(request, frozen);
});

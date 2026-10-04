// Domain implementation derived from Tsumugi's MIT-licensed caption profile.
// See PROVENANCE.md for the exact public source revision and migration boundary.
import { createHash } from 'node:crypto';

/** @typedef {import('../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/content.js').SourceExtractionInput} SourceExtractionInput */
/** @typedef {import('../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/content.js').ContentExchange} ContentExchange */
/** @typedef {import('../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/content.js').SourceExtractionCheckInput} SourceExtractionCheckInput */

export const MAX_SOURCE_BYTES = 128 * 1024;
export const MAX_CUES = 2000;
export const MAX_TEXT_BYTES = 16 * 1024;
export const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCE_CHECK_BYTES = 4 * 1024 * 1024;
export const PROFILE = Object.freeze({ id: 'webvtt-captions', schemaVersion: 1, behaviorVersion: 1 });
export const BUILDER_VERSION = 'webvtt-locale-build-1';
export const CHECKER_VERSION = 'webvtt-locale-artifact-1';
const POLICY = 'webvtt-cue/1';
const contract = id => ({ id, schemaVersion: 1, behaviorVersion: 1 });
const asciiWhitespace = /[\t\n\f\r ]+/;
export const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const normalize = text => text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');

export class WebvttError extends Error {
  constructor(code, detail) {
    super(detail);
    this.name = 'WebvttError';
    this.code = code;
    this.detail = detail;
  }
}
const reject = (code, detail) => { throw new WebvttError(code, detail); };
const cancelled = signal => { if (signal?.aborted) reject('cancelled', 'Operation cancelled.'); };
function scalar(text, code = 'invalid-input') {
  if (typeof text !== 'string' || !text.isWellFormed()) reject(code, 'Expected well-formed Unicode text.');
  return text;
}
function record(value, keys, detail = 'Unexpected input fields.') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    reject('invalid-input', detail);
  }
}
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const language = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9-]+$/.test(value);
const opaque = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._:/-]+$/.test(value);
function profile(value) {
  if (value?.id !== PROFILE.id || value?.schemaVersion !== 1 || value?.behaviorVersion !== 1) {
    reject('unsupported-profile', 'Unsupported caption profile.');
  }
}
function lines(raw) {
  const bytes = Buffer.from(raw, 'utf8');
  const result = [];
  let start = 0;
  for (let end = 0; end < bytes.length; end++) {
    if (bytes[end] !== 13 && bytes[end] !== 10) continue;
    result.push({ text: bytes.subarray(start, end).toString('utf8'), start, end });
    if (bytes[end] === 13 && bytes[end + 1] === 10) end++;
    start = end + 1;
  }
  if (start < bytes.length) result.push({ text: bytes.subarray(start).toString('utf8'), start, end: bytes.length });
  return result;
}
function timestamp(text) {
  const parts = text.split(':');
  if (parts.length !== 2 && parts.length !== 3) reject('invalid-source', 'Invalid cue timestamp.');
  const number = (value, length) => {
    if (value.length !== length || !/^[0-9]+$/.test(value)) reject('invalid-source', 'Invalid cue timestamp.');
    return Number(value);
  };
  let hours = 0;
  if (parts.length === 3) {
    if (parts[0].length < 2 || parts[0].length > 8) reject('invalid-source', 'Invalid cue timestamp.');
    const hourText = parts.shift();
    hours = number(hourText, hourText.length);
  }
  const minutes = number(parts[0], 2);
  const seconds = parts[1].split('.');
  if (seconds.length !== 2) reject('invalid-source', 'Invalid cue timestamp.');
  const second = number(seconds[0], 2);
  const milliseconds = number(seconds[1], 3);
  if (minutes > 59 || second > 59) reject('invalid-source', 'Invalid cue timestamp.');
  return ((hours * 60 + minutes) * 60 + second) * 1000 + milliseconds;
}
function percent(text) {
  if (!/^[0-9.]+%$/.test(text)) return false;
  const value = Number(text.slice(0, -1));
  return Number.isFinite(value) && value >= 0 && value <= 100;
}
function setting(token, regions) {
  const colon = token.indexOf(':');
  if (colon < 0) return false;
  const key = token.slice(0, colon);
  const parts = token.slice(colon + 1).split(',');
  if (parts.length > 2) return false;
  const [value, suffix] = parts;
  switch (key) {
    case 'align': return suffix === undefined && ['start', 'center', 'end', 'left', 'right'].includes(value);
    case 'size': return suffix === undefined && percent(value);
    case 'region': return suffix === undefined && regions.has(value);
    case 'position': return percent(value) && (suffix === undefined || ['line-left', 'center', 'line-right', 'auto'].includes(suffix));
    case 'line': {
      const integer = /^-?[0-9]+$/.test(value) && Number(value) >= -2147483648 && Number(value) <= 2147483647;
      return (value === 'auto' || percent(value) || integer) && (suffix === undefined || ['start', 'center', 'end'].includes(suffix));
    }
    default: return false;
  }
}
function timing(text, regions) {
  const tokens = text.split(asciiWhitespace).filter(Boolean);
  if (tokens.length < 3 || tokens[1] !== '-->') reject('invalid-source', 'Invalid cue timing.');
  const start = timestamp(tokens[0]);
  if (timestamp(tokens[2]) <= start) reject('invalid-source', 'Cue end must follow its start.');
  const seen = new Set();
  for (const token of tokens.slice(3)) {
    const key = token.split(':', 1)[0];
    if (!setting(token, regions) || seen.has(key)) reject('unsupported-structure', 'Unsupported, duplicate or invalid cue setting.');
    seen.add(key);
  }
  return { start, settings: tokens.slice(3) };
}
function region(block, regions) {
  let id;
  const seen = new Set();
  for (const line of block.slice(1)) {
    const colon = line.text.indexOf(':');
    if (colon < 0) reject('unsupported-structure', 'Invalid region declaration.');
    const key = line.text.slice(0, colon);
    const value = line.text.slice(colon + 1);
    if (seen.has(key)) reject('unsupported-structure', 'Duplicate region field.');
    seen.add(key);
    let valid = false;
    switch (key) {
      case 'id': id = value; valid = value.length > 0 && !/\p{White_Space}/u.test(value); break;
      case 'width': valid = percent(value); break;
      case 'lines': valid = /^[0-9]+$/.test(value) && Number(value) > 0 && Number(value) <= 4294967295; break;
      case 'regionanchor': case 'viewportanchor': {
        const parts = value.split(',');
        valid = parts.length === 2 && parts.every(percent); break;
      }
      case 'scroll': valid = value === 'up'; break;
      default: break;
    }
    if (!valid) reject('unsupported-structure', 'Unsupported or invalid region field.');
  }
  if (id === undefined || regions.has(id)) reject('unsupported-structure', 'Missing or duplicate region ID.');
  regions.add(id);
}
export function validPayload(text) {
  return typeof text === 'string' && text.isWellFormed() && text.length > 0
    && Buffer.byteLength(text) <= MAX_TEXT_BYTES && !/[\0<&]/.test(text) && !text.includes('-->')
    && !/[\r\n]$/.test(text) && lines(text).every(line => line.text.length > 0);
}
const note = text => text === 'NOTE' || text.startsWith('NOTE ') || text.startsWith('NOTE\t');

/** Parse the selected profile without reading any filesystem path or executing CSS. */
export function parseCaptions(raw, signal) {
  scalar(raw, 'invalid-source');
  if (Buffer.byteLength(raw) > MAX_SOURCE_BYTES) reject('limit-exceeded', 'Caption source exceeds 128 KiB.');
  cancelled(signal);
  const all = lines(raw);
  const header = all[0]?.text.replace(/^\uFEFF/, '');
  if (header === undefined || !(header === 'WEBVTT' || header.startsWith('WEBVTT ') || header.startsWith('WEBVTT\t'))
    || header.includes('-->') || all[1]?.text !== '' || raw.includes('\0')) {
    reject('invalid-source', 'Invalid caption header or source encoding.');
  }
  const blocks = [];
  for (let index = 2; index < all.length;) {
    cancelled(signal);
    if (all[index].text === '') { index++; continue; }
    const start = index;
    while (index < all.length && all[index].text !== '') index++;
    blocks.push(all.slice(start, index));
  }
  let layout = '';
  const regions = new Set();
  let cuesStarted = false;
  for (const block of blocks) {
    cancelled(signal);
    const head = block[0].text;
    if (head === 'STYLE' || head === 'REGION') {
      if (cuesStarted || block.length < 2 || block.some(line => line.text.includes('-->'))) reject('unsupported-structure', 'Invalid caption layout block.');
      if (head === 'REGION') region(block, regions);
      layout += block.map(line => `${line.text}\n`).join('') + '\n';
    } else if (note(head)) {
      if (block.some(line => line.text.includes('-->'))) reject('unsupported-structure', 'Invalid caption note block.');
    } else cuesStarted = true;
  }
  const bytes = Buffer.from(raw, 'utf8');
  const cues = [];
  const ids = new Set();
  let previous = 0;
  const layoutDigest = sha256(layout);
  for (const block of blocks) {
    cancelled(signal);
    const nativeId = block[0].text;
    if (nativeId === 'STYLE' || nativeId === 'REGION' || note(nativeId)) continue;
    const canonicalId = nativeId.toLowerCase();
    if (block.length < 3 || nativeId.length === 0 || nativeId.length > 1024 || !/^[\x20-\x7e]+$/.test(nativeId)
      || nativeId.includes('-->') || ids.has(canonicalId)) reject('unsupported-structure', 'Missing, ambiguous or invalid explicit cue ID.');
    ids.add(canonicalId);
    const parsed = timing(block[1].text, regions);
    if (parsed.start < previous) reject('invalid-source', 'Cue starts must be nondecreasing.');
    previous = parsed.start;
    const start = block[2].start;
    const end = block.at(-1).end;
    const payload = bytes.subarray(start, end).toString('utf8');
    if (!validPayload(payload)) reject('unsupported-structure', 'Unsupported or empty caption payload.');
    if (cues.length >= MAX_CUES) reject('limit-exceeded', 'Caption source exceeds 2000 cues.');
    cues.push({ ordinal: cues.length, nativeId, canonicalId, idStart: block[0].start, idEnd: block[0].end,
      start, end, sourceText: normalize(payload),
      basis: { version: 1, policy: POLICY, nativeId, timing: block[1].text, settings: parsed.settings, layoutDigest } });
  }
  if (cues.length === 0) reject('invalid-source', 'Caption source has no cues.');
  cancelled(signal);
  return { cues, bytes, newline: raw.includes('\r\n') ? '\r\n' : raw.includes('\r') ? '\r' : '\n' };
}

function capturedSource(input, signal) {
  profile(input.profile);
  if (!opaque(input.sourceSetId) || !language(input.sourceLanguage) || !Array.isArray(input.artifacts) || input.artifacts.length !== 1) {
    reject('invalid-input', 'Expected one captured source artifact and valid operation metadata.');
  }
  const artifact = input.artifacts[0];
  if (!opaque(artifact.id) || artifact.logicalPath !== 'source.vtt' || artifact.role !== 'source'
    || !digest(artifact.sha256) || sha256(scalar(artifact.utf8)) !== artifact.sha256) reject('invalid-input', 'Captured source binding mismatch.');
  return { artifact, parsed: parseCaptions(artifact.utf8, signal) };
}

/** Domain checks after the SDK-generated structural validator.
 * @param {SourceExtractionInput} input @returns {ContentExchange} */
export function extractSource(input, signal) {
  const { artifact, parsed } = capturedSource(input, signal);
  const result = { profile: { ...PROFILE }, sourceSetId: input.sourceSetId, sourceLanguage: input.sourceLanguage,
    artifacts: [{ ...artifact }], units: [], order: [], relations: [], domainBlocks: [] };
  for (const cue of parsed.cues) {
    cancelled(signal);
    const id = `cue-${cue.ordinal}`;
    const occurrence = `occurrence-${cue.ordinal}`;
    result.units.push({ id, sourceRevisionId: `source-${cue.ordinal}`, text: cue.sourceText,
      occurrences: [{ id: occurrence, source: { artifactId: artifact.id, range: { encoding: 'utf8-byte', start: cue.start, end: cue.end } },
        nativeIdentity: { namespace: 'webvtt:source', value: cue.canonicalId, policy: contract('webvtt-cue'),
          display: { value: cue.nativeId, source: { artifactId: artifact.id,
            range: { encoding: 'utf8-byte', start: cue.idStart, end: cue.idEnd } } } } }], protectedFragments: [] });
    result.order.push(occurrence);
    result.domainBlocks.push({ target: { kind: 'occurrence', id: occurrence }, schema: contract('webvtt.cue-basis'),
      handling: 'required', payloadUtf8: JSON.stringify(cue.basis) });
  }
  encoded(result);
  return result;
}

function exactContract(actual, id) {
  return actual?.id === id && actual.schemaVersion === 1 && actual.behaviorVersion === 1;
}
function sourceRequirement(input) {
  if (!Array.isArray(input.requirements) || input.requirements.length !== 1) {
    reject('invalid-input', 'Expected exactly one fixed source semantic requirement.');
  }
  const requirement = input.requirements[0];
  const provider = requirement.key?.implementation?.provider;
  if (!exactContract(requirement.key?.rule, 'webvtt.source-semantics')
    || requirement.key.implementation.kind !== 'plugin'
    || provider?.plugin?.publisher !== 'org.tsumugi' || provider.plugin.id !== 'webvtt' || provider.plugin.version !== '0.1.0-alpha.1'
    || provider.componentId !== 'caption-worker' || provider.contributionId !== 'source-semantic-check'
    || !digest(provider.packageDigest) || !digest(requirement.inputDigest) || !digest(requirement.scopeDigest)
    || requirement.mandatory !== true || requirement.waivable !== false || requirement.notApplicable !== null
    || !Array.isArray(requirement.targets) || requirement.targets.length !== 1 || requirement.targets[0] !== input.source.sourceSetId) {
    reject('invalid-input', 'Source semantic requirement does not match the fixed rule, provider or target.');
  }
  return requirement;
}
function exactRange(reference, artifactId, start, end) {
  return reference?.artifactId === artifactId && reference.range?.encoding === 'utf8-byte'
    && reference.range.start === start && reference.range.end === end;
}
function sourceAssociation(input, artifact) {
  const proposal = input.proposal;
  if (!exactContract(proposal.profile, PROFILE.id) || proposal.sourceSetId !== input.source.sourceSetId
    || proposal.sourceLanguage !== input.source.sourceLanguage || proposal.artifacts.length !== 1) {
    reject('invalid-input', 'Proposal does not belong to the captured source material.');
  }
  const proposedArtifact = proposal.artifacts[0];
  if (proposedArtifact.id !== artifact.id || proposedArtifact.logicalPath !== artifact.logicalPath
    || proposedArtifact.role !== artifact.role || proposedArtifact.sha256 !== artifact.sha256 || proposedArtifact.utf8 !== artifact.utf8) {
    reject('invalid-input', 'Proposal artifact does not match the captured source material.');
  }
}
function faithfulSourceProposal(input, artifact, parsed, signal) {
  const proposal = input.proposal;
  if (proposal.units.length !== parsed.cues.length || proposal.order.length !== parsed.cues.length
    || proposal.relations.length !== 0 || proposal.domainBlocks.length !== parsed.cues.length) return false;
  const unitIds = new Set();
  const revisionIds = new Set();
  const occurrences = new Map();
  for (const unit of proposal.units) {
    cancelled(signal);
    if (!opaque(unit.id) || unitIds.has(unit.id) || !opaque(unit.sourceRevisionId) || revisionIds.has(unit.sourceRevisionId)
      || unit.occurrences.length !== 1 || unit.protectedFragments.length !== 0) return false;
    unitIds.add(unit.id);
    revisionIds.add(unit.sourceRevisionId);
    const occurrence = unit.occurrences[0];
    if (!opaque(occurrence.id) || occurrences.has(occurrence.id)) return false;
    occurrences.set(occurrence.id, { unit, occurrence });
  }
  const blocks = new Map();
  for (const block of proposal.domainBlocks) {
    cancelled(signal);
    if (block.target.kind !== 'occurrence' || !occurrences.has(block.target.id) || blocks.has(block.target.id)
      || !exactContract(block.schema, 'webvtt.cue-basis') || block.handling !== 'required') return false;
    blocks.set(block.target.id, block.payloadUtf8);
  }
  const ordered = new Set();
  for (const [index, cue] of parsed.cues.entries()) {
    cancelled(signal);
    const id = proposal.order[index];
    const entry = occurrences.get(id);
    if (!entry || ordered.has(id)) return false;
    ordered.add(id);
    const { unit, occurrence } = entry;
    const identity = occurrence.nativeIdentity;
    if (unit.text !== cue.sourceText || !exactRange(occurrence.source, artifact.id, cue.start, cue.end)
      || identity?.namespace !== 'webvtt:source' || identity.value !== cue.canonicalId
      || !exactContract(identity.policy, 'webvtt-cue') || identity.display?.value !== cue.nativeId
      || !exactRange(identity.display.source, artifact.id, cue.idStart, cue.idEnd)
      // Opaque basis bytes have one canonical encoding in this profile. Do not
      // JSON.parse a forged duplicate field and silently discard its history.
      || blocks.get(id) !== JSON.stringify(cue.basis)) return false;
  }
  return true;
}

/** Reparse fixed source and inspect the proposal's complete domain evidence.
 * No producer result is used as an oracle and extractSource is never called.
 * @param {SourceExtractionCheckInput} input */
export function checkSourceSemantics(input, signal) {
    cancelled(signal);
    encoded(input, MAX_SOURCE_CHECK_BYTES);
    encoded(input.source);
    encoded(input.proposal);
  const requirement = sourceRequirement(input);
  const { artifact, parsed } = capturedSource(input.source, signal);
  sourceAssociation(input, artifact);
  const faithful = faithfulSourceProposal(input, artifact, parsed, signal);
  cancelled(signal);
  const results = [{ key: structuredClone(requirement.key), inputDigest: requirement.inputDigest,
    scopeDigest: requirement.scopeDigest, coveredTargets: [...requirement.targets],
    outcome: { kind: 'completed', findings: faithful ? []
      : [{ code: 'source-mismatch', target: input.source.sourceSetId, severity: 'error' }] } }];
  encoded(results);
  return results;
}

export function safeOutputPath(value) {
  if (typeof value !== 'string' || !value.endsWith('.vtt')) return false;
  const stem = value.slice(0, -4);
  return stem.length > 0 && stem.length <= 80 && /^[A-Za-z0-9_-]+$/.test(stem)
    && !/^(source|con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(stem);
}
function sameBasis(actual, expected) {
  record(actual, ['version', 'policy', 'nativeId', 'timing', 'settings', 'layoutDigest']);
  return actual.version === expected.version && actual.policy === expected.policy && actual.nativeId === expected.nativeId
    && actual.timing === expected.timing && actual.layoutDigest === expected.layoutDigest
    && Array.isArray(actual.settings) && actual.settings.length === expected.settings.length
    && actual.settings.every((setting, index) => setting === expected.settings[index]);
}
function prepareBuild(input, signal) {
  record(input, ['version', 'template', 'locale', 'logicalPath', 'cues']);
  record(input.template, ['utf8', 'sha256']);
  if (input.version !== 1 || !language(input.locale)) reject('invalid-input', 'Unsupported build request or locale.');
  if (!safeOutputPath(input.logicalPath)) reject('unsafe-path', 'Output must use a safe caption basename.');
  scalar(input.template.utf8);
  if (!digest(input.template.sha256) || sha256(input.template.utf8) !== input.template.sha256) reject('invalid-template', 'Captured template digest mismatch.');
  let parsed;
  try { parsed = parseCaptions(input.template.utf8, signal); }
  catch (error) {
    if (!(error instanceof WebvttError) || ['cancelled', 'limit-exceeded'].includes(error.code)) throw error;
    reject('invalid-template', 'Captured template is not supported caption data.');
  }
  if (!Array.isArray(input.cues) || input.cues.length !== parsed.cues.length) reject('identity-mismatch', 'Build must cover every template cue exactly once.');
  for (const [ordinal, cue] of parsed.cues.entries()) {
    cancelled(signal);
    const entry = input.cues[ordinal];
    record(entry, ['ordinal', 'nativeId', 'canonicalId', 'sourceText', 'targetText', 'basis']);
    if (entry.ordinal !== ordinal || entry.nativeId !== cue.nativeId || entry.canonicalId !== cue.canonicalId
      || entry.sourceText !== cue.sourceText || !sameBasis(entry.basis, cue.basis)) reject('identity-mismatch', 'Captured cue identity or source basis mismatch.');
    if (!validPayload(entry.targetText)) reject('invalid-payload', 'Unsupported or empty target caption payload.');
  }
  return parsed;
}

/** Replace only parsed payload ranges in a captured template. Never write files. */
export function buildCaptions(input, signal) {
  const parsed = prepareBuild(input, signal);
  const pieces = [];
  let offset = 0;
  for (const cue of parsed.cues) {
    cancelled(signal);
    pieces.push(parsed.bytes.subarray(offset, cue.start));
    const payload = Buffer.from(normalize(input.cues[cue.ordinal].targetText).replaceAll('\n', parsed.newline), 'utf8');
    if (payload.length > MAX_TEXT_BYTES) reject('limit-exceeded', 'Encoded target caption payload exceeds 16 KiB.');
    pieces.push(payload);
    offset = cue.end;
  }
  pieces.push(parsed.bytes.subarray(offset));
  const bytes = Buffer.concat(pieces);
  if (bytes.length > MAX_SOURCE_BYTES) reject('limit-exceeded', 'Built caption artifact exceeds 128 KiB.');
  const utf8 = bytes.toString('utf8');
  const result = { version: 1, locale: input.locale, logicalPath: input.logicalPath, sha256: sha256(utf8), utf8,
    cueCount: parsed.cues.length, builderVersion: BUILDER_VERSION };
  encoded(result);
  return result;
}

/** Reparse actual output and compare every inter-payload byte segment. This
 * verifier never calls the builder or reconstructs an expected output file. */
export function checkArtifact(request, signal) {
  record(request, ['version', 'input', 'output']);
  if (request.version !== 1) reject('invalid-input', 'Unsupported artifact check request.');
  const input = request.input;
  const output = request.output;
  const original = prepareBuild(input, signal);
  record(output, ['version', 'locale', 'logicalPath', 'sha256', 'utf8', 'cueCount', 'builderVersion']);
  scalar(output.utf8);
  if (output.version !== 1 || output.locale !== input.locale || output.logicalPath !== input.logicalPath
    || output.cueCount !== original.cues.length || output.builderVersion !== BUILDER_VERSION
    || !digest(output.sha256) || sha256(output.utf8) !== output.sha256) reject('invalid-output', 'Artifact metadata or digest mismatch.');
  let actual;
  try { actual = parseCaptions(output.utf8, signal); }
  catch (error) {
    if (!(error instanceof WebvttError) || ['cancelled', 'limit-exceeded'].includes(error.code)) throw error;
    reject('invalid-output', 'Actual artifact is not supported caption data.');
  }
  if (actual.cues.length !== original.cues.length) reject('invalid-output', 'Artifact cue coverage mismatch.');
  let sourceOffset = 0;
  let outputOffset = 0;
  for (let index = 0; index < original.cues.length; index++) {
    cancelled(signal);
    const before = original.cues[index];
    const after = actual.cues[index];
    if (!original.bytes.subarray(sourceOffset, before.start).equals(actual.bytes.subarray(outputOffset, after.start))
      || before.nativeId !== after.nativeId || !sameBasis(after.basis, before.basis)
      || after.sourceText !== normalize(input.cues[index].targetText)
      || actual.bytes.subarray(after.start, after.end).toString('utf8') !== normalize(input.cues[index].targetText).replaceAll('\n', original.newline)) {
      reject('invalid-output', 'Artifact changed caption structure, identity or decided text.');
    }
    sourceOffset = before.end;
    outputOffset = after.end;
  }
  if (!original.bytes.subarray(sourceOffset).equals(actual.bytes.subarray(outputOffset))) reject('invalid-output', 'Artifact changed trailing template bytes.');
  const result = { version: 1, locale: output.locale, logicalPath: output.logicalPath, sha256: output.sha256,
    cueCount: actual.cues.length, checkerVersion: CHECKER_VERSION };
  encoded(result);
  return result;
}

export function encoded(value, limit = MAX_PAYLOAD_BYTES) {
  const utf8 = JSON.stringify(value);
  if (Buffer.byteLength(utf8) > limit) reject('limit-exceeded', 'Encoded operation payload exceeds its captured byte limit.');
  return utf8;
}

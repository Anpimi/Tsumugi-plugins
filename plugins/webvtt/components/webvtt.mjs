// Domain implementation derived from Tsumugi's MIT-licensed caption profile.
// See PROVENANCE.md for the exact public source revision and migration boundary.
import { createHash } from 'node:crypto';
import { encodeSourceContextFacts } from '../sdk/source-context.mjs';
import { SOURCE_CONTEXT_FACTS_PROFILE } from '../sdk/source-context-profile.mjs';

/** @typedef {import('../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/content.js').SourceExtractionInput} SourceExtractionInput */
/** @typedef {import('../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/content.js').ContentExchange} ContentExchange */
/** @typedef {import('../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/content.js').SourceExtractionCheckInput} SourceExtractionCheckInput */
/** @typedef {import('../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/translation.js').TranslationExtractionInput} TranslationExtractionInput */
/** @typedef {import('../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/translation.js').TranslationExchange} TranslationExchange */
/** @typedef {import('../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/translation.js').TranslationExtractionCheckInput} TranslationExtractionCheckInput */

export const MAX_SOURCE_BYTES = 128 * 1024;
export const MAX_CUES = 2000;
export const MAX_TEXT_BYTES = 16 * 1024;
export const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_CONTENT_BYTES = 4 * 1024 * 1024;
export const MAX_SOURCE_CHECK_BYTES = 4 * 1024 * 1024;
export const PROFILE = Object.freeze({ id: 'webvtt-captions', schemaVersion: 1, behaviorVersion: 1 });
export const BUILD_LIMITS = Object.freeze({ maxArtifacts: 1, maxTotalBytes: MAX_SOURCE_BYTES });
export const ARTIFACT_ID = 'caption-output';
export const ARTIFACT_RULE = 'webvtt.artifact-conformance';
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
export function parseCaptions(raw, signal, { allowEmpty = false } = {}) {
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
    // The source reference covers the literal time interval, excluding cue
    // settings. The complete timing line remains in the opaque identity basis.
    const time = /^[\t\f\r ]*(\S+[\t\f\r ]+-->[\t\f\r ]+\S+)/.exec(block[1].text);
    const timeStart = block[1].start + Buffer.byteLength(block[1].text.slice(0, time.index + time[0].length - time[1].length));
    cues.push({ ordinal: cues.length, nativeId, canonicalId, idStart: block[0].start, idEnd: block[0].end,
      timeLiteral: time[1], timeStart, timeEnd: timeStart + Buffer.byteLength(time[1]),
      start, end, sourceText: normalize(payload),
      basis: { version: 1, policy: POLICY, nativeId, timing: block[1].text, settings: parsed.settings, layoutDigest } });
  }
  if (cues.length === 0 && !allowEmpty) reject('invalid-source', 'Caption source has no cues.');
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
  for (const cue of parsed.cues) {
    result.domainBlocks.push({ target: { kind: 'occurrence', id: result.order[cue.ordinal] }, schema: SOURCE_CONTEXT_FACTS_PROFILE.contract,
      handling: 'required', payloadUtf8: cueContext(artifact.id, cue) });
  }
  encoded(result, MAX_CONTENT_BYTES);
  return result;
}

function cueContext(artifactId, cue) {
  return encodeSourceContextFacts({ facts: [{ id: 'time', kind: 'time', text: cue.timeLiteral,
    origin: { kind: 'extracted', sources: [{ artifactId,
      range: { encoding: 'utf8-byte', start: cue.timeStart, end: cue.timeEnd } }] } }] });
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
    || proposal.relations.length !== 0 || proposal.domainBlocks.length !== parsed.cues.length * 2) return false;
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
    if (block.target.kind !== 'occurrence' || !occurrences.has(block.target.id) || block.handling !== 'required') return false;
    const kind = block.schema?.id;
    if ((kind !== 'webvtt.cue-basis' && kind !== SOURCE_CONTEXT_FACTS_PROFILE.contract.id)
      || !exactContract(block.schema, kind)) return false;
    const entry = blocks.get(block.target.id) ?? new Map();
    if (entry.has(kind)) return false;
    entry.set(kind, block.payloadUtf8);
    blocks.set(block.target.id, entry);
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
      || blocks.get(id)?.get('webvtt.cue-basis') !== JSON.stringify(cue.basis)
      || blocks.get(id)?.get(SOURCE_CONTEXT_FACTS_PROFILE.contract.id) !== cueContext(artifact.id, cue)) return false;
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
    encoded(input.proposal, MAX_CONTENT_BYTES);
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

// ICU comes from the selected Node runtime. Project locale membership and the
// recorded choice remain application-owned; a filename supplies only evidence.
function canonicalLocale(value) {
  if (!language(value)) return null;
  try {
    const locale = new Intl.Locale(value);
    return locale.toString() === value ? locale : null;
  } catch { return null; }
}
function capturedTranslations(input, signal) {
  cancelled(signal); encoded(input); profile(input.profile);
  if (!opaque(input.importId) || !opaque(input.sourceSetId) || !opaque(input.sourceSnapshotId)
    || input.languageEvidence !== 'user-confirmed' || input.nativeScope?.namespace !== 'webvtt:source'
    || !exactContract(input.nativeScope?.policy, 'webvtt-cue')
    || !Array.isArray(input.artifacts) || input.artifacts.length !== 1) {
    reject('invalid-input', 'Expected complete fixed caption translation scope and one captured file.');
  }
  const artifact = input.artifacts[0];
  if (!opaque(artifact?.id) || artifact.role !== 'translation' || !digest(artifact.sha256)
    || sha256(scalar(artifact.utf8)) !== artifact.sha256) reject('invalid-input', 'Captured translation binding mismatch.');
  const path = typeof artifact.logicalPath === 'string'
    && /^translations\/([A-Za-z0-9-]{1,128})\.vtt$/.exec(artifact.logicalPath);
  const stem = path && path[1];
  const declared = canonicalLocale(stem);
  const target = canonicalLocale(input.targetLanguage);
  if (!declared || !target || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(stem)
    || declared.language !== target.language) {
    reject('invalid-input', 'Choose one canonical caption filename and a confirmed target with the same base language.');
  }
  return { artifact, declaredLanguage: stem, parsed: parseCaptions(artifact.utf8, signal, { allowEmpty: true }) };
}

/** Extract only operation-local entries; source matching and adoption stay in Core.
 * @param {TranslationExtractionInput} input @returns {TranslationExchange} */
export function extractTranslations(input, signal) {
  const { artifact, declaredLanguage, parsed } = capturedTranslations(input, signal);
  const output = { profile: { ...PROFILE }, importId: input.importId, sourceSetId: input.sourceSetId,
    sourceSnapshotId: input.sourceSnapshotId, targetLanguage: input.targetLanguage, declaredLanguage,
    languageEvidence: input.languageEvidence,
    nativeScope: { namespace: input.nativeScope.namespace, policy: { ...input.nativeScope.policy } },
    artifacts: [{ ...artifact }], entries: [], order: [] };
  for (const cue of parsed.cues) {
    cancelled(signal); const id = `translation-${cue.ordinal}`;
    output.entries.push({ id, text: cue.sourceText,
      source: { artifactId: artifact.id, range: { encoding: 'utf8-byte', start: cue.start, end: cue.end } },
      nativeIdentity: { namespace: 'webvtt:source', value: cue.canonicalId, policy: contract('webvtt-cue'),
        display: { value: cue.nativeId, source: { artifactId: artifact.id,
          range: { encoding: 'utf8-byte', start: cue.idStart, end: cue.idEnd } } } } });
    output.order.push(id);
  }
  cancelled(signal); encoded(output, MAX_CONTENT_BYTES); return output;
}

function translationRequirement(request) {
  if (!Array.isArray(request.requirements) || request.requirements.length !== 1) {
    reject('invalid-input', 'Expected exactly one fixed translation semantic requirement.');
  }
  const value = request.requirements[0]; const provider = value.key?.implementation?.provider;
  if (!exactContract(value.key?.rule, 'webvtt.translation-semantics') || value.key.implementation.kind !== 'plugin'
    || provider?.plugin?.publisher !== 'org.tsumugi' || provider.plugin.id !== 'webvtt' || provider.plugin.version !== '0.1.0-alpha.1'
    || provider.componentId !== 'caption-worker' || provider.contributionId !== 'translation-semantic-check'
    || !digest(provider.packageDigest) || !digest(value.inputDigest) || !digest(value.scopeDigest)
    || value.mandatory !== true || value.waivable !== false || value.notApplicable !== null
    || !Array.isArray(value.targets) || value.targets.length !== 1 || value.targets[0] !== request.input.importId) {
    reject('invalid-input', 'Translation requirement does not match the fixed rule, provider or target.');
  }
  return value;
}
function faithfulTranslationProposal(proposal, input, captured, signal) {
  if (!exactContract(proposal.profile, PROFILE.id)
    || ['importId', 'sourceSetId', 'sourceSnapshotId', 'targetLanguage', 'languageEvidence'].some(key => proposal[key] !== input[key])
    || proposal.declaredLanguage !== captured.declaredLanguage || proposal.nativeScope?.namespace !== input.nativeScope.namespace
    || !exactContract(proposal.nativeScope?.policy, 'webvtt-cue') || proposal.artifacts.length !== 1
    || proposal.entries.length !== captured.parsed.cues.length || proposal.order.length !== captured.parsed.cues.length) return false;
  const retained = proposal.artifacts[0];
  if (['id', 'logicalPath', 'role', 'sha256', 'utf8'].some(key => retained[key] !== captured.artifact[key])) return false;
  const entries = new Map();
  for (const entry of proposal.entries) {
    cancelled(signal);
    if (!opaque(entry.id) || entries.has(entry.id)) return false;
    entries.set(entry.id, entry);
  }
  const ordered = new Set();
  for (const [index, cue] of captured.parsed.cues.entries()) {
    cancelled(signal); const id = proposal.order[index]; const entry = entries.get(id);
    if (!entry || ordered.has(id)) return false;
    ordered.add(id); const identity = entry.nativeIdentity;
    if (entry.text !== cue.sourceText || !exactRange(entry.source, captured.artifact.id, cue.start, cue.end)
      || identity?.namespace !== input.nativeScope.namespace || identity.value !== cue.canonicalId
      || !exactContract(identity.policy, 'webvtt-cue') || identity.display?.value !== cue.nativeId
      || !exactRange(identity.display.source, captured.artifact.id, cue.idStart, cue.idEnd)) return false;
  }
  return true;
}

/** Reparse the whole captured file without calling the extractor as an oracle.
 * @param {TranslationExtractionCheckInput} request */
export function checkTranslationSemantics(request, signal) {
  cancelled(signal); encoded(request, MAX_SOURCE_CHECK_BYTES); encoded(request.proposal, MAX_CONTENT_BYTES);
  const captured = capturedTranslations(request.input, signal);
  const fixed = translationRequirement(request);
  const findings = faithfulTranslationProposal(request.proposal, request.input, captured, signal) ? []
    : [{ code: 'translation-mismatch', target: request.input.importId, severity: 'error' }];
  cancelled(signal);
  const output = [{ key: structuredClone(fixed.key), inputDigest: fixed.inputDigest, scopeDigest: fixed.scopeDigest,
    coveredTargets: [...fixed.targets], outcome: { kind: 'completed', findings } }];
  encoded(output); return output;
}

export const REVIEW_RULES = Object.freeze([
  Object.freeze({ rule: Object.freeze(contract('webvtt.source-structure')), requiresTranslation: false }),
  Object.freeze({ rule: Object.freeze(contract('webvtt.payload')), requiresTranslation: true }),
]);

/** Captured domain QA only; project decisions, resources, fallback and release
 * qualification stay application-owned. No builder is invoked as an oracle. */
export function checkReview(input, signal) {
  cancelled(signal); encoded(input, MAX_SOURCE_CHECK_BYTES); encoded(input.source, MAX_CONTENT_BYTES);
  record(input, ['source', 'targetLanguage', 'selections', 'requirements']);
  if (!language(input.targetLanguage) || !Array.isArray(input.selections) || !input.selections.length
    || input.selections.length > MAX_CUES || !Array.isArray(input.requirements)
    || input.requirements.length !== REVIEW_RULES.length) reject('invalid-input', 'Expected a fixed caption review scope and complete domain rules.');
  const { artifact, parsed } = capturedSource(input.source, signal);
  const faithful = faithfulSourceProposal({ proposal: input.source }, artifact, parsed, signal);
  const units = new Map(input.source.units.map(unit => [unit.id, unit]));
  const selected = new Set();
  for (const selection of input.selections) {
    cancelled(signal); record(selection, ['unitId', 'sourceRevisionId', 'translationText']);
    const unit = units.get(selection.unitId);
    if (!unit || selected.has(selection.unitId) || unit.sourceRevisionId !== selection.sourceRevisionId
      || (selection.translationText !== null && (typeof selection.translationText !== 'string'
        || !selection.translationText.isWellFormed() || Buffer.byteLength(selection.translationText) > MAX_TEXT_BYTES))) {
      reject('invalid-input', 'Caption review selection does not match its captured unit, revision or text limit.');
    }
    selected.add(selection.unitId);
  }
  const anyMissing = input.selections.some(selection => selection.translationText === null);
  const allMissing = input.selections.every(selection => selection.translationText === null);
  const seen = new Set(); let selectedProvider;
  for (const value of input.requirements) {
    cancelled(signal); const declared = REVIEW_RULES.find(rule => exactContract(value.key?.rule, rule.rule.id));
    const provider = value.key?.implementation?.provider;
    if (!declared || seen.has(declared.rule.id) || value.key.implementation.kind !== 'plugin'
      || provider?.plugin?.publisher !== 'org.tsumugi' || provider.plugin.id !== 'webvtt' || provider.plugin.version !== '0.1.0-alpha.1'
      || provider.componentId !== 'caption-worker' || provider.contributionId !== 'review-check' || !digest(provider.packageDigest)
      || (selectedProvider && selectedProvider !== provider.packageDigest)
      || !digest(value.inputDigest) || !digest(value.scopeDigest) || value.mandatory !== true || value.waivable !== false
      || !Array.isArray(value.targets) || value.targets.length !== selected.size
      || new Set(value.targets).size !== selected.size || value.targets.some(target => !selected.has(target))) {
      reject('invalid-input', 'Caption review requirement does not match its declared rule, provider or exact scope.');
    }
    if (value.notApplicable !== null && (!declared.requiresTranslation || !allMissing
      || value.notApplicable?.code !== 'missing-translation' || !digest(value.notApplicable.basisDigest))) {
      reject('invalid-input', 'Caption applicability does not match the captured missing-text scope.');
    }
    selectedProvider = provider.packageDigest; seen.add(declared.rule.id);
  }
  const output = input.requirements.map(value => {
    cancelled(signal); const isPayload = value.key.rule.id === 'webvtt.payload';
    let outcome;
    if (isPayload && allMissing && value.notApplicable !== null) outcome = { kind: 'not-applicable', basis: structuredClone(value.notApplicable) };
    else if (isPayload && anyMissing) outcome = { kind: 'unavailable' };
    else outcome = { kind: 'completed', findings: input.selections.filter(selection => isPayload
      ? !validPayload(selection.translationText) : !faithful).map(selection => ({ code: isPayload ? 'invalid-payload' : 'source-mismatch', target: selection.unitId, severity: 'error' })) };
    return { key: structuredClone(value.key), inputDigest: value.inputDigest, scopeDigest: value.scopeDigest,
      coveredTargets: [...value.targets], outcome };
  });
  cancelled(signal); encoded(output); return output;
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
/** The facade performs SDK structural validation; this boundary verifies the
 * complete domain projection against captured source bytes, never opaque IDs.
 * @param {import('../../../.cache/sdk/tsumugi-plugin-sdk-0.1.0-alpha.1/javascript/build.js').BuildInput} input */
function prepareBuild(input, signal) {
  cancelled(signal);
  record(input, ['source', 'targetLanguage', 'targets', 'configuration', 'outputPaths', 'outputLimits']);
  record(input.source, ['profile', 'sourceSetId', 'sourceLanguage', 'artifacts', 'units', 'order', 'relations', 'domainBlocks']);
  record(input.outputLimits, ['maxArtifacts', 'maxTotalBytes']);
  encoded(input, MAX_SOURCE_CHECK_BYTES);
  encoded(input.source, MAX_CONTENT_BYTES);
  if (!language(input.targetLanguage) || !Array.isArray(input.configuration) || input.configuration.length !== 0
    || input.outputLimits.maxArtifacts !== BUILD_LIMITS.maxArtifacts || input.outputLimits.maxTotalBytes !== BUILD_LIMITS.maxTotalBytes) {
    reject('invalid-input', 'Unsupported build language, configuration or fixed output limits.');
  }
  if (!Array.isArray(input.outputPaths) || input.outputPaths.length !== 1 || !safeOutputPath(input.outputPaths[0])) {
    reject('unsafe-path', 'Build requires exactly one safe caption basename.');
  }
  const { artifact, parsed } = capturedSource(input.source, signal);
  if (!faithfulSourceProposal({ proposal: input.source }, artifact, parsed, signal)) {
    reject('identity-mismatch', 'Build source must retain complete caption coverage, identity and basis.');
  }
  if (!Array.isArray(input.targets) || input.targets.length !== input.source.units.length) {
    reject('identity-mismatch', 'Build must cover every source unit exactly once.');
  }
  const units = new Map(input.source.units.map(unit => [unit.id, unit]));
  const texts = new Map();
  for (const target of input.targets) {
    cancelled(signal);
    record(target, ['unitId', 'sourceRevisionId', 'text']);
    const unit = units.get(target.unitId);
    if (!unit || texts.has(target.unitId) || target.sourceRevisionId !== unit.sourceRevisionId) {
      reject('identity-mismatch', 'Build target does not match its fixed source revision.');
    }
    if (!validPayload(target.text)) reject('invalid-payload', 'Unsupported or empty target caption payload.');
    texts.set(target.unitId, target.text);
  }
  const byOccurrence = new Map(input.source.units.map(unit => [unit.occurrences[0].id, unit.id]));
  return { parsed, targets: input.source.order.map(id => texts.get(byOccurrence.get(id))) };
}

/** Replace only parsed payload ranges in a captured template. Never write files. */
export function buildCaptions(input, signal) {
  const { parsed, targets } = prepareBuild(input, signal);
  const pieces = [];
  let offset = 0;
  for (const cue of parsed.cues) {
    cancelled(signal);
    pieces.push(parsed.bytes.subarray(offset, cue.start));
    const payload = Buffer.from(normalize(targets[cue.ordinal]).replaceAll('\n', parsed.newline), 'utf8');
    if (payload.length > MAX_TEXT_BYTES) reject('limit-exceeded', 'Encoded target caption payload exceeds 16 KiB.');
    pieces.push(payload);
    offset = cue.end;
  }
  pieces.push(parsed.bytes.subarray(offset));
  const bytes = Buffer.concat(pieces);
  if (bytes.length > MAX_SOURCE_BYTES) reject('limit-exceeded', 'Built caption artifact exceeds 128 KiB.');
  const utf8 = bytes.toString('utf8');
  const result = { profile: { ...PROFILE }, sourceSetId: input.source.sourceSetId, targetLanguage: input.targetLanguage,
    artifacts: [{ id: ARTIFACT_ID, role: 'caption', logicalPath: input.outputPaths[0], sha256: sha256(utf8), utf8 }] };
  encoded(result);
  return result;
}

function artifactRequirement(request) {
  if (!Array.isArray(request.requirements) || request.requirements.length !== 1) {
    reject('invalid-input', 'Expected exactly one fixed artifact conformance requirement.');
  }
  const requirement = request.requirements[0];
  const provider = requirement.key?.implementation?.provider;
  if (!exactContract(requirement.key?.rule, ARTIFACT_RULE) || requirement.key.implementation.kind !== 'plugin'
    || provider?.plugin?.publisher !== 'org.tsumugi' || provider.plugin.id !== 'webvtt' || provider.plugin.version !== '0.1.0-alpha.1'
    || provider.componentId !== 'caption-worker' || provider.contributionId !== 'validate-artifact'
    || !digest(provider.packageDigest) || !digest(requirement.inputDigest) || !digest(requirement.scopeDigest)
    || requirement.mandatory !== true || requirement.waivable !== false || requirement.notApplicable !== null
    || !Array.isArray(requirement.targets) || requirement.targets.length !== 1 || requirement.targets[0] !== ARTIFACT_ID) {
    reject('invalid-input', 'Artifact requirement does not match the fixed rule, provider or complete target.');
  }
  return requirement;
}

/** Reparse actual output and compare every inter-payload byte segment. This
 * verifier never calls the builder or reconstructs an expected output file. */
export function checkArtifact(request, signal) {
  cancelled(signal);
  record(request, ['input', 'output', 'requirements']);
  encoded(request, MAX_SOURCE_CHECK_BYTES);
  const requirement = artifactRequirement(request);
  const input = request.input;
  const { parsed: original, targets } = prepareBuild(input, signal);
  const artifacts = request.output;
  record(artifacts, ['profile', 'sourceSetId', 'targetLanguage', 'artifacts']);
  encoded(artifacts);
  if (!exactContract(artifacts.profile, PROFILE.id) || artifacts.sourceSetId !== input.source.sourceSetId
    || artifacts.targetLanguage !== input.targetLanguage || !Array.isArray(artifacts.artifacts) || artifacts.artifacts.length !== 1) {
    reject('invalid-output', 'Artifact set does not match the fixed build input.');
  }
  const output = artifacts.artifacts[0];
  record(output, ['id', 'role', 'logicalPath', 'sha256', 'utf8']);
  scalar(output.utf8, 'invalid-output');
  if (output.id !== ARTIFACT_ID || output.role !== 'caption' || output.logicalPath !== input.outputPaths[0]
    || !digest(output.sha256) || sha256(output.utf8) !== output.sha256) reject('invalid-output', 'Artifact metadata or digest mismatch.');
  let faithful = true;
  try { verifyArtifact(original, targets, output, signal); }
  catch (error) {
    if (!(error instanceof WebvttError) || error.code !== 'invalid-output') throw error;
    faithful = false;
  }
  cancelled(signal);
  const result = [{ key: structuredClone(requirement.key), inputDigest: requirement.inputDigest,
    scopeDigest: requirement.scopeDigest, coveredTargets: [...requirement.targets],
    outcome: { kind: 'completed', findings: faithful ? [] : [{ code: 'artifact-mismatch', target: ARTIFACT_ID, severity: 'error' }] } }];
  encoded(result);
  return result;
}

function verifyArtifact(original, targets, output, signal) {
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
      || after.sourceText !== normalize(targets[index])
      || actual.bytes.subarray(after.start, after.end).toString('utf8') !== normalize(targets[index]).replaceAll('\n', original.newline)) {
      reject('invalid-output', 'Artifact changed caption structure, identity or decided text.');
    }
    sourceOffset = before.end;
    outputOffset = after.end;
  }
  if (!original.bytes.subarray(sourceOffset).equals(actual.bytes.subarray(outputOffset))) reject('invalid-output', 'Artifact changed trailing template bytes.');

}

export function encoded(value, limit = MAX_PAYLOAD_BYTES) {
  const utf8 = JSON.stringify(value);
  if (Buffer.byteLength(utf8) > limit) reject('limit-exceeded', 'Encoded operation payload exceeds its captured byte limit.');
  return utf8;
}

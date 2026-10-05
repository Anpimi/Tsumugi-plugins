// SMAPI domain interpretation derived from Tsumugi's MIT source profile.
// See PROVENANCE.md. Project state, identity allocation and adoption stay outside.
import jsonc from '../.generated/jsonc-parser/lib/umd/main.js';
import { createHash } from 'node:crypto';

export const PROFILE = Object.freeze({ id: 'smapi-i18n-flat', schemaVersion: 1, behaviorVersion: 1 });
export const MAX_SOURCE_BYTES = 128 * 1024;
export const MAX_MANIFEST_BYTES = 16 * 1024;
export const MAX_ENTRIES = 2000;
export const MAX_TEXT_BYTES = 16 * 1024;
export const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_CHECK_BYTES = 4 * 1024 * 1024;
export const BUILD_LIMITS = Object.freeze({ maxArtifacts: 1, maxTotalBytes: 1024 * 1024 });
export const ARTIFACT_ID = 'smapi-locale-output';
export const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const contract = id => ({ id, schemaVersion: 1, behaviorVersion: 1 });
const exact = (value, id) => value?.id === id && value.schemaVersion === 1 && value.behaviorVersion === 1;
const ascii = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && /^[\x20-\x7e]+$/.test(value);
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9._:/-]{1,128}$/.test(value);
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const language = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(value);

export class SmapiError extends Error {
  constructor(code, detail) { super(detail); this.name = 'SmapiError'; this.code = code; this.detail = detail; }
}
const reject = (code, detail) => { throw new SmapiError(code, detail); };
function scalar(value, code = 'invalid-input') {
  if (typeof value !== 'string' || !value.isWellFormed()) reject(code, 'Expected well-formed Unicode text.');
  return value;
}
function guard(signal, deadline) {
  if (signal?.aborted) reject('cancelled', 'Operation cancelled.');
  if (deadline !== undefined && Date.now() > deadline) reject('limit-exceeded', 'Computation exceeded its thirty-second limit.');
}
export function encoded(value, limit = MAX_PAYLOAD_BYTES) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > limit) reject('limit-exceeded', 'Encoded result exceeds its complete byte limit.');
  return text;
}

/** JSONC offsets are UTF-16. Translate complete token boundaries to original
 * UTF-8 bytes, including the one allowed leading BOM and JSON string quotes.
 * Never use parse's recovering object as evidence of valid complete input. */
export function parseJsonc(raw, { signal, maxBytes = MAX_SOURCE_BYTES, strict = false } = {}) {
  scalar(raw, 'invalid-source');
  if (Buffer.byteLength(raw) > maxBytes) reject('limit-exceeded', 'Captured JSON exceeds its byte limit.');
  const bom = raw.startsWith('\ufeff') ? 1 : 0;
  if (strict && bom) reject('invalid-artifact', 'A built locale must not contain a BOM.');
  const text = raw.slice(bom);
  const deadline = Date.now() + 30000;
  const scanner = jsonc.createScanner(text, false);
  let depth = 0;
  for (;;) {
    guard(signal, deadline);
    const token = scanner.scan();
    if (scanner.getTokenError() !== jsonc.ScanError.None) reject('invalid-source', 'Invalid JSON token.');
    if (token === jsonc.SyntaxKind.EOF) break;
    if (token === jsonc.SyntaxKind.OpenBraceToken || token === jsonc.SyntaxKind.OpenBracketToken) {
      if (++depth > 16) reject('limit-exceeded', 'JSON nesting exceeds sixteen levels.');
    } else if (token === jsonc.SyntaxKind.CloseBraceToken || token === jsonc.SyntaxKind.CloseBracketToken) {
      if (--depth < 0) reject('invalid-source', 'Unbalanced JSON structure.');
    }
  }
  const errors = [];
  const tree = jsonc.parseTree(text, errors, { disallowComments: strict, allowTrailingComma: !strict, allowEmptyContent: false });
  if (!tree || errors.length) reject('invalid-source', 'JSON does not match the supported complete profile.');
  const visit = node => {
    guard(signal, deadline);
    if (node.type === 'object') {
      const keys = new Set();
      for (const property of node.children ?? []) {
        const key = scalar(property.children[0].value, 'invalid-source');
        // Match the previous Rust ASCII folding, including non-ASCII manifest
        // fields; do not silently claim .NET Unicode OrdinalIgnoreCase behavior.
        const folded = key.replace(/[A-Z]/g, character => character.toLowerCase());
        if (keys.has(folded)) reject('unsupported-structure', 'Duplicate native key, including case conflicts.');
        keys.add(folded); visit(property.children[1]);
      }
    } else if (node.type === 'array') {
      for (const child of node.children ?? []) visit(child);
    } else if (node.type === 'string') scalar(node.value, 'invalid-source');
  };
  visit(tree);
  guard(signal, deadline);
  const byteOffset = offset => Buffer.byteLength(raw.slice(0, bom + offset));
  return { tree, range: node => ({ encoding: 'utf8-byte', start: byteOffset(node.offset), end: byteOffset(node.offset + node.length) }) };
}

const property = (node, name) => node.children?.find(entry => entry.children[0].value === name)?.children[1];
function requiredString(node, name) {
  const value = property(node, name);
  if (value?.type !== 'string' || !value.value.length) reject('invalid-source', 'Required manifest string is missing or empty.');
  return value.value;
}
function manifest(raw, signal) {
  const parsed = parseJsonc(raw, { signal, maxBytes: MAX_MANIFEST_BYTES });
  const node = parsed.tree;
  if (node.type !== 'object') reject('invalid-source', 'The manifest must be an object.');
  const namespace = requiredString(node, 'UniqueID');
  requiredString(node, 'Name');
  const version = requiredString(node, 'Version');
  if (!ascii(namespace, 256)) reject('unsupported-structure', 'Manifest UniqueID must be printable ASCII.');
  const dll = property(node, 'EntryDll');
  const pack = property(node, 'ContentPackFor');
  const packId = pack?.type === 'object' ? property(pack, 'UniqueID') : null;
  const entry = dll?.type === 'string' && dll.value.length > 0;
  const contentPack = packId?.type === 'string' && packId.value.length > 0;
  if (entry === contentPack) reject('invalid-source', 'Expected exactly one EntryDll or ContentPackFor.UniqueID.');
  return { namespace, version, sourceTemplate: version.includes('%') };
}

/** Parse source or existing translations with the same complete flat profile.
 * An empty object is a valid translation proposal, while source requires text. */
export function parseFlat(raw, { signal, allowEmpty = false, strict = false, maxBytes = MAX_SOURCE_BYTES } = {}) {
  const parsed = parseJsonc(raw, { signal, strict, maxBytes });
  if (parsed.tree.type !== 'object') reject('unsupported-structure', 'Expected a flat string object.');
  const entries = [];
  for (const property of parsed.tree.children ?? []) {
    guard(signal);
    const [key, value] = property.children;
    if (!ascii(key.value, 1024)) reject('unsupported-structure', 'Native keys must be printable ASCII.');
    if (value.type !== 'string') reject('unsupported-structure', 'Flat translation values must be strings.');
    if (Buffer.byteLength(value.value) > MAX_TEXT_BYTES) reject('limit-exceeded', 'Decoded text exceeds sixteen KiB.');
    if (key.value === '$schema') continue;
    if (entries.length >= MAX_ENTRIES) reject('limit-exceeded', 'Flat translation file exceeds two thousand entries.');
    entries.push({ key: key.value, canonicalKey: key.value.toLowerCase(), text: value.value,
      keyRange: parsed.range(key), valueRange: parsed.range(value) });
  }
  if (!allowEmpty && !entries.length) reject('invalid-source', 'Source contains no text entries.');
  return entries;
}

function capturedSource(input, signal) {
  guard(signal);
  if (!exact(input.profile, PROFILE.id)) reject('unsupported-profile', 'Unsupported SMAPI profile.');
  if (!opaque(input.sourceSetId) || !language(input.sourceLanguage) || input.artifacts?.length !== 2) reject('invalid-input', 'Expected a complete two-file capture.');
  const files = new Map();
  for (const artifact of input.artifacts) {
    if (!opaque(artifact.id) || files.has(artifact.logicalPath) || !digest(artifact.sha256)
      || sha256(scalar(artifact.utf8)) !== artifact.sha256) reject('invalid-input', 'Captured artifact binding mismatch.');
    files.set(artifact.logicalPath, artifact);
  }
  const companion = files.get('manifest.json');
  const source = files.get('i18n/default.json');
  if (companion?.role !== 'companion' || source?.role !== 'source' || source.id === companion.id) reject('invalid-input', 'Required source or companion is missing.');
  return { companion, source, metadata: manifest(companion.utf8, signal), entries: parseFlat(source.utf8, { signal }) };
}

export function extractSource(input, signal) {
  const captured = capturedSource(input, signal);
  const result = { profile: { ...PROFILE }, sourceSetId: input.sourceSetId, sourceLanguage: input.sourceLanguage,
    artifacts: input.artifacts.map(artifact => ({ ...artifact })), units: [], order: [], relations: [], domainBlocks: [] };
  for (const [index, entry] of captured.entries.entries()) {
    guard(signal);
    const occurrenceId = `occurrence-${index}`;
    result.units.push({ id: `entry-${index}`, sourceRevisionId: `source-${index}`, text: entry.text,
      occurrences: [{ id: occurrenceId, source: { artifactId: captured.source.id, range: entry.valueRange },
        nativeIdentity: { namespace: captured.metadata.namespace, value: entry.canonicalKey, policy: contract('smapi-native-key'),
          display: { value: entry.key, source: { artifactId: captured.source.id, range: entry.keyRange } } } }], protectedFragments: [] });
    result.order.push(occurrenceId);
  }
  encoded(result);
  return result;
}

function sameRange(actual, expected, artifactId) {
  return actual?.artifactId === artifactId && actual.range?.encoding === 'utf8-byte'
    && actual.range.start === expected.start && actual.range.end === expected.end;
}
function faithfulProposal(proposal, source, captured, signal) {
  if (!exact(proposal.profile, PROFILE.id) || proposal.sourceSetId !== source.sourceSetId || proposal.sourceLanguage !== source.sourceLanguage
    || proposal.artifacts.length !== 2 || proposal.units.length !== captured.entries.length || proposal.order.length !== captured.entries.length
    || proposal.relations.length || proposal.domainBlocks.length) return false;
  const byArtifact = new Map(proposal.artifacts.map(artifact => [artifact.id, artifact]));
  if (byArtifact.size !== 2 || source.artifacts.some(artifact => {
    const actual = byArtifact.get(artifact.id);
    return !actual || ['id', 'logicalPath', 'role', 'sha256', 'utf8'].some(key => actual[key] !== artifact[key]);
  })) return false;
  const units = new Map(); const unitIds = new Set(); const revisions = new Set();
  for (const unit of proposal.units) {
    guard(signal);
    if (!opaque(unit.id) || unitIds.has(unit.id) || !opaque(unit.sourceRevisionId) || revisions.has(unit.sourceRevisionId)
      || unit.occurrences.length !== 1 || unit.protectedFragments.length) return false;
    unitIds.add(unit.id); revisions.add(unit.sourceRevisionId);
    const occurrence = unit.occurrences[0];
    if (!opaque(occurrence.id) || units.has(occurrence.id)) return false;
    units.set(occurrence.id, { unit, occurrence });
  }
  const ordered = new Set();
  for (const [index, entry] of captured.entries.entries()) {
    guard(signal);
    const id = proposal.order[index]; const row = units.get(id);
    if (!row || ordered.has(id)) return false;
    ordered.add(id); const { unit, occurrence } = row; const identity = occurrence.nativeIdentity;
    if (unit.text !== entry.text || !sameRange(occurrence.source, entry.valueRange, captured.source.id)
      || identity?.namespace !== captured.metadata.namespace || identity.value !== entry.canonicalKey
      || !exact(identity.policy, 'smapi-native-key') || identity.display?.value !== entry.key
      || !sameRange(identity.display.source, entry.keyRange, captured.source.id)) return false;
  }
  return true;
}
function requirement(request, rule, contribution, target) {
  if (request.requirements?.length !== 1) reject('invalid-input', 'Expected one fixed independent domain requirement.');
  const value = request.requirements[0]; const provider = value.key?.implementation?.provider;
  if (!exact(value.key?.rule, rule) || value.key.implementation.kind !== 'plugin'
    || provider?.plugin?.publisher !== 'org.tsumugi' || provider.plugin.id !== 'stardew-smapi' || provider.plugin.version !== '0.1.0-alpha.1'
    || provider.componentId !== 'smapi-worker' || provider.contributionId !== contribution || !digest(provider.packageDigest)
    || !digest(value.inputDigest) || !digest(value.scopeDigest) || value.mandatory !== true || value.waivable !== false || value.notApplicable !== null
    || value.targets.length !== 1 || value.targets[0] !== target) reject('invalid-input', 'Requirement does not match its fixed rule, provider or target.');
  return value;
}
function checkResult(value, findings) {
  const output = [{ key: structuredClone(value.key), inputDigest: value.inputDigest, scopeDigest: value.scopeDigest,
    coveredTargets: [...value.targets], outcome: { kind: 'completed', findings } }];
  encoded(output); return output;
}

/** Independently reparse fixed source; do not call the extractor as an oracle. */
export function checkSourceSemantics(input, signal) {
  encoded(input, MAX_CHECK_BYTES); const captured = capturedSource(input.source, signal);
  const fixed = requirement(input, 'smapi.source-semantics', 'source-semantic-check', input.source.sourceSetId);
  const findings = faithfulProposal(input.proposal, input.source, captured, signal) ? []
    : [{ code: 'source-mismatch', target: input.source.sourceSetId, severity: 'error' }];
  if (captured.metadata.sourceTemplate) findings.push({ code: 'source-template', target: input.source.sourceSetId, severity: 'warning' });
  guard(signal); return checkResult(fixed, findings);
}

function capturedTranslations(input, signal) {
  guard(signal); encoded(input);
  if (!exact(input.profile, PROFILE.id)) reject('unsupported-profile', 'Unsupported SMAPI profile.');
  if (!opaque(input.importId) || !opaque(input.sourceSetId) || !opaque(input.sourceSnapshotId)
    || input.languageEvidence !== 'user-confirmed' || input.artifacts?.length !== 1
    || !ascii(input.nativeScope?.namespace, 256) || !exact(input.nativeScope?.policy, 'smapi-native-key')) {
    reject('invalid-input', 'Expected complete fixed translation scope and one captured file.');
  }
  const artifact = input.artifacts[0];
  if (!opaque(artifact.id) || artifact.role !== 'translation' || !digest(artifact.sha256)
    || sha256(scalar(artifact.utf8)) !== artifact.sha256) reject('invalid-input', 'Captured translation binding mismatch.');
  const declared = localePath(artifact.logicalPath, 128);
  const target = canonicalLocale(input.targetLanguage);
  if (!declared || !target || declared.locale.language !== target.language) {
    reject('invalid-input', 'Choose one canonical translation filename and a confirmed target with the same base language.');
  }
  // Registry membership, current adopted source and actual consent are checked
  // by the application. This value supplies domain evidence, never a grant.
  return { artifact, declaredLanguage: declared.stem, entries: parseFlat(artifact.utf8, { signal, allowEmpty: true }) };
}

export function extractTranslations(input, signal) {
  const captured = capturedTranslations(input, signal);
  const output = { profile: { ...PROFILE }, importId: input.importId, sourceSetId: input.sourceSetId,
    sourceSnapshotId: input.sourceSnapshotId, targetLanguage: input.targetLanguage,
    declaredLanguage: captured.declaredLanguage, languageEvidence: input.languageEvidence,
    nativeScope: { namespace: input.nativeScope.namespace, policy: { ...input.nativeScope.policy } },
    artifacts: input.artifacts.map(artifact => ({ ...artifact })), entries: [], order: [] };
  for (const [index, entry] of captured.entries.entries()) {
    guard(signal); const id = `translation-${index}`;
    output.entries.push({ id, text: entry.text, source: { artifactId: captured.artifact.id, range: entry.valueRange },
      nativeIdentity: { namespace: input.nativeScope.namespace, value: entry.canonicalKey, policy: contract('smapi-native-key'),
        display: { value: entry.key, source: { artifactId: captured.artifact.id, range: entry.keyRange } } } });
    output.order.push(id);
  }
  encoded(output); return output;
}

function faithfulTranslationProposal(proposal, input, captured, signal) {
  if (!exact(proposal.profile, PROFILE.id)
    || ['importId', 'sourceSetId', 'sourceSnapshotId', 'targetLanguage', 'languageEvidence'].some(key => proposal[key] !== input[key])
    || proposal.declaredLanguage !== captured.declaredLanguage || proposal.nativeScope.namespace !== input.nativeScope.namespace
    || !exact(proposal.nativeScope.policy, 'smapi-native-key') || proposal.artifacts.length !== 1
    || proposal.entries.length !== captured.entries.length || proposal.order.length !== captured.entries.length) return false;
  const retained = proposal.artifacts[0];
  if (['id', 'logicalPath', 'role', 'sha256', 'utf8'].some(key => retained[key] !== captured.artifact[key])) return false;
  const byId = new Map();
  for (const entry of proposal.entries) {
    guard(signal);
    if (!opaque(entry.id) || byId.has(entry.id)) return false;
    byId.set(entry.id, entry);
  }
  const ordered = new Set();
  for (const [index, expected] of captured.entries.entries()) {
    guard(signal); const id = proposal.order[index]; const entry = byId.get(id);
    if (!entry || ordered.has(id)) return false;
    ordered.add(id); const native = entry.nativeIdentity;
    if (entry.text !== expected.text || !sameRange(entry.source, expected.valueRange, captured.artifact.id)
      || native.namespace !== input.nativeScope.namespace || native.value !== expected.canonicalKey
      || !exact(native.policy, 'smapi-native-key') || native.display.value !== expected.key
      || !sameRange(native.display.source, expected.keyRange, captured.artifact.id)) return false;
  }
  return true;
}

/** Independently reparse the original whole file, never the extractor's output.
 * Matching, selection conflicts and per-entry adoption remain Core decisions. */
export function checkTranslationSemantics(request, signal) {
  encoded(request, MAX_CHECK_BYTES);
  const captured = capturedTranslations(request.input, signal);
  const fixed = requirement(request, 'smapi.translation-semantics', 'translation-semantic-check', request.input.importId);
  const findings = faithfulTranslationProposal(request.proposal, request.input, captured, signal) ? []
    : [{ code: 'translation-mismatch', target: request.input.importId, severity: 'error' }];
  guard(signal); return checkResult(fixed, findings);
}

/** Inventory names and counts exactly; braces outside a well-formed named
 * marker remain text, matching the preceding SMAPI review profile. */
export function markers(text) {
  const result = new Map(); let rest = text;
  while (rest.length) {
    const open = rest.indexOf('{{'); const close = rest.indexOf('}}');
    if (close >= 0 && (open < 0 || close < open)) return null;
    if (open < 0) break;
    rest = rest.slice(open + 2); const end = rest.indexOf('}}');
    if (end < 0 || rest.slice(0, end).includes('{{') || !/^[A-Za-z0-9_-]+$/.test(rest.slice(0, end))) return null;
    const name = rest.slice(0, end); result.set(name, (result.get(name) ?? 0) + 1); rest = rest.slice(end + 2);
  }
  return result;
}
const validTarget = text => typeof text === 'string' && text.isWellFormed() && Buffer.byteLength(text) <= MAX_TEXT_BYTES;
// Project metadata owns registered/supported locales. At this domain boundary
// also reject malformed or noncanonical spellings instead of emitting them as
// filenames. ICU is supplied by the fixed Node runtime, not a developer locale.
function canonicalLocale(value) {
  if (!language(value)) return null;
  try {
    const locale = new Intl.Locale(value);
    return locale.toString() === value ? locale : null;
  } catch { return null; }
}
function localePath(path, maxStem) {
  const match = typeof path === 'string' && /^i18n\/([A-Za-z0-9-]{1,128})\.json$/.exec(path);
  if (!match || match[1].length > maxStem || /^(default|con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(match[1])) return null;
  const locale = canonicalLocale(match[1]);
  return locale ? { stem: match[1], locale } : null;
}
export function safeOutputPath(path, targetLanguage) {
  const declared = localePath(path, 80); const target = canonicalLocale(targetLanguage);
  return declared !== null && target !== null && declared.locale.language === target.language;
}
function prepareBuild(input, signal) {
  guard(signal); encoded(input, MAX_CHECK_BYTES);
  if (!language(input.targetLanguage) || input.configuration.length || input.outputPaths.length !== 1
    || !safeOutputPath(input.outputPaths[0], input.targetLanguage)
    || input.outputLimits.maxArtifacts !== BUILD_LIMITS.maxArtifacts || input.outputLimits.maxTotalBytes !== BUILD_LIMITS.maxTotalBytes) {
    reject('invalid-input', 'Unsupported locale path, configuration or fixed output limits.');
  }
  const captured = capturedSource(input.source, signal);
  if (!faithfulProposal(input.source, input.source, captured, signal)) reject('invalid-input', 'Build source lacks faithful complete identity and coverage.');
  if (input.targets.length !== captured.entries.length) reject('invalid-target', 'Targets must cover every source unit exactly once.');
  const byUnit = new Map(input.source.units.map(unit => [unit.id, unit])); const targets = new Map();
  for (const target of input.targets) {
    guard(signal); const unit = byUnit.get(target.unitId);
    if (!unit || target.sourceRevisionId !== unit.sourceRevisionId || targets.has(target.unitId) || !validTarget(target.text)) reject('invalid-target', 'Target text or fixed revision does not match the source.');
    targets.set(target.unitId, target.text);
  }
  const occurrences = new Map(input.source.units.map(unit => [unit.occurrences[0].id, unit.id]));
  return { captured, texts: input.source.order.map(id => targets.get(occurrences.get(id))) };
}

/** Canonical flat JSON output; JSONC comments and whitespace are source data,
 * not a caption-style byte-preservation promise for newly built locale files. */
export function buildLocale(input, signal) {
  const { captured, texts } = prepareBuild(input, signal);
  const pairs = [];
  for (const [index, entry] of captured.entries.entries()) {
    guard(signal); pairs.push(`  ${JSON.stringify(entry.key)}: ${JSON.stringify(texts[index])}`);
  }
  const utf8 = `{\n${pairs.join(',\n')}\n}\n`;
  if (Buffer.byteLength(utf8) > BUILD_LIMITS.maxTotalBytes) reject('limit-exceeded', 'Locale artifact exceeds one MiB.');
  const result = { profile: { ...PROFILE }, sourceSetId: input.source.sourceSetId, targetLanguage: input.targetLanguage,
    artifacts: [{ id: ARTIFACT_ID, role: 'translation', logicalPath: input.outputPaths[0], sha256: sha256(utf8), utf8 }] };
  encoded(result); return result;
}

/** Reparse actual strict JSON; compare ordered keys, values and exact canonical
 * lexical tokens without calling buildLocale or regenerating a whole artifact. */
export function checkArtifact(request, signal) {
  guard(signal); encoded(request, MAX_CHECK_BYTES);
  const fixed = requirement(request, 'smapi.artifact-conformance', 'validate-artifact', ARTIFACT_ID);
  const { captured, texts } = prepareBuild(request.input, signal); const output = request.output;
  if (!exact(output.profile, PROFILE.id) || output.sourceSetId !== request.input.source.sourceSetId || output.targetLanguage !== request.input.targetLanguage
    || output.artifacts.length !== 1) reject('invalid-artifact', 'Artifact metadata does not match the fixed build.');
  const artifact = output.artifacts[0]; scalar(artifact.utf8, 'invalid-artifact');
  if (artifact.id !== ARTIFACT_ID || artifact.role !== 'translation' || artifact.logicalPath !== request.input.outputPaths[0]
    || !digest(artifact.sha256) || sha256(artifact.utf8) !== artifact.sha256 || Buffer.byteLength(artifact.utf8) > BUILD_LIMITS.maxTotalBytes) reject('invalid-artifact', 'Actual artifact binding mismatch.');
  let faithful = true;
  try {
    const parsed = parseJsonc(artifact.utf8, { signal, strict: true, maxBytes: BUILD_LIMITS.maxTotalBytes });
    if (parsed.tree.type !== 'object' || parsed.tree.children.length !== captured.entries.length) faithful = false;
    else {
      let cursor = 0;
      for (const [index, property] of parsed.tree.children.entries()) {
        guard(signal); const [key, value] = property.children; const expected = captured.entries[index];
        const prefix = index === 0 ? '{\n  ' : ',\n  ';
        if (artifact.utf8.slice(cursor, key.offset) !== prefix || key.value !== expected.key || value.type !== 'string'
          || value.value !== texts[index] || artifact.utf8.slice(key.offset, key.offset + key.length) !== JSON.stringify(expected.key)
          || artifact.utf8.slice(key.offset + key.length, value.offset) !== ': '
          || artifact.utf8.slice(value.offset, value.offset + value.length) !== JSON.stringify(texts[index])) faithful = false;
        const sourceMarkers = markers(expected.text); const targetMarkers = markers(texts[index]);
        if (!sourceMarkers || !targetMarkers || sourceMarkers.size !== targetMarkers.size
          || [...sourceMarkers].some(([name, count]) => targetMarkers.get(name) !== count)) faithful = false;
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(expected.text + texts[index])) faithful = false;
        cursor = value.offset + value.length;
      }
      if (artifact.utf8.slice(cursor) !== '\n}\n') faithful = false;
    }
  } catch (error) {
    if (!(error instanceof SmapiError) || error.code === 'cancelled') throw error;
    faithful = false;
  }
  guard(signal);
  return checkResult(fixed, faithful ? [] : [{ code: 'artifact-mismatch', target: ARTIFACT_ID, severity: 'error' }]);
}

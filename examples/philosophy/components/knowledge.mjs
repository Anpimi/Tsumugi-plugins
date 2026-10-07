import { createHash } from 'node:crypto';

export const MAX_INPUT_BYTES = 65536;
export const MAX_OUTPUT_BYTES = 65536;
export const contract = id => ({ id, schemaVersion: 1, behaviorVersion: 1 });
export const PROFILE = contract('org.tsumugi.examples.philosophy-terminology');
export const RESOURCE_SCHEMA = contract('org.tsumugi.examples.terminology-resource');
export const OPERATIONS = Object.freeze({
  query: { contract: contract('org.tsumugi.examples.philosophy-query'), input: contract('org.tsumugi.examples.philosophy-query-input'), output: contract('org.tsumugi.examples.philosophy-query-output') },
  check: { contract: contract('org.tsumugi.examples.philosophy-check'), input: contract('org.tsumugi.examples.philosophy-check-input'), output: contract('org.tsumugi.examples.philosophy-check-output') },
});
export const ERROR_SCHEMA = contract('org.tsumugi.examples.philosophy-error');
export const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');
export class KnowledgeError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new KnowledgeError(code); };
const object = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) fail('invalid-input');
};
const text = (value, maximum = 8192) => {
  if (typeof value !== 'string' || !value.isWellFormed()) fail('invalid-input');
  if (Buffer.byteLength(value) > maximum) fail('limit-exceeded');
};
const id = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:/-]{1,128}$/.test(value)) fail('invalid-input');
};
const stop = signal => { if (signal?.aborted) fail('cancelled'); };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const same = (a, b) => a?.id === b.id && a?.schemaVersion === b.schemaVersion && a?.behaviorVersion === b.behaviorVersion;
export const sameContract = same;
export function encode(value) {
  const utf8 = JSON.stringify(value);
  if (Buffer.byteLength(utf8) > MAX_OUTPUT_BYTES) fail('limit-exceeded');
  return utf8;
}

/** Create one immutable engine from exact package resource bytes. Neither this
 * resource nor its declared identity grants project adoption or execution. */
export function createKnowledgeEngine(resourceUtf8) {
  text(resourceUtf8, 32768);
  let resource;
  try { resource = JSON.parse(resourceUtf8); } catch { fail('invalid-resource'); }
  object(resource, ['id', 'revision', 'sourceLanguage', 'authority', 'license', 'coverage', 'concepts']);
  id(resource.id); id(resource.revision); text(resource.coverage);
  if (resource.sourceLanguage !== 'en' || resource.authority !== 'unadopted-editorial-suggestion'
    || resource.license !== 'MIT' || !Array.isArray(resource.concepts)
    || resource.concepts.length === 0 || resource.concepts.length > 32) fail('invalid-resource');
  const concepts = new Map();
  for (const concept of resource.concepts) {
    object(concept, ['id', 'sourceForms', 'note', 'targets']); id(concept.id); text(concept.note);
    if (concepts.has(concept.id) || !Array.isArray(concept.sourceForms)
      || concept.sourceForms.length === 0 || concept.sourceForms.length > 8
      || new Set(concept.sourceForms).size !== concept.sourceForms.length) fail('invalid-resource');
    for (const form of concept.sourceForms) { text(form, 128); if (!form) fail('invalid-resource'); }
    object(concept.targets, ['zh-CN', 'ja']);
    for (const form of Object.values(concept.targets)) { text(form, 128); if (!form) fail('invalid-resource'); }
    concepts.set(concept.id, freeze(concept));
  }
  freeze(resource);
  const pin = freeze({ id: resource.id, revision: resource.revision, sha256: digest(resourceUtf8) });
  const selected = ids => {
    if (!Array.isArray(ids) || ids.length > 32 || new Set(ids).size !== ids.length) fail('invalid-input');
    return ids.map(key => { id(key); if (!concepts.has(key)) fail('unknown-concept'); return concepts.get(key); });
  };
  const basis = input => ({ resource: pin, sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage, querySha256: digest(JSON.stringify(input)),
    coverage: 'explicit-concepts; case-sensitive Unicode word boundaries in English; literal preferred target forms',
    authority: resource.authority });
  const validate = (input, rows, keys) => {
    object(input, ['resource', 'sourceLanguage', 'targetLanguage', rows]);
    object(input.resource, ['id', 'revision', 'sha256']);
    if (Object.keys(pin).some(key => input.resource[key] !== pin[key])) fail('resource-mismatch');
    if (input.sourceLanguage !== resource.sourceLanguage || !['zh-CN', 'ja'].includes(input.targetLanguage)) fail('unsupported-locale');
    if (!Array.isArray(input[rows]) || input[rows].length === 0 || input[rows].length > 100) fail('invalid-input');
    const seen = new Set();
    for (const row of input[rows]) {
      object(row, keys); id(row.id); if (seen.has(row.id)) fail('invalid-input'); seen.add(row.id);
    }
    if (Buffer.byteLength(JSON.stringify(input)) > MAX_INPUT_BYTES) fail('limit-exceeded');
  };
  const occurs = (source, form) => {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_])${escaped}(?![\\p{L}\\p{N}\\p{M}_])`, 'u').test(source);
  };
  return Object.freeze({
    pin,
    query(input, signal) {
      stop(signal); validate(input, 'queries', ['id', 'text', 'conceptIds']);
      const results = input.queries.map(row => {
        stop(signal); text(row.text);
        const entries = selected(row.conceptIds).filter(c => c.sourceForms.some(form => occurs(row.text, form)))
          .map(c => ({ conceptId: c.id, preferredTarget: c.targets[input.targetLanguage], note: c.note }));
        return { id: row.id, entries };
      });
      stop(signal); const output = { basis: basis(input), results }; encode(output); return output;
    },
    check(input, signal) {
      stop(signal); validate(input, 'items', ['id', 'sourceText', 'translationText', 'conceptIds']);
      const results = input.items.map(row => {
        stop(signal); text(row.sourceText);
        if (row.translationText !== null) text(row.translationText);
        const applicable = selected(row.conceptIds).filter(c => c.sourceForms.some(form => occurs(row.sourceText, form)));
        if (applicable.length === 0) return { id: row.id, status: 'not-applicable', findings: [] };
        if (row.translationText === null) return { id: row.id, status: 'unavailable', findings: [] };
        const findings = applicable.filter(c => !row.translationText.includes(c.targets[input.targetLanguage]))
          .map(c => ({ code: 'preferred-term-missing', conceptId: c.id, preferredTarget: c.targets[input.targetLanguage],
            range: { encoding: 'utf-16', start: 0, end: row.translationText.length } }));
        return { id: row.id, status: 'completed', findings };
      });
      stop(signal); const output = { basis: basis(input), results }; encode(output); return output;
    },
  });
}

import { isDeepStrictEqual } from 'node:util';
import validateInput from '../sdk/validate-text-review-input.mjs';
import validateReport from '../sdk/validate-text-review-report.mjs';
import validateDeclaration from '../sdk/validate-text-review-declaration.mjs';
import { KnowledgeError, encode, MAX_INPUT_BYTES } from './knowledge.mjs';
import { PROFILE, RESOURCE_SCHEMA, textReviewDeclaration } from './definition.mjs';

const fail = code => { throw new KnowledgeError(code); };
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9._:/-]{1,128}$/.test(value);
const same = isDeepStrictEqual;
const unique = values => new Set(values).size === values.length;
const checkText = value => {
  if (typeof value !== 'string' || !value.isWellFormed()) fail('invalid-input');
  if (Buffer.byteLength(value) > 8192) fail('limit-exceeded');
};

/** Adapt captured text to the original deterministic engine. The Host-supplied
 * provider is required for checks; request data never establishes that identity. */
export function createTextReview(engine, declaration, version) {
  if (!validateDeclaration(declaration) || !same(declaration, textReviewDeclaration(engine.resource))) {
    fail('invalid-input');
  }
  const concepts = new Map(engine.resource.concepts.map(concept => [concept.id, concept]));
  const rules = new Map(declaration.rules.map((rule, index) => [rule.rule.id, {
    ...rule, concept: engine.resource.concepts[index].id,
  }]));
  const pin = { contributionId: 'terminology', schema: RESOURCE_SCHEMA, sha256: engine.pin.sha256 };

  return (input, metadata, signal) => {
    const stopped = () => {
      if (signal?.aborted || metadata.signal?.aborted) fail('cancelled');
    };
    stopped();
    if (!validateInput(input) || !same(input.profile, PROFILE) || !same(metadata.profile, PROFILE)) {
      fail('invalid-input');
    }
    if (Buffer.byteLength(JSON.stringify(input)) > MAX_INPUT_BYTES) fail('limit-exceeded');
    if (input.selections.length > 100) fail('limit-exceeded');
    if (input.selections.length === 0 || input.requirements.length === 0
      || input.requirements.length > rules.size) fail('invalid-input');
    if (!same(input.resources, [pin])) fail('invalid-input');
    if (input.sourceLanguage !== engine.resource.sourceLanguage || !['zh-CN', 'ja'].includes(input.targetLanguage)) {
      fail('unsupported-profile');
    }
    const actual = metadata.provider;
    if (!actual || !same(actual.plugin, { publisher: 'org.tsumugi.examples', id: 'philosophy', version })
      || actual.componentId !== 'knowledge' || actual.contributionId !== 'check'
      || !sha256(actual.packageDigest) || !id(actual.instanceId)
      || !Number.isSafeInteger(actual.activationGeneration) || actual.activationGeneration < 1) fail('invalid-input');
    const selectedProvider = { plugin: actual.plugin, componentId: actual.componentId,
      contributionId: actual.contributionId, packageDigest: actual.packageDigest };
    const targets = input.selections.map(selected => selected.unitId);
    if (!unique(targets)) fail('invalid-input');
    for (const selected of input.selections) {
      if (!id(selected.unitId) || !id(selected.sourceRevisionId)) fail('invalid-input');
      checkText(selected.sourceText);
      if (selected.translationText !== null) checkText(selected.translationText);
    }
    const allMissing = input.selections.every(selected => selected.translationText === null);
    const chosen = input.requirements.map(requirement => {
      const declared = rules.get(requirement.key.rule.id);
      if (!declared || !same(requirement.key.rule, declared.rule)
        || !same(requirement.key.implementation, { kind: 'plugin', provider: selectedProvider })
        || requirement.mandatory !== false || requirement.waivable !== false
        || !sha256(requirement.inputDigest) || !sha256(requirement.scopeDigest)
        || !unique(requirement.targets) || requirement.targets.length !== targets.length
        || requirement.targets.some(target => !targets.includes(target))) fail('invalid-input');
      if (requirement.notApplicable !== null
        && (!allMissing || !declared.requiresTranslation || requirement.notApplicable.code !== 'missing-translation'
          || !sha256(requirement.notApplicable.basisDigest))) fail('invalid-input');
      return { requirement, declared };
    });
    if (!unique(chosen.map(({ declared }) => declared.rule.id))) fail('invalid-input');

    const diagnostics = [];
    const results = chosen.map(({ requirement, declared }) => {
      stopped();
      // Each invocation checks exactly one declared sense. The original engine
      // owns applicability, Unicode boundaries, locale preferences and findings.
      const checked = engine.check({ resource: engine.pin, sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage, items: input.selections.map(selected => ({
          id: selected.unitId, sourceText: selected.sourceText, translationText: selected.translationText,
          conceptIds: [declared.concept],
        })) }, metadata.signal);
      const unavailable = checked.results.some(row => row.status === 'unavailable');
      let outcome;
      if (unavailable) {
        outcome = requirement.notApplicable === null ? { kind: 'unavailable' }
          : { kind: 'not-applicable', basis: structuredClone(requirement.notApplicable) };
      } else {
        const findings = checked.results.flatMap(row => row.findings.map(finding => {
          const concept = concepts.get(finding.conceptId);
          diagnostics.push({ key: structuredClone(requirement.key), code: finding.code, target: row.id,
            // The original engine uses UTF-16 offsets with its own encoding
            // label. Project only that label to the public SDK wire value.
            location: { field: 'translation', range: { encoding: 'utf16', start: finding.range.start, end: finding.range.end } },
            detail: concept.note, suggestion: finding.preferredTarget,
            resourceEntry: { contributionId: 'terminology', entryId: finding.conceptId } });
          return { code: finding.code, target: row.id, severity: 'warning' };
        }));
        // An irrelevant selected sense completed its deterministic check; it
        // does not invent an N/A reason that the capture owner never allowed.
        outcome = { kind: 'completed', findings };
      }
      return { key: structuredClone(requirement.key), inputDigest: requirement.inputDigest,
        scopeDigest: requirement.scopeDigest, coveredTargets: [...requirement.targets], outcome };
    });
    stopped();
    const report = { results, diagnostics };
    if (!validateReport(report)) throw new Error('Invalid generated text-review report.');
    encode(report); // Reject the entire report before emitting oversized output.
    return report;
  };
}

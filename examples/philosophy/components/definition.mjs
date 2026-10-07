// Public capability and rule metadata. The package version remains in package.json.
export const contract = id => ({ id, schemaVersion: 1, behaviorVersion: 1 });
export const PROFILE = contract('org.tsumugi.examples.philosophy-terminology');
export const RESOURCE_SCHEMA = contract('org.tsumugi.examples.terminology-resource');
export const ERROR_SCHEMA = contract('org.tsumugi.examples.philosophy-error');
export const REVIEW_ERROR_SCHEMA = contract('tsumugi.review-check-error');
export const TEXT_REVIEW_DECLARATION_SCHEMA = contract('tsumugi.text-review-declaration');
export const OPERATIONS = Object.freeze({
  query: { contract: contract('org.tsumugi.examples.philosophy-query'), input: contract('org.tsumugi.examples.philosophy-query-input'), output: contract('org.tsumugi.examples.philosophy-query-output'), error: ERROR_SCHEMA },
  check: { contract: { id: 'org.tsumugi.examples.philosophy-check', schemaVersion: 2, behaviorVersion: 2 }, input: contract('tsumugi.text-review-input'), output: contract('tsumugi.text-review-report'), error: REVIEW_ERROR_SCHEMA },
});

export const conceptRule = id => contract(`org.tsumugi.examples.philosophy-term.${id}`);
export function textReviewDeclaration(resource) {
  return {
    profile: PROFILE,
    checker: 'check',
    disposition: 'advisory',
    supportingResources: ['terminology'],
    rules: resource.concepts.map(concept => ({
      rule: conceptRule(concept.id),
      requiresTranslation: true,
      title: concept.sourceForms[0],
      description: concept.note,
    })),
  };
}

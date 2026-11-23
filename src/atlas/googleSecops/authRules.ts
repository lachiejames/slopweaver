/**
 * Which OAuth scopes `chronicle_v1.yaml`'s `authentication.rules` grant one method.
 *
 * ## The selector grammar, as Google's service config defines it
 *
 * A rule's `selector` is a comma-separated list of patterns. A pattern is a fully qualified method
 * (`google.cloud.chronicle.v1.InstanceService.GetInstance`), a wildcard over everything below a prefix
 * (`google.cloud.chronicle.v1.RuleService.*`), or `*` alone. `google/api/auth.proto` says every service
 * configuration rule list follows **"last one wins"** order, so when two rules match one method the later
 * one decides, and that is what {@link scopesForSelector} implements rather than "most specific wins".
 *
 * ## No rule is a refusal, never an empty list
 *
 * A method no rule matches has no declared scope, and reading that as `[]` would let an empty array pass
 * for "no scope needed" — the exact misreading `googleAdmin/surfaceRow.ts` records Google's own discovery
 * documents inviting. So it is `AUTH_RULE_MISSING`, and the generator refuses to emit a row for it. A rule
 * that DOES match but whose `canonical_scopes` splits to nothing (`','`, or blank) would reach the same `[]`
 * by another road, and is `AUTH_RULE_GRANTS_NO_SCOPE` for the same reason.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type GoogleSecopsInventoryError, GoogleSecopsInventoryErrors } from "./errors.js";

/** One `authentication.rules` entry, its `canonical_scopes` split into a list. */
export interface AuthRule {
  /** The rule's selector exactly as the config writes it. */
  readonly selector: string;
  /** The scopes it grants, in the config's own order. */
  readonly scopes: readonly string[];
}

/**
 * Whether one rule's selector matches one fully qualified method, whatever scopes the rule grants.
 *
 * Kept apart from {@link scopesForSelector} on purpose: a rule that matches but grants nothing is a
 * refusal there, and must still count as matching here, or it would be misreported as a dead rule.
 *
 * @param selector the rule's whole selector, possibly comma-separated
 * @param method the fully qualified method
 * @returns true when any pattern in the list matches
 */
export function authRuleMatches({ selector, method }: { selector: string; method: string }): boolean {
  return selector
    .split(",")
    .map((part) => part.trim())
    .some((part) => {
      if (part === "*") {
        return true;
      }
      if (part.endsWith(".*")) {
        return method.startsWith(part.slice(0, -1));
      }
      return part === method;
    });
}

/**
 * The scopes the service config grants one method, decided by the LAST rule that matches it.
 *
 * @param rules the config's `authentication.rules`, in file order
 * @param selector the fully qualified method to look up
 * @returns its scopes sorted, `AUTH_RULE_MISSING` when no rule matches it, or `AUTH_RULE_GRANTS_NO_SCOPE`
 *   when the deciding rule's scope list is empty
 */
export function scopesForSelector({
  rules,
  selector,
}: {
  rules: readonly AuthRule[];
  selector: string;
}): Result<readonly string[], GoogleSecopsInventoryError> {
  const matching = rules.filter((rule) => authRuleMatches({ method: selector, selector: rule.selector }));
  const last = matching.at(-1);
  if (last === undefined) {
    return err(GoogleSecopsInventoryErrors.authRuleMissing({ selector }));
  }
  if (last.scopes.length === 0) {
    return err(GoogleSecopsInventoryErrors.authRuleGrantsNoScope({ ruleSelector: last.selector, selector }));
  }
  return ok(last.scopes.toSorted());
}

/**
 * Split a `canonical_scopes` block into its scopes.
 *
 * The config writes them as one comma-separated YAML block scalar, one scope per line.
 *
 * @param canonicalScopes the block exactly as YAML decoded it
 * @returns every non-empty scope, in order
 */
export function splitCanonicalScopes({ canonicalScopes }: { canonicalScopes: string }): readonly string[] {
  return canonicalScopes
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

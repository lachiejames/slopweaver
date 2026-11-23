/**
 * The projection for one GitHub deployment ENVIRONMENT and its protection rules.
 *
 * Split from `projectionConfig.ts` on size alone; it shares `projectionBase.ts`'s readers and provenance,
 * and the rules are that module's header.
 */
import { isRecord } from "../../lib/parsers.js";

import type { GithubEnvironment } from "./entities.js";
import { bool, int, nested, type ProjectionContext, scopedOf, str } from "./projectionBase.js";

/**
 * Project one deployment environment and its protection rules.
 *
 * @param raw one environment from the listing
 * @param scopeRef the `owner/repo` coordinate
 * @param context the run's provenance
 * @returns the stored environment, or `null` when it carries no name
 */
export function projectGithubEnvironment({
  raw,
  scopeRef,
  context,
}: {
  raw: unknown;
  scopeRef: string;
  context: ProjectionContext;
}): GithubEnvironment | null {
  if (!isRecord(raw)) {
    return null;
  }
  const name = str({ key: "name", raw });
  if (name === null) {
    return null;
  }
  const rules = raw["protection_rules"];
  const ruleList = Array.isArray(rules) ? rules.filter(isRecord) : [];
  return {
    ...scopedOf({
      context,
      deepLink: str({ key: "html_url", raw }),
      kind: "environment",
      providerId: `${scopeRef}/${name}`,
      scopeLevel: "environment",
      scopeRef: `${scopeRef}/${name}`,
    }),
    canAdminsBypass: bool({ key: "can_admins_bypass", raw }),
    deploymentBranchPolicy: deploymentBranchPolicyOf({ raw }),
    name,
    preventSelfReview: firstPresent({
      values: ruleList.map((rule) => bool({ key: "prevent_self_review", raw: rule })),
    }),
    protectionRuleTypes: [
      ...new Set(ruleList.flatMap((rule) => (typeof rule["type"] === "string" ? [rule["type"]] : []))),
    ].toSorted(),
    reviewerIds: environmentReviewerIds({ rules: ruleList }),
    waitTimerMinutes: firstPresent({ values: ruleList.map((rule) => int({ key: "wait_timer", raw: rule })) }),
  };
}

/**
 * The first rule's setting that is present, or `null` when no rule carries one — absence by design, because
 * an environment with no such rule simply has no such setting.
 */
function firstPresent<T>({ values }: { values: readonly (T | null)[] }): T | null {
  for (const value of values) {
    if (value !== null) {
      return value;
    }
  }
  return null;
}

/**
 * Which branches may deploy, in GitHub's own key names.
 *
 * GitHub answers `null` for the policy when every branch may deploy, and otherwise an object with two
 * booleans. Both are booleans, so neither can be read as text; an absent policy or one setting neither is
 * `null`, because it says nothing.
 */
function deploymentBranchPolicyOf({ raw }: { raw: Record<string, unknown> }): string | null {
  const policy = raw["deployment_branch_policy"];
  if (policy === null) {
    return "all_branches";
  }
  if (!isRecord(policy)) {
    return null;
  }
  if (bool({ key: "protected_branches", raw: policy }) === true) {
    return "protected_branches";
  }
  if (bool({ key: "custom_branch_policies", raw: policy }) === true) {
    return "custom_branch_policies";
  }
  return null;
}

/**
 * Every required reviewer across the protection rules, as `<type>:<id>`, deduplicated and sorted.
 *
 * GitHub nests each reviewer as `{ type, reviewer: { id } }`, and a user and a team can share a numeric id,
 * so the type is part of the stored id.
 */
function environmentReviewerIds({ rules }: { rules: readonly Record<string, unknown>[] }): string[] {
  const ids = rules.flatMap((rule): readonly string[] => {
    const entries = rule["reviewers"];
    if (!Array.isArray(entries)) {
      return [];
    }
    return entries.filter(isRecord).flatMap((entry): readonly string[] => {
      const type = str({ key: "type", raw: entry });
      const id = int({ key: "id", raw: nested({ key: "reviewer", raw: entry }) });
      if (type === null || id === null) {
        return [];
      }
      return [`${type}:${String(id)}`];
    });
  });
  return [...new Set(ids)].toSorted();
}

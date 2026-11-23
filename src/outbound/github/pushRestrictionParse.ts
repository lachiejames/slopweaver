/**
 * The pure readers of `github push-restriction`'s two GraphQL answers: the classic rules on a repository, and a
 * login's node id. Held apart from `./pushRestrictionWrite.ts`, which judges and writes, so each stays a file a
 * reader can hold; nothing here touches the network.
 */
import { PUSH_RULE_PAGE } from "../../corpus/github/pushRestriction.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type PushRestrictionError, PushRestrictionErrors } from "./pushRestrictionErrors.js";

/** The one classic rule whose pattern names the branch exactly, narrowed to what this verb reads and writes. */
export interface BranchPushRule {
  readonly ruleId: string;
  readonly pattern: string;
  readonly restrictsPushes: boolean;
  /** Every actor allowed to push: a user's login, or a team's or an App's slug. */
  readonly allowances: readonly { readonly kind: "user" | "team" | "app"; readonly name: string }[];
  /** Whether the rule binds administrators too; when false an admin pushes past the restriction. */
  readonly isAdminEnforced: boolean;
  readonly requiresApprovingReviews: boolean;
  readonly requiresCodeOwnerReviews: boolean;
}

/** One actor a rule allows to push. */
type PushAllowance = BranchPushRule["allowances"][number];

/**
 * Shape one GraphQL allowance node, or say it cannot be read.
 *
 * @param node one `pushAllowances.nodes` entry, unvalidated
 * @returns the allowance, or undefined when the actor carries no name this verb recognises
 */
function allowanceOf({ node }: { node: unknown }): PushAllowance | undefined {
  const actor = isRecord(node) ? node["actor"] : undefined;
  if (!isRecord(actor)) {
    return undefined;
  }
  const typename = actor["__typename"];
  if (typename === "User" && typeof actor["login"] === "string") {
    return { kind: "user", name: actor["login"] };
  }
  if (typename === "Team" && typeof actor["slug"] === "string") {
    return { kind: "team", name: actor["slug"] };
  }
  if (typename === "App" && typeof actor["slug"] === "string") {
    return { kind: "app", name: actor["slug"] };
  }
  return undefined;
}

/** A GraphQL connection's nodes and total, or undefined when it is not one. */
function connectionOf({ value }: { value: unknown }): { nodes: readonly unknown[]; totalCount: number } | undefined {
  if (!isRecord(value) || !Array.isArray(value["nodes"]) || typeof value["totalCount"] !== "number") {
    return undefined;
  }
  return { nodes: value["nodes"], totalCount: value["totalCount"] };
}

/**
 * Shape one rule node into a {@link BranchPushRule}, or name what is unreadable about it.
 *
 * @param node one `branchProtectionRules.nodes` entry, unvalidated
 * @returns the rule, or the typed malformed-payload failure
 */
function ruleOf({ node }: { node: unknown }): Result<BranchPushRule, PushRestrictionError> {
  if (
    !isRecord(node) ||
    typeof node["id"] !== "string" ||
    typeof node["pattern"] !== "string" ||
    typeof node["restrictsPushes"] !== "boolean" ||
    typeof node["isAdminEnforced"] !== "boolean" ||
    typeof node["requiresApprovingReviews"] !== "boolean" ||
    typeof node["requiresCodeOwnerReviews"] !== "boolean"
  ) {
    return err(PushRestrictionErrors.malformed({ what: "a protection rule is missing a field" }));
  }
  const connection = connectionOf({ value: node["pushAllowances"] });
  if (connection === undefined) {
    return err(PushRestrictionErrors.malformed({ what: `rule "${node["pattern"]}" has no pushAllowances connection` }));
  }
  if (connection.totalCount > connection.nodes.length) {
    return err(
      PushRestrictionErrors.malformed({
        what: `rule "${node["pattern"]}" lists ${String(connection.nodes.length)} of ${String(connection.totalCount)} allowances`,
      }),
    );
  }
  const allowances: PushAllowance[] = [];
  for (const entry of connection.nodes) {
    const allowance = allowanceOf({ node: entry });
    if (allowance === undefined) {
      return err(
        PushRestrictionErrors.malformed({
          what: `rule "${node["pattern"]}" has an allowance actor of an unknown type`,
        }),
      );
    }
    allowances.push(allowance);
  }
  return ok({
    allowances,
    isAdminEnforced: node["isAdminEnforced"],
    pattern: node["pattern"],
    requiresApprovingReviews: node["requiresApprovingReviews"],
    requiresCodeOwnerReviews: node["requiresCodeOwnerReviews"],
    restrictsPushes: node["restrictsPushes"],
    ruleId: node["id"],
  });
}

/**
 * Find the classic rule whose pattern is exactly the branch, and shape it.
 *
 * Exact, never a glob match: a wildcard rule also governs other branches, and patching it to restrict `main`
 * would restrict every branch it matches. The read refuses a page that may be hiding a rule or an allowance.
 *
 * @param data the raw GraphQL payload from `branchPushRulesVia`
 * @param branch the branch the caller is governing
 * @param identity the `owner/name` slug, named in the no-rule error
 * @returns the rule, or the typed reason there is none to read
 */
export function parseBranchPushRule({
  data,
  branch,
  identity,
}: {
  data: unknown;
  branch: string;
  identity: string;
}): Result<BranchPushRule, PushRestrictionError> {
  const repository = isRecord(data) ? data["repository"] : undefined;
  const connection = connectionOf({ value: isRecord(repository) ? repository["branchProtectionRules"] : undefined });
  if (connection === undefined) {
    return err(PushRestrictionErrors.malformed({ what: "no repository.branchProtectionRules connection" }));
  }
  if (connection.totalCount > connection.nodes.length || connection.nodes.length >= PUSH_RULE_PAGE) {
    return err(
      PushRestrictionErrors.malformed({ what: `a full page of ${String(PUSH_RULE_PAGE)} rules may hide more` }),
    );
  }
  const rules: BranchPushRule[] = [];
  for (const node of connection.nodes) {
    const rule = ruleOf({ node });
    if (rule.isErr()) {
      return err(rule.error);
    }
    rules.push(rule.value);
  }
  const match = rules.find((rule) => rule.pattern === branch);
  if (match === undefined) {
    return err(PushRestrictionErrors.noRule({ branch, identity, patterns: rules.map((rule) => rule.pattern) }));
  }
  return ok(match);
}

/**
 * Shape the login lookup into a node id.
 *
 * @param data the raw GraphQL payload from `userNodeIdVia`
 * @param login the login that was asked for, named in the unknown-user error
 * @returns the user's node id, or that no such user exists
 */
export function parseUserNodeId({
  data,
  login,
}: {
  data: unknown;
  login: string;
}): Result<string, PushRestrictionError> {
  const user = isRecord(data) ? data["user"] : undefined;
  if (user === null || user === undefined) {
    return err(PushRestrictionErrors.unknownUser({ login }));
  }
  if (!isRecord(user) || typeof user["id"] !== "string") {
    return err(PushRestrictionErrors.malformed({ what: `the user lookup for "${login}" carries no id` }));
  }
  return ok(user["id"]);
}

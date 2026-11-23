/**
 * Read a proposed least-privilege plan against what a pull saw exercised: every permission a principal used,
 * that the plan would no longer allow in that container, is a would-break finding.
 *
 * Pure. The plan names, per principal, what REMAINS in each scope after the change — kept roles (resolved from
 * the generation's role cache, never a surprise IAM call) plus loose permissions — and what is DENIED. An
 * organisation scope applies everywhere; a project scope applies to entries originating in that project.
 *
 * Each scope states its BASIS. `effective` asserts the remaining set is everything the principal will hold
 * there; `direct-bindings` covers only the principal's own bindings, because a group, a folder grant or a
 * condition can still allow what a naive union misses. A finding carries how sure it is: a DENY is definite
 * whatever the basis, since a deny policy on the principal overrides every allow, group grants included; a
 * permission merely absent from a `direct-bindings` scope breaks unless another grant covers it, and says so.
 *
 * A role the cache lacks or a principal with no plan row is UNASSESSABLE, never a finding. Only `granted: true`
 * uses count: a refused call does not prove the permission was ever available.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import type { GcpPermissionUse } from "./aggregate.js";
import { type GcpAuditError, GcpAuditErrors } from "./errors.js";
import type { GcpCachedRole } from "./store.js";

/** One scope of one principal's planned access. */
const plannedScope = z.strictObject({
  basis: z.enum(["effective", "direct-bindings"]),
  deniedPermissions: z.array(z.string()),
  keptRoles: z.array(z.string()),
  remainingPermissions: z.array(z.string()),
  resource: z.string().regex(/^(?:organizations\/\d+|projects\/[a-z][a-z0-9-]{4,28}[a-z0-9])$/, {
    message: "a scope is an organisation or a project; a folder's grants belong in each project scope beneath it",
  }),
});

/** A whole plan, version 1. */
const planSchema = z.strictObject({
  principals: z.array(z.strictObject({ principal: z.string(), scopes: z.array(plannedScope) })),
  schemaVersion: z.literal(1),
});

/** A parsed plan. */
export type GcpLeastPrivilegePlan = z.output<typeof planSchema>;

/**
 * Parse a plan document.
 *
 * @param value the parsed JSON
 * @returns the plan, or `PLAN_INVALID` naming what is wrong
 */
export function parsePlan({ value }: { value: unknown }): Result<GcpLeastPrivilegePlan, GcpAuditError> {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success) {
    return err(
      GcpAuditErrors.planInvalid({
        why: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      }),
    );
  }
  return ok(parsed.data);
}

/**
 * One exercised permission the plan would take away.
 *
 * @internal
 */
export interface WouldBreakFinding {
  readonly use: GcpPermissionUse;
  readonly reason: "absent-from-remaining-set" | "explicitly-denied";
  /** `definite`, or true only if no grant outside the principal's direct bindings covers it. */
  readonly certainty: "definite" | "unless-another-grant-covers-it";
}

/**
 * One exercised permission the plan cannot be read against, and why.
 *
 * @internal
 */
export interface UnassessableUse {
  readonly use: GcpPermissionUse;
  readonly why: string;
}

/** What the plan does to ONE exercised permission. */
type UseVerdict =
  | { readonly kind: "kept" }
  | { readonly kind: "would-break"; readonly finding: WouldBreakFinding }
  | { readonly kind: "unassessable"; readonly item: UnassessableUse };

/** What a plan does to what was exercised. */
export interface GcpPlanAssessment {
  readonly kept: number;
  readonly wouldBreak: readonly WouldBreakFinding[];
  readonly unassessable: readonly UnassessableUse[];
}

/**
 * Read the plan against one granted use.
 *
 * @param use the exercised permission
 * @param org the organisation number, so an `organizations/<n>` scope applies everywhere
 * @param roleMap each cached role's permissions
 * @returns kept, would-break with its reason and certainty, or unassessable with why
 */
function assessUse({
  use,
  plan,
  org,
  roleMap,
}: {
  use: GcpPermissionUse;
  plan: GcpLeastPrivilegePlan;
  org: string;
  roleMap: ReadonlyMap<string, ReadonlySet<string>>;
}): UseVerdict {
  const row = plan.principals.find((candidate) => candidate.principal === use.principal);
  if (row === undefined) {
    return { item: { use, why: "the plan has no row for this principal" }, kind: "unassessable" };
  }
  const scopes = row.scopes.filter(
    (scope) => scope.resource === `organizations/${org}` || scope.resource === use.origin,
  );
  if (scopes.length === 0) {
    return { item: { use, why: `no plan scope covers ${use.origin}` }, kind: "unassessable" };
  }
  // A deny and a loose permission each settle a use without any role, so neither waits on the role cache.
  if (scopes.some((scope) => scope.deniedPermissions.includes(use.permission))) {
    return { finding: { certainty: "definite", reason: "explicitly-denied", use }, kind: "would-break" };
  }
  if (scopes.some((scope) => scope.remainingPermissions.includes(use.permission))) {
    return { kind: "kept" };
  }
  const missingRole = scopes.flatMap((scope) => scope.keptRoles).find((role) => !roleMap.has(role));
  if (missingRole !== undefined) {
    const why = `role ${missingRole} is not in this generation's cache — pull again with --role ${missingRole}`;
    return { item: { use, why }, kind: "unassessable" };
  }
  if (scopes.some((scope) => scope.keptRoles.some((role) => roleMap.get(role)!.has(use.permission)))) {
    return { kind: "kept" };
  }
  const effective = scopes.every((scope) => scope.basis === "effective");
  return {
    finding: {
      certainty: effective ? "definite" : "unless-another-grant-covers-it",
      reason: "absent-from-remaining-set",
      use,
    },
    kind: "would-break",
  };
}

/**
 * Assess a plan against the exercised permissions.
 *
 * @param uses every permission use the count produced; only `granted` ones are assessed
 * @param org the organisation number the pull read, so an `organizations/<n>` scope can be matched
 * @param roles the generation's role cache
 * @returns kept, would-break and unassessable uses
 */
export function assessPlan({
  uses,
  plan,
  org,
  roles,
}: {
  uses: readonly GcpPermissionUse[];
  plan: GcpLeastPrivilegePlan;
  org: string;
  roles: readonly GcpCachedRole[];
}): GcpPlanAssessment {
  const roleMap = new Map(roles.map((role) => [role.name, new Set(role.permissions)]));
  const wouldBreak: WouldBreakFinding[] = [];
  const unassessable: UnassessableUse[] = [];
  let kept = 0;
  for (const use of uses.filter((candidate) => candidate.granted)) {
    const verdict = assessUse({ org, plan, roleMap, use });
    switch (verdict.kind) {
      case "kept":
        kept += 1;
        break;
      case "would-break":
        wouldBreak.push(verdict.finding);
        break;
      case "unassessable":
        unassessable.push(verdict.item);
        break;
      default: {
        const unreachable: never = verdict;
        return unreachable;
      }
    }
  }
  return { kept, unassessable, wouldBreak };
}

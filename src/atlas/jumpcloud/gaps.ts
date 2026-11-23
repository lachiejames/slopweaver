/**
 * What this atlas knows it does NOT know, per kind, raised from what the walk actually saw.
 *
 * The lifecycle is `kit/gaps.ts`; the vocabulary is `model.ts`. What is here is the JUDGEMENT — which
 * observations become a gap — and two of them are the ones this class of atlas gets wrong.
 *
 * ## `reachable-but-empty` is not the same as covered
 *
 * An attribute census has OBSERVATIONS as its denominator, so a family this tenant holds zero of produces a
 * vocabulary derived from nothing while looking exactly like a family that was read in full. Measured: an
 * endpoint for a product the tenancy has not provisioned (`/api/radiusservers`, `/api/v2/duo/accounts`,
 * `/api/v2/activedirectories`, `/api/v2/workdays`) answers `totalCount` 0, and a System Insights table with
 * nothing collected (`systeminsights/shadow`) is reachable and empty. Retention is true for each; coverage
 * is false. So an empty family raises a gap rather than passing
 * silently, and the gap says the vocabulary came from zero records.
 *
 * ## `path-unbound` records an operation that exists and was not called
 *
 * A fan-out whose parent collection yielded no ids was never attempted. Recording that as `unreadable`
 * would blame the credential for something the credential was never asked; recording nothing at all would
 * make the operation look absent. It is its own condition for exactly that reason.
 */
import { type AtlasGap, openGap } from "../kit/gaps.js";

import type { JumpcloudGap } from "./entities.js";
import type { JumpcloudGapCondition, JumpcloudKind } from "./model.js";
import type { JumpcloudKindPlan, JumpcloudUnrunnableReason } from "./plan.js";
import type { JumpcloudKindWalk } from "./syncEngine.js";

/**
 * Narrow a kit gap to this atlas's stored shape.
 *
 * @param gap the kit-shaped gap
 * @param kind the kind it concerns
 * @param condition this atlas's own condition, already checked against its closed vocabulary
 * @returns the gap as this atlas stores it
 */
function stored({
  gap,
  kind,
  condition,
}: {
  gap: AtlasGap;
  kind: JumpcloudKind;
  condition: JumpcloudGapCondition;
}): JumpcloudGap {
  return {
    condition,
    fields: [...gap.fields],
    firstDetectedAt: gap.firstDetectedAt,
    id: gap.id,
    kind,
    lastCheckedAt: gap.lastCheckedAt,
    lastDetectedAt: gap.lastDetectedAt,
    reason: gap.reason,
    scope: gap.scope,
    status: gap.status,
    surfaces: [...gap.surfaces],
  };
}

/**
 * One observed gap in this atlas's stored shape.
 *
 * @param condition this atlas's own condition
 * @param kind the kind it concerns
 * @param scope where it is missing — an operation name, or the kind itself
 * @param reason why, in English
 * @param at this run's ISO timestamp
 * @returns the gap
 */
function raise({
  condition,
  kind,
  scope,
  reason,
  at,
}: {
  condition: JumpcloudGapCondition;
  kind: JumpcloudKind;
  scope: string;
  reason: string;
  at: string;
}): JumpcloudGap {
  return stored({
    condition,
    gap: openGap({ at, condition, fields: [], kind, reason, scope, surfaces: ["directory-api"] }),
    kind,
  });
}

/**
 * Every gap one kind's walk earned.
 *
 * @param walk what the walk accumulated for this kind
 * @param plan what the plan said would and would not be run
 * @param at this run's ISO timestamp
 * @returns the gaps, sorted by id
 */
export function jumpcloudKindGaps({
  walk,
  plan,
  at,
}: {
  walk: JumpcloudKindWalk;
  plan: JumpcloudKindPlan;
  at: string;
}): readonly JumpcloudGap[] {
  const gaps: JumpcloudGap[] = [];
  for (const surface of walk.emptyOperations) {
    gaps.push(
      raise({
        at,
        condition: "reachable-but-empty",
        kind: walk.kind,
        reason: `${surface} answered successfully and carried no records, so any attribute vocabulary for it was derived from zero observations — reachable and empty is not the same fact as read in full`,
        scope: surface,
      }),
    );
  }
  for (const surface of walk.incompleteOperations) {
    gaps.push(
      raise({
        at,
        condition: "unstable-page-order",
        kind: walk.kind,
        reason: `${surface} ended paging without reaching the total the provider declared — a short page with a shortfall is what an unstable page order produces, so records may be missing from this family`,
        scope: surface,
      }),
    );
  }
  for (const failure of walk.failures) {
    gaps.push(
      raise({
        at,
        condition: conditionFor({ code: failure.error.code }),
        kind: walk.kind,
        reason: failure.error.message,
        scope: failure.surface,
      }),
    );
  }
  for (const unrunnable of plan.unrunnable) {
    gaps.push(
      raise({
        at,
        condition: unrunnableCondition({ reason: unrunnable.reason }),
        kind: walk.kind,
        reason: unrunnable.detail,
        scope: unrunnable.operation.row.name,
      }),
    );
  }
  return gaps.toSorted((left, right) => left.id.localeCompare(right.id));
}

/**
 * The gap condition one PLANNED-BUT-NOT-RUN operation earns.
 *
 * The three are genuinely different facts and collapsing them would make a reader chase the wrong thing. A
 * nested parameter has no id to bind, which is `path-unbound`. A required query parameter this atlas cannot
 * source is a REQUEST CONTRACT it does not hold — the provider would answer, asked correctly — so it is
 * `request-contract-unknown` rather than a claim about the schema. Everything else is a schema the pinned
 * specification does not describe closely enough to call.
 *
 * @param reason the plan's own reason
 * @returns the condition the stored gap carries
 */
function unrunnableCondition({ reason }: { reason: JumpcloudUnrunnableReason }): JumpcloudGapCondition {
  if (reason === "nested-parameter") {
    return "path-unbound";
  }
  if (reason === "query-unbindable") {
    return "request-contract-unknown";
  }
  return "schema-drift";
}

/**
 * The gap condition one typed read failure earns.
 *
 * @param code the failure's own discriminant
 * @returns the condition this atlas records it under
 */
function conditionFor({ code }: { code: string }): JumpcloudGapCondition {
  if (code === "PATH_UNBOUND") {
    return "path-unbound";
  }
  if (code === "CREDENTIAL_REJECTED" || code === "PERMISSION_REFUSED") {
    return "auth-refused";
  }
  if (code === "REDIRECT_REFUSED") {
    return "redirect-refused";
  }
  if (code === "OPERATION_UNUSABLE") {
    return "request-contract-unknown";
  }
  if (code === "UNEXPECTED_SHAPE" || code === "BODY_SHAPE_CHANGED" || code === "SURFACE_REFUSED") {
    return "schema-drift";
  }
  return "incomplete-read";
}

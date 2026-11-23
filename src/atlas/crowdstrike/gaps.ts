/**
 * This atlas's gap lifecycle, and the classification that turns a typed provider failure into one.
 *
 * The LIFECYCLE is the kit's — accumulate, and close only when a gap's own `(condition, scope)` pair is
 * rechecked, because a gap closed by "the sync succeeded" would be closed by an unrelated success. The
 * VOCABULARY is `model.ts`'s {@link CrowdstrikeGapCondition}.
 *
 * What is genuinely this platform's own is {@link classifyCrowdstrikeGap}: one place that decides which
 * condition a failure raises, so a scope refusal on hosts and a scope refusal on vulnerabilities produce
 * the same word and a recheck can match either.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasGapRecheck, openGaps, openTypedGap, reconcileGaps } from "../kit/gaps.js";

import type { CrowdstrikeGap } from "./entities.js";
import type { CrowdstrikeError } from "./errors.js";
import type { CrowdstrikeGapCondition, CrowdstrikeKind, CrowdstrikeSurface } from "./model.js";

/**
 * The gap condition a typed provider failure raises.
 *
 * Exhaustive with a `never` default, so a new failure kind fails to compile rather than silently becoming
 * whichever condition the last `if` happened to reach.
 *
 * @param error the failure to classify
 * @returns the condition to raise for it
 */
export function classifyCrowdstrikeGap({ error }: { error: CrowdstrikeError }): CrowdstrikeGapCondition {
  switch (error.code) {
    case "SCOPE_REFUSED":
      return "scope-refused";
    case "ROUTE_ABSENT":
      return "route-absent";
    case "INCOMPLETE_READ":
      return "incomplete-read";
    case "AUTH_FAILED":
      return "auth-failed";
    case "TRANSPORT_EXHAUSTED":
      return "transport-exhausted";
    case "UNUSABLE_RESPONSE":
      return "schema-drift";
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}

/**
 * A gap observed during this run.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @param kind the entity kind this gap is about, or `null` for a cross-kind gap
 * @param surfaces which surfaces this gap concerns; empty when surface-independent
 * @param fields which fields disagree; empty unless this is a disagreement
 * @param reason why, in English
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openCrowdstrikeGap({
  condition,
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  condition: CrowdstrikeGapCondition;
  scope: string;
  kind: CrowdstrikeKind | null;
  surfaces: readonly CrowdstrikeSurface[];
  fields: readonly string[];
  reason: string;
  at: string;
}): CrowdstrikeGap {
  return openTypedGap({ at, condition, fields, kind, reason, scope, surfaces });
}

/**
 * A condition and scope that were genuinely rechecked, and what the recheck found.
 *
 * @internal
 */
export type CrowdstrikeGapRecheck = AtlasGapRecheck;

/**
 * Fold this run's gaps and rechecks into what is already stored.
 *
 * @param stored every gap already held for this kind
 * @param observed gaps this run detected
 * @param rechecks conditions and scopes this run actually rechecked
 * @param runFailed whether the run itself failed; a failed run may not close anything
 * @param at this run's ISO timestamp
 * @returns the accumulated gap list, or the reason it cannot be merged
 */
export function reconcileCrowdstrikeGaps({
  stored,
  observed,
  rechecks,
  runFailed,
  at,
}: {
  stored: readonly CrowdstrikeGap[];
  observed: readonly CrowdstrikeGap[];
  rechecks: readonly CrowdstrikeGapRecheck[];
  runFailed: boolean;
  at: string;
}): Result<readonly CrowdstrikeGap[]> {
  return reconcileGaps({ at, observed, rechecks, runFailed, stored });
}

/**
 * The open gaps, which is what a reader and a ticket list both want.
 *
 * @param gaps every gap held
 * @returns only the open ones
 */
export function openCrowdstrikeGaps({ gaps }: { gaps: readonly CrowdstrikeGap[] }): readonly CrowdstrikeGap[] {
  return openGaps({ gaps });
}

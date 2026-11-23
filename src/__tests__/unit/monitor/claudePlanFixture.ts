/**
 * The register's plan-two and its probe record, shared by the `claude-plan-unusable` evaluator's test files: one
 * plan, one store, one signed-out fault episode, and the empty closed-by-owner and open-card sets a pass starts from.
 */
import type { ClaudePlanFault, ClaudePlanProbeRecord } from "../../../claude/planProbeRecord.js";
import { type ClaudePlanInput, claudeFaultKey } from "../../../monitor/claudePlanUnusable.js";

export const STORE = "/Users/owner/.claude-accounts/plan-two";
export const EMAIL = "ada-owner-claude-2@slopweaver.ai";
export const SINCE = "2026-10-31T06:22:53.000Z";
export const LAST = "2026-10-31T07:59:23.000Z";
export const SIGNED_OUT: ClaudePlanFault = {
  code: "STORE_NOT_READY",
  lastSeenIso: LAST,
  message: "plan-two's store holds no sign-in",
  sinceIso: SINCE,
};

/**
 * A record whose last probe found {@link SIGNED_OUT}, or what `over` sets.
 *
 * @returns the probe record
 */
export function record(over: Partial<ClaudePlanProbeRecord> = {}): ClaudePlanProbeRecord {
  return {
    alias: "plan-two",
    fault: SIGNED_OUT,
    latest: "fault",
    observedAtIso: LAST,
    storeDir: STORE,
    unmeasuredBecause: undefined,
    ...over,
  };
}

/**
 * The register's plan-two, its last probe {@link record} unless `over` sets another — `undefined` included.
 *
 * @returns the plan as the evaluator reads it
 */
export function plan(over: Partial<ClaudePlanInput> = {}): ClaudePlanInput {
  return { alias: "plan-two", email: EMAIL, record: record(), storeDir: STORE, ...over };
}

export const NONE: ReadonlyMap<string, string> = new Map();
export const SHUT: ReadonlySet<string> = new Set();
export const KEY = claudeFaultKey({ alias: "plan-two", fault: SIGNED_OUT, storeDir: STORE });

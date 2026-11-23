/**
 * The REACH RECEIPT a turn's progress log carries (`./progressLog.ts`): its shape and its decode, apart from the log's
 * timeline events because a receipt is never drawn on the card — it is what `turn answer` reads before it lets browser
 * evidence through. Pure.
 */
import { type AskIdentity, askIdentityOf, isAskIdentity } from "../ask/identity.js";

/**
 * A REACH RECEIPT: `turn reach` visited every origin listed through the owner's work Chrome and found each one signed in
 * (`../../cli/commands/turn/reach.ts`). What `turn answer` reads before it lets browser evidence from one of those
 * origins reach a thread. Never on the timeline: a reachability check is not a phase of the work the card draws.
 */
export interface ProgressReachEvent {
  readonly kind: "reach";
  readonly tsIso: string;
  /**
   * The exact ask this receipt is for, carried in the line itself: the log's file name joins channel and ts with a
   * `-` and drops the thread, so two different identities can share one file and the file alone never proves whose
   * receipt it is.
   */
  readonly askIdentity: AskIdentity;
  /** Every bare origin found signed in, in the order the caller named them. */
  readonly origins: readonly string[];
}

/**
 * Decode a `reach` line. One with no origin, an origin that is not a string, or no ask identity is unreadable rather
 * than a receipt for nothing: a receipt is what lets evidence through, so a malformed one must not.
 *
 * @param record the decoded JSON object
 * @param tsIso its already-validated instant
 * @returns the receipt, or `undefined` when the line is not a well-formed one
 */
export function decodeReachRecord({
  record,
  tsIso,
}: {
  record: Record<string, unknown>;
  tsIso: string;
}): ProgressReachEvent | undefined {
  const origins = record["origins"];
  const askIdentity = record["askIdentity"];
  if (!Array.isArray(origins) || origins.length === 0 || !isAskIdentity(askIdentity)) {
    return undefined;
  }
  const strings = origins.filter((origin): origin is string => typeof origin === "string" && origin.length > 0);
  if (strings.length !== origins.length) {
    return undefined;
  }
  return { askIdentity: askIdentityOf({ source: askIdentity }), kind: "reach", origins: strings, tsIso };
}

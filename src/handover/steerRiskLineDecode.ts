/**
 * Decoding a `steer-risk` line — a session naming the uncertainty on a row's deliverable, or saying it has passed.
 *
 * Both halves are load-bearing. A standing other than the two words is unreadable rather than read as either,
 * because reading an unknown word as `cleared` would silence a risk nobody cleared, and as `at-risk` would raise one
 * nobody named. A line with no reason is unreadable too: the owner's ask is to be told WHAT the uncertainty is.
 *
 * Pure: no filesystem, no clock.
 */
import type { RunEvent } from "./ledger.js";
import { optionalText } from "./ledgerFields.js";

/**
 * Decode a recorded risk on a row's deliverable.
 *
 * @param atIso when the line was written, already decoded by the caller
 * @param payload the line's own fields
 * @returns the risk event, or `undefined` when the line names no known standing or no reason
 */
export function steerRiskEvent({
  atIso,
  payload,
}: {
  atIso: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent | undefined {
  const standing = payload["standing"];
  const why = optionalText({ key: "why", payload });
  if ((standing !== "at-risk" && standing !== "cleared") || why === undefined) {
    return undefined;
  }
  return { atIso, kind: "steer-risk", standing, why };
}

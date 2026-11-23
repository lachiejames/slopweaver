/**
 * The residue of a telemetry reading: every bound on what it saw, in the reader's own words.
 *
 * Pure prose assembly, split from `telemetry.ts` so the reader holds the query and the fold while this holds
 * what each outcome may and may not claim. The claim that matters most is the coverage line's: a live empty
 * result is "really zero failures" only when nothing the query matched went unread.
 */
import type { RetentionHorizon, ToolExecutionError, WindowCoverage } from "./telemetry.js";

/** The residue line every reading carries, whatever else happened. */
const CONTENT_BOUND_RESIDUE =
  "no prompt text, tool input or user identity is read — a failure is a tool name plus a typed error here, never the command line";

/** The residue line about who the telemetry covers. Measured, not assumed — see `telemetry.ts`'s header. */
const FLEET_BOUND_RESIDUE =
  "only accounts whose Claude Code exports OTLP to this Datadog org appear at all, so this is never automatically the fleet";

/**
 * Say what a coverage verdict means for an empty result, in one line.
 *
 * @param coverage the window's classification
 * @param retention the horizon it was classified against, or `null`
 * @param unreadableEvents matched events that failed projection — any at all and a live zero is unproven
 * @returns the residue line for this coverage
 */
function coverageResidue({
  coverage,
  retention,
  unreadableEvents,
}: {
  coverage: WindowCoverage;
  retention: RetentionHorizon | null;
  unreadableEvents: number;
}): string {
  const horizon = retention === null ? "unknown" : `${String(retention.minDays)}-${String(retention.maxDays)}d`;
  switch (coverage) {
    case "aged-out":
      return `the whole window is older than the ${horizon} log retention and there is no cold storage — nothing was queried, and this empty result is UNREADABLE, not zero failures`;
    case "partial":
      return `the window starts before the ${horizon} log retention, so what is reported is a floor: older failures in it have already aged out`;
    case "unknown":
      return "log-index retention could not be read, so an empty result cannot be told apart from an aged-out one";
    case "live":
      if (unreadableEvents > 0) {
        return `the window is entirely inside the ${horizon} log retention, but ${String(unreadableEvents)} matched event(s) went unread, so an empty result is not proven zero failures`;
      }
      return `the window is entirely inside the ${horizon} log retention, so an empty result really is zero failures`;
    default: {
      const exhaustive: never = coverage;
      return exhaustive;
    }
  }
}

/**
 * Assemble every bound on what this reading saw.
 *
 * Pure, and always non-empty: a reading that named no residue would be claiming completeness it cannot
 * have, which is the exact failure this phase exists to remove.
 *
 * @param coverage the window's classification
 * @param retention the horizon it was classified against, or `null`
 * @param truncated whether the cap stopped the read early
 * @param cap the cap that would have stopped it
 * @param unreadableEvents how many matched events failed projection
 * @param incompletePages how many pages Datadog answered with a status other than `done`
 * @param errors the projected failures, counted for how many carried no message
 * @returns the residue lines, most consequential first
 */
export function describeResidue({
  coverage,
  retention,
  truncated,
  cap,
  unreadableEvents,
  incompletePages,
  errors,
}: {
  coverage: WindowCoverage;
  retention: RetentionHorizon | null;
  truncated: boolean;
  cap: number;
  unreadableEvents: number;
  incompletePages: number;
  errors: readonly ToolExecutionError[];
}): readonly string[] {
  const lines: string[] = [coverageResidue({ coverage, retention, unreadableEvents })];
  const withheld = errors.filter((error) => error.message === null).length;
  if (withheld > 0) {
    lines.push(
      `${String(withheld)} failure(s) carried no error text — the exporter withheld the message, so each is a tool name plus a typed error`,
    );
  }
  if (truncated) {
    lines.push(`stopped at the ${String(cap)}-error cap, so this is a prefix of the window and not all of it`);
  }
  if (unreadableEvents > 0) {
    lines.push(
      `${String(unreadableEvents)} matched event(s) did not carry the tool_result shape this reader projects and were counted, not read`,
    );
  }
  if (incompletePages > 0) {
    lines.push(
      `${String(incompletePages)} page(s) came back with a status other than 'done', so those pages are partial answers`,
    );
  }
  lines.push(CONTENT_BOUND_RESIDUE, FLEET_BOUND_RESIDUE);
  return lines;
}

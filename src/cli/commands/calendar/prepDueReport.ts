/**
 * The pure report half of `calendar prep-due`: what one meeting's pass did, the exit code a pass earns, and the
 * human lines it prints. Split from `./prepDueRun.ts` for its size cap; nothing here reads or writes.
 */
import type { PrepDueMeeting, selectPrepDue } from "../../../live/calendar/prepDue.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";

/**
 * What one meeting's pass did. `existing` is a row or tag that appeared between this pass's read and its write;
 * `started` is a meeting that began while the pass was reading.
 */
export interface PrepOutcome {
  readonly slug: string;
  readonly eventId: string;
  readonly summary: string | undefined;
  readonly startIso: string;
  readonly reason: PrepDueMeeting["reason"];
  readonly outcome: "registered" | "would-register" | "existing" | "started" | "failed";
}

/**
 * The exit code a pass's outcomes earn: 1 when any failed, 0 when any row was (or would be) registered, else 3.
 *
 * @param outcomes what each qualifying meeting's pass did
 * @returns the exit code
 */
export function prepExitCode({ outcomes }: { outcomes: readonly PrepOutcome[] }): number {
  if (outcomes.some((outcome) => outcome.outcome === "failed")) {
    return EXIT_ERROR;
  }
  if (outcomes.some((outcome) => outcome.outcome === "registered" || outcome.outcome === "would-register")) {
    return EXIT_OK;
  }
  return EXIT_EXPECTED_EMPTY;
}

/**
 * The human report: one line per meeting acted on, then one per event skipped and why.
 *
 * @param outcomes what each qualifying meeting's registration did
 * @param skipped every other event in the window, with its reason
 * @returns the lines, in that order
 */
export function prepDueLines({
  outcomes,
  skipped,
}: {
  outcomes: readonly PrepOutcome[];
  skipped: ReturnType<typeof selectPrepDue>["skipped"];
}): readonly string[] {
  const lines: string[] = [];
  for (const outcome of outcomes) {
    lines.push(
      `${outcome.outcome}  ${outcome.slug}  ${outcome.startIso}  ${titleOf({ summary: outcome.summary })} (${outcome.reason})`,
    );
  }
  for (const skip of skipped) {
    lines.push(`skipped  ${skip.event.id}  ${titleOf({ summary: skip.event.summary })} — ${skip.why}`);
  }
  if (lines.length === 0) {
    lines.push("calendar prep-due: no meeting in the window");
  }
  return lines;
}

/** An event's title for a report line; a blank one is a meeting the grant sees only as busy, or one marked private. */
function titleOf({ summary }: { summary: string | undefined }): string {
  if (summary === undefined) {
    return "(untitled)";
  }
  return summary;
}

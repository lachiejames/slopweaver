/**
 * THE CHAIR'S AUTO-COMPACTION TRIAL — the supervisor chair seats its successor once its own session has been
 * auto-compacted five times.
 *
 * ## The owner's ruling, and why it is a trial
 *
 * Every model compacts at one shared 300K window (`docs/hooks/session-guards.md` § The auto-compact window), so
 * the chair no longer hands off on a token depth: it compacts, lossily, and keeps going. The owner's concern is
 * that a chair gets worse at its duties the more auto-compactions it has been through, so it hands off after a
 * fixed number of them — five, a starting guess adopted as a TRIAL. Nothing in this repository measures that five
 * is the point supervision degrades; the measurement that would settle it is named on
 * {@link AUTO_COMPACTION_HANDOFF_TRIAL_COUNT}.
 *
 * ## What counts
 *
 * Only a `compact_boundary` record whose `compactMetadata.trigger` is `auto`: a manual `/compact` is a choice the
 * chair made, not the window forcing it. A line that could hide an automatic boundary — an oversized line, any line
 * that will not parse (a torn record need not still carry the whole marker), a boundary with no trigger or one that
 * is neither `auto` nor `manual` — makes a count below five UNMEASURED rather than a comforting low number. Five
 * verified automatic boundaries prove the threshold whatever else the file holds, so the walk stops there and claims
 * "at least five", never an exact total.
 *
 * Pure: transcript lines in, a reading out. `./chairCadenceRead.ts` streams the file; `./chairCadence.ts` judges.
 */
import { isRecord } from "#lib/parsers.js";

import type { RawTranscriptLine } from "../transcripts/source.js";

/**
 * How many automatic compactions a chair session runs through before it hands off.
 *
 * A TRIAL number from the owner's ruling, not a measurement. What would settle it: the chair's correction rate per
 * outward supervisory action (`skills/supervisor/reference/ledger-and-gauges.md` § Do not hand off early defines
 * the action), bucketed by how many auto-compactions its transcript had recorded when it acted. A rate that climbs
 * before five lowers this; one flat through five raises it or retires the reason.
 */
export const AUTO_COMPACTION_HANDOFF_TRIAL_COUNT = 5;

/** One chair session's automatic compactions, as far as its transcript can say. */
export type ChairAutoCompactionReading =
  | { readonly kind: "below-trial"; readonly autoCompactions: number }
  | { readonly kind: "trial-reached"; readonly autoCompactionsAtLeast: number }
  | { readonly kind: "unmeasured"; readonly why: string };

/** The `subtype` a boundary record carries. */
const BOUNDARY_MARKER = "compact_boundary";

/** One line, read only as far as the trial needs: whether it is a boundary, and its trigger. */
type BoundaryTrigger =
  | { readonly kind: "not-boundary" }
  | { readonly kind: "boundary"; readonly trigger: string }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * Read a line's boundary trigger, and nothing else.
 *
 * Every line is parsed, never pre-filtered on the marker's text: a torn record cut before `compact_boundary` no
 * longer carries it, and skipping it would count that boundary as absent. A line that parses to anything but an
 * object is well formed and no record, so it is no boundary.
 *
 * Deliberately NOT `../sessions/compactionRecord.ts`'s `readCompactionLine`: that reader refuses a boundary with no
 * `durationMs`, which the drift monitor needs and this count does not, so five automatic boundaries missing it
 * would read UNMEASURED and never hand off.
 *
 * @param line one transcript line
 * @returns the trigger of a boundary, that the line is no boundary, or why it could not be read
 */
function readBoundaryTrigger({ line }: { line: string }): BoundaryTrigger {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return { kind: "unreadable", why: "it is not readable JSON" };
  }
  if (!isRecord(parsed) || parsed["subtype"] !== BOUNDARY_MARKER) {
    return { kind: "not-boundary" };
  }
  const metadata = parsed["compactMetadata"];
  if (!isRecord(metadata)) {
    return { kind: "unreadable", why: "a compact_boundary record carries no compactMetadata" };
  }
  const trigger = metadata["trigger"];
  if (typeof trigger !== "string") {
    return { kind: "unreadable", why: "a compact_boundary record carries no trigger" };
  }
  return { kind: "boundary", trigger };
}

/**
 * Count a chair transcript's automatic compactions, stopping at the trial count.
 *
 * Returning from inside the `for…of` closes a generator source, so a long-lived chair's transcript is read only
 * as far as its fifth automatic boundary.
 *
 * @param lines the transcript's raw lines, in file order
 * @returns the count below the trial, the trial reached, or why a count below it cannot be trusted
 */
export function countChairAutoCompactions({
  lines,
}: {
  lines: Iterable<RawTranscriptLine>;
}): ChairAutoCompactionReading {
  let autoCompactions = 0;
  let doubt: string | undefined;
  for (const raw of lines) {
    if ("oversized" in raw) {
      doubt = `line ${String(raw.lineNumber)} is too long to read, and could be an automatic compaction`;
      continue;
    }
    const read = readBoundaryTrigger({ line: raw.line });
    if (read.kind === "unreadable") {
      doubt = `line ${String(raw.lineNumber)} could be a compaction boundary but is unreadable — ${read.why}`;
      continue;
    }
    if (read.kind === "not-boundary" || read.trigger === "manual") {
      continue;
    }
    if (read.trigger !== "auto") {
      doubt = `line ${String(raw.lineNumber)} is a compaction boundary with an unknown trigger ("${read.trigger}")`;
      continue;
    }
    autoCompactions += 1;
    if (autoCompactions >= AUTO_COMPACTION_HANDOFF_TRIAL_COUNT) {
      return { autoCompactionsAtLeast: autoCompactions, kind: "trial-reached" };
    }
  }
  if (doubt !== undefined) {
    return { kind: "unmeasured", why: doubt };
  }
  return { autoCompactions, kind: "below-trial" };
}

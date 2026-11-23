/**
 * How long a call's transcript lines spent between the page and the call file — the half of a stalled transcript
 * that is ours.
 *
 * A measured call showed the owner's words stopping short of the voice for 72 s with nothing to say whether OpenAI's
 * transcription or the page's own posting held them. The page stamps a line's `atIso` as it queues it, after OpenAI's
 * transcript has reached the page; the store stamps `storedIso` as it appends it. So the gap between the two is the
 * page's queue, the console route and the verb, and a stall longer than the worst of them happened before the page
 * heard the words — upstream, in the transcription. A line written before the store stamped is not counted.
 *
 * Pure: no filesystem, no clock.
 */
import type { CallEntry } from "./callRecord.js";

/** A call's page-to-file lag over its stamped transcript lines. */
export interface TranscriptLag {
  /** How many segment lines carry both stamps. */
  readonly stamped: number;
  /** The longest page-to-file gap among them, in milliseconds, `undefined` when none is stamped. */
  readonly worstMs: number | undefined;
  /** The page's own instant on the line that took longest, `undefined` when none is stamped. */
  readonly worstAtIso: string | undefined;
}

/**
 * Measure a call's page-to-file lag from its lines as written.
 *
 * @param entries the call's lines, in file order
 * @returns how many lines were stamped, and the worst gap and where it was
 */
export function transcriptLag({ entries }: { entries: readonly CallEntry[] }): TranscriptLag {
  let stamped = 0;
  let worstMs: number | undefined;
  let worstAtIso: string | undefined;
  for (const entry of entries) {
    if (entry.kind !== "segment" || entry.storedIso === undefined) {
      continue;
    }
    stamped += 1;
    const gap = Date.parse(entry.storedIso) - Date.parse(entry.atIso);
    if (worstMs === undefined || gap > worstMs) {
      worstMs = gap;
      worstAtIso = entry.atIso;
    }
  }
  return { stamped, worstAtIso, worstMs };
}

/**
 * The lag as one line `talk calls` prints under a call, or `undefined` for a call whose lines predate the stamp.
 *
 * @param lag the call's measured lag
 * @returns the line
 */
export function transcriptLagPhrase({ lag }: { lag: TranscriptLag }): string | undefined {
  if (lag.worstMs === undefined || lag.worstAtIso === undefined) {
    return undefined;
  }
  const seconds = (Math.max(0, lag.worstMs) / 1000).toFixed(1);
  return (
    `transcript: page to file at most ${seconds} s (at ${lag.worstAtIso}, over ${String(lag.stamped)} line(s)); ` +
    `a longer stall happened before the page heard the owner, in OpenAI's transcription`
  );
}

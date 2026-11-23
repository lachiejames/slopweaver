/**
 * Which of the readings a derived judgement stands on have not answered: the ones still in flight, and the ones whose
 * read failed with nothing kept. A judgement off a reading not in hand is a spinner or a staleness mark in the
 * judgement's place, never its "not measured" sentence. Pure.
 */

import type { LiveState } from "./liveState";
import type { StalenessFact } from "./stalenessLabel";

/** What a judgement's inputs come to, read by read. */
export interface UnreadReadings {
  /** The subjects whose first read is still in flight. */
  readonly loading: readonly string[];
  /** A fact per read that failed with no earlier reading kept. */
  readonly failed: readonly StalenessFact[];
}

/**
 * Sort a judgement's inputs into the ones still reading and the ones that failed; a ready reading, stale or not, is
 * in hand and in neither.
 *
 * @param readings each input, with what it is in the page's own words
 * @returns the unread inputs
 */
export function unreadReadingsOf({
  readings,
}: {
  readings: readonly { readonly state: LiveState<unknown>; readonly subject: string }[];
}): UnreadReadings {
  const loading: string[] = [];
  const failed: StalenessFact[] = [];
  for (const { state, subject } of readings) {
    if (state.phase === "loading") {
      loading.push(subject);
    } else if (state.phase === "not-measured") {
      failed.push({ subject, why: state.why });
    }
  }
  return { failed, loading };
}

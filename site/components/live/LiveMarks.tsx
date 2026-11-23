"use client";

import type { ReactElement } from "react";

import type { LiveState } from "../../lib/liveState";
import { ReadingIndicator } from "../console/ReadingIndicator";
import { StaleMark } from "../console/StaleMark";

/**
 * The mark a drawn reading carries beside its stamp: a spinner while the read replacing it is on its way, a
 * staleness mark when the latest read failed and this is the last one that answered, else nothing.
 *
 * @param state the reading as drawn
 * @param subject what it is, in the page's own words, for the hover
 * @param row draw it on a line of its own, at the right edge, above a page that has no stamp to sit beside; the line
 *   is held at the spinner's height while the reading is current, so each poll's re-read turning it on and off never
 *   moves the page under it
 * @returns the mark, the held line for a current reading on its own row, or nothing for a current reading beside a stamp
 */
export function ReadMark<T>({
  state,
  subject,
  row = false,
}: {
  state: Extract<LiveState<T>, { phase: "ready" }>;
  subject: string;
  row?: boolean;
}): ReactElement | null {
  let mark: ReactElement | null = null;
  if (state.stale !== undefined) {
    mark = <StaleMark facts={[{ observedAtIso: state.observedAtIso, subject, why: state.stale.why }]} />;
  } else if (state.refreshing === true) {
    mark = <ReadingIndicator label={`Re-reading ${subject}`} />;
  }
  if (!row) {
    return mark;
  }
  return <div className="flex min-h-3 items-center justify-end">{mark}</div>;
}

/**
 * One staleness mark over every reading a block draws FROM beside its own: each one kept over a failed re-read is a
 * fact in the hover, so a figure off an old capacity or board reading never reads as current. Nothing when all are.
 *
 * @param readings each channel the block reads, with what it is in the page's own words
 * @param row draw it on a line of its own, at the right edge
 * @returns the mark, or nothing when no reading is stale
 */
export function StaleReadings({
  readings,
  row = false,
}: {
  readings: readonly { readonly state: LiveState<unknown>; readonly subject: string }[];
  row?: boolean;
}): ReactElement | null {
  const facts = readings.flatMap(({ state, subject }) => {
    if (state.phase !== "ready" || state.stale === undefined) {
      return [];
    }
    return [{ observedAtIso: state.observedAtIso, subject, why: state.stale.why }];
  });
  if (facts.length === 0) {
    return null;
  }
  const mark = <StaleMark facts={facts} />;
  if (!row) {
    return mark;
  }
  return <div className="flex justify-end">{mark}</div>;
}

/**
 * What a page draws where a live value goes before it has one: a spinner while the first read is in flight, a
 * staleness mark saying why when it failed. Never a sentence in the value's place.
 *
 * @param state the read, not yet a reading
 * @param subject what it is, in the page's own words and mid-sentence case ("the board"), for the hover and a screen
 *   reader
 * @param block draw it centred in a box of its own rather than inline
 * @returns the stand-in
 */
export function ReadStandIn<T>({
  state,
  subject,
  block = false,
}: {
  state: Exclude<LiveState<T>, { phase: "ready" }>;
  subject: string;
  block?: boolean;
}): ReactElement {
  if (state.phase === "loading") {
    return <ReadingIndicator label={`Reading ${subject}`} block={block} />;
  }
  return <StaleMark facts={[{ subject, why: state.why }]} block={block} />;
}

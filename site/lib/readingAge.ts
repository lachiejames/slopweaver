/**
 * Which reading a figure's age is told from, when the figure stands on more than one. Pure.
 *
 * Numbers that change between loads need to be relatively live, and a number that cannot be live yet shows its own age. A tile drawn from a live channel AND a read-once one (Fleet's Next
 * up: the reconcile reading each minute, the board once) is only as current as the older of the two, so its stamp ages
 * that one — a "just now" off the fresh channel would vouch for a figure the old one shaped.
 */

import type { LiveState } from "./liveState";

/** One reading as a stamp ages it: when it was true, whether the route stamped that instant, and what it is. */
export interface AgedReading {
  readonly observedAtIso: string;
  readonly stampedByRoute: boolean;
  /** What the reading is, in the page's own words, for the stamp's hover when it is not the tile's own. */
  readonly subject: string;
}

/**
 * The reading a stamp ages: the tile's own, unless another reading it draws from is ready and older. A reading still
 * loading or failed adds nothing here — its spinner or staleness mark is the page's to draw. An instant that does not
 * parse is never treated as fresh: another reading's unreadable instant wins, so the stamp says it cannot read it
 * rather than borrowing the fresher one's age.
 *
 * @param primary the tile's own reading
 * @param others the other channels the tile's figures are drawn from, each with what it is
 * @returns the reading the stamp should age
 */
export function oldestReadingOf({
  primary,
  others,
}: {
  primary: AgedReading;
  others: readonly { readonly state: LiveState<unknown>; readonly subject: string }[];
}): AgedReading {
  let oldest = primary;
  for (const { state, subject } of others) {
    if (state.phase !== "ready") {
      continue;
    }
    const at = Date.parse(state.observedAtIso);
    const oldestAt = Date.parse(oldest.observedAtIso);
    if (Number.isNaN(oldestAt) && oldest !== primary) {
      continue;
    }
    if (Number.isNaN(at) || at < oldestAt) {
      oldest = { observedAtIso: state.observedAtIso, stampedByRoute: state.stampedByRoute, subject };
    }
  }
  return oldest;
}

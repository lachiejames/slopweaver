/**
 * What a live read holds, and what a page draws when the latest read failed over one that had answered. Pure.
 *
 * A Queue whose refresh failed still shows the two-hour stale queue alongside a staleness indicator. So a failed read never replaces the
 * reading already drawn: the reading stays, carrying the failure's reason as `stale`, and every page's staleness mark
 * reads that reason. The transition lives here, under the hook, so every page that reads a live channel keeps its
 * last data the same way rather than each page keeping its own.
 *
 * Imports nothing, for the reason `./liveRetained.ts` gives.
 */

/** Why the reading drawn is not the latest: the latest read failed, and said this. */
export interface LiveStaleness {
  readonly why: string;
}

/** What a tile holds while it waits, and what it holds afterwards. */
export type LiveState<T> =
  | { readonly phase: "loading" }
  | {
      readonly phase: "ready";
      readonly value: T;
      readonly observedAtIso: string;
      readonly stampedByRoute: boolean;
      /** The fixture name when the value is a frozen reading, so the tile labels it in the stamp's place. */
      readonly fixture: string | undefined;
      /**
       * Set when this reading was handed over on mount — kept from an earlier page, or already on the channel —
       * and the read that replaces it is on its way. Optional so a reading built elsewhere need not name it.
       */
      readonly refreshing?: true;
      /**
       * Set when the latest read failed and this is the last reading that answered, still drawn — its stamp states
       * how old it is, and this says why nothing newer is. Never set together with {@link refreshing}.
       */
      readonly stale?: LiveStaleness;
    }
  | { readonly phase: "not-measured"; readonly why: string };

/**
 * The state a page draws after a read lands: a reading or a loading replaces whatever was drawn, and a failure
 * keeps the reading already drawn, marked stale with the failure's reason — or stays a failure when there was none.
 *
 * Loading replaces a reading on purpose: a press sends a handed-over register back to loading so that a reading from
 * before its write is never drawn. For the same reason the hook does not call this for the first read after a press
 * (`../components/live/useLive.ts`): a re-read failing after the press draws the failure, never the reading from
 * before the write.
 *
 * @param previous what the page drew before this read landed
 * @param current what this read came to on its own
 * @returns what the page draws now
 */
export function liveStateAfter<T>({
  previous,
  current,
}: {
  previous: LiveState<T>;
  current: LiveState<T>;
}): LiveState<T> {
  if (current.phase !== "not-measured" || previous.phase !== "ready") {
    return current;
  }
  return {
    fixture: previous.fixture,
    observedAtIso: previous.observedAtIso,
    phase: "ready",
    stale: { why: current.why },
    stampedByRoute: previous.stampedByRoute,
    value: previous.value,
  };
}

/**
 * The latest read's own outcome, whatever the page still draws: a reading drawn over a failed read is that failure.
 * What a count, a badge or a press must judge by, so none of them calls a stale reading current.
 *
 * @param state the state as the page draws it
 * @returns the latest read's phase, and its reason when it failed
 */
export function latestReadOf<T>({
  state,
}: {
  state: LiveState<T>;
}): { readonly phase: "loading" | "ready" } | { readonly phase: "not-measured"; readonly why: string } {
  if (state.phase === "ready" && state.stale !== undefined) {
    return { phase: "not-measured", why: state.stale.why };
  }
  if (state.phase === "not-measured") {
    return { phase: "not-measured", why: state.why };
  }
  return { phase: state.phase };
}

/**
 * Whether this page has its own first answer for a reading: drawn, current, and not a reading handed over on mount
 * that the replacing read has yet to answer. What a fact about NOW must stand on — {@link latestReadOf} calls a
 * handed-over reading ready, because a count may draw it, but it answers nothing about the page's own first read.
 *
 * @param state the state as the page draws it
 * @returns true once a read on this page answered and its answer is what is drawn
 */
export function answeredHere<T>({ state }: { state: LiveState<T> }): boolean {
  return state.phase === "ready" && state.stale === undefined && state.refreshing !== true;
}

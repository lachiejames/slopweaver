/**
 * Whether a reading saved by an earlier console process may be drawn on this page — pure, so every arm is a test.
 *
 * The first load after an update took about ten seconds, on the Queue and on Fleet, waiting out the whole board read, so saved
 * data is drawn marked as refreshing. `site/components/live/useLive.ts` already draws a kept reading marked refreshing
 * on a REVISIT (`./liveRetained.ts`), but that register is page memory and an app restart empties it. The console
 * server saves each successful real read (`./savedReadings.ts`) and a new page asks for those once; this decides,
 * per key, where one of them may go.
 *
 * **A saved reading only ever fills a gap, and only before this page has an answer of its own.** It is drawn
 * provisional, so the read already under way replaces it; it is dropped once this page has delivered an answer for
 * the key, since that answer is newer than anything on disk; and it is dropped for a key pressed on this page AT
 * ALL, since a press means the register moved and a reading from before it must never come back (the same reason
 * `./liveRetained.ts`'s `forget` exists). A live channel already holding a reading keeps it, and so does a retained
 * entry.
 *
 * Imports NOTHING, for the reason `./queueFreshness.ts` gives: the unit lane reaches this file from a root that
 * resolves modules differently from the site.
 */

/** Where a saved reading goes: onto the key's live channel, into the retained register, or nowhere. */
export type SavedReadingDraw = "channel" | "retained" | "drop";

/**
 * Decide where one key's saved reading goes when the saved readings land.
 *
 * @param delivered how many answers this page has delivered for the key, across every channel it has had
 * @param pressed how many presses this page has had on the key
 * @param channel the key's live channel, `undefined` when none is alive; `hasLast` is whether it holds a reading
 * @param retained whether the retained register holds an entry for the key
 * @returns where the saved reading is drawn from, or `drop`
 */
export function savedReadingDraw({
  delivered,
  pressed,
  channel,
  retained,
}: {
  delivered: number;
  pressed: number;
  channel: { readonly hasLast: boolean } | undefined;
  retained: boolean;
}): SavedReadingDraw {
  if (delivered > 0 || pressed > 0) {
    return "drop";
  }
  if (channel !== undefined) {
    if (channel.hasLast) {
      return "drop";
    }
    return "channel";
  }
  if (retained) {
    return "drop";
  }
  return "retained";
}

/** What an answer that just landed does to a key's saved reading, wherever the saved reading has since moved. */
export interface SavedOutlived {
  /** Stop tracking the saved reading: this page has an answer of its own for the key. */
  readonly settled: boolean;
  /** The retained register still holds the saved reading, so forget it. */
  readonly forgetRetained: boolean;
  /** Another channel, live now, still holds the saved reading, so hand it the answer in its place. */
  readonly replaceLive: boolean;
  /** That other channel's last answered reading is the saved one, so clear it before the answer is handed over. */
  readonly clearLiveAnswered: boolean;
  /** The channel the answer landed on keeps the saved one as its last answered reading, so clear that too. */
  readonly clearOnAnswered: boolean;
}

/**
 * Decide what an answer this page just received does to the key's SAVED reading, which must never be drawn after it.
 *
 * A channel torn down with its read in flight lands that read on the dead channel, which nothing reads. Meanwhile the saved reading can have gone into the retained register (the saved readings landed in
 * the gap, or a channel that drew it retired it) or on from there into a new live channel a remount opened. Either
 * way the arrival held is the saved one itself, so identity is the test, over BOTH places a holder keeps one: its last
 * arrival, and its last answered one, which a later failed fetch leaves underneath to draw marked stale.
 * Forgetting a retained one leaves the next mount on loading; a live one takes
 * the answer in its place, and a last answered slot still holding it is emptied before the answer is handed over, so
 * the slot holds the answer only if a reader draws it.
 *
 * Only a SUCCESSFUL answer outlives a saved reading. A fetch that never reached its verb, or a verb that answered NOT
 * MEASURED, carries no reading newer than the saved one: the page draws the saved one marked stale beneath it, exactly
 * as it does any reading it kept (`site/lib/liveState.ts`'s `liveStateAfter`), and the saved reading stays tracked
 * until a successful answer clears it.
 *
 * @param answered whether what landed is a successful reading from the verb
 * @param saved the saved arrival admitted for the key, `undefined` when none was or it is already settled
 * @param onAnswered the last answered arrival of the channel the answer landed on
 * @param retained what the retained register holds for the key, `undefined` when nothing
 * @param otherLive what the key's live channel holds when that is not the channel the answer landed on, `undefined`
 *   otherwise
 * @returns what to clear
 */
export function savedOutlived<A>({
  answered,
  saved,
  onAnswered,
  retained,
  otherLive,
}: {
  answered: boolean;
  saved: A | undefined;
  onAnswered: A | undefined;
  retained: { readonly last: A | undefined; readonly answered: A | undefined } | undefined;
  otherLive: { readonly last: A | undefined; readonly answered: A | undefined } | undefined;
}): SavedOutlived {
  if (!answered || saved === undefined) {
    return {
      clearLiveAnswered: false,
      clearOnAnswered: false,
      forgetRetained: false,
      replaceLive: false,
      settled: false,
    };
  }
  // `saved` is defined past the guard above, so an absent holder compares `undefined` to it and is never a match.
  const liveAnswered = otherLive?.answered === saved;
  return {
    clearLiveAnswered: liveAnswered,
    clearOnAnswered: onAnswered === saved,
    forgetRetained: retained?.last === saved || retained?.answered === saved,
    replaceLive: liveAnswered || otherLive?.last === saved,
    settled: true,
  };
}

/**
 * The `queue-pinned` step of `slopweaver desktop e2e`, its pure half: what the tab strip must show after each of the
 * three moves the step makes, judged from snapshots the effectful half (`../cli/commands/desktop/e2ePinnedQueue.ts`)
 * reads off the real app.
 *
 * The requirement: the voice's `browser_open` of the Queue never opens a SECOND Queue tab, and the next card follows
 * into the pinned one — the owner controls one static tab that never closes, and expects to be taken over to it when
 * a Queue card opens or the voice moves on to the next thing. No other step could see that:
 * `queue-card` clicks a row in the page it stands on, and `card-read` proves `open_card` ran, not which tab took it.
 *
 * The moves, in order, each judged against the snapshot just before it:
 *
 * - `beside` — a deep link to a page other than the Queue (`/alignment`) opens ONE new tab, in front of the pinned one.
 *   It is the setup: with another tab in front, the next two moves have somewhere wrong to land.
 * - `card` — the voice window's `presentConsoleCard`, exactly what `open_card` sends, opens a real Queue card. No tab
 *   is added, the pinned tab is the one showing, it is on that card, and exactly one console page is on the Queue.
 * - `queue` — the deep link the voice's `browser_open` minted on that call (`/queue?…`), after another `beside`. No tab
 *   is added, the pinned tab is the one showing, and exactly one console page is on the Queue.
 *
 * Pure.
 */

/** What the app showed at one moment of the step. */
export interface PinnedQueueSnapshot {
  /** The tabs in the strip. */
  readonly tabs: number;
  /** The pinned tab is the one selected in the strip. */
  readonly pinnedSelected: boolean;
  /** How many console pages stand on the Queue (`/queue`, any query or hash). */
  readonly queuePages: number;
  /** The pinned tab's page address, path and query, or `undefined` when it could not be read. */
  readonly pinnedAddress: string | undefined;
}

/** One of the step's three moves. */
export type PinnedQueueMove =
  { readonly kind: "beside" } | { readonly kind: "card"; readonly cardKey: string } | { readonly kind: "queue" };

/**
 * Whether one move left the strip as the one-Queue-tab steer requires, and if not, every way it did not.
 *
 * @param move what the step just did
 * @param before the snapshot just before it
 * @param after the snapshot once it settled
 * @returns every requirement the move broke, in the owner's terms; empty when it held
 */
export function pinnedQueueBreaks({
  move,
  before,
  after,
}: {
  move: PinnedQueueMove;
  before: PinnedQueueSnapshot;
  after: PinnedQueueSnapshot;
}): readonly string[] {
  if (move.kind === "beside") {
    const breaks: string[] = [];
    if (after.tabs !== before.tabs + 1) {
      breaks.push(`a page beside the Queue left ${String(after.tabs)} tab(s), not ${String(before.tabs + 1)}`);
    }
    if (after.pinnedSelected) {
      breaks.push("a page beside the Queue did not come in front of the pinned tab");
    }
    return breaks;
  }
  const what = move.kind === "card" ? "the voice's card" : "the voice's Queue link";
  const breaks: string[] = [];
  if (after.tabs !== before.tabs) {
    breaks.push(`${what} left ${String(after.tabs)} tab(s), not ${String(before.tabs)}: it opened a tab of its own`);
  }
  if (!after.pinnedSelected) {
    breaks.push(`${what} did not take the owner over to the pinned Queue tab`);
  }
  if (after.queuePages !== 1) {
    breaks.push(`${what} left ${String(after.queuePages)} console page(s) on the Queue, not exactly one`);
  }
  if (move.kind === "card" && openKeyOf({ address: after.pinnedAddress }) !== move.cardKey) {
    breaks.push(`the pinned tab is not on ${move.cardKey} (it reads ${String(after.pinnedAddress)})`);
  }
  return breaks;
}

/* The card a console address has open, or `undefined` for an address that names none or could not be read. */
function openKeyOf({ address }: { address: string | undefined }): string | undefined {
  if (address === undefined) {
    return undefined;
  }
  const open = new URL(address, "http://console.invalid").searchParams.get("open");
  if (open === null) {
    return undefined;
  }
  return open;
}

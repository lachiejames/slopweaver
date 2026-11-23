/**
 * The last reading of a channel nobody is reading any more, kept so the next page that reads it shows it at once
 * instead of "loading" — pure, so the hand-off and every invalidation are unit tests.
 *
 * `site/components/live/useLive.ts` tears a channel down when its last subscriber unmounts, which is every route
 * change for a slug only one page reads. Before this, the next visit to that page drew every such tile as
 * "loading" for the whole of its first read (0.94–5.8 s measured per call). Now the channel's last arrival is
 * handed here at teardown ({@link retire}) and back at the next channel's creation ({@link take}), and the
 * tile shows it — with its own stamp, which states its true age, and a mark saying a fresh read is on its way.
 *
 * **Handed off at teardown, never written on every arrival.** A cache written on arrival would also take the
 * answer of a read still in flight when its page unmounted, and if that read started before a press it would
 * refill the entry the press had just cleared. Handed off, such an orphan writes only its own dead channel,
 * which nothing reads. The cost, named: an arrival landing after teardown is dropped, and the next mount reads
 * again anyway.
 *
 * **While a channel is alive, this holds nothing for its key**, so the channel's own `last` is the one source of
 * truth: a press clears that, and {@link forget} clears this for a key with no channel. There is no expiry — the
 * entry is on screen for one route call, the stamp states its age, and memory is bounded by the key set.
 *
 * Generic over the arrival, and it imports NOTHING, for the reason `./queueFreshness.ts` gives: the unit lane
 * reaches this file from a root that resolves modules differently from the site.
 */

/**
 * An empty register: one retained arrival per channel key.
 *
 * @returns the register
 */
export function openRetained<A>(): Map<string, A> {
  return new Map<string, A>();
}

/**
 * Hand a torn-down channel's last arrival to the register, or clear the key when there is nothing worth keeping.
 *
 * Deleting rather than leaving an older entry is the point of both clearing arms: a channel a press emptied, then
 * torn down before the re-read landed, must not bring back the reading from before the press. An older success
 * comes back only when the arrival itself carries it — the hook keeps a channel's last answered reading beside a
 * later failure, and draws it marked stale (`./liveState.ts`).
 *
 * @param retained the page's register
 * @param key the channel's key
 * @param last the channel's last arrival, `undefined` when a press cleared it or nothing ever arrived
 * @param keeps whether an arrival is an honest last word worth showing on the next mount
 */
export function retire<A>({
  retained,
  key,
  last,
  keeps,
}: {
  retained: Map<string, A>;
  key: string;
  last: A | undefined;
  keeps: (arrival: A) => boolean;
}): void {
  if (last !== undefined && keeps(last)) {
    retained.set(key, last);
    return;
  }
  retained.delete(key);
}

/**
 * Take a key's retained arrival out of the register, to seed a channel being created for it.
 *
 * @param retained the page's register
 * @param key the channel's key
 * @returns the arrival, once; `undefined` when none was kept or it was already taken
 */
export function take<A>({ retained, key }: { retained: Map<string, A>; key: string }): A | undefined {
  const kept = retained.get(key);
  retained.delete(key);
  return kept;
}

/**
 * Clear a key's retained arrival, because the register it read has moved.
 *
 * @param retained the page's register
 * @param key the channel's key
 */
export function forget<A>({ retained, key }: { retained: Map<string, A>; key: string }): void {
  retained.delete(key);
}

/**
 * What a component mounting on a key should draw first — read only, so a render can call it.
 *
 * A live channel always wins, EVEN WHEN its `last` is `undefined`: that is a channel a press emptied, and it must
 * show loading until the re-read lands, never a reading the register has moved past.
 *
 * @param retained the page's register
 * @param key the channel's key
 * @param live the key's live channel, `undefined` when none is alive
 * @returns the arrival to draw, or `undefined` for loading
 */
export function firstArrival<A>({
  retained,
  key,
  live,
}: {
  retained: Map<string, A>;
  key: string;
  live: { readonly last: A | undefined } | undefined;
}): A | undefined {
  if (live !== undefined) {
    return live.last;
  }
  return retained.get(key);
}

/**
 * The last reading each by-id read landed on this page, kept so a failed re-read draws it marked stale rather than
 * the failure alone — the by-id hooks' half of `./liveState.ts`'s rule, which `useLive`'s channels keep for a
 * register. A card or panel re-opened mounts its hook afresh, so the reading lives here, by id, not in the hook.
 *
 * Pure: the store is a plain map the caller owns, and the rule is one function over it.
 */

/** How many readings a store keeps before dropping the oldest — a page opens a bounded number of cards. */
export const KEPT_READINGS_MAX = 50;

/** A read's settled answer, whichever hook's shape its ready half has. */
type Settled<R> = R | { readonly phase: "not-measured"; readonly why: string };

/**
 * What a hook draws once a read of `id` lands: a ready reading replaces the kept one; a failure over a kept reading
 * draws that reading with `stale` carrying the failure's reason; a failure with nothing kept is the failure.
 *
 * @param kept the store, by id, changed in place when the read answered
 * @param id what was read
 * @param next what the read came to on its own
 * @returns what the hook draws now
 */
export function keptOverFailure<R extends { readonly phase: "ready" }>({
  kept,
  id,
  next,
}: {
  kept: Map<string, R>;
  id: string;
  next: Settled<R>;
}): Settled<R & { readonly stale?: { readonly why: string } }> {
  if (next.phase === "ready") {
    kept.delete(id);
    kept.set(id, next);
    while (kept.size > KEPT_READINGS_MAX) {
      const oldest = kept.keys().next();
      if (oldest.done === true) {
        break;
      }
      kept.delete(oldest.value);
    }
    return next;
  }
  const earlier = kept.get(id);
  if (earlier === undefined) {
    return next;
  }
  return { ...earlier, stale: { why: next.why } };
}

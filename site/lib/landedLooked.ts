/**
 * The Fleet page's "what landed since you last looked": the owner comes back to their computer after a while and wants to know what
 * has landed since. Pure; the mark itself is
 * kept by `components/live/useLastLooked.ts` under this page's own key.
 */

/** The `localStorage` key the landed history's mark lives under, one per browser like the theme. */
export const LANDED_LOOKED_KEY = "sw-fleet-landed-last-looked";

/** How many landings the owner has not seen, or that there is no mark to count from. */
export type LandedSince =
  /** No mark in this browser, or one that does not parse — nothing is claimed new. */
  | { readonly kind: "unmarked" }
  /**
   * The count after the mark. `atLeast` when every landing in a FULL window is newer than the mark, so more may sit
   * beyond the window the verb read.
   */
  | { readonly kind: "since"; readonly count: number; readonly atLeast: boolean };

/**
 * How many landings fall strictly after the mark.
 *
 * @param landings the window read, in any order
 * @param lookedIso the moment the owner last looked, `null` when this browser has never shown the page
 * @param limit how many the verb was asked for — the window's size, so a full one is never read as all of history
 * @returns the count and whether it is a floor, or that there is no mark
 */
export function landedSince({
  landings,
  lookedIso,
  limit,
}: {
  landings: readonly { readonly mergedIso: string }[];
  lookedIso: string | null;
  limit: number;
}): LandedSince {
  if (lookedIso === null) {
    return { kind: "unmarked" };
  }
  const looked = Date.parse(lookedIso);
  if (Number.isNaN(looked)) {
    return { kind: "unmarked" };
  }
  const count = landings.filter((one) => Date.parse(one.mergedIso) > looked).length;
  return { atLeast: count > 0 && count === landings.length && landings.length >= limit, count, kind: "since" };
}

/**
 * The tile's opening line.
 *
 * @param since the count
 * @param shown how many landings the window holds
 * @returns the sentence
 */
export function landedSinceLine({ since, shown }: { since: LandedSince; shown: number }): string {
  if (since.kind === "unmarked") {
    return `the last ${String(shown)} changes to land on main, newest first`;
  }
  if (since.count === 0) {
    return "nothing has landed on main since you last looked";
  }
  let count = String(since.count);
  if (since.atLeast) {
    count = `at least ${count}`;
  }
  let noun = "changes";
  if (since.count === 1) {
    noun = "change";
  }
  return `${count} ${noun} landed on main since you last looked`;
}

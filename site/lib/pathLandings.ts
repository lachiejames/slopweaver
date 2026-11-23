/**
 * Who waits for the console's address to land on a pathname. A router move returns before its navigation commits, so
 * `open_card` in a plain browser waits here for the page to say it reached the card's path, inside the call's own
 * deadline: a move still pending at the deadline is answered as possibly still landing, never as opened.
 */

/** The waits on each pathname, and the one call the page makes as its pathname changes. */
export interface PathLandings {
  /**
   * A wait that settles once the page reports this pathname. Registered BEFORE the move starts, so a navigation that
   * commits at once is never missed.
   *
   * @returns a promise settling when the pathname lands
   */
  readonly waitFor: (input: { readonly pathname: string }) => Promise<void>;
  /** The page reached this pathname: every wait on it settles and is dropped. */
  readonly landed: (input: { readonly pathname: string }) => void;
  /**
   * How many waits are still out, on every pathname.
   *
   * @returns the count
   */
  readonly pending: () => number;
}

/**
 * A fresh registry of path waits. A wait whose call's time ran out stays until its pathname lands or a later move
 * there settles it; nothing awaits it by then, so settling it late changes no answer.
 *
 * @returns the registry
 */
export function pathLandings(): PathLandings {
  const waits = new Map<string, (() => void)[]>();
  return {
    landed: ({ pathname }) => {
      const settle = waits.get(pathname);
      if (settle === undefined) {
        return;
      }
      waits.delete(pathname);
      for (const one of settle) {
        one();
      }
    },
    pending: () => [...waits.values()].reduce((sum, list) => sum + list.length, 0),
    waitFor: ({ pathname }) =>
      new Promise<void>((resolve) => {
        let list = waits.get(pathname);
        if (list === undefined) {
          list = [];
          waits.set(pathname, list);
        }
        list.push(resolve);
      }),
  };
}

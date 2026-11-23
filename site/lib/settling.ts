/**
 * Which Queue rows a press is settling — the optimistic half of a press, pure so the rule is a test.
 *
 * A press is two child processes before the list moves: the act itself (`/api/act`), then the re-read of the
 * register it wrote (`refreshLive`). `slopweaver perf console` measured each at one to several seconds on the owner's
 * machine, so a row they had just marked done sat there unchanged for all of it. A pressed row is drawn as
 * settling the moment the owner presses, and the list catches up when the re-read lands.
 *
 * It never claims an outcome. The mark says "pressed, on its way", not "done": a refused or unknown press clears
 * it at once, so the row is drawn exactly as before with the panel's outcome line saying why; a done press keeps
 * it only until the register has been read again, after which the row is either gone or drawn as the register
 * now has it.
 */

/** One pressed row: the register its press re-reads, and — once the act answered done — that press's place in the register's order of presses. */
export interface Settling {
  readonly readsSlug: string;
  readonly pressedAs: number | undefined;
}

/**
 * Whether a row is still drawn settling.
 *
 * @param held the row's mark, if it has one
 * @param answered the latest press a LANDED answer of the mark's register was read after (`livePressOrderOf`) — a
 *   failed re-read never moves it, nor does an answer from a read that left before the press
 * @returns true while the press is in flight, or done and not yet answered by a read that left after it
 */
export function isSettling({ held, answered }: { held: Settling | undefined; answered: number }): boolean {
  if (held === undefined) {
    return false;
  }
  if (held.pressedAs === undefined) {
    return true;
  }
  return answered < held.pressedAs;
}

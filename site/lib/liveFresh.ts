/**
 * Whether a live key still owes a press a `fresh` read — pure, so the rule is a unit test.
 *
 * A press's read goes out `fresh=1` so the route never answers it from a flight that left before the write
 * (`./liveFlights.ts`). Measured: that read failing before it reached the route left its RETRY going out
 * plain, which rode exactly the pre-press flight `fresh` exists to refuse; and a press made with no channel alive
 * left the next channel's first read plain too. So the debt is the key's, not the read's or the channel's, and only
 * an answer landed by a fresh read that left AFTER the last press pays it.
 */

/**
 * Whether the key still owes a fresh read once one of its reads has come back.
 *
 * @param owed the key owes a fresh read now
 * @param sentFresh this read went out `fresh`
 * @param landed this read brought back an answer from the route, rather than failing
 * @param pressedSince a press moved the key after this read left, so its answer may predate that write
 * @returns true while a later read must still go out fresh
 */
export function stillOwesFresh({
  owed,
  sentFresh,
  landed,
  pressedSince,
}: {
  owed: boolean;
  sentFresh: boolean;
  landed: boolean;
  pressedSince: boolean;
}): boolean {
  if (pressedSince) {
    return true;
  }
  return owed && !(sentFresh && landed);
}

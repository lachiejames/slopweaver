/**
 * Whether a relay's turn record kept all of what the owner said, read at each end on its own. The record stores two
 * independent facts — `heardTruncated` (only the tail was kept) and `heardTailCut` (the words end before the owner did)
 * — so a quote can have lost its start, its end, both, or not say about either; `talk unread` marks each end by its
 * own fact (`./quietBatches.ts`). An absent fact is never read as "kept".
 */
import type { TurnRecord } from "./relayStore.js";

/** What a turn record says about one end of the owner's words: every word there, lost, or never said. */
type HeardEdge = "kept" | "lost" | "unknown";

/** Both ends of a relay's words, each read from its own stored fact. */
export interface HeardEdges {
  /** `lost` on a record that kept only the tail (`heardTruncated`). */
  readonly start: HeardEdge;
  /** `lost` on a relay made while the owner was still speaking (`heardTailCut`); a typed steer is whole by construction. */
  readonly end: HeardEdge;
}

/**
 * Read both ends of a relay's words, independently, so a record that lost its start and its end — or says one and not
 * the other — is never collapsed into a single state.
 *
 * @param turn the relay's turn record
 * @returns what it says about each end
 */
export function heardEdges({
  turn,
}: {
  turn: Pick<TurnRecord, "heardTailCut" | "heardTruncated" | "typed">;
}): HeardEdges {
  return {
    end: edgeOf({ fact: turn.heardTailCut, wholeWhenUnsaid: turn.typed }),
    start: edgeOf({ fact: turn.heardTruncated, wholeWhenUnsaid: false }),
  };
}

/** One end from its stored fact: `true` lost it, `false` kept it, absent unknown unless the end is whole by construction. */
function edgeOf({ fact, wholeWhenUnsaid }: { fact: boolean | undefined; wholeWhenUnsaid: boolean }): HeardEdge {
  if (fact === true) {
    return "lost";
  }
  if (fact === false || wholeWhenUnsaid) {
    return "kept";
  }
  return "unknown";
}

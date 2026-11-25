/**
 * Whether a relay's turn record kept all of what the owner said, read at each end on its own. The record stores two
 * independent facts — `heardTruncated` (only the tail was kept) and `heardTailCut` (the words end before the owner did)
 * — so a quote can have lost its start, its end, both, or not say about either; `talk unread` marks each end by its
 * own fact (`./quietBatches.ts`) and `profile words` says each (`../profile/ownerWords.ts`). An absent fact is never
 * read as "kept".
 */
import { type OwnerWordsEdges, ownerWordsEdge } from "../profile/ownerWordsEdges.js";
import type { TurnRecord } from "./relayStore.js";

/**
 * Read both ends of a relay's words, independently, so a record that lost its start and its end — or says one and not
 * the other — is never collapsed into a single state. The start is lost on a record that kept only the tail
 * (`heardTruncated`); the end on a relay made while the owner was still speaking (`heardTailCut`), and a typed steer's
 * end is whole by construction.
 *
 * @param turn the relay's turn record
 * @returns what it says about each end
 */
export function heardEdges({
  turn,
}: {
  turn: Pick<TurnRecord, "heardTailCut" | "heardTruncated" | "typed">;
}): OwnerWordsEdges {
  return {
    end: ownerWordsEdge({ known: turn.typed || turn.heardTailCut !== undefined, lost: turn.heardTailCut === true }),
    start: ownerWordsEdge({ known: turn.heardTruncated !== undefined, lost: turn.heardTruncated === true }),
  };
}

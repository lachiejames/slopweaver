/**
 * Filling each amending memory's row state from the board. Pure: the resolver is injected, so this module never
 * imports `src/handover` — that closure carries `typescript` itself, and every `memory` verb, the PostToolUse
 * hook and the state repo's pre-push gate import this layer. The CLI edge
 * (`src/cli/commands/memory/judgedCorpus.ts`) lazy-loads the real resolver only when a leaf declares a row.
 *
 * Stated residue: a caller that skips resolution leaves every declaration `unresolved`, and then only the
 * "names no row at all" half of `amends-canon-without-row` can fire. Every production reader goes through that
 * one CLI helper, which is the mitigation.
 */
import type { AmendsRowState, MemoryCorpus } from "./types.js";

/**
 * Every distinct board row an amending memory names, sorted.
 *
 * @param corpus the classified corpus
 * @returns the declared rows; empty when no leaf declares one, which is when nothing needs resolving
 */
export function declaredAmendsRows({ corpus }: { corpus: MemoryCorpus }): readonly string[] {
  const rows = new Set<string>();
  for (const leaf of corpus.leaves) {
    if (leaf.amendsCanon?.row != null) {
      rows.add(leaf.amendsCanon.row);
    }
  }
  return [...rows].toSorted();
}

/**
 * The same corpus with each declared row's board state on its leaf. The resolver is asked once per distinct
 * row, however many memories name it.
 *
 * @param corpus the classified corpus
 * @param rowState what the board says about one row
 * @returns a new corpus; leaves declaring no row are returned as they were
 */
export function withAmendsRowStates({
  corpus,
  rowState,
}: {
  corpus: MemoryCorpus;
  rowState: (args: { row: string }) => AmendsRowState;
}): MemoryCorpus {
  const states = new Map(declaredAmendsRows({ corpus }).map((row) => [row, rowState({ row })]));
  return {
    ...corpus,
    leaves: corpus.leaves.map((leaf) => {
      const amends = leaf.amendsCanon;
      if (amends?.row == null) {
        return leaf;
      }
      return { ...leaf, amendsCanon: { ...amends, rowState: states.get(amends.row)! } };
    }),
  };
}

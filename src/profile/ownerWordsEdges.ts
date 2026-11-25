/**
 * What a record says about each end of a user's words, read on its own: every word there, lost, or never said. A
 * record can have lost its start, its end, both, or say nothing about either, so the two ends are two facts and never
 * one collapsed state. A relay reads its ends from its own stored facts (`../talk/relayHeardCut.ts`), a call stretch
 * and a chair turn from theirs (`./ownerWords.ts`). An end the record never recorded is `unknown`, never `kept`.
 */

/** One end of a record's words. */
export type OwnerWordsEdge = "kept" | "lost" | "unknown";

/** Both ends of a record's words, each read from its own fact. */
export interface OwnerWordsEdges {
  readonly start: OwnerWordsEdge;
  readonly end: OwnerWordsEdge;
}

/**
 * One end from the two facts a record carries about it. A lost end reads lost even where the record also fails to say
 * it knew, since losing words is itself a statement about that end.
 *
 * @param lost the record says words at this end are missing
 * @param known the record says anything at all about this end, or the end is whole by construction
 * @returns `lost`, `kept` or `unknown`
 */
export function ownerWordsEdge({ lost, known }: { lost: boolean; known: boolean }): OwnerWordsEdge {
  if (lost) {
    return "lost";
  }
  if (known) {
    return "kept";
  }
  return "unknown";
}

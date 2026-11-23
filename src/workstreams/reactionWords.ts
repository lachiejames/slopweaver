/**
 * The owner's words for a mined candidate, and the ones a ruling can carry alone. A leaf with no imports, so the console's
 * copy (`site/lib/workstreamCandidatesTypes.ts`) can be bound to it by a test in the site lane, which type-checks what it
 * imports without this package's dependencies. Pure.
 */

/**
 * The owner's words, in the order the page shows them: the five they answer a candidate with, then the ones that place it
 * against what already exists. `done` reached its outcome and is kept as a closing entry, never dropped; `same-as` is
 * a workstream the register already holds, named; `milestone-of` is a step inside one, filed as its own milestone;
 * `outcome-of` is something one produces, never a step on its way; `superseded` was replaced by something else, named;
 * `abandoned` ended without its outcome and always carries why, with the anchor where the owner said it. A decline names whose it is, or the workstream
 * that covers it as a side effect.
 */
export const REACTIONS = [
  "yes",
  "no",
  "sort-of",
  "not-sure",
  "lets-talk",
  "done",
  "same-as",
  "milestone-of",
  "outcome-of",
  "superseded",
  "abandoned",
] as const;

/** One of the owner's words. */
export type Reaction = (typeof REACTIONS)[number];

/**
 * The words a ruling can carry alone, with nothing named beside them — what the console voice relays, since a relay
 * names no workstream it is the same as, a milestone or outcome of, or what superseded it. A placing word spoken on a
 * call is recorded by the seat with its target (`workstreams react`), never relayed half-said.
 */
export const STANDALONE_REACTIONS: readonly Reaction[] = REACTIONS.filter(
  (word) => word !== "same-as" && word !== "milestone-of" && word !== "outcome-of" && word !== "superseded",
);
